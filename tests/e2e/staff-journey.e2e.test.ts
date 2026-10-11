import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../server.js';
import db from '../../src/database.js';
import bcrypt from 'bcryptjs';

describe('E2E Staff POS Journey: Login → Open Shift → Scan Product → Bill → Payment → Receipt → Stock Update → Close Shift', () => {
  const timestamp = Date.now();
  const staffUsername = `staff_pos_${timestamp}`;
  const staffPassword = 'PosStaffPass#2026';
  let staffUserId: number;

  let productId: number;
  let variantId: number;
  const barcode = `POS_BARCODE_${timestamp}`;

  let agent: any;
  let csrfToken = '';
  let activeShiftId: number;
  let generatedBillId: number;

  beforeAll(() => {
    agent = request.agent(app);

    // 1. Create dedicated isolated staff user
    const hash = bcrypt.hashSync(staffPassword, 10);
    const u = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
      .run(staffUsername, hash, 'staff');
    staffUserId = u.lastInsertRowid as number;

    // 2. Create dedicated isolated product
    const p = db.prepare('INSERT INTO products (name, description, active) VALUES (?, ?, 1)')
      .run(`POS Pistachios ${timestamp}`, 'Irani Salted Pistachios');
    productId = p.lastInsertRowid as number;

    const v = db.prepare(`
      INSERT INTO product_variants (
        product_id, name, sku, barcode, size_weight, unit, cost_price, selling_price, mrp, total_qty, sold_qty, reserved_qty, category
      ) VALUES (?, ?, ?, ?, 1, 'unit', 500, 750, 900, 40, 0, 0, 'Dry Fruits')
    `).run(productId, `POS Pistachios ${timestamp}`, `SKU_POS_${timestamp}`, barcode);
    variantId = v.lastInsertRowid as number;
  });

  afterAll(() => {
    try {
      if (generatedBillId) {
        db.prepare('DELETE FROM sales WHERE bill_id = ?').run(generatedBillId);
        db.prepare('DELETE FROM bills WHERE id = ?').run(generatedBillId);
      }
      if (activeShiftId) {
        db.prepare('DELETE FROM shifts WHERE id = ?').run(activeShiftId);
      }
      db.prepare('DELETE FROM stock_movements WHERE product_variant_id = ?').run(variantId);
      db.prepare('DELETE FROM product_variants WHERE id = ?').run(variantId);
      db.prepare('DELETE FROM products WHERE id = ?').run(productId);
      db.prepare('DELETE FROM users WHERE id = ?').run(staffUserId);
    } catch {
      // ignore teardown error
    }
  });

  it('Step 1: Staff Member Login', async () => {
    const loginPage = await agent.get('/login');
    expect(loginPage.status).toBe(200);

    const match = loginPage.text.match(/<input type="hidden" name="_csrf" value="(.*?)">/)
      || loginPage.headers['x-csrf-token'];
    csrfToken = typeof match === 'string' ? match : (match ? match[1] : '');

    const loginRes = await agent
      .post('/login')
      .set('CSRF-Token', csrfToken)
      .send({
        username: staffUsername,
        password: staffPassword,
        _csrf: csrfToken
      });

    expect([200, 302]).toContain(loginRes.status);
  });

  it('Step 2: Open POS Register Shift with Opening Float', async () => {
    const openPage = await agent.get('/shift/open');
    expect(openPage.status).toBe(200);

    const match = openPage.text.match(/<input type="hidden" name="_csrf" value="(.*?)">/)
      || openPage.headers['x-csrf-token'];
    if (match) csrfToken = typeof match === 'string' ? match : match[1];

    const openShiftRes = await agent
      .post('/shift/open')
      .set('CSRF-Token', csrfToken)
      .send({
        opening_cash: '500',
        _csrf: csrfToken
      });

    expect(openShiftRes.status).toBe(302);
    expect(openShiftRes.headers.location).toBe('/sell');

    // Verify shift row created in SQLite
    const shiftDb = db.prepare("SELECT * FROM shifts WHERE user_id = ? AND status = 'open'").get(staffUserId) as any;
    expect(shiftDb).toBeDefined();
    expect(shiftDb.opening_cash).toBe(500);
    activeShiftId = shiftDb.id;
  });

  it('Step 3: Scan Product Barcode into POS Register Cart', async () => {
    const sellPage = await agent.get('/sell');
    expect(sellPage.status).toBe(200);

    const match = sellPage.text.match(/<input type="hidden" name="_csrf" value="(.*?)">/)
      || sellPage.headers['x-csrf-token'];
    if (match) csrfToken = typeof match === 'string' ? match : match[1];

    const scanRes = await agent
      .post('/sell')
      .set('CSRF-Token', csrfToken)
      .send({
        barcode,
        qty: '2',
        _csrf: csrfToken
      });

    expect([200, 302]).toContain(scanRes.status);

    const sellPageUpdated = await agent.get('/sell');
    expect(sellPageUpdated.status).toBe(200);
    // 2 units * ₹750 = ₹1500 subtotal in cart view
    expect(sellPageUpdated.text).toContain('1500');
    expect(sellPageUpdated.text).toContain('POS Pistachios');
  });

  it('Step 4 & 5: Bill Finalization, Payment Processing & Receipt Generation', async () => {
    const sellPage = await agent.get('/sell');
    const match = sellPage.text.match(/<input type="hidden" name="_csrf" value="(.*?)">/)
      || sellPage.headers['x-csrf-token'];
    if (match) csrfToken = typeof match === 'string' ? match : match[1];

    // Finalize bill: Subtotal ₹1500 - Discount ₹100 = Final ₹1400 via Cash
    const finalizeRes = await agent
      .post('/finalize_bill')
      .set('CSRF-Token', csrfToken)
      .send({
        payment_method: 'Cash',
        discount_amount: '100',
        customer_name: 'In-Store Walkin Customer',
        customer_phone: '9876500000',
        _csrf: csrfToken
      });

    expect(finalizeRes.status).toBe(200);
    expect(finalizeRes.text).toContain('1400');
    expect(finalizeRes.text).toContain('Cash');

    // Find created bill in SQLite
    const billDb = db.prepare('SELECT * FROM bills WHERE shift_id = ? ORDER BY id DESC LIMIT 1').get(activeShiftId) as any;
    expect(billDb).toBeDefined();
    expect(billDb.total_amount).toBe(1400);
    expect(billDb.discount_amount).toBe(100);
    expect(billDb.payment_method).toBe('Cash');
    generatedBillId = billDb.id;

    // Verify Sales record
    const saleDb = db.prepare('SELECT * FROM sales WHERE bill_id = ?').get(generatedBillId) as any;
    expect(saleDb).toBeDefined();
    expect(saleDb.product_id).toBe(variantId);
    expect(saleDb.qty_sold).toBe(2);

    // Verify PDF receipt download endpoint
    const pdfRes = await agent.get(`/bill/pdf/${generatedBillId}`);
    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers['content-type']).toBe('application/pdf');
    expect(pdfRes.body.length).toBeGreaterThan(100);
  });

  it('Step 6: Real-time Stock Update & Inventory Ledger Verification', async () => {
    // 2 units sold: sold_qty should now be 2
    const variantDb = db.prepare('SELECT total_qty, sold_qty, reserved_qty FROM product_variants WHERE id = ?').get(variantId) as any;
    expect(variantDb.sold_qty).toBe(2);
    expect(variantDb.total_qty - variantDb.sold_qty).toBe(38); // 40 - 2 = 38

    // Ledger should contain POS_SALE movement
    const movementDb = db.prepare("SELECT * FROM stock_movements WHERE product_variant_id = ? AND movement_type = 'POS_SALE'").get(variantId) as any;
    expect(movementDb).toBeDefined();
    expect(movementDb.quantity_delta).toBe(-2);
    expect(movementDb.reference_id).toBe(generatedBillId.toString());
  });

  it('Step 7: Close POS Register Shift with Cash Reconciliation', async () => {
    // Expected cash: Opening ₹500 + Cash sales ₹1400 = ₹1900
    const closePage = await agent.get('/shift/close');
    expect(closePage.status).toBe(200);
    expect(closePage.text).toContain('1900');

    const match = closePage.text.match(/<input type="hidden" name="_csrf" value="(.*?)">/)
      || closePage.headers['x-csrf-token'];
    if (match) csrfToken = typeof match === 'string' ? match : match[1];

    const closeRes = await agent
      .post('/shift/close')
      .set('CSRF-Token', csrfToken)
      .send({
        actual_closing_cash: '1900',
        _csrf: csrfToken
      });

    // Session destroyed and redirected to home
    expect(closeRes.status).toBe(302);
    expect(closeRes.headers.location).toBe('/');

    // Verify shift in SQLite is closed with reconciled cash amounts
    const closedShift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(activeShiftId) as any;
    expect(closedShift.status).toBe('closed');
    expect(closedShift.expected_closing_cash).toBe(1900);
    expect(closedShift.actual_closing_cash).toBe(1900);
    expect(closedShift.closing_time).toBeDefined();
  });
});
