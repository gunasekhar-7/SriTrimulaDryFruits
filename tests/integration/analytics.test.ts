import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../server.js';
import db from '../../src/database.js';
import bcrypt from 'bcryptjs';

describe('Admin Analytics Dashboard & Reporting API (Integration)', () => {
  const timestamp = Date.now();
  const adminUsername = `analytics_admin_${timestamp}`;
  const adminPassword = 'AdminPassword#2026';
  let adminUserId: number;
  let adminAgent: any;

  const staffUsername = `analytics_staff_${timestamp}`;
  const staffPassword = 'StaffPassword#2026';
  let staffUserId: number;
  let staffAgent: any;

  let testCustId: number;
  let testVariantId: number;
  let testBillId: number;
  let testOrderId: number;

  beforeAll(async () => {
    // 1. Create Admin User
    const adminHash = bcrypt.hashSync(adminPassword, 10);
    const au = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
      .run(adminUsername, adminHash, 'admin');
    adminUserId = au.lastInsertRowid as number;

    // 2. Create Staff User
    const staffHash = bcrypt.hashSync(staffPassword, 10);
    const su = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
      .run(staffUsername, staffHash, 'staff');
    staffUserId = su.lastInsertRowid as number;

    // 3. Create Sample Product & Variant
    const p = db.prepare('INSERT INTO products (name, description, active) VALUES (?, ?, 1)')
      .run(`Analytics Almonds ${timestamp}`, 'Test almonds for analytics');
    const pid = p.lastInsertRowid as number;

    const v = db.prepare(`
      INSERT INTO product_variants (
        product_id, name, sku, barcode, size_weight, unit, cost_price, selling_price, mrp, total_qty, sold_qty, reserved_qty, category
      ) VALUES (?, ?, ?, ?, 1, 'kg', 600, 850, 950, 50, 5, 0, 'Dry Fruits')
    `).run(pid, `Analytics Almonds ${timestamp}`, `SKU_ALM_${timestamp}`, `BC_ALM_${timestamp}`);
    testVariantId = v.lastInsertRowid as number;

    // 4. Create Sample Customer
    const c = db.prepare(`
      INSERT INTO customers (name, phone, email, password_hash, account_status)
      VALUES (?, ?, ?, 'pass', 'ACTIVE')
    `).run('Analytics Tester', `9198${Math.floor(10000000 + Math.random() * 90000000)}`, `tester_${timestamp}@test.com`);
    testCustId = c.lastInsertRowid as number;

    const todayStr = new Date().toISOString().split('T')[0];

    // 5. Create Sample POS Bill and Sale
    const b = db.prepare(`
      INSERT INTO bills (bill_date, bill_time, total_amount, customer_name, customer_phone, payment_method)
      VALUES (?, '11:30:00', 850, 'Walk-in Guest', '919876543210', 'Cash')
    `).run(todayStr);
    testBillId = b.lastInsertRowid as number;

    db.prepare(`
      INSERT INTO sales (bill_id, product_id, qty_sold, profit_made, sale_date, unit_price)
      VALUES (?, ?, 1, 250, ?, 850)
    `).run(testBillId, testVariantId, todayStr);

    // 6. Create Sample Online Order and Item
    const o = db.prepare(`
      INSERT INTO online_orders (
        order_number, customer_id, subtotal, delivery_charge, discount, total_amount, payment_mode, delivery_type, status, created_at
      ) VALUES (?, ?, 850, 0, 0, 850, 'COD', 'DELIVERY', 'COMPLETED', CURRENT_TIMESTAMP)
    `).run(`STDF-AN-${timestamp}`, testCustId);
    testOrderId = o.lastInsertRowid as number;

    db.prepare(`
      INSERT INTO online_order_items (order_id, product_id, product_name, unit_price, quantity, total_price)
      VALUES (?, ?, ?, 850, 1, 850)
    `).run(testOrderId, testVariantId, `Analytics Almonds ${timestamp}`);

    // 7. Login Admin Agent
    adminAgent = request.agent(app);
    const adminLoginPage = await adminAgent.get('/login');
    const adminCsrfMatch = adminLoginPage.text.match(/<input type="hidden" name="_csrf" value="(.*?)">/) || adminLoginPage.headers['x-csrf-token'];
    const adminCsrf = typeof adminCsrfMatch === 'string' ? adminCsrfMatch : (adminCsrfMatch ? adminCsrfMatch[1] : '');

    await adminAgent
      .post('/login')
      .set('CSRF-Token', adminCsrf)
      .send({ username: adminUsername, password: adminPassword, _csrf: adminCsrf });

    // 8. Login Staff Agent
    staffAgent = request.agent(app);
    const staffLoginPage = await staffAgent.get('/login');
    const staffCsrfMatch = staffLoginPage.text.match(/<input type="hidden" name="_csrf" value="(.*?)">/) || staffLoginPage.headers['x-csrf-token'];
    const staffCsrf = typeof staffCsrfMatch === 'string' ? staffCsrfMatch : (staffCsrfMatch ? staffCsrfMatch[1] : '');

    await staffAgent
      .post('/login')
      .set('CSRF-Token', staffCsrf)
      .send({ username: staffUsername, password: staffPassword, _csrf: staffCsrf });
  });

  afterAll(() => {
    try {
      if (testBillId) {
        db.prepare('DELETE FROM sales WHERE bill_id = ?').run(testBillId);
        db.prepare('DELETE FROM bills WHERE id = ?').run(testBillId);
      }
      if (testOrderId) {
        db.prepare('DELETE FROM online_order_items WHERE order_id = ?').run(testOrderId);
        db.prepare('DELETE FROM online_orders WHERE id = ?').run(testOrderId);
      }
      if (testCustId) {
        db.prepare('DELETE FROM customers WHERE id = ?').run(testCustId);
      }
      if (testVariantId) {
        db.prepare('DELETE FROM product_variants WHERE id = ?').run(testVariantId);
      }
      db.prepare('DELETE FROM users WHERE id IN (?, ?)').run(adminUserId, staffUserId);
    } catch {
      // ignore
    }
  });

  describe('1. Access Control & Authorization', () => {
    it('should redirect unauthenticated visitors from /analytics to /login', async () => {
      const res = await request(app).get('/analytics');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/login');
    });

    it('should redirect staff users from /analytics to /sell', async () => {
      const res = await staffAgent.get('/analytics');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/sell');
    });

    it('should permit admin users to access /analytics dashboard', async () => {
      const res = await adminAgent.get('/analytics');
      expect(res.status).toBe(200);
      expect(res.text).toContain('Admin Analytics Dashboard');
    });
  });

  describe('2. Dashboard Metrics Display & Centralized Calculations', () => {
    it('should render all required core financial & business metrics', async () => {
      const res = await adminAgent.get('/analytics');
      expect(res.status).toBe(200);
      const html = res.text;

      // Revenue benchmarks
      expect(html).toContain("Today's Revenue");
      expect(html).toContain('Weekly Revenue');
      expect(html).toContain('Monthly Revenue');
      expect(html).toContain('All-Time Revenue');

      // Volume & Financial KPIs
      expect(html).toContain('Filtered Total');
      expect(html).toContain('Volume & AOV');
      expect(html).toContain('Profit & Margin');
      expect(html).toContain('AOV:');
      expect(html).toContain('Margin:');

      // Customer, WhatsApp & Inventory KPIs
      expect(html).toContain('Repeat Customers');
      expect(html).toContain('Cancellations');
      expect(html).toContain('WhatsApp Conversion');
      expect(html).toContain('Inventory Status');

      // Charts and Tables
      expect(html).toContain('Revenue Trend Over Time');
      expect(html).toContain('Best-Selling Products');
      expect(html).toContain('Most Profitable Products');
    });
  });

  describe('3. Multi-Dimensional Filtering', () => {
    it('should filter by preset (today)', async () => {
      const res = await adminAgent.get('/analytics?preset=today');
      expect(res.status).toBe(200);
      expect(res.text).toContain('name="preset" id="presetInput" value="today"');
    });

    it('should filter by preset (7d)', async () => {
      const res = await adminAgent.get('/analytics?preset=7d');
      expect(res.status).toBe(200);
      expect(res.text).toContain('value="7d"');
    });

    it('should filter by category', async () => {
      const res = await adminAgent.get('/analytics?category=Dry%20Fruits');
      expect(res.status).toBe(200);
      expect(res.text).toContain('selected>Dry Fruits</option>');
    });

    it('should filter by channel (POS only)', async () => {
      const res = await adminAgent.get('/analytics?channel=POS');
      expect(res.status).toBe(200);
      expect(res.text).toContain('selected>POS (In-Store)</option>');
    });

    it('should filter by channel (ONLINE only)', async () => {
      const res = await adminAgent.get('/analytics?channel=ONLINE');
      expect(res.status).toBe(200);
      expect(res.text).toContain('selected>Online Store</option>');
    });

    it('should filter by status (COMPLETED)', async () => {
      const res = await adminAgent.get('/analytics?status=COMPLETED');
      expect(res.status).toBe(200);
      expect(res.text).toContain('selected>Completed</option>');
    });

    it('should filter by custom date range', async () => {
      const todayStr = new Date().toISOString().split('T')[0];
      const res = await adminAgent.get(`/analytics?startDate=${todayStr}&endDate=${todayStr}`);
      expect(res.status).toBe(200);
      expect(res.text).toContain(`value="${todayStr}"`);
    });
  });

  describe('4. JSON Reporting API (GET /api/v1/analytics)', () => {
    it('should return complete structured analytics JSON for authenticated admin', async () => {
      const res = await adminAgent.get('/api/v1/analytics');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const d = res.body.data;
      expect(d).toBeDefined();

      // Benchmark totals
      expect(typeof d.todayRevenue).toBe('number');
      expect(typeof d.weeklyRevenue).toBe('number');
      expect(typeof d.monthlyRevenue).toBe('number');
      expect(typeof d.allTimeRevenue).toBe('number');

      // Filtered metrics
      expect(typeof d.totalRevenue).toBe('number');
      expect(typeof d.posRevenue).toBe('number');
      expect(typeof d.onlineRevenue).toBe('number');
      expect(typeof d.orderCount).toBe('number');
      expect(typeof d.averageOrderValue).toBe('number');
      expect(typeof d.posAov).toBe('number');
      expect(typeof d.onlineAov).toBe('number');
      expect(typeof d.totalCOGS).toBe('number');
      expect(typeof d.totalProfit).toBe('number');
      expect(typeof d.profitMarginPercent).toBe('number');

      // Sub-metrics structures
      expect(Array.isArray(d.bestSellingProducts)).toBe(true);
      expect(Array.isArray(d.mostProfitableProducts)).toBe(true);
      expect(d.repeatCustomers).toBeDefined();
      expect(d.cancellations).toBeDefined();
      expect(d.stockOuts).toBeDefined();
      expect(d.whatsappConversion).toBeDefined();
      expect(Array.isArray(d.revenueTrend)).toBe(true);
      expect(Array.isArray(d.categoryBreakdown)).toBe(true);
      expect(d.channelBreakdown).toBeDefined();
    });

    it('should respect channel filter on JSON API', async () => {
      const res = await adminAgent.get('/api/v1/analytics?channel=POS');
      expect(res.status).toBe(200);
      const d = res.body.data;
      expect(d.onlineRevenue).toBe(0);
      expect(d.onlineOrderCount).toBe(0);
    });
  });

});
