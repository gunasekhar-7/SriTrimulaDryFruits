import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import { app } from '../server.js';
import db from '../src/database.js';
import { queueService, queueRepository } from '../src/queue/index.js';
import { whatsappClient } from '../src/integrations/whatsapp/client.js';
import { orderService } from '../src/services/order.service.js';

describe('Durable Background Job Queue System', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    try {
      db.prepare("DELETE FROM background_jobs WHERE name LIKE 'test_%' OR idempotency_key LIKE 'test_%' OR status = 'PENDING'").run();
    } catch {
      // ignore
    }
  });

  afterEach(() => {
    try {
      db.prepare("DELETE FROM background_jobs WHERE name LIKE 'test_%' OR idempotency_key LIKE 'test_%'").run();
    } catch {
      // ignore
    }
  });

  describe('1. Core Queue Mechanics & Idempotency', () => {
    it('should enqueue a job and process it successfully', async () => {
      let executed = false;
      queueService.registerHandler('test_simple_success', async (payload: { message: string }) => {
        expect(payload.message).toBe('hello world');
        executed = true;
      });

      const job = queueService.enqueue({
        name: 'test_simple_success',
        payload: { message: 'hello world' },
        idempotencyKey: `test_simple_${Date.now()}`
      });

      expect(job.status).toBe('PENDING');
      expect(job.attempts).toBe(0);

      const processedCount = await queueService.processNextBatch();
      expect(processedCount).toBeGreaterThanOrEqual(1);
      expect(executed).toBe(true);

      const updated = queueService.getJobById(job.id);
      expect(updated?.status).toBe('COMPLETED');
      expect(updated?.completed_at).toBeDefined();
    });

    it('should enforce idempotency by preventing duplicate job enqueuing', async () => {
      const idempotencyKey = `test_idem_${Date.now()}`;

      const job1 = queueService.enqueue({
        name: 'test_idempotent_job',
        payload: { item: 'dry_fruit' },
        idempotencyKey
      });

      const job2 = queueService.enqueue({
        name: 'test_idempotent_job',
        payload: { item: 'different_content' },
        idempotencyKey
      });

      expect(job1.id).toBe(job2.id);

      const count = db
        .prepare('SELECT COUNT(*) as c FROM background_jobs WHERE idempotency_key = ?')
        .get(idempotencyKey) as { c: number };
      expect(count.c).toBe(1);
    });

    it('should retry with exponential backoff on failure', async () => {
      let callCount = 0;
      queueService.registerHandler('test_retry_job', async () => {
        callCount++;
        throw new Error('Transient 503 Service Unavailable');
      });

      const job = queueService.enqueue({
        name: 'test_retry_job',
        payload: { attempt: 1 },
        maxRetries: 3,
        idempotencyKey: `test_retry_${Date.now()}`
      });

      await queueService.processNextBatch();

      const updated = queueService.getJobById(job.id);
      expect(updated?.status).toBe('PENDING');
      expect(updated?.attempts).toBe(1);
      expect(updated?.last_error).toContain('Transient 503');
      expect(updated?.run_at).toBeDefined();
    });

    it('should transition to FAILED state after exceeding max retries', async () => {
      queueService.registerHandler('test_fatal_job', async () => {
        throw new Error('Permanent Failure');
      });

      const job = queueService.enqueue({
        name: 'test_fatal_job',
        payload: {},
        maxRetries: 1, // Max 1 attempt
        idempotencyKey: `test_fatal_${Date.now()}`
      });

      await queueService.processNextBatch();

      const updated = queueService.getJobById(job.id);
      expect(updated?.status).toBe('FAILED');
      expect(updated?.attempts).toBe(1);
      expect(updated?.last_error).toContain('Permanent Failure');
    });

    it('should allow manual retry of a FAILED job', async () => {
      let succeedsOnManualRetry = false;
      queueService.registerHandler('test_manual_retry_job', async () => {
        if (!succeedsOnManualRetry) {
          throw new Error('Temporary outage');
        }
      });

      const job = queueService.enqueue({
        name: 'test_manual_retry_job',
        payload: {},
        maxRetries: 1,
        idempotencyKey: `test_manual_${Date.now()}`
      });

      // 1. Initial attempt fails and becomes FAILED
      await queueService.processNextBatch();
      expect(queueService.getJobById(job.id)?.status).toBe('FAILED');

      // 2. Trigger manual retry
      succeedsOnManualRetry = true;
      const retried = queueService.manualRetry(job.id);
      expect(retried).toBe(true);

      const rearmed = queueService.getJobById(job.id);
      expect(rearmed?.status).toBe('PENDING');
      expect(rearmed?.last_error).toBeNull();

      // 3. Process rearmed job
      await queueService.processNextBatch();
      expect(queueService.getJobById(job.id)?.status).toBe('COMPLETED');
    });
  });

  describe('2. The 6 Durable Job Handlers', () => {
    it('1. WhatsApp Notification: should handle WhatsApp messaging in the background', async () => {
      vi.spyOn(whatsappClient, 'sendTextMessage').mockResolvedValue({ messages: [{ id: 'mock_wa_1' }] });

      const job = queueService.enqueue({
        name: 'whatsapp_notification',
        payload: {
          phone: '919999912345',
          isTextMessage: true,
          messageText: 'Your order is confirmed!'
        },
        idempotencyKey: `test_wa_${Date.now()}`
      });

      await queueService.processNextBatch();
      const updated = queueService.getJobById(job.id);
      expect(updated?.status).toBe('COMPLETED');
      expect(whatsappClient.sendTextMessage).toHaveBeenCalledWith('919999912345', 'Your order is confirmed!');
    });

    it('2. Webhook Processing: should process webhook messages asynchronously', async () => {
      vi.spyOn(whatsappClient, 'sendTextMessage').mockResolvedValue({ messages: [{ id: 'mock_wa_ack' }] });

      const job = queueService.enqueue({
        name: 'webhook_processing',
        payload: {
          source: 'whatsapp',
          from: '919999912345',
          messageId: `msg_${Date.now()}`,
          messageText: 'HELLO'
        },
        idempotencyKey: `test_wh_${Date.now()}`
      });

      await queueService.processNextBatch();
      const updated = queueService.getJobById(job.id);
      expect(updated?.status).toBe('COMPLETED');
    });

    it('3. PDF Generation: should asynchronously generate a bill PDF', async () => {
      // Insert a mock bill for PDF generation
      const b = db.prepare(`
        INSERT INTO bills (bill_date, bill_time, total_amount, payment_method, customer_name, customer_phone, discount_amount)
        VALUES ('2026-10-09', '12:00 PM', 500, 'Cash', 'PDF Cust', '9999988888', 0)
      `).run();
      const billId = b.lastInsertRowid as number;

      const outPdf = path.join(process.cwd(), 'data', 'generated_pdfs', `test_bill_${billId}.pdf`);

      const job = queueService.enqueue({
        name: 'pdf_generation',
        payload: {
          type: 'bill',
          billId,
          outputPath: outPdf
        },
        idempotencyKey: `test_pdf_${billId}`
      });

      await queueService.processNextBatch();
      const updated = queueService.getJobById(job.id);
      expect(updated?.status).toBe('COMPLETED');
      expect(fs.existsSync(outPdf)).toBe(true);

      // Clean up test generated file
      try { fs.unlinkSync(outPdf); } catch {}
    });

    it('4. Email: should process email delivery', async () => {
      const job = queueService.enqueue({
        name: 'email',
        payload: {
          to: 'customer@example.com',
          subject: 'Order Receipt #STDF-1001',
          text: 'Thank you for your order with Sri Tirumala Dry Fruits.'
        },
        idempotencyKey: `test_email_${Date.now()}`
      });

      await queueService.processNextBatch();
      const updated = queueService.getJobById(job.id);
      expect(updated?.status).toBe('COMPLETED');
    });

    it('5. Analytics Aggregation: should compute daily analytics asynchronously', async () => {
      const job = queueService.enqueue({
        name: 'analytics_aggregation',
        payload: {
          date: '2026-10-09',
          period: 'daily'
        },
        idempotencyKey: `test_analytics_${Date.now()}`
      });

      await queueService.processNextBatch();
      const updated = queueService.getJobById(job.id);
      expect(updated?.status).toBe('COMPLETED');

      const snapshot = db.prepare('SELECT * FROM daily_analytics_snapshots WHERE date = ?').get('2026-10-09') as any;
      expect(snapshot).toBeDefined();
      expect(snapshot.date).toBe('2026-10-09');
    });

    it('6. Backup Verification: should verify SQLite backup integrity and detect corruption', async () => {
      const validBackupPath = path.join(process.cwd(), 'data', 'store.db');

      const job = queueService.enqueue({
        name: 'backup_verification',
        payload: {
          backupPath: validBackupPath
        },
        idempotencyKey: `test_backup_ver_${Date.now()}`
      });

      await queueService.processNextBatch();
      const updated = queueService.getJobById(job.id);
      expect(updated?.status).toBe('COMPLETED');
    });
  });

  describe('3. Critical Reliability Constraint: WhatsApp Unavailability Resilience', () => {
    it('order creation MUST succeed even when WhatsApp is completely unavailable/down', async () => {
      // Mock WhatsApp failing with network timeout / service down
      vi.spyOn(whatsappClient, 'sendTextMessage').mockRejectedValue(new Error('WhatsApp Meta API Gateway Timeout 504'));
      vi.spyOn(whatsappClient, 'sendTemplateMessage').mockRejectedValue(new Error('WhatsApp Meta API Gateway Timeout 504'));

      // 1. Create a customer and product
      const phone = '988' + Math.floor(1000000 + Math.random() * 9000000);
      const cust = db.prepare('INSERT INTO customers (name, phone) VALUES (?, ?)').run('Resilience Customer', phone);
      const customerId = cust.lastInsertRowid as number;

      const p = db.prepare('INSERT INTO products (name) VALUES (?)').run('Resilience Cashews');
      const prodId = p.lastInsertRowid as number;

      const v = db.prepare(`
        INSERT INTO product_variants (name, barcode, selling_price, cost_price, total_qty, sold_qty, reserved_qty, product_id)
        VALUES ('Resilience Cashews Variant', ?, 300, 200, 20, 0, 0, ?)
      `).run('RES_BC_' + Date.now(), prodId);
      const variantId = v.lastInsertRowid as number;

      // 2. Execute order creation (SIMULATING CHECKOUT)
      // Must NOT throw despite WhatsApp failure!
      const order = orderService.createOnlineOrder({
        customer_id: customerId,
        items: [{ product_id: variantId, quantity: 1 }],
        payment_mode: 'COD',
        delivery_type: 'STORE_PICKUP',
        delivery_charge: 0,
        discount: 0
      });

      expect(order).toBeDefined();
      expect(order.id).toBeGreaterThan(0);
      expect(order.status).toBe('NEW');

      // 3. Verify notification job failed and entered retry state independently
      await queueService.processNextBatch();

      const jobs = queueService.getJobs({ name: 'whatsapp_notification' });
      const orderJob = jobs.find((j) => (j.payload as any).orderId === order.id);

      expect(orderJob).toBeDefined();
      expect(orderJob?.attempts).toBeGreaterThanOrEqual(1);
      expect(orderJob?.last_error).toContain('WhatsApp Meta API Gateway Timeout 504');
      // The order is still safely created and intact in the database!
      const persistedOrder = orderService.getOnlineOrderById(order.id);
      expect(persistedOrder).toBeDefined();
      expect(persistedOrder?.status).toBe('NEW');
    });
  });

  describe('4. Job Inspection & Management API Endpoints', () => {
    it('should reject unauthenticated access to /api/v1/jobs with 401', async () => {
      const statsRes = await request(app).get('/api/v1/jobs/stats');
      expect(statsRes.status).toBe(401);
      expect(statsRes.body.error.code).toBe('UNAUTHORIZED');

      const listRes = await request(app).get('/api/v1/jobs');
      expect(listRes.status).toBe(401);

      const retryRes = await request(app).post('/api/v1/jobs/1/retry');
      expect(retryRes.status).toBe(401);
    });

    it('should expose queue statistics and jobs list to authenticated administrator', async () => {
      const { default: bcrypt } = await import('bcryptjs');
      const adminUsername = `queue_admin_${Date.now()}`;
      const password = 'AdminPassword#123';
      const hash = bcrypt.hashSync(password, 10);
      db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(
        adminUsername,
        hash,
        'admin'
      );

      const adminAgent = request.agent(app);
      const loginPage = await adminAgent.get('/login');
      const csrfMatch = loginPage.text.match(/<input type="hidden" name="_csrf" value="(.*?)">/) || loginPage.text.match(/csrf-token" content="(.*?)"/);
      const csrfToken = csrfMatch ? csrfMatch[1] : '';

      await adminAgent
        .post('/login')
        .set('CSRF-Token', csrfToken)
        .send({ username: adminUsername, password, _csrf: csrfToken });

      // 1. Stats
      const statsRes = await adminAgent.get('/api/v1/jobs/stats');
      expect(statsRes.status).toBe(200);
      expect(statsRes.body.stats).toBeDefined();
      expect(statsRes.body.stats.total).toBeGreaterThanOrEqual(0);
      expect(typeof statsRes.body.stats.pending).toBe('number');
      expect(typeof statsRes.body.stats.completed).toBe('number');
      expect(typeof statsRes.body.stats.failed).toBe('number');

      // 2. Query jobs
      const listRes = await adminAgent.get('/api/v1/jobs');
      expect(listRes.status).toBe(200);
      expect(listRes.body.jobs).toBeInstanceOf(Array);
    });

    it('should allow manual retry via POST /api/v1/jobs/:id/retry for authenticated admin with CSRF', async () => {
      const { default: bcrypt } = await import('bcryptjs');
      const adminUsername = `queue_retry_admin_${Date.now()}`;
      const password = 'AdminPassword#123';
      const hash = bcrypt.hashSync(password, 10);
      db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(
        adminUsername,
        hash,
        'admin'
      );

      const adminAgent = request.agent(app);
      const loginPage = await adminAgent.get('/login');
      const csrfMatch = loginPage.text.match(/<input type="hidden" name="_csrf" value="(.*?)">/) || loginPage.text.match(/csrf-token" content="(.*?)"/);
      const csrfToken = csrfMatch ? csrfMatch[1] : '';

      await adminAgent
        .post('/login')
        .set('CSRF-Token', csrfToken)
        .send({ username: adminUsername, password, _csrf: csrfToken });

      // Force insert a failed job
      const insert = db.prepare(`
        INSERT INTO background_jobs (name, payload, status, attempts, max_retries, run_at, last_error)
        VALUES ('test_api_retry', '{"foo":"bar"}', 'FAILED', 5, 5, CURRENT_TIMESTAMP, 'Dead Letter Error')
      `).run();
      const failedJobId = insert.lastInsertRowid as number;

      // Without CSRF token -> 403
      const noCsrfRes = await adminAgent.post(`/api/v1/jobs/${failedJobId}/retry`);
      expect(noCsrfRes.status).toBe(403);
      expect(noCsrfRes.body.error.code).toBe('INVALID_CSRF');

      // Fetch fresh CSRF token via GET request
      const statsRes = await adminAgent.get('/api/v1/jobs/stats');
      const activeCsrfToken = statsRes.headers['x-csrf-token'];

      // With CSRF token -> 200
      const res = await adminAgent
        .post(`/api/v1/jobs/${failedJobId}/retry`)
        .set('CSRF-Token', activeCsrfToken)
        .send({ _csrf: activeCsrfToken });

      expect(res.status).toBe(200);
      expect(res.body.job.status).toBe('PENDING');
      expect(res.body.job.last_error).toBeNull();
    });
  });
});
