import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../server.js';
import db from '../../src/database.js';
import { otpService, MockOtpProvider } from '../../src/services/otp.service.js';
import { queueService } from '../../src/queue/index.js';
import { whatsappClient } from '../../src/integrations/whatsapp/client.js';

describe('Notification Dual-Send Prevention Suite (OTP & Store Checkout)', () => {
  const testPhone = '9876500001';
  const testPhoneNormalized = '919876500001';

  beforeEach(() => {
    vi.restoreAllMocks();
    db.prepare('DELETE FROM phone_verifications').run();
    db.prepare("DELETE FROM background_jobs WHERE name IN ('otp_delivery', 'whatsapp_notification')").run();
  });

  afterEach(() => {
    db.prepare('DELETE FROM phone_verifications').run();
    db.prepare("DELETE FROM background_jobs WHERE name IN ('otp_delivery', 'whatsapp_notification')").run();
  });

  it('1. OtpService.sendOtp() invokes provider.sendOtp exactly once and does not duplicate via worker', async () => {
    const mockProvider = new MockOtpProvider();
    const sendSpy = vi.spyOn(mockProvider, 'sendOtp');
    otpService.setProvider(mockProvider);

    // Call sendOtp with active queue worker started
    queueService.startWorker(50);

    try {
      const res = await otpService.sendOtp(testPhone, 'REGISTRATION');
      expect(res.success).toBe(true);

      // Verify immediate inline delivery was recorded in mock provider
      expect(mockProvider.getLastOtp(testPhoneNormalized, 'REGISTRATION')).toBeDefined();

      // Allow any worker cycle to run
      await new Promise(r => setTimeout(r, 100));
      await queueService.processNextBatch();

      // Expect provider.sendOtp was called EXACTLY ONCE (never duplicated by queue worker)
      expect(sendSpy).toHaveBeenCalledTimes(1);

      // Verify the enqueued job is in COMPLETED state
      const jobs = queueService.getJobs({ name: 'otp_delivery' });
      expect(jobs.length).toBe(1);
      expect(jobs[0].status).toBe('COMPLETED');
    } finally {
      queueService.stopWorker();
    }
  });

  it('2. StoreController checkoutApi creates exactly ONE whatsapp_notification job and does not trigger direct out-of-band text message', async () => {
    // Seed variant
    const p = db.prepare("INSERT INTO products (name) VALUES ('Dual-Send Test Almonds')").run();
    const prodId = p.lastInsertRowid as number;
    const v = db.prepare(`
      INSERT INTO product_variants (product_id, name, barcode, selling_price, cost_price, total_qty, sold_qty, reserved_qty, category)
      VALUES (?, 'Dual-Send Test Almonds', 'DS_ALM_01', 300, 200, 50, 0, 0, 'Dry Fruits')
    `).run(prodId);
    const variantId = v.lastInsertRowid as number;

    const directTextSpy = vi.spyOn(whatsappClient, 'sendTextMessage').mockResolvedValue({ messages: [{ id: 'mock_direct' }] });
    const templateSpy = vi.spyOn(whatsappClient, 'sendTemplateMessage').mockResolvedValue({ messages: [{ id: 'mock_tmpl' }] });

    const agent = request.agent(app);

    // Get CSRF
    const homeRes = await agent.get('/');
    const csrf = homeRes.headers['x-csrf-token'] || 
      (homeRes.text.match(/<meta name="csrf-token" content="(.*?)">/) || [])[1];

    // Add to cart
    await agent
      .post('/api/v1/cart/add')
      .set('CSRF-Token', csrf)
      .send({ product_id: variantId, quantity: 1, _csrf: csrf });

    // Checkout via API
    const checkoutRes = await agent
      .post('/api/v1/store/checkout')
      .set('CSRF-Token', csrf)
      .send({
        name: 'Single Send Customer',
        phone: '9876500002',
        address: 'Main Road Tekkali',
        delivery_type: 'DELIVERY',
        payment_mode: 'COD',
        _csrf: csrf
      });

    expect(checkoutRes.status).toBe(201);
    const orderId = checkoutRes.body.data?.order?.id || checkoutRes.body.order?.id;
    expect(orderId).toBeDefined();

    // 1. Assert NO direct out-of-band sendTextMessage was dispatched during checkout request
    expect(directTextSpy).not.toHaveBeenCalled();

    // 2. Assert exactly ONE whatsapp_notification job was created in background_jobs
    const jobs = queueService.getJobs({ name: 'whatsapp_notification' });
    const orderJobs = jobs.filter(j => j.payload?.orderId === orderId);
    expect(orderJobs.length).toBe(1);
    expect(orderJobs[0].idempotency_key).toBe(`whatsapp_order_${orderId}_NEW`);

    // Clean up
    db.prepare('DELETE FROM order_status_logs WHERE order_id = ?').run(orderId);
    db.prepare('DELETE FROM online_order_items WHERE order_id = ?').run(orderId);
    db.prepare('DELETE FROM stock_reservations WHERE order_id = ?').run(orderId);
    db.prepare('DELETE FROM stock_movements WHERE reference_id = ?').run(orderId.toString());
    db.prepare('DELETE FROM online_orders WHERE id = ?').run(orderId);
    db.prepare('DELETE FROM product_variants WHERE id = ?').run(variantId);
    db.prepare('DELETE FROM products WHERE id = ?').run(prodId);
  });
});
