import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../../server.js';
import db from '../../src/database.js';
import bcrypt from 'bcryptjs';

describe('Immutable Audit Log System (Integration)', () => {
  let adminAgent: any;
  let staffAgent: any;
  let customerAgent: any;
  const timestamp = Date.now();
  const adminUsername = `audit_admin_${timestamp}`;
  const staffUsername = `audit_staff_${timestamp}`;
  const customerEmail = `audit_cust_${timestamp}@example.com`;
  const password = 'Password@123';

  beforeAll(async () => {
    const passwordHash = bcrypt.hashSync(password, 10);

    // 1. Create admin user
    db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(
      adminUsername,
      passwordHash,
      'admin'
    );

    // 2. Create staff user
    db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(
      staffUsername,
      passwordHash,
      'staff'
    );

    // 3. Create customer user
    db.prepare('INSERT INTO customers (name, phone, email, password_hash) VALUES (?, ?, ?, ?)').run(
      'Audit Test Customer',
      `98${Math.floor(10000000 + Math.random() * 90000000)}`,
      customerEmail,
      passwordHash
    );

    // Login Admin via agent with CSRF token
    adminAgent = request.agent(app);
    const adminLoginPage = await adminAgent.get('/login');
    const adminCsrfMatch = adminLoginPage.text.match(/<input type="hidden" name="_csrf" value="(.*?)">/);
    const adminCsrf = adminCsrfMatch ? adminCsrfMatch[1] : '';

    await adminAgent
      .post('/login')
      .set('CSRF-Token', adminCsrf)
      .send({ username: adminUsername, password, _csrf: adminCsrf });

    // Login Staff via agent with CSRF token
    staffAgent = request.agent(app);
    const staffLoginPage = await staffAgent.get('/login');
    const staffCsrfMatch = staffLoginPage.text.match(/<input type="hidden" name="_csrf" value="(.*?)">/);
    const staffCsrf = staffCsrfMatch ? staffCsrfMatch[1] : '';

    await staffAgent
      .post('/login')
      .set('CSRF-Token', staffCsrf)
      .send({ username: staffUsername, password, _csrf: staffCsrf });

    // Login Customer via agent with CSRF token
    customerAgent = request.agent(app);
    const custLoginPage = await customerAgent.get('/customer/login');
    const custCsrfMatch = custLoginPage.text.match(/<input type="hidden" name="_csrf" value="(.*?)">/);
    const custCsrf = custCsrfMatch ? custCsrfMatch[1] : '';

    await customerAgent
      .post('/customer/login')
      .set('CSRF-Token', custCsrf)
      .send({ email: customerEmail, password, _csrf: custCsrf });
  });

  describe('1. Role-Based Access Control & Customer Data Shielding', () => {
    it('should redirect unauthenticated visitors from /admin/audit-logs to /login', async () => {
      const res = await request(app).get('/admin/audit-logs');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/login');
    });

    it('should block unauthenticated access to /api/v1/audit-logs with 401/403 or redirect', async () => {
      const res = await request(app).get('/api/v1/audit-logs');
      expect([302, 401, 403]).toContain(res.status);
    });

    it('should redirect ordinary staff members away from /admin/audit-logs to /sell', async () => {
      const res = await staffAgent.get('/admin/audit-logs');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/sell');
    });

    it('should block ordinary staff members from /api/v1/audit-logs with 403', async () => {
      const res = await staffAgent.get('/api/v1/audit-logs');
      expect([302, 403]).toContain(res.status);
    });

    it('should prevent ordinary customers from accessing internal audit data', async () => {
      const res = await customerAgent.get('/admin/audit-logs');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/login');
    });

    it('should grant access to /admin/audit-logs for authenticated administrator', async () => {
      const res = await adminAgent.get('/admin/audit-logs');
      expect(res.status).toBe(200);
      expect(res.text).toContain('System Audit Logs');
      expect(res.text).toContain('ENTERPRISE COMPLIANCE');
    });

    it('should grant access to /api/v1/audit-logs for authenticated administrator', async () => {
      const res = await adminAgent.get('/api/v1/audit-logs');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.logs)).toBe(true);
    });
  });

  describe('2. Real-time Application Event Logging', () => {
    it('should verify that admin and staff logins were recorded as LOGIN events in audit_logs', () => {
      const rows = db.prepare(`
        SELECT * FROM audit_logs 
        WHERE action = 'LOGIN' AND (actor LIKE ? OR actor LIKE ?)
      `).all(`%${adminUsername}%`, `%${staffUsername}%`) as any[];

      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0].entity).toBe('USER');
      expect(rows[0].hash).toBeDefined();
    });

    it('should record FAILED_LOGIN when an invalid login attempt occurs', async () => {
      const badUser = `bad_actor_${Date.now()}`;
      const unauthAgent = request.agent(app);
      const loginPage = await unauthAgent.get('/login');
      const csrfMatch = loginPage.text.match(/<input type="hidden" name="_csrf" value="(.*?)">/);
      const csrf = csrfMatch ? csrfMatch[1] : '';

      await unauthAgent
        .post('/login')
        .send({ username: badUser, password: 'WrongPassword', _csrf: csrf });

      const log = db.prepare(`
        SELECT * FROM audit_logs 
        WHERE action = 'FAILED_LOGIN' AND actor = ?
      `).get(badUser) as any;

      expect(log).toBeDefined();
      expect(log.action).toBe('FAILED_LOGIN');
      expect(log.entity).toBe('AUTH');
    });

    it('should record PRODUCT_CREATE and INVENTORY_ADJUST when a product is added', async () => {
      const barcode = `AUDIT-BAR-${Date.now()}`;
      const addPage = await adminAgent.get('/add');
      const csrfMatch = addPage.text.match(/<input type="hidden" name="_csrf" value="(.*?)">/);
      const csrf = csrfMatch ? csrfMatch[1] : '';

      await adminAgent
        .post('/add')
        .send({
          name: 'Audit Test Cashews',
          barcode,
          qty: '20',
          cost: '400',
          sell: '600',
          mrp: '700',
          category: 'Dry Fruits',
          _csrf: csrf
        });

      const prodLog = db.prepare(`
        SELECT * FROM audit_logs 
        WHERE action = 'PRODUCT_CREATE' AND metadata LIKE ?
      `).get(`%${barcode}%`) as any;

      expect(prodLog).toBeDefined();
      expect(prodLog.entity).toBe('PRODUCT');

      const invLog = db.prepare(`
        SELECT * FROM audit_logs 
        WHERE action = 'INVENTORY_ADJUST' AND entity_id = ?
      `).get(prodLog.entity_id) as any;

      expect(invLog).toBeDefined();
      expect(invLog.entity).toBe('INVENTORY');
    });

    it('should record ROLE_CHANGE when an admin updates user permissions', async () => {
      const targetUser = `target_user_${Date.now()}`;
      const userRes = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(
        targetUser,
        'dummy_hash',
        'staff'
      );
      const targetUserId = Number(userRes.lastInsertRowid);

      const settingsPage = await adminAgent.get('/settings');
      const csrfMatch = settingsPage.text.match(/<input type="hidden" name="_csrf" value="(.*?)">/);
      const csrf = csrfMatch ? csrfMatch[1] : '';

      await adminAgent
        .post('/update_user')
        .send({
          user_id: targetUserId,
          username: targetUser,
          role: 'admin',
          _csrf: csrf
        });

      const roleLog = db.prepare(`
        SELECT * FROM audit_logs 
        WHERE action = 'ROLE_CHANGE' AND entity_id = ?
      `).get(String(targetUserId)) as any;

      expect(roleLog).toBeDefined();
      expect(roleLog.action).toBe('ROLE_CHANGE');
      const meta = JSON.parse(roleLog.metadata);
      expect(meta.oldRole).toBe('staff');
      expect(meta.newRole).toBe('admin');
    });
  });

  describe('3. REST API Filtering & Ledger Verification', () => {
    it('should filter logs by action query parameter via REST API', async () => {
      const res = await adminAgent.get('/api/v1/audit-logs?action=LOGIN');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.logs.every((l: any) => l.action === 'LOGIN')).toBe(true);
    });

    it('should verify ledger cryptographic integrity via /api/v1/audit-logs/verify', async () => {
      const res = await adminAgent.get('/api/v1/audit-logs/verify');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isValid).toBe(true);
      expect(res.body.data.checkedCount).toBeGreaterThan(0);
    });
  });

});
