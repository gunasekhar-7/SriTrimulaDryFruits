import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../server.js';
import db from '../../src/database.js';
import bcrypt from 'bcryptjs';

describe('Integration Tests: Full Vertical Slice (API → Service → Repository → SQLite)', () => {
  const testRunId = Date.now();
  let productId: number;
  let variantId: number;
  const testBarcode = `INTG_BC_${testRunId}`;
  const testPhone10 = '98' + Math.floor(10000000 + Math.random() * 90000000);
  const testPhone = '91' + testPhone10;
  let adminUserId: number;
  const adminUsername = `intg_admin_${testRunId}`;
  let adminAgent: any;
  let customerAgent: any;
  let createdOrderId: number;

  beforeAll(async () => {
    // 1. Seed isolated product and variant directly in SQLite
    const p = db.prepare('INSERT INTO products (name, description, active) VALUES (?, ?, 1)')
      .run(`Integ Almonds ${testRunId}`, 'Test dry fruits');
    productId = p.lastInsertRowid as number;

    const v = db.prepare(`
      INSERT INTO product_variants (
        product_id, name, sku, barcode, size_weight, unit, cost_price, selling_price, mrp, total_qty, sold_qty, reserved_qty, category
      ) VALUES (?, ?, ?, ?, 1, 'unit', 600, 850, 999, 50, 0, 0, 'Dry Fruits')
    `).run(productId, `Integ Almonds ${testRunId}`, `SKU_${testRunId}`, testBarcode);
    variantId = v.lastInsertRowid as number;

    // 2. Seed isolated admin user in SQLite
    const passHash = bcrypt.hashSync('AdminPass#123', 10);
    const u = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
      .run(adminUsername, passHash, 'admin');
    adminUserId = u.lastInsertRowid as number;

    // 3. Setup agents
    adminAgent = request.agent(app);
    customerAgent = request.agent(app);

    // Login admin agent
    const homeRes = await adminAgent.get('/login');
    let csrfToken = '';
    const match = homeRes.text.match(/<input type="hidden" name="_csrf" value="(.*?)">/)
      || homeRes.headers['x-csrf-token'];
    csrfToken = typeof match === 'string' ? match : (match ? match[1] : '');

    await adminAgent.post('/login')
      .set('CSRF-Token', csrfToken)
      .send({ username: adminUsername, password: 'AdminPass#123', _csrf: csrfToken });
  });

  afterAll(() => {
    try {
      // Clean up isolated test data
      db.prepare('DELETE FROM order_status_logs WHERE order_id IN (SELECT id FROM online_orders WHERE customer_id IN (SELECT id FROM customers WHERE phone = ?))').run(testPhone);
      db.prepare('DELETE FROM online_order_items WHERE order_id IN (SELECT id FROM online_orders WHERE customer_id IN (SELECT id FROM customers WHERE phone = ?))').run(testPhone);
      db.prepare('DELETE FROM stock_reservations WHERE product_variant_id = ?').run(variantId);
      db.prepare('DELETE FROM stock_movements WHERE product_variant_id = ?').run(variantId);
      db.prepare('DELETE FROM online_orders WHERE customer_id IN (SELECT id FROM customers WHERE phone = ?)').run(testPhone);
      db.prepare('DELETE FROM customer_addresses WHERE customer_id IN (SELECT id FROM customers WHERE phone = ?)').run(testPhone);
      db.prepare('DELETE FROM customer_cart_items WHERE product_id = ?').run(variantId);
      db.prepare('DELETE FROM customers WHERE phone = ?').run(testPhone);
      db.prepare('DELETE FROM product_variants WHERE id = ?').run(variantId);
      db.prepare('DELETE FROM products WHERE id = ?').run(productId);
      db.prepare('DELETE FROM users WHERE id = ?').run(adminUserId);
    } catch {
      // ignore teardown errors
    }
  });

  it('Vertical Slice 1: Product Catalog API → Service → Repository → SQLite', async () => {
    // API Call
    const res = await request(app).get(`/api/v1/products/${testBarcode}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Response structure
    const returnedProduct = res.body.data.product;
    expect(returnedProduct.id).toBe(variantId);
    expect(returnedProduct.selling_price).toBe(850);
    expect(returnedProduct.available).toBe(50);

    // Verify raw SQLite state matches
    const dbRow = db.prepare('SELECT selling_price, total_qty, sold_qty, reserved_qty FROM product_variants WHERE id = ?').get(variantId);
    expect(dbRow.selling_price).toBe(returnedProduct.selling_price);
    expect(dbRow.total_qty - dbRow.sold_qty - dbRow.reserved_qty).toBe(returnedProduct.available);
  });

  it('Vertical Slice 2: Cart API → Cart Service → Cart Repository → SQLite', async () => {
    // Retrieve CSRF token
    const homeRes = await customerAgent.get('/');
    let csrf = '';
    const match = homeRes.text.match(/<meta name="csrf-token" content="(.*?)">/)
      || homeRes.headers['x-csrf-token'];
    csrf = typeof match === 'string' ? match : (match ? match[1] : '');

    // Add item to cart
    const addRes = await customerAgent.post('/api/v1/cart/add')
      .set('CSRF-Token', csrf)
      .send({ product_id: variantId, quantity: 2, _csrf: csrf });

    expect(addRes.status).toBe(200);
    expect(addRes.body.success).toBe(true);
    expect(addRes.body.data.items.length).toBeGreaterThanOrEqual(1);

    // Verify Cart API fetch
    const getCartRes = await customerAgent.get('/api/v1/cart');
    expect(getCartRes.status).toBe(200);
    const cartItems = getCartRes.body.data.items;
    const addedItem = cartItems.find((i: any) => i.id === variantId);
    expect(addedItem).toBeDefined();
    expect(addedItem.qty).toBe(2);
    expect(addedItem.price).toBe(850);
  });

  it('Vertical Slice 3: Store Checkout API → Idempotency → OrderService → Repository → SQLite', async () => {
    const homeRes = await customerAgent.get('/');
    let csrf = '';
    const match = homeRes.text.match(/<meta name="csrf-token" content="(.*?)">/)
      || homeRes.headers['x-csrf-token'];
    csrf = typeof match === 'string' ? match : (match ? match[1] : '');

    const checkoutPayload = {
      name: 'Integration Test Customer',
      phone: testPhone10,
      address: 'Shop 42, Market Complex',
      landmark: 'Near Clock Tower',
      delivery_type: 'STORE_PICKUP',
      payment_mode: 'COD',
      notes: 'Testing full vertical slice',
      _csrf: csrf
    };

    const idempotencyKey = `intg_idem_${testRunId}`;

    // Execute Checkout API
    const checkoutRes = await customerAgent
      .post('/api/v1/store/checkout')
      .set('CSRF-Token', csrf)
      .set('idempotency-key', idempotencyKey)
      .send(checkoutPayload);

    expect([200, 201]).toContain(checkoutRes.status);
    const orderData = checkoutRes.body.data?.order || checkoutRes.body.order || checkoutRes.body;
    expect(orderData.id).toBeDefined();
    createdOrderId = orderData.id;

    // Verify SQLite online_orders row
    const orderDb = db.prepare('SELECT * FROM online_orders WHERE id = ?').get(createdOrderId);
    expect(orderDb).toBeDefined();
    expect(orderDb.status).toBe('NEW');
    expect(orderDb.total_amount).toBe(1700); // 850 * 2 = 1700

    // Verify SQLite online_order_items row
    const orderItemsDb = db.prepare('SELECT * FROM online_order_items WHERE order_id = ?').all(createdOrderId);
    expect(orderItemsDb.length).toBe(1);
    expect(orderItemsDb[0].product_id).toBe(variantId);
    expect(orderItemsDb[0].quantity).toBe(2);

    // Verify SQLite stock_reservations row
    const reservationDb = db.prepare('SELECT * FROM stock_reservations WHERE order_id = ?').get(createdOrderId);
    expect(reservationDb).toBeDefined();
    expect(reservationDb.status).toBe('ACTIVE');
    expect(reservationDb.quantity).toBe(2);

    // Verify SQLite stock_movements entry
    const movementDb = db.prepare("SELECT * FROM stock_movements WHERE reference_id = ? AND movement_type = 'RESERVATION'").get(createdOrderId.toString());
    expect(movementDb).toBeDefined();
    expect(movementDb.quantity_delta).toBe(-2);

    // Verify product_variants table reserved_qty is updated
    const variantDb = db.prepare('SELECT reserved_qty, sold_qty, total_qty FROM product_variants WHERE id = ?').get(variantId);
    expect(variantDb.reserved_qty).toBe(2);
  });

  it('Vertical Slice 4: Admin Fulfillment API → OrderService → StateMachine → Inventory Commit → SQLite', async () => {
    expect(createdOrderId).toBeDefined();

    // Fetch CSRF token for admin
    const adminPageRes = await adminAgent.get(`/admin/online-orders/${createdOrderId}`);
    let adminCsrf = adminPageRes.headers['x-csrf-token'];
    if (!adminCsrf) {
      const match = adminPageRes.text.match(/<input type="hidden" name="_csrf" value="(.*?)">/)
        || adminPageRes.text.match(/<meta name="csrf-token" content="(.*?)">/);
      if (match) adminCsrf = match[1];
    }

    const updateStatus = async (targetStatus: string) => {
      const res = await adminAgent
        .post(`/admin/online-orders/${createdOrderId}/status`)
        .set('CSRF-Token', adminCsrf)
        .send({ new_status: targetStatus, _csrf: adminCsrf });
      if (res.headers['x-csrf-token']) adminCsrf = res.headers['x-csrf-token'];
      return res;
    };

    // 1. Admin confirms order
    const confirmRes = await updateStatus('CONFIRMED');
    expect([200, 302]).toContain(confirmRes.status);
    let orderRow = db.prepare('SELECT status FROM online_orders WHERE id = ?').get(createdOrderId);
    expect(orderRow.status).toBe('CONFIRMED');

    // 2. Admin advances to PACKING
    await updateStatus('PACKING');
    orderRow = db.prepare('SELECT status FROM online_orders WHERE id = ?').get(createdOrderId);
    expect(orderRow.status).toBe('PACKING');

    // 3. Admin advances to READY
    await updateStatus('READY');
    orderRow = db.prepare('SELECT status FROM online_orders WHERE id = ?').get(createdOrderId);
    expect(orderRow.status).toBe('READY');

    // 4. Admin advances to DISPATCHED
    await updateStatus('DISPATCHED');
    orderRow = db.prepare('SELECT status FROM online_orders WHERE id = ?').get(createdOrderId);
    expect(orderRow.status).toBe('DISPATCHED');

    // 5. Admin completes order
    await updateStatus('COMPLETED');
    orderRow = db.prepare('SELECT status FROM online_orders WHERE id = ?').get(createdOrderId);
    expect(orderRow.status).toBe('COMPLETED');

    // Verify SQLite commitment:
    // - Reservation status changed to COMMITTED
    const reservationDb = db.prepare('SELECT status FROM stock_reservations WHERE order_id = ?').get(createdOrderId);
    expect(reservationDb.status).toBe('COMMITTED');

    // - Variant reserved_qty reduced, sold_qty incremented
    const variantDb = db.prepare('SELECT reserved_qty, sold_qty FROM product_variants WHERE id = ?').get(variantId);
    expect(variantDb.reserved_qty).toBe(0);
    expect(variantDb.sold_qty).toBe(2);

    // - Status logs exist for all state transitions
    const logs = db.prepare('SELECT new_status FROM order_status_logs WHERE order_id = ? ORDER BY id ASC').all(createdOrderId);
    const statuses = logs.map((l: any) => l.new_status);
    expect(statuses).toContain('NEW');
    expect(statuses).toContain('CONFIRMED');
    expect(statuses).toContain('PACKING');
    expect(statuses).toContain('READY');
    expect(statuses).toContain('DISPATCHED');
    expect(statuses).toContain('COMPLETED');
  });
});
