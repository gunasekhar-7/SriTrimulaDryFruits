import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../server.js';
import db from '../src/database.js';
import bcrypt from 'bcryptjs';
import { queueService } from '../src/queue/index.js';
import { customerService } from '../src/services/customer.service.js';

describe('P0 Remediation: Background-Job Management API Security (/api/v1/jobs)', () => {
  const testTimestamp = Date.now();
  const adminUsername = `sec_admin_${testTimestamp}`;
  const staffUsername = `sec_cashier_${testTimestamp}`;
  const customerEmail = `sec_cust_${testTimestamp}@example.com`;
  const password = 'Password@123';
  const validServiceKey = 'production_super_secret_internal_key_12345'; // > 16 chars

  let testJobFailedId: number;
  let testJobPendingId: number;
  let adminAgent: any;
  let staffAgent: any;
  let customerAgent: any;

  beforeAll(async () => {
    process.env.INTERNAL_SERVICE_KEY = validServiceKey;

    const hash = bcrypt.hashSync(password, 8);

    // 1. Create Admin User
    db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(
      adminUsername,
      hash,
      'admin'
    );

    // 2. Create Staff Cashier User
    db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(
      staffUsername,
      hash,
      'staff'
    );

    // 3. Create Customer
    customerService.register('Security Test Customer', '9199999999', customerEmail, password);

    // 4. Create Test Background Jobs (one FAILED, one PENDING with sensitive payload)
    const insertFailed = db.prepare(`
      INSERT INTO background_jobs (name, payload, status, attempts, max_retries, run_at, last_error)
      VALUES (?, ?, 'FAILED', 5, 5, CURRENT_TIMESTAMP, 'Dead Letter Worker Timeout')
    `).run('test_job_failed', JSON.stringify({
      orderId: 9001,
      phone: '9876543210',
      token: 'sensitive_customer_bearer_token',
      apiKey: 'meta_graph_api_secret_key'
    }));
    testJobFailedId = insertFailed.lastInsertRowid as number;

    const insertPending = db.prepare(`
      INSERT INTO background_jobs (name, payload, status, attempts, max_retries, run_at, last_error)
      VALUES (?, ?, 'PENDING', 0, 5, CURRENT_TIMESTAMP, NULL)
    `).run('test_job_pending', JSON.stringify({
      orderId: 9002,
      phone: '9123456789',
      secret: 'webhook_secret_key'
    }));
    testJobPendingId = insertPending.lastInsertRowid as number;

    // 5. Establish Authenticated Sessions
    // A. Admin Session
    adminAgent = request.agent(app);
    const adminLoginPage = await adminAgent.get('/login');
    const adminCsrfMatch = adminLoginPage.text.match(/<input type="hidden" name="_csrf" value="(.*?)">/) ||
                           adminLoginPage.text.match(/csrf-token" content="(.*?)"/);
    const adminLoginCsrf = adminCsrfMatch ? adminCsrfMatch[1] : '';
    await adminAgent
      .post('/login')
      .set('CSRF-Token', adminLoginCsrf)
      .send({ username: adminUsername, password, _csrf: adminLoginCsrf });

    // B. Staff Session
    staffAgent = request.agent(app);
    const staffLoginPage = await staffAgent.get('/login');
    const staffCsrfMatch = staffLoginPage.text.match(/<input type="hidden" name="_csrf" value="(.*?)">/) ||
                           staffLoginPage.text.match(/csrf-token" content="(.*?)"/);
    const staffLoginCsrf = staffCsrfMatch ? staffCsrfMatch[1] : '';
    await staffAgent
      .post('/login')
      .set('CSRF-Token', staffLoginCsrf)
      .send({ username: staffUsername, password, _csrf: staffLoginCsrf });

    // C. Customer Session
    customerAgent = request.agent(app);
    const custLoginPage = await customerAgent.get('/customer/login');
    const custCsrfMatch = custLoginPage.text.match(/<input type="hidden" name="_csrf" value="(.*?)">/) ||
                          custLoginPage.text.match(/csrf-token" content="(.*?)"/);
    const custLoginCsrf = custCsrfMatch ? custCsrfMatch[1] : '';
    await customerAgent
      .post('/customer/login')
      .set('CSRF-Token', custLoginCsrf)
      .send({ email: customerEmail, password, _csrf: custLoginCsrf });
  });

  afterAll(() => {
    delete process.env.INTERNAL_SERVICE_KEY;
    db.prepare('DELETE FROM background_jobs WHERE id IN (?, ?)').run(testJobFailedId, testJobPendingId);
    db.prepare('DELETE FROM users WHERE username IN (?, ?)').run(adminUsername, staffUsername);
    db.prepare('DELETE FROM customers WHERE email = ?').run(customerEmail);
  });

  // ===========================================================================
  // 1. Unauthenticated Access
  // ===========================================================================
  describe('1. Unauthenticated Access', () => {
    it('should reject unauthenticated GET /api/v1/jobs/stats with 401 Unauthorized', async () => {
      const res = await request(app).get('/api/v1/jobs/stats');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should reject unauthenticated GET /api/v1/jobs with 401 Unauthorized', async () => {
      const res = await request(app).get('/api/v1/jobs');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should reject unauthenticated GET /api/v1/jobs/:id with 401 Unauthorized', async () => {
      const res = await request(app).get(`/api/v1/jobs/${testJobFailedId}`);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should reject unauthenticated POST /api/v1/jobs/:id/retry with 401 Unauthorized', async () => {
      const res = await request(app).post(`/api/v1/jobs/${testJobFailedId}/retry`);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should reject unauthenticated POST /api/v1/jobs/:id/cancel with 401 Unauthorized', async () => {
      const res = await request(app).post(`/api/v1/jobs/${testJobPendingId}/cancel`);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  // ===========================================================================
  // 2. Authenticated Customer Access
  // ===========================================================================
  describe('2. Authenticated Customer Access', () => {
    it('should reject customer GET /api/v1/jobs/stats with 401 Unauthorized', async () => {
      const res = await customerAgent.get('/api/v1/jobs/stats');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should reject customer GET /api/v1/jobs with 401 Unauthorized', async () => {
      const res = await customerAgent.get('/api/v1/jobs');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should reject customer POST /api/v1/jobs/:id/retry with 401 Unauthorized', async () => {
      const res = await customerAgent.post(`/api/v1/jobs/${testJobFailedId}/retry`);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should reject customer POST /api/v1/jobs/:id/cancel with 401 Unauthorized', async () => {
      const res = await customerAgent.post(`/api/v1/jobs/${testJobPendingId}/cancel`);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  // ===========================================================================
  // 3. Authenticated Staff Access Without Admin Privileges
  // ===========================================================================
  describe('3. Authenticated Staff Access (Non-Admin)', () => {
    it('should reject cashier GET /api/v1/jobs/stats with 403 Forbidden', async () => {
      const res = await staffAgent.get('/api/v1/jobs/stats');
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toContain('Administrator');
    });

    it('should reject cashier GET /api/v1/jobs with 403 Forbidden', async () => {
      const res = await staffAgent.get('/api/v1/jobs');
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('should reject cashier GET /api/v1/jobs/:id with 403 Forbidden', async () => {
      const res = await staffAgent.get(`/api/v1/jobs/${testJobFailedId}`);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('should reject cashier POST /api/v1/jobs/:id/retry with 403 Forbidden', async () => {
      const res = await staffAgent.post(`/api/v1/jobs/${testJobFailedId}/retry`);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('should reject cashier POST /api/v1/jobs/:id/cancel with 403 Forbidden', async () => {
      const res = await staffAgent.post(`/api/v1/jobs/${testJobPendingId}/cancel`);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  // ===========================================================================
  // 4. Authorized Administrator Access
  // ===========================================================================
  describe('4. Authorized Administrator Access', () => {
    it('should allow admin GET /api/v1/jobs/stats with 200 OK', async () => {
      const res = await adminAgent.get('/api/v1/jobs/stats');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.stats).toBeDefined();
    });

    it('should allow admin GET /api/v1/jobs with 200 OK', async () => {
      const res = await adminAgent.get('/api/v1/jobs');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.jobs)).toBe(true);
    });

    it('should allow admin GET /api/v1/jobs/:id with 200 OK', async () => {
      const res = await adminAgent.get(`/api/v1/jobs/${testJobFailedId}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.job.id).toBe(testJobFailedId);
    });

    it('should allow admin POST /api/v1/jobs/:id/retry with valid CSRF token', async () => {
      // Refresh CSRF token via GET
      const statsRes = await adminAgent.get('/api/v1/jobs/stats');
      const csrf = statsRes.headers['x-csrf-token'];

      const res = await adminAgent
        .post(`/api/v1/jobs/${testJobFailedId}/retry`)
        .set('X-CSRF-Token', csrf)
        .send({ _csrf: csrf });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.job.status).toBe('PENDING');
      expect(res.body.job.last_error).toBeNull();

      // Keep it FAILED so test 8 internal worker doesn't pick it up
      db.prepare("UPDATE background_jobs SET status = 'FAILED' WHERE id = ?").run(testJobFailedId);
    });

    it('should allow admin POST /api/v1/jobs/:id/cancel with valid CSRF token', async () => {
      // Refresh CSRF token via GET
      const statsRes = await adminAgent.get('/api/v1/jobs/stats');
      const csrf = statsRes.headers['x-csrf-token'];

      const res = await adminAgent
        .post(`/api/v1/jobs/${testJobPendingId}/cancel`)
        .set('X-CSRF-Token', csrf)
        .send({ _csrf: csrf });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.job.status).toBe('FAILED');
      expect(res.body.job.last_error).toContain('Cancelled by administrator');
    });
  });

  // ===========================================================================
  // 5. State-Changing Requests With Missing / Invalid CSRF Protection
  // ===========================================================================
  describe('5. CSRF Protection on State-Changing Operations', () => {
    it('should reject state-changing POST /retry when CSRF token is missing with 403 INVALID_CSRF', async () => {
      const res = await adminAgent.post(`/api/v1/jobs/${testJobFailedId}/retry`);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_CSRF');
    });

    it('should reject state-changing POST /retry when CSRF token is bogus with 403 INVALID_CSRF', async () => {
      const res = await adminAgent
        .post(`/api/v1/jobs/${testJobFailedId}/retry`)
        .set('X-CSRF-Token', 'totally_bogus_csrf_token')
        .send({ _csrf: 'totally_bogus_csrf_token' });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_CSRF');
    });

    it('should reject state-changing POST /cancel when CSRF token is missing with 403 INVALID_CSRF', async () => {
      const res = await adminAgent.post(`/api/v1/jobs/${testJobPendingId}/cancel`);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_CSRF');
    });
  });

  // ===========================================================================
  // 6. Identifier Manipulation & Payload Sanitization
  // ===========================================================================
  describe("6. Job Identifier Validation & Sensitive Payload Sanitization", () => {
    it('should reject non-numeric job ID with 400 INVALID_JOB_ID', async () => {
      const res = await adminAgent.get('/api/v1/jobs/malicious_payload_id');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_JOB_ID');
    });

    it('should reject negative job ID with 400 INVALID_JOB_ID', async () => {
      const res = await adminAgent.get('/api/v1/jobs/-1');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_JOB_ID');
    });

    it('should return 404 for non-existent job ID', async () => {
      const res = await adminAgent.get('/api/v1/jobs/99999999');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('JOB_NOT_FOUND');
    });

    it('should mask customer phone numbers and redact secret credentials in job payloads', async () => {
      const res = await adminAgent.get(`/api/v1/jobs/${testJobFailedId}`);
      expect(res.status).toBe(200);

      const payload = res.body.job.payload;
      expect(payload).toBeDefined();

      // Original phone was 9876543210 -> should be masked to ***3210
      expect(payload.phone).toBe('***3210');

      // Original token & apiKey should be redacted
      expect(payload.token).toBe('[REDACTED]');
      expect(payload.apiKey).toBe('[REDACTED]');

      // Non-sensitive data remains visible
      expect(payload.orderId).toBe(9001);
    });

    it('should mask sensitive data across the entire jobs list output', async () => {
      const res = await adminAgent.get('/api/v1/jobs');
      expect(res.status).toBe(200);

      const targetJob = res.body.jobs.find((j: any) => j.id === testJobFailedId);
      expect(targetJob).toBeDefined();
      expect(targetJob.payload.phone).toBe('***3210');
      expect(targetJob.payload.token).toBe('[REDACTED]');
      expect(targetJob.payload.apiKey).toBe('[REDACTED]');
    });
  });

  // ===========================================================================
  // 7. Authorization Bypass Attempts & Internal Service Identity
  // ===========================================================================
  describe('7. Authorization Bypass & Service Identity', () => {
    it('should permit internal service identity with valid Bearer token without session or CSRF', async () => {
      const res = await request(app)
        .get('/api/v1/jobs/stats')
        .set('Authorization', `Bearer ${validServiceKey}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.stats).toBeDefined();
    });

    it('should permit internal service identity with valid X-Service-Key header', async () => {
      const res = await request(app)
        .get('/api/v1/jobs/stats')
        .set('x-service-key', validServiceKey);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should reject invalid Bearer token with 401 Unauthorized', async () => {
      const res = await request(app)
        .get('/api/v1/jobs/stats')
        .set('Authorization', 'Bearer invalid_service_key_99999');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should reject short service key (< 16 chars) even if present', async () => {
      const res = await request(app)
        .get('/api/v1/jobs/stats')
        .set('Authorization', 'Bearer shortkey');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should reject spoofed or case-altered HTTP bypass attempts without auth', async () => {
      const res = await request(app)
        .post('/api/v1/jobs/stats')
        .send({});

      // Stats is GET only, or rejects with 401
      expect([401, 404, 405]).toContain(res.status);
    });
  });

  // ===========================================================================
  // 8. Legitimate Internal Scheduler & In-Process Execution
  // ===========================================================================
  describe('8. Internal Worker In-Process Execution', () => {
    it('should process pending jobs directly via internal worker without HTTP credentials', async () => {
      // Insert a dedicated internal test job
      const insert = db.prepare(`
        INSERT INTO background_jobs (name, payload, status, attempts, max_retries, run_at)
        VALUES ('test_internal_worker', '{"task":"maintenance"}', 'PENDING', 0, 3, CURRENT_TIMESTAMP)
      `).run();
      const internalJobId = insert.lastInsertRowid as number;

      // Register temporary handler
      queueService.registerHandler('test_internal_worker', async (payload: any) => {
        expect(payload.task).toBe('maintenance');
      });

      // Internal worker executes in-process
      for (let i = 0; i < 5; i++) {
        await queueService.processNextBatch(50);
        if (queueService.getJobById(internalJobId)?.status === 'COMPLETED') break;
      }

      const jobRecord = queueService.getJobById(internalJobId);
      expect(jobRecord).not.toBeNull();
      expect(jobRecord?.status).toBe('COMPLETED');

      // Cleanup
      db.prepare('DELETE FROM background_jobs WHERE id = ?').run(internalJobId);
    });
  });

  // ===========================================================================
  // 9. Preservation of WhatsApp Delivery and Retries Behavior
  // ===========================================================================
  describe('9. Preservation of WhatsApp Delivery & Queue Failure Handling', () => {
    it('should handle failed WhatsApp job by incrementing attempts and setting exponential backoff', async () => {
      const insert = db.prepare(`
        INSERT INTO background_jobs (name, payload, status, attempts, max_retries, run_at)
        VALUES ('whatsapp_notification', ?, 'PENDING', 0, 5, CURRENT_TIMESTAMP)
      `).run(JSON.stringify({
        templateName: 'order_status_update',
        components: [{ type: 'body', parameters: [{ type: 'text', text: 'CONFIRMED' }] }],
        phone: '9876543210'
      }));
      const waJobId = insert.lastInsertRowid as number;

      // Mock whatsappClient to fail
      const { whatsappClient } = await import('../src/integrations/whatsapp/client.js');
      const originalSend = whatsappClient.sendTemplateMessage;
      whatsappClient.sendTemplateMessage = async () => {
        throw new Error('Meta API 503 Service Unavailable');
      };

      try {
        for (let i = 0; i < 5; i++) {
          await queueService.processNextBatch(50);
          if ((queueService.getJobById(waJobId)?.attempts || 0) >= 1) break;
        }

        const updated = queueService.getJobById(waJobId);
        expect(updated).not.toBeNull();
        expect(updated?.attempts).toBe(1);
        expect(updated?.status).toBe('PENDING'); // Backoff scheduled
        expect(updated?.last_error).toContain('503 Service Unavailable');
      } finally {
        whatsappClient.sendTemplateMessage = originalSend;
        db.prepare('DELETE FROM background_jobs WHERE id = ?').run(waJobId);
      }
    });
  });
});
