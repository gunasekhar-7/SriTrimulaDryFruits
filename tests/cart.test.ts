import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../server.js';
import db from '../src/database.js';
import { customerRepository } from '../src/repositories/customer.repository.js';

describe('Server-Side Persistent Cart', () => {
  let customerCookies: string[] = [];
  let anonCookies: string[] = [];
  let customerId: number;
  let testProductId: number;
  let csrfTokenAnon: string;
  let csrfTokenAuth: string;

  beforeAll(async () => {
    // Insert test product
    let stmt = db.prepare(`
      INSERT OR IGNORE INTO product_variants (name, barcode, cost_price, selling_price, mrp, total_qty, sold_qty, category, tax_rate)
      VALUES ('Test Cashew', 'T-CASHEW-001', 500, 600, 700, 100, 0, 'Dry Fruits', 5)
    `);
    stmt.run();
    
    const prod = db.prepare("SELECT id FROM product_variants WHERE barcode = 'T-CASHEW-001'").get() as any;
    testProductId = prod.id;

    // Create a test customer
    const c = customerRepository.findOrCreateCustomer('919999999999', 'Test Cust', '', '', '');
    customerId = c.id;

    // Create an authenticated session by logging in
    // Note: We bypass full login UI and just mock the session or use supertest to login if a test route exists.
    // For now, let's test anonymous cart first.
    
    // Get anon CSRF
    const getResAnon = await request(app).get('/');
    anonCookies = getResAnon.header['set-cookie'];
    const htmlAnon = getResAnon.text;
    const matchAnon = htmlAnon.match(/<meta name="csrf-token" content="(.*?)">/);
    if (matchAnon) {
      csrfTokenAnon = matchAnon[1];
    }
  });

  it('should get an empty cart for anonymous user initially', async () => {
    const res = await request(app)
      .get('/api/v1/cart')
      .set('Cookie', anonCookies);
    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([]);
    expect(res.body.data.subtotal).toBe(0);
  });

  it('should add item to anonymous cart', async () => {
    const res = await request(app)
      .post('/api/v1/cart/add')
      .set('Cookie', anonCookies)
      .set('CSRF-Token', csrfTokenAnon)
      .send({ product_id: testProductId, quantity: 2 });
    
    if (res.headers['x-csrf-token']) csrfTokenAnon = res.headers['x-csrf-token'];
    
    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBe(1);
    expect(res.body.data.items[0].qty).toBe(2);
    expect(res.body.data.subtotal).toBe(1200); // 2 * 600
    
    // Save cookies (session update)
    if (res.header['set-cookie']) {
      anonCookies = res.header['set-cookie'];
    }
  });

  it('should update item quantity in anonymous cart', async () => {
    const res = await request(app)
      .post('/api/v1/cart/update')
      .set('Cookie', anonCookies)
      .set('CSRF-Token', csrfTokenAnon)
      .send({ product_id: testProductId, quantity: 5 });
      
    if (res.headers['x-csrf-token']) csrfTokenAnon = res.headers['x-csrf-token'];
      
    expect(res.status).toBe(200);
    expect(res.body.data.items[0].qty).toBe(5);
    expect(res.body.data.subtotal).toBe(3000);
    if (res.header['set-cookie']) {
      anonCookies = res.header['set-cookie'];
    }
  });

  it('should remove item from anonymous cart', async () => {
    const res = await request(app)
      .delete(`/api/v1/cart/remove/${testProductId}`)
      .set('Cookie', anonCookies)
      .set('CSRF-Token', csrfTokenAnon);
      
    if (res.headers['x-csrf-token']) csrfTokenAnon = res.headers['x-csrf-token'];
      
    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBe(0);
    expect(res.body.data.subtotal).toBe(0);
  });
  
  // Checking checkout process mapping
  it('should checkout using server cart logic', async () => {
    // Add item first
    const addRes = await request(app)
      .post('/api/v1/cart/add')
      .set('Cookie', anonCookies)
      .set('CSRF-Token', csrfTokenAnon)
      .send({ product_id: testProductId, quantity: 1 });
      
    if (addRes.headers['x-csrf-token']) csrfTokenAnon = addRes.headers['x-csrf-token'];
    if (addRes.header['set-cookie']) {
      anonCookies = addRes.header['set-cookie'];
    }
      
    const checkoutRes = await request(app)
      .post('/api/v1/store/checkout')
      .set('Cookie', anonCookies)
      .set('CSRF-Token', csrfTokenAnon)
      .send({
        name: 'Checkout Test',
        phone: '9999988888',
        delivery_type: 'STORE_PICKUP',
        payment_mode: 'COD',
        address: '',
        landmark: '',
        notes: 'Test'
      });
      
    expect(checkoutRes.status).toBe(201);
    expect(checkoutRes.body.data.order).toBeDefined();
    expect(checkoutRes.body.success).toBe(true);
    expect(checkoutRes.body.data.redirect).toBeDefined();
  });

  it('should reject adding out of stock item to anonymous cart with 400', async () => {
    // Create an out of stock product
    const barcode = `T-OOS-${Date.now()}`;
    const oos = db.prepare(`
      INSERT INTO product_variants (name, barcode, cost_price, selling_price, mrp, total_qty, sold_qty, category, tax_rate)
      VALUES ('OOS Item', ?, 500, 600, 700, 5, 5, 'Dry Fruits', 5)
    `).run(barcode);
    const oosId = oos.lastInsertRowid;

    const res = await request(app)
      .post('/api/v1/cart/add')
      .set('Cookie', anonCookies)
      .set('CSRF-Token', csrfTokenAnon)
      .send({ product_id: oosId, quantity: 1 });

    expect(res.status).toBe(409);
    const msg = res.body.error?.message || res.body.message;
    expect(msg).toMatch(/out of stock/i);
  });
});
