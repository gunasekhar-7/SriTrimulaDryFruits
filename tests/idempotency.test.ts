import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../server.js';
import db from '../src/database.js';
import crypto from 'crypto';
import { customerRepository } from '../src/repositories/customer.repository.js';
import { productService } from '../src/services/product.service.js';
import { cartService } from '../src/services/cart.service.js';

describe('Idempotency Mechanisms', () => {
  let customerId: number;
  let variantId: number;
  let cartId: number;
  let agent: any;

  let csrfToken = '';

  beforeEach(async () => {
    agent = request.agent(app);
    const c = customerRepository.createCustomer('Idempotent Cust', '9999933333', 'idem@example.com', 'pwd');
    customerId = c.id;
    const p = productService.addProduct('Idem Product', 'IDEM-1', 10, 100, 150, 200, 'Dry Fruits', '', 0);
    variantId = p.id;

    // Get CSRF Token
    const res = await agent.get('/');
    const match = res.text.match(/<meta name="csrf-token" content="(.*?)">/);
    if (match) csrfToken = match[1];

    // Login (Login might use body _csrf)
    const loginRes = await agent.post('/customer/login')
      .set('CSRF-Token', csrfToken)
      .send({ phone: '9999933333', password: 'pwd', _csrf: csrfToken });
    
    if (loginRes.headers['x-csrf-token']) csrfToken = loginRes.headers['x-csrf-token'];
    
    // Add to cart
    const addRes = await agent.post('/api/v1/cart/add')
      .set('CSRF-Token', csrfToken)
      .send({ product_id: variantId, quantity: 1, _csrf: csrfToken });
    
    if (addRes.headers['x-csrf-token']) csrfToken = addRes.headers['x-csrf-token'];
  });

  afterEach(() => {
    db.prepare('DELETE FROM online_order_items').run();
    db.prepare('DELETE FROM order_status_logs').run();
    db.prepare('DELETE FROM stock_reservations').run();
    db.prepare('DELETE FROM online_orders').run();
    db.prepare('DELETE FROM stock_movements WHERE product_variant_id = ?').run(variantId);
    db.prepare('DELETE FROM customer_cart_items').run();
    db.prepare('DELETE FROM customer_carts').run();
    db.prepare('DELETE FROM product_variants WHERE id = ?').run(variantId);
    db.prepare('DELETE FROM customers WHERE id = ?').run(customerId);
    db.prepare('DELETE FROM idempotency_keys').run();
  });

  it('should ignore duplicate checkout requests', async () => {
    const payload = {
      name: 'Idempotent Cust',
      phone: '9999933333',
      delivery_type: 'STORE_PICKUP',
      payment_mode: 'COD',
      notes: '',
      _csrf: csrfToken
    };
    const idempotencyKey = 'checkout_test_123';

    // Check cart state before checkout
    const cartRes = await agent.get('/api/v1/cart');
    console.log("CART RESPONSE BEFORE CHECKOUT:", cartRes.body);

    // First request
    const res1 = await agent.post('/api/v1/store/checkout')
      .set('CSRF-Token', csrfToken)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);
    
    expect(res1.status).toBe(201);
    expect(res1.body.success).toBe(true);
    expect(res1.body.data.order).toBeDefined();

    if (res1.headers['x-csrf-token']) csrfToken = res1.headers['x-csrf-token'];

    // Second request (duplicate)
    const res2 = await agent.post('/api/v1/store/checkout')
      .set('CSRF-Token', csrfToken)
      .set('Idempotency-Key', idempotencyKey)
      .send({...payload, _csrf: csrfToken});

    expect(res2.status).toBe(201);
    expect(res2.body.success).toBe(true);
    // Should return the exact same order
    expect(res2.body.data.order.id).toBe(res1.body.data.order.id);

    // Verify only one order exists in DB
    const orders = db.prepare('SELECT * FROM online_orders WHERE customer_id = ?').all(res1.body.data.order.customer_id);
    expect(orders.length).toBe(1);
  });

  it('should handle concurrent overlapping checkout requests gracefully', async () => {
    const payload = {
      name: 'Idempotent Cust',
      phone: '9999933333',
      delivery_type: 'STORE_PICKUP',
      payment_mode: 'COD',
      notes: '',
      _csrf: csrfToken
    };
    const idempotencyKey = 'checkout_test_concurrent';

    // Fire two identical requests at the exact same time
    const [res1, res2] = await Promise.all([
      agent.post('/api/v1/store/checkout').set('CSRF-Token', csrfToken).set('Idempotency-Key', idempotencyKey).send(payload),
      agent.post('/api/v1/store/checkout').set('CSRF-Token', csrfToken).set('Idempotency-Key', idempotencyKey).send(payload)
    ]);

    // One should succeed (201) and the other should either fail with 409 Concurrent request or return 201 (if the first finished extremely fast)
    // Given the synchronous nature of Node/SQLite, the first one will execute, the second one might get 409 if it tries to insert while the first is async, or 201 if the first is done.
    
    // We just verify that only ONE order was created.
    const successfulRes = res1.status === 201 ? res1 : res2;
    const orders = db.prepare('SELECT * FROM online_orders WHERE customer_id = ?').all(successfulRes.body.data.order.customer_id);
    expect(orders.length).toBe(1);
  });

  it('should ignore duplicate WhatsApp webhook events safely', async () => {
    const msgId = 'meta_msg_123';
    const payload = {
      entry: [{
        changes: [{
          value: {
            messages: [{
              from: '919999933333',
              id: msgId,
              text: { body: 'YES' }
            }]
          }
        }]
      }]
    };

    // Since we don't have an order to confirm, it will just return 200 after trying
    // But we are testing idempotency specifically.
    
    const payloadStr = JSON.stringify(payload);
    const signature = 'sha256=' + crypto.createHmac('sha256', process.env.WHATSAPP_WEBHOOK_SECRET || 'test_secret').update(payloadStr).digest('hex');

    // Fire webhook 1
    const res1 = await request(app)
      .post('/api/v1/whatsapp/webhook')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', signature)
      .send(payloadStr); // Need to send string if using raw body verification
    expect(res1.status).toBe(200);

    // Fire webhook 2 (Duplicate)
    const res2 = await request(app)
      .post('/api/v1/whatsapp/webhook')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', signature)
      .send(payloadStr);
    expect(res2.status).toBe(200);

    // Verify it was only processed once by checking idempotency_keys
    const idems = db.prepare('SELECT * FROM idempotency_keys WHERE key = ?').all(`whatsapp_${msgId}`);
    expect(idems.length).toBe(1);
    
    // In our implementation, idempotencyService updates the response_status to 200
    expect((idems[0] as any).response_status).toBe(200);
  });
});
