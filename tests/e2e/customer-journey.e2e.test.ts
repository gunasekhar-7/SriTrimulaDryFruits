import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../server.js';
import db from '../../src/database.js';

describe('E2E Customer Journey: Signup → Login → Browse → Add Cart → Checkout → Order → Order History', () => {
  const timestamp = Date.now();
  const rawPhone10 = '98' + Math.floor(10000000 + Math.random() * 90000000);
  const formattedPhone = '91' + rawPhone10;
  const customerName = `E2E Customer ${timestamp}`;
  const customerEmail = `e2e_cust_${timestamp}@test.com`;
  const customerPassword = 'CustomerSecurePassword#2026';

  let productId: number;
  let variantId: number;
  const barcode = `E2E_CUST_BC_${timestamp}`;
  let agent: any;
  let csrfToken = '';
  let createdOrderId: number;
  let createdOrderNumber: string;

  beforeAll(() => {
    agent = request.agent(app);

    // Seed test product
    const p = db.prepare('INSERT INTO products (name, description, active) VALUES (?, ?, 1)')
      .run(`E2E Cashews ${timestamp}`, 'Premium Goan Cashews');
    productId = p.lastInsertRowid as number;

    const v = db.prepare(`
      INSERT INTO product_variants (
        product_id, name, sku, barcode, size_weight, unit, cost_price, selling_price, mrp, total_qty, sold_qty, reserved_qty, category
      ) VALUES (?, ?, ?, ?, 1, 'unit', 750, 950, 1100, 30, 0, 0, 'Dry Fruits')
    `).run(productId, `E2E Cashews ${timestamp}`, `SKU_CUST_${timestamp}`, barcode);
    variantId = v.lastInsertRowid as number;
  });

  afterAll(() => {
    try {
      db.prepare('DELETE FROM order_status_logs WHERE order_id IN (SELECT id FROM online_orders WHERE customer_id IN (SELECT id FROM customers WHERE phone = ?))').run(formattedPhone);
      db.prepare('DELETE FROM online_order_items WHERE order_id IN (SELECT id FROM online_orders WHERE customer_id IN (SELECT id FROM customers WHERE phone = ?))').run(formattedPhone);
      db.prepare('DELETE FROM stock_reservations WHERE product_variant_id = ?').run(variantId);
      db.prepare('DELETE FROM stock_movements WHERE product_variant_id = ?').run(variantId);
      db.prepare('DELETE FROM online_orders WHERE customer_id IN (SELECT id FROM customers WHERE phone = ?)').run(formattedPhone);
      db.prepare('DELETE FROM customer_addresses WHERE customer_id IN (SELECT id FROM customers WHERE phone = ?)').run(formattedPhone);
      db.prepare('DELETE FROM customer_cart_items WHERE product_id = ?').run(variantId);
      db.prepare('DELETE FROM customers WHERE phone = ?').run(formattedPhone);
      db.prepare('DELETE FROM product_variants WHERE id = ?').run(variantId);
      db.prepare('DELETE FROM products WHERE id = ?').run(productId);
    } catch {
      // ignore teardown error
    }
  });

  it('Step 1: Customer Signup via Registration Form', async () => {
    const regPage = await agent.get('/customer/register');
    expect(regPage.status).toBe(200);

    const match = regPage.text.match(/<input type="hidden" name="_csrf" value="(.*?)">/)
      || regPage.headers['x-csrf-token'];
    csrfToken = typeof match === 'string' ? match : (match ? match[1] : '');
    expect(csrfToken).toBeTruthy();

    const registerRes = await agent
      .post('/customer/register')
      .set('CSRF-Token', csrfToken)
      .send({
        name: customerName,
        phone: rawPhone10,
        email: customerEmail,
        password: customerPassword,
        _csrf: csrfToken
      });

    // Registration redirects to login or dashboard
    expect([200, 302]).toContain(registerRes.status);

    // Verify record in SQLite customers table
    const custDb = db.prepare('SELECT * FROM customers WHERE phone = ? OR phone = ?').get(rawPhone10, formattedPhone) as any;
    expect(custDb).toBeDefined();
    expect(custDb.name).toBe(customerName);
    expect(custDb.email).toBe(customerEmail);
    expect(custDb.account_status).toBe('ACTIVE');
  });

  it('Step 2: Customer Login', async () => {
    // Fresh agent to verify login with created credentials
    agent = request.agent(app);

    const loginPage = await agent.get('/customer/login');
    expect(loginPage.status).toBe(200);

    const match = loginPage.text.match(/<input type="hidden" name="_csrf" value="(.*?)">/)
      || loginPage.headers['x-csrf-token'];
    if (match) csrfToken = typeof match === 'string' ? match : match[1];

    const loginRes = await agent
      .post('/customer/login')
      .set('CSRF-Token', csrfToken)
      .send({
        email: customerEmail,
        password: customerPassword,
        _csrf: csrfToken
      });

    expect(loginRes.status).toBe(302);
    expect(loginRes.headers.location).toMatch(/account|dashboard|\//);
  });

  it('Step 3: Browse Storefront Catalog', async () => {
    const homeRes = await agent.get('/');
    expect(homeRes.status).toBe(200);
    expect(homeRes.text).toMatch(/Sri Tirumala/i);

    const productApiRes = await agent.get(`/api/v1/products/${barcode}`);
    expect(productApiRes.status).toBe(200);
    expect(productApiRes.body.data.product.selling_price).toBe(950);
  });

  it('Step 4: Add Product to Shopping Cart', async () => {
    // Get fresh token
    const homeRes = await agent.get('/');
    const match = homeRes.text.match(/<meta name="csrf-token" content="(.*?)">/)
      || homeRes.headers['x-csrf-token'];
    if (match) csrfToken = typeof match === 'string' ? match : match[1];

    const addRes = await agent
      .post('/api/v1/cart/add')
      .set('CSRF-Token', csrfToken)
      .send({
        product_id: variantId,
        quantity: 1,
        _csrf: csrfToken
      });

    expect(addRes.status).toBe(200);
    expect(addRes.body.success).toBe(true);

    const cartRes = await agent.get('/api/v1/cart');
    expect(cartRes.status).toBe(200);
    const item = cartRes.body.data.items.find((i: any) => i.id === variantId);
    expect(item).toBeDefined();
    expect(item.qty).toBe(1);
    expect(item.price).toBe(950);
  });

  it('Step 5: Checkout Order', async () => {
    const homeRes = await agent.get('/');
    const match = homeRes.text.match(/<meta name="csrf-token" content="(.*?)">/)
      || homeRes.headers['x-csrf-token'];
    if (match) csrfToken = typeof match === 'string' ? match : match[1];

    const checkoutRes = await agent
      .post('/api/v1/store/checkout')
      .set('CSRF-Token', csrfToken)
      .send({
        name: customerName,
        phone: rawPhone10,
        address: 'Bungalow 7, Hill View Estate',
        landmark: 'Opposite Lake Park',
        delivery_type: 'STORE_PICKUP',
        payment_mode: 'COD',
        notes: 'E2E Customer Journey test order',
        _csrf: csrfToken
      });

    expect([200, 201]).toContain(checkoutRes.status);
    const orderData = checkoutRes.body.data?.order || checkoutRes.body.order || checkoutRes.body;
    expect(orderData.id).toBeDefined();
    createdOrderId = orderData.id;
    createdOrderNumber = orderData.order_number;
  });

  it('Step 6: Order Record Verification in Database & Reservations', async () => {
    expect(createdOrderId).toBeDefined();

    const orderRow = db.prepare('SELECT * FROM online_orders WHERE id = ?').get(createdOrderId) as any;
    expect(orderRow).toBeDefined();
    expect(orderRow.status).toBe('NEW');
    expect(orderRow.total_amount).toBe(950);

    const reservation = db.prepare('SELECT * FROM stock_reservations WHERE order_id = ?').get(createdOrderId) as any;
    expect(reservation).toBeDefined();
    expect(reservation.status).toBe('ACTIVE');
    expect(reservation.quantity).toBe(1);
  });

  it('Step 7: View Order History in Customer Portal', async () => {
    // 1. Order History list
    const historyRes = await agent.get('/account/orders');
    expect(historyRes.status).toBe(200);
    expect(historyRes.text).toContain(createdOrderNumber || 'STDF-');

    // 2. Specific Order Details
    const detailRes = await agent.get(`/account/orders/${createdOrderId}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.text).toContain('950');
    expect(detailRes.text).toContain('NEW');
  });
});
