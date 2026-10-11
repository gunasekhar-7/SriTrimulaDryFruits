import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../server.js';
import db from '../../src/database.js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { whatsappClient } from '../../src/integrations/whatsapp/client.js';

describe('E2E Security Suite: Unauthorized Access, BOLA, CSRF, Rate Limiting, Idempotency, Webhooks & Privilege Escalation', () => {
  const timestamp = Date.now();

  // Test Customer A
  const phoneA = '98' + Math.floor(10000000 + Math.random() * 90000000);
  const emailA = `cust_a_${timestamp}@sec.com`;
  let customerAId: number;

  // Test Customer B
  const phoneB = '98' + Math.floor(10000000 + Math.random() * 90000000);
  const emailB = `cust_b_${timestamp}@sec.com`;
  let customerBId: number;
  let orderBId: number;

  // Staff User
  const staffUsername = `sec_staff_${timestamp}`;
  const staffPassword = 'StaffPass#2026';
  let staffUserId: number;

  // Admin User
  const adminUsername = `sec_admin_${timestamp}`;
  const adminPassword = 'AdminPass#2026';
  let adminUserId: number;

  // Test Product
  let productId: number;
  let variantId: number;

  beforeAll(() => {
    // 1. Create Customers A and B
    const passHash = bcrypt.hashSync('Password#123', 10);
    const ca = db.prepare('INSERT INTO customers (name, phone, email, password_hash, account_status) VALUES (?, ?, ?, ?, ?)')
      .run('Customer A', '91' + phoneA, emailA, passHash, 'ACTIVE');
    customerAId = ca.lastInsertRowid as number;

    const cb = db.prepare('INSERT INTO customers (name, phone, email, password_hash, account_status) VALUES (?, ?, ?, ?, ?)')
      .run('Customer B', '91' + phoneB, emailB, passHash, 'ACTIVE');
    customerBId = cb.lastInsertRowid as number;

    // 2. Create Order belonging to Customer B
    const ordB = db.prepare(`
      INSERT INTO online_orders (
        order_number, customer_id, subtotal, delivery_charge, discount, total_amount, payment_mode, delivery_type, status
      ) VALUES (?, ?, 500, 0, 0, 500, 'COD', 'STORE_PICKUP', 'NEW')
    `).run(`STDF-SEC-${timestamp}`, customerBId);
    orderBId = ordB.lastInsertRowid as number;

    // 3. Create Staff User
    const staffHash = bcrypt.hashSync(staffPassword, 10);
    const su = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
      .run(staffUsername, staffHash, 'staff');
    staffUserId = su.lastInsertRowid as number;

    // 4. Create Admin User
    const adminHash = bcrypt.hashSync(adminPassword, 10);
    const au = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
      .run(adminUsername, adminHash, 'admin');
    adminUserId = au.lastInsertRowid as number;

    // 5. Create Test Product
    const p = db.prepare('INSERT INTO products (name, description, active) VALUES (?, ?, 1)')
      .run(`Sec Product ${timestamp}`, 'Security test product');
    productId = p.lastInsertRowid as number;

    const v = db.prepare(`
      INSERT INTO product_variants (
        product_id, name, sku, barcode, size_weight, unit, cost_price, selling_price, mrp, total_qty, sold_qty, reserved_qty, category
      ) VALUES (?, ?, ?, ?, 1, 'unit', 100, 200, 250, 50, 0, 0, 'Dry Fruits')
    `).run(productId, `Sec Product ${timestamp}`, `SKU_SEC_${timestamp}`, `SEC_BC_${timestamp}`);
    variantId = v.lastInsertRowid as number;
  });

  afterAll(() => {
    try {
      if (orderBId) {
        db.prepare('DELETE FROM online_orders WHERE id = ?').run(orderBId);
      }
      db.prepare('DELETE FROM online_orders WHERE customer_id IN (?, ?)').run(customerAId, customerBId);
      db.prepare('DELETE FROM stock_reservations WHERE product_variant_id = ?').run(variantId);
      db.prepare('DELETE FROM customers WHERE id IN (?, ?)').run(customerAId, customerBId);
      db.prepare('DELETE FROM product_variants WHERE id = ?').run(variantId);
      db.prepare('DELETE FROM products WHERE id = ?').run(productId);
      db.prepare('DELETE FROM users WHERE id IN (?, ?)').run(staffUserId, adminUserId);
      db.prepare("DELETE FROM background_jobs WHERE idempotency_key LIKE 'webhook_sec_%'").run();
    } catch {
      // ignore
    }
  });

  describe('1. Unauthorized Access Controls', () => {
    it('should redirect unauthenticated users attempting to access customer account portal', async () => {
      const res = await request(app).get('/account/orders');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/customer/login');
    });

    it('should redirect unauthenticated users attempting to access staff POS register', async () => {
      const res = await request(app).get('/sell');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/login');
    });

    it('should redirect unauthenticated users attempting to access admin online orders dashboard', async () => {
      const res = await request(app).get('/admin/online-orders');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/login');
    });

    it('should reject unauthenticated requests to /api/v1/orders/pending-count with 401 Unauthorized', async () => {
      const res = await request(app).get('/api/v1/orders/pending-count');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should allow authenticated staff requests to /api/v1/orders/pending-count with 200 OK', async () => {
      const staffAgent = request.agent(app);
      const loginPage = await staffAgent.get('/login');
      const match = loginPage.text.match(/<input type="hidden" name="_csrf" value="(.*?)">/)
        || loginPage.headers['x-csrf-token'];
      const csrf = typeof match === 'string' ? match : (match ? match[1] : '');

      await staffAgent
        .post('/login')
        .set('CSRF-Token', csrf)
        .send({ username: staffUsername, password: staffPassword, _csrf: csrf });

      const res = await staffAgent.get('/api/v1/orders/pending-count');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(typeof res.body.data.count).toBe('number');
    });
  });

  describe('2. Broken Object Level Authorization (BOLA / IDOR)', () => {
    it('should prevent Customer A from viewing or accessing Customer B order details', async () => {
      const agentA = request.agent(app);

      // Login as Customer A
      const loginPage = await agentA.get('/customer/login');
      const match = loginPage.text.match(/<input type="hidden" name="_csrf" value="(.*?)">/)
        || loginPage.headers['x-csrf-token'];
      const csrf = typeof match === 'string' ? match : (match ? match[1] : '');

      await agentA
        .post('/customer/login')
        .set('CSRF-Token', csrf)
        .send({ email: emailA, password: 'Password#123', _csrf: csrf });

      // Customer A tries to access Customer B's order: /account/orders/:orderBId
      const accessRes = await agentA.get(`/account/orders/${orderBId}`);

      // Route explicitly checks if (!order || order.customer_id !== customerId) -> returns 404 Not Found
      expect(accessRes.status).toBe(404);
      expect(accessRes.text).toContain('Order Not Found');
      expect(accessRes.text).not.toContain(`STDF-SEC-${timestamp}`);
    });
  });

  describe('3. CSRF Protection (Double-Submit Token Validation)', () => {
    it('should reject state-changing POST requests when CSRF token is completely missing', async () => {
      const res = await request(app)
        .post('/customer/login')
        .send({ email: emailA, password: 'Password#123' });

      expect(res.status).toBe(403);
      expect(res.text).toContain('Forbidden');
    });

    it('should reject state-changing POST requests when CSRF token is invalid or forged', async () => {
      const agent = request.agent(app);
      await agent.get('/');

      const res = await agent
        .post('/customer/login')
        .set('CSRF-Token', 'forged_csrf_token_value_999999')
        .send({
          email: emailA,
          password: 'Password#123',
          _csrf: 'forged_csrf_token_value_999999'
        });

      expect(res.status).toBe(403);
      expect(res.text).toContain('Forbidden');
    });

    it('should accept state-changing POST requests when genuine session CSRF token is supplied', async () => {
      const agent = request.agent(app);
      const page = await agent.get('/customer/login');
      const match = page.text.match(/<input type="hidden" name="_csrf" value="(.*?)">/)
        || page.headers['x-csrf-token'];
      const csrf = typeof match === 'string' ? match : (match ? match[1] : '');

      const res = await agent
        .post('/customer/login')
        .set('CSRF-Token', csrf)
        .send({
          email: emailA,
          password: 'Password#123',
          _csrf: csrf
        });

      // Valid token allows processing (redirect to dashboard)
      expect(res.status).not.toBe(403);
      expect([200, 302]).toContain(res.status);
    });
  });

  describe('4. Rate Limiting Protection', () => {
    it('should expose rate limit headers on customer authentication endpoints', async () => {
      const res = await request(app)
        .post('/customer/login')
        .send({ email: 'ratelimit@example.com', password: 'bad' });

      // Check standard and legacy rate limit headers
      const limitHeader = res.headers['x-ratelimit-limit'] || res.headers['ratelimit-limit'];
      expect(limitHeader).toBeDefined();
    });
  });

  describe('5. Duplicate Requests & Idempotency Enforcement', () => {
    it('should return identical cached response and avoid duplicate orders on repeated requests', async () => {
      const agent = request.agent(app);
      const homeRes = await agent.get('/');
      let csrf = homeRes.headers['x-csrf-token'];
      if (!csrf) {
        const match = homeRes.text.match(/<meta name="csrf-token" content="(.*?)">/);
        if (match) csrf = match[1];
      }

      // Add item to cart
      await agent
        .post('/api/v1/cart/add')
        .set('CSRF-Token', csrf)
        .send({ product_id: variantId, quantity: 1, _csrf: csrf });

      const idempotencyKey = `idem_sec_test_${Date.now()}`;
      const checkoutPayload = {
        name: 'Idempotency User',
        phone: phoneA,
        address: 'Sec Flat 4',
        landmark: 'Sector 5',
        delivery_type: 'STORE_PICKUP',
        payment_mode: 'COD',
        notes: 'Idempotency test order',
        _csrf: csrf
      };

      // First Request
      const firstRes = await agent
        .post('/api/v1/store/checkout')
        .set('CSRF-Token', csrf)
        .set('idempotency-key', idempotencyKey)
        .send(checkoutPayload);

      expect([200, 201]).toContain(firstRes.status);
      const firstOrder = firstRes.body.data?.order || firstRes.body.order || firstRes.body;
      const orderIdCreated = firstOrder.id;

      // Second Request (Identical idempotency-key and payload)
      const secondRes = await agent
        .post('/api/v1/store/checkout')
        .set('CSRF-Token', csrf)
        .set('idempotency-key', idempotencyKey)
        .send(checkoutPayload);

      expect([200, 201]).toContain(secondRes.status);
      const secondOrder = secondRes.body.data?.order || secondRes.body.order || secondRes.body;

      // Assert identical order ID returned
      expect(secondOrder.id).toBe(orderIdCreated);

      // Verify database contains exactly ONE order for this key
      const ordersInDb = db.prepare('SELECT COUNT(*) as count FROM online_orders WHERE order_number = ?').get(firstOrder.order_number) as any;
      expect(ordersInDb.count).toBe(1);

      // Verify idempotency record exists in database
      const keyDb = db.prepare('SELECT * FROM idempotency_keys WHERE key = ?').get(idempotencyKey) as any;
      expect(keyDb).toBeDefined();
    });
  });

  describe('6. Duplicate Webhook Handling', () => {
    it('should process webhook idempotently without inserting duplicate jobs into background_jobs', async () => {
      vi.spyOn(whatsappClient, 'verifySignature').mockReturnValue(true);

      const messageSid = `sec_webhook_${Date.now()}`;
      const webhookPayload = JSON.stringify({
        From: `whatsapp:+91${phoneB}`,
        Body: 'YES',
        MessageSid: messageSid
      });

      // First Webhook Delivery
      const firstRes = await request(app)
        .post('/api/v1/whatsapp/webhook')
        .set('Content-Type', 'application/json')
        .set('x-hub-signature-256', 'sha256=test_signature')
        .send(webhookPayload);
      expect(firstRes.status).toBe(200);

      // Count background jobs for this idempotency key
      const jobKey = `webhook_${messageSid}`;
      const jobsFirstCount = db.prepare('SELECT COUNT(*) as c FROM background_jobs WHERE idempotency_key = ?').get(jobKey) as any;
      expect(jobsFirstCount.c).toBe(1);

      // Second Duplicate Webhook Delivery (Identical MessageSid)
      const secondRes = await request(app)
        .post('/api/v1/whatsapp/webhook')
        .set('Content-Type', 'application/json')
        .set('x-hub-signature-256', 'sha256=test_signature')
        .send(webhookPayload);
      expect(secondRes.status).toBe(200);

      // Count must still be exactly 1
      const jobsSecondCount = db.prepare('SELECT COUNT(*) as c FROM background_jobs WHERE idempotency_key = ?').get(jobKey) as any;
      expect(jobsSecondCount.c).toBe(1);
    });
  });

  describe('7. Privilege Escalation & Role Enforcement', () => {
    it('should prevent authenticated staff user from accessing admin-only management routes', async () => {
      const staffAgent = request.agent(app);

      // Login as staff user
      const loginPage = await staffAgent.get('/login');
      const match = loginPage.text.match(/<input type="hidden" name="_csrf" value="(.*?)">/)
        || loginPage.headers['x-csrf-token'];
      const csrf = typeof match === 'string' ? match : (match ? match[1] : '');

      await staffAgent
        .post('/login')
        .set('CSRF-Token', csrf)
        .send({ username: staffUsername, password: staffPassword, _csrf: csrf });

      // Staff tries to access admin-only /profit
      const profitRes = await staffAgent.get('/profit');
      // requireAdmin redirects non-admin to /sell with access denied flash
      expect(profitRes.status).toBe(302);
      expect(profitRes.headers.location).toBe('/sell');

      // Staff tries to access admin-only /analytics
      const analyticsRes = await staffAgent.get('/analytics');
      expect(analyticsRes.status).toBe(302);
      expect(analyticsRes.headers.location).toBe('/sell');

      // Staff tries to access admin-only /settings
      const settingsRes = await staffAgent.get('/settings');
      expect(settingsRes.status).toBe(302);
      expect(settingsRes.headers.location).toBe('/sell');
    });

    it('should allow authenticated admin user to access admin-only management routes', async () => {
      const adminAgent = request.agent(app);

      // Login as admin user
      const loginPage = await adminAgent.get('/login');
      const match = loginPage.text.match(/<input type="hidden" name="_csrf" value="(.*?)">/)
        || loginPage.headers['x-csrf-token'];
      const csrf = typeof match === 'string' ? match : (match ? match[1] : '');

      await adminAgent
        .post('/login')
        .set('CSRF-Token', csrf)
        .send({ username: adminUsername, password: adminPassword, _csrf: csrf });

      // Admin accesses /analytics
      const analyticsRes = await adminAgent.get('/analytics');
      expect(analyticsRes.status).toBe(200);

      // Admin accesses /profit
      const profitRes = await adminAgent.get('/profit');
      expect(profitRes.status).toBe(200);
    });
  });
});
