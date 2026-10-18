import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../server.js';
import db from '../../src/database.js';
import bcrypt from 'bcryptjs';

describe('POS Terminal & Thermal Bill Integration QA Suite', () => {
  const timestamp = Date.now();
  const staffUsername = `pos_qa_${timestamp}`;
  const staffPassword = 'PosQaPassword#2026';
  let staffUserId: number;

  let productId: number;
  let variantId: number;
  const barcode = `POS_QA_BC_${timestamp}`;

  let agent: any;
  let csrfToken = '';
  let activeShiftId: number;
  let createdBillId: number;
  let testOrderId: number;

  beforeAll(() => {
    agent = request.agent(app);

    // 1. Create test staff user
    const hash = bcrypt.hashSync(staffPassword, 10);
    const u = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
      .run(staffUsername, hash, 'staff');
    staffUserId = u.lastInsertRowid as number;

    // 2. Create test product & variant
    const p = db.prepare('INSERT INTO products (name, description, active) VALUES (?, ?, 1)')
      .run(`POS QA Product ${timestamp}`, 'Test Dryfruit for POS QA');
    productId = p.lastInsertRowid as number;

    const v = db.prepare(`
      INSERT INTO product_variants (
        product_id, name, sku, barcode, size_weight, unit, cost_price, selling_price, mrp, total_qty, sold_qty, reserved_qty, category
      ) VALUES (?, ?, ?, ?, 1, 'unit', 300, 450, 500, 50, 0, 0, 'Dry Fruits')
    `).run(productId, `POS QA Product ${timestamp}`, `SKU_QA_${timestamp}`, barcode);
    variantId = v.lastInsertRowid as number;

    // 3. Create test customer & pending pickup online order
    const cust = db.prepare('INSERT INTO customers (name, phone) VALUES (?, ?)').run('QA Customer', `98${timestamp.toString().slice(-8)}`);
    const custId = cust.lastInsertRowid as number;

    const ord = db.prepare(`
      INSERT INTO online_orders (order_number, customer_id, subtotal, delivery_charge, discount, total_amount, payment_mode, delivery_type, notes, status)
      VALUES (?, ?, 900, 0, 0, 900, 'COD', 'STORE_PICKUP', 'Pickup test order', 'NEW')
    `).run(`ORD_QA_${timestamp}`, custId);
    testOrderId = ord.lastInsertRowid as number;

    db.prepare(`
      INSERT INTO online_order_items (order_id, product_id, product_name, unit_price, quantity, total_price)
      VALUES (?, ?, ?, 450, 2, 900)
    `).run(testOrderId, variantId, `POS QA Product ${timestamp}`);
  });

  afterAll(() => {
    try {
      if (createdBillId) {
        db.prepare('DELETE FROM sales WHERE bill_id = ?').run(createdBillId);
        db.prepare('DELETE FROM bills WHERE id = ?').run(createdBillId);
      }
      if (activeShiftId) {
        db.prepare('DELETE FROM shifts WHERE id = ?').run(activeShiftId);
      }
      if (testOrderId) {
        db.prepare('DELETE FROM online_order_items WHERE order_id = ?').run(testOrderId);
        db.prepare('DELETE FROM online_orders WHERE id = ?').run(testOrderId);
      }
      db.prepare('DELETE FROM stock_movements WHERE product_variant_id = ?').run(variantId);
      db.prepare('DELETE FROM product_variants WHERE id = ?').run(variantId);
      db.prepare('DELETE FROM products WHERE id = ?').run(productId);
      db.prepare('DELETE FROM users WHERE id = ?').run(staffUserId);
    } catch {}
  });

  function extractCsrf(res: any) {
    if (res.headers && res.headers['x-csrf-token']) {
      csrfToken = res.headers['x-csrf-token'];
    } else if (res.text) {
      const match = res.text.match(/<input type="hidden" name="_csrf" value="(.*?)">/);
      if (match) csrfToken = match[1];
    }
  }

  it('1. Authenticates staff member and acquires CSRF token', async () => {
    const loginPage = await agent.get('/login');
    expect(loginPage.status).toBe(200);
    extractCsrf(loginPage);

    const loginRes = await agent
      .post('/login')
      .set('CSRF-Token', csrfToken)
      .send({ username: staffUsername, password: staffPassword, _csrf: csrfToken });
    expect([200, 302]).toContain(loginRes.status);
    extractCsrf(loginRes);
  });

  it('2. Opens register shift with float and verifies /sell loads ergonomic slate terminal', async () => {
    const openPage = await agent.get('/shift/open');
    extractCsrf(openPage);

    const openShiftRes = await agent
      .post('/shift/open')
      .set('CSRF-Token', csrfToken)
      .send({ opening_cash: '5000', _csrf: csrfToken });
    extractCsrf(openShiftRes);

    const shift = db.prepare("SELECT * FROM shifts WHERE user_id = ? AND status = 'open'").get(staffUserId) as any;
    expect(shift).toBeDefined();
    activeShiftId = shift.id;

    const sellPage = await agent.get('/sell');
    extractCsrf(sellPage);
    expect(sellPage.status).toBe(200);
    // Verifies ergonomic slate theme and shift status banner
    expect(sellPage.text).toContain('pos-terminal-wrapper');
    expect(sellPage.text).toContain(`Shift #${activeShiftId} Open`);
    expect(sellPage.text).toContain('Float: ₹5,000');
    expect(sellPage.text).toContain('Convert Online Order to POS');
    expect(sellPage.text).toContain('F1');
    expect(sellPage.text).toContain('F2');
  });

  it('3. Fetches pending pickup orders via /api/v1/pos/pending-pickups', async () => {
    const res = await agent.get('/api/v1/pos/pending-pickups');
    extractCsrf(res);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.orders)).toBe(true);

    const found = res.body.orders.find((o: any) => o.id === testOrderId);
    expect(found).toBeDefined();
    expect(found.order_number).toBe(`ORD_QA_${timestamp}`);
    expect(found.itemsCount).toBe(1);
  });

  it('4. Converts online pickup order into POS cart via /api/v1/pos/load-order/:id', async () => {
    const loadRes = await agent
      .post(`/api/v1/pos/load-order/${testOrderId}`)
      .set('CSRF-Token', csrfToken)
      .set('Accept', 'application/json')
      .send({ _csrf: csrfToken });

    extractCsrf(loadRes);
    expect(loadRes.status).toBe(200);
    expect(loadRes.body.success).toBe(true);
    expect(loadRes.body.loadedItems).toBe(1);

    // Verify /sell reflects loaded order items and customer info
    const sellPage = await agent.get('/sell');
    extractCsrf(sellPage);
    expect(sellPage.status).toBe(200);
    expect(sellPage.text).toContain('900');
    expect(sellPage.text).toContain('QA Customer');
  });

  it('5. Finalizes sale and generates receipt', async () => {
    const finalizeRes = await agent
      .post('/finalize_bill')
      .set('CSRF-Token', csrfToken)
      .send({
        payment_method: 'UPI',
        discount_amount: '50',
        customer_name: 'QA Customer',
        customer_phone: '9876543210',
        _csrf: csrfToken
      });

    extractCsrf(finalizeRes);
    expect(finalizeRes.status).toBe(200);
    expect(finalizeRes.text).toContain('thermal-slip-paper');
    expect(finalizeRes.text).toContain('850'); // 900 - 50 = 850
    expect(finalizeRes.text).toContain('UPI');

    const bill = db.prepare('SELECT * FROM bills WHERE shift_id = ? ORDER BY id DESC LIMIT 1').get(activeShiftId) as any;
    expect(bill).toBeDefined();
    expect(bill.total_amount).toBe(850);
    expect(bill.payment_method).toBe('UPI');
    createdBillId = bill.id;
  });

  it('6. Resolves thermal bill directly at /bill/:id', async () => {
    const billRes = await agent.get(`/bill/${createdBillId}`);
    expect(billRes.status).toBe(200);
    expect(billRes.text).toContain('SRI TIRUMALA');
    expect(billRes.text).toContain('CASH MEMORANDUM');
    expect(billRes.text).toContain(`Bill No: <strong style="font-size: 13.5px;">${createdBillId}</strong>`);
    expect(billRes.text).toContain('850');
    expect(billRes.text).toContain(`/bill/pdf/${createdBillId}`);
  });
});
