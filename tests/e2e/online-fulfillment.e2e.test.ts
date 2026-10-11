import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../server.js';
import db from '../../src/database.js';
import bcrypt from 'bcryptjs';

describe('E2E Online Order Fulfillment: Create Order → Admin Confirm → Packing → Ready → Dispatch → Complete', () => {
  const timestamp = Date.now();
  const phone10 = '98' + Math.floor(10000000 + Math.random() * 90000000);
  const formattedPhone = '91' + phone10;

  const adminUser = `fulf_admin_${timestamp}`;
  const adminPass = 'AdminFulfillPass#2026';
  let adminUserId: number;

  let productId: number;
  let variantId: number;
  const barcode = `FULFILL_BC_${timestamp}`;

  let customerAgent: any;
  let adminAgent: any;
  let orderId: number;
  let adminCsrf = '';

  beforeAll(async () => {
    customerAgent = request.agent(app);
    adminAgent = request.agent(app);

    // Seed product
    const p = db.prepare('INSERT INTO products (name, description, active) VALUES (?, ?, 1)')
      .run(`Fulfillment Dates ${timestamp}`, 'Saudi Medjool Dates');
    productId = p.lastInsertRowid as number;

    const v = db.prepare(`
      INSERT INTO product_variants (
        product_id, name, sku, barcode, size_weight, unit, cost_price, selling_price, mrp, total_qty, sold_qty, reserved_qty, category
      ) VALUES (?, ?, ?, ?, 1, 'unit', 400, 600, 750, 25, 0, 0, 'Dry Fruits')
    `).run(productId, `Fulfillment Dates ${timestamp}`, `SKU_FULF_${timestamp}`, barcode);
    variantId = v.lastInsertRowid as number;

    // Seed admin
    const hash = bcrypt.hashSync(adminPass, 10);
    const u = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
      .run(adminUser, hash, 'admin');
    adminUserId = u.lastInsertRowid as number;

    // Login admin
    const loginPage = await adminAgent.get('/login');
    const match = loginPage.text.match(/<input type="hidden" name="_csrf" value="(.*?)">/)
      || loginPage.headers['x-csrf-token'];
    const csrf = typeof match === 'string' ? match : (match ? match[1] : '');

    await adminAgent
      .post('/login')
      .set('CSRF-Token', csrf)
      .send({ username: adminUser, password: adminPass, _csrf: csrf });
  });

  afterAll(() => {
    try {
      if (orderId) {
        db.prepare('DELETE FROM order_status_logs WHERE order_id = ?').run(orderId);
        db.prepare('DELETE FROM online_order_items WHERE order_id = ?').run(orderId);
        db.prepare('DELETE FROM stock_reservations WHERE order_id = ?').run(orderId);
        db.prepare('DELETE FROM online_orders WHERE id = ?').run(orderId);
      }
      db.prepare('DELETE FROM stock_movements WHERE product_variant_id = ?').run(variantId);
      db.prepare('DELETE FROM customer_cart_items WHERE product_id = ?').run(variantId);
      db.prepare('DELETE FROM customer_addresses WHERE customer_id IN (SELECT id FROM customers WHERE phone = ?)').run(formattedPhone);
      db.prepare('DELETE FROM customers WHERE phone = ?').run(formattedPhone);
      db.prepare('DELETE FROM product_variants WHERE id = ?').run(variantId);
      db.prepare('DELETE FROM products WHERE id = ?').run(productId);
      db.prepare('DELETE FROM users WHERE id = ?').run(adminUserId);
    } catch {
      // ignore
    }
  });

  it('Phase 1: Customer Creates Online Order (State = NEW, Stock Reserved)', async () => {
    // 1. Add item to cart
    const homeRes = await customerAgent.get('/');
    let custCsrf = homeRes.headers['x-csrf-token'];
    if (!custCsrf) {
      const match = homeRes.text.match(/<meta name="csrf-token" content="(.*?)">/);
      if (match) custCsrf = match[1];
    }

    const addRes = await customerAgent
      .post('/api/v1/cart/add')
      .set('CSRF-Token', custCsrf)
      .send({ product_id: variantId, quantity: 3, _csrf: custCsrf });
    expect(addRes.status).toBe(200);

    // 2. Checkout
    const checkoutRes = await customerAgent
      .post('/api/v1/store/checkout')
      .set('CSRF-Token', custCsrf)
      .send({
        name: 'Fulfillment Test User',
        phone: phone10,
        address: 'Villa 101, Palm Meadows',
        landmark: 'Near Club House',
        delivery_type: 'DELIVERY',
        payment_mode: 'COD',
        notes: 'Please pack in air-tight container',
        _csrf: custCsrf
      });

    expect([200, 201]).toContain(checkoutRes.status);
    const orderData = checkoutRes.body.data?.order || checkoutRes.body.order || checkoutRes.body;
    expect(orderData.id).toBeDefined();
    orderId = orderData.id;

    // Check Database State
    const order = db.prepare('SELECT status, total_amount, subtotal FROM online_orders WHERE id = ?').get(orderId) as any;
    expect(order.status).toBe('NEW');
    expect(order.subtotal).toBe(1800); // 3 * 600 = 1800

    const reservation = db.prepare('SELECT status, quantity FROM stock_reservations WHERE order_id = ?').get(orderId) as any;
    expect(reservation.status).toBe('ACTIVE');
    expect(reservation.quantity).toBe(3);

    const variant = db.prepare('SELECT reserved_qty, sold_qty, total_qty FROM product_variants WHERE id = ?').get(variantId) as any;
    expect(variant.reserved_qty).toBe(3);
    expect(variant.sold_qty).toBe(0);
  });

  it('Phase 2: Admin Confirms the Order (State Transition: NEW → CONFIRMED)', async () => {
    expect(orderId).toBeDefined();

    // Fetch CSRF token for admin actions
    const detailRes = await adminAgent.get(`/admin/online-orders/${orderId}`);
    expect(detailRes.status).toBe(200);
    adminCsrf = detailRes.headers['x-csrf-token'];
    if (!adminCsrf) {
      const match = detailRes.text.match(/<input type="hidden" name="_csrf" value="(.*?)">/)
        || detailRes.text.match(/<meta name="csrf-token" content="(.*?)">/);
      if (match) adminCsrf = match[1];
    }

    const res = await adminAgent
      .post(`/admin/online-orders/${orderId}/status`)
      .set('CSRF-Token', adminCsrf)
      .send({ new_status: 'CONFIRMED', _csrf: adminCsrf });
    expect([200, 302]).toContain(res.status);
    if (res.headers['x-csrf-token']) adminCsrf = res.headers['x-csrf-token'];

    const order = db.prepare('SELECT status FROM online_orders WHERE id = ?').get(orderId) as any;
    expect(order.status).toBe('CONFIRMED');
  });

  it('Phase 3: Order Preparation & Packing (State Transition: CONFIRMED → PACKING)', async () => {
    const res = await adminAgent
      .post(`/admin/online-orders/${orderId}/status`)
      .set('CSRF-Token', adminCsrf)
      .send({ new_status: 'PACKING', _csrf: adminCsrf });
    expect([200, 302]).toContain(res.status);
    if (res.headers['x-csrf-token']) adminCsrf = res.headers['x-csrf-token'];

    const order = db.prepare('SELECT status FROM online_orders WHERE id = ?').get(orderId) as any;
    expect(order.status).toBe('PACKING');
  });

  it('Phase 4: Order Ready for Dispatch (State Transition: PACKING → READY)', async () => {
    const res = await adminAgent
      .post(`/admin/online-orders/${orderId}/status`)
      .set('CSRF-Token', adminCsrf)
      .send({ new_status: 'READY', _csrf: adminCsrf });
    expect([200, 302]).toContain(res.status);
    if (res.headers['x-csrf-token']) adminCsrf = res.headers['x-csrf-token'];

    const order = db.prepare('SELECT status FROM online_orders WHERE id = ?').get(orderId) as any;
    expect(order.status).toBe('READY');
  });

  it('Phase 5: Order Out for Delivery (State Transition: READY → DISPATCHED)', async () => {
    const res = await adminAgent
      .post(`/admin/online-orders/${orderId}/status`)
      .set('CSRF-Token', adminCsrf)
      .send({ new_status: 'DISPATCHED', _csrf: adminCsrf });
    expect([200, 302]).toContain(res.status);
    if (res.headers['x-csrf-token']) adminCsrf = res.headers['x-csrf-token'];

    const order = db.prepare('SELECT status FROM online_orders WHERE id = ?').get(orderId) as any;
    expect(order.status).toBe('DISPATCHED');
  });

  it('Phase 6: Order Delivered & Completed (State Transition: DISPATCHED → COMPLETED)', async () => {
    const res = await adminAgent
      .post(`/admin/online-orders/${orderId}/status`)
      .set('CSRF-Token', adminCsrf)
      .send({ new_status: 'COMPLETED', _csrf: adminCsrf });
    expect([200, 302]).toContain(res.status);

    // 1. Order Status is COMPLETED
    const order = db.prepare('SELECT status FROM online_orders WHERE id = ?').get(orderId) as any;
    expect(order.status).toBe('COMPLETED');

    // 2. Reservation is COMMITTED
    const reservation = db.prepare('SELECT status FROM stock_reservations WHERE order_id = ?').get(orderId) as any;
    expect(reservation.status).toBe('COMMITTED');

    // 3. Stock counts updated: reserved_qty decremented to 0, sold_qty incremented to 3
    const variant = db.prepare('SELECT reserved_qty, sold_qty, total_qty FROM product_variants WHERE id = ?').get(variantId) as any;
    expect(variant.reserved_qty).toBe(0);
    expect(variant.sold_qty).toBe(3);
    expect(variant.total_qty - variant.sold_qty).toBe(22); // 25 - 3 = 22

    // 4. Stock ledger movements recorded
    const movements = db.prepare("SELECT movement_type, quantity_delta FROM stock_movements WHERE reference_id = ? ORDER BY id ASC").all(orderId.toString()) as any[];
    const movementTypes = movements.map(m => m.movement_type);
    expect(movementTypes).toContain('RESERVATION');
    expect(movementTypes).toContain('RESERVATION_RELEASE');
    expect(movementTypes).toContain('ONLINE_SALE');

    // 5. Full audit trail in status logs
    const logs = db.prepare('SELECT previous_status, new_status FROM order_status_logs WHERE order_id = ? ORDER BY id ASC').all(orderId) as any[];
    expect(logs.length).toBeGreaterThanOrEqual(6);
    expect(logs[0].new_status).toBe('NEW');
    expect(logs[logs.length - 1].new_status).toBe('COMPLETED');
  });
});
