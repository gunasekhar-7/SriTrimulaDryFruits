import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../server.js';
import db from '../src/database.js';
import {
  metricsRegistry,
  metricsAggregator,
  otelTracer,
  inMemorySpanExporter,
  getRecordedSpans,
  buildTraceTree,
  getRecentTraces
} from '../src/observability/index.js';
import { orderService } from '../src/services/order.service.js';
import { billingService } from '../src/services/billing.service.js';
import { whatsappService } from '../src/services/whatsapp.service.js';
import { whatsappClient } from '../src/integrations/whatsapp/client.js';

describe('Observability & Metrics System', () => {
  beforeEach(() => {
    metricsAggregator.reset();
    inMemorySpanExporter.reset();
    vi.restoreAllMocks();
  });

  describe('1. Technical Metrics', () => {
    it('should track HTTP request count, request latency, and 4xx rate', async () => {
      // Valid request (200)
      const res200 = await request(app).get('/health');
      expect(res200.status).toBe(200);

      // Non-existent route (404)
      const res404 = await request(app).get('/non-existent-page-xyz');
      expect(res404.status).toBe(404);

      const summary = metricsAggregator.getSummary();
      expect(summary.technical.httpRequestCount).toBeGreaterThanOrEqual(1);
      expect(summary.technical.requestLatencyMs.avg).toBeGreaterThanOrEqual(0);
      expect(summary.technical.rate4xxPercent).toBeGreaterThan(0);
    });

    it('should track 5xx rate on unhandled server error', async () => {
      metricsAggregator.recordHttpRequest('GET', '/api/error', 500, 0.05);

      const summary = metricsAggregator.getSummary();
      expect(summary.technical.rate5xxPercent).toBeGreaterThan(0);
      expect(summary.technical.httpRequestCount).toBe(1);
    });

    it('should track DB latency and query count through SQLite instrumentation', () => {
      // Execute sample queries
      db.prepare('SELECT 1 as test').get();
      db.prepare('SELECT COUNT(*) FROM products').all();

      const summary = metricsAggregator.getSummary();
      expect(summary.technical.dbLatencyMs.totalQueries).toBeGreaterThanOrEqual(2);
      expect(summary.technical.dbLatencyMs.avg).toBeGreaterThanOrEqual(0);
    });

    it('should track authentication failures for staff and customer', async () => {
      // 1. Staff login failure with valid CSRF
      const staffAgent = request.agent(app);
      const staffGet = await staffAgent.get('/login');
      const staffCsrf = staffGet.headers['x-csrf-token'];

      await staffAgent
        .post('/login')
        .set('csrf-token', staffCsrf)
        .send({ username: 'invalid_user', password: 'bad_password', _csrf: staffCsrf });

      // 2. Customer login failure with valid CSRF
      const custAgent = request.agent(app);
      const custGet = await custAgent.get('/customer/login');
      const custCsrf = custGet.headers['x-csrf-token'];

      await custAgent
        .post('/customer/login')
        .set('csrf-token', custCsrf)
        .send({ email: 'unknown@example.com', password: 'bad_password', _csrf: custCsrf });

      // 3. Direct CSRF failure
      await request(app)
        .post('/login')
        .send({ username: 'invalid_user', password: 'bad_password' });

      const summary = metricsAggregator.getSummary();
      expect(summary.technical.authenticationFailures.total).toBeGreaterThanOrEqual(3);
      expect(summary.technical.authenticationFailures.byType['staff:invalid_credentials']).toBe(1);
      expect(summary.technical.authenticationFailures.byType['customer:invalid_credentials']).toBe(1);
      expect(summary.technical.authenticationFailures.byType['unknown:csrf_validation_failed']).toBe(1);
    });

    it('should track webhook failures', () => {
      metricsAggregator.recordWebhookFailure('whatsapp', 'signature_verification_failed');
      metricsAggregator.recordWebhookFailure('whatsapp', 'idempotency_conflict');

      const summary = metricsAggregator.getSummary();
      expect(summary.technical.webhookFailures.total).toBe(2);
      expect(summary.technical.webhookFailures.byType['whatsapp:signature_verification_failed']).toBe(1);
      expect(summary.technical.webhookFailures.byType['whatsapp:idempotency_conflict']).toBe(1);
    });

    it('should track background job failures and durations', () => {
      metricsAggregator.recordBackgroundJobRun('database_backup', 1.25, true);
      metricsAggregator.recordBackgroundJobRun('whatsapp_retry', 0.45, false, 'network_timeout');

      const summary = metricsAggregator.getSummary();
      expect(summary.technical.backgroundJobFailures.total).toBe(1);
      expect(summary.technical.backgroundJobFailures.byJob['whatsapp_retry:network_timeout']).toBe(1);
    });
  });

  describe('2. Business Metrics', () => {
    let customerId: number;
    let variantId: number;

    beforeEach(() => {
      const phone = '999' + Math.floor(1000000 + Math.random() * 9000000);
      const cust = db.prepare('INSERT INTO customers (name, phone) VALUES (?, ?)').run('Metrics Cust', phone);
      customerId = cust.lastInsertRowid as number;

      const p = db.prepare('INSERT INTO products (name) VALUES (?)').run('Metrics Dry Fruit ' + Date.now());
      const prodId = p.lastInsertRowid as number;

      const v = db.prepare(`
        INSERT INTO product_variants (name, barcode, selling_price, cost_price, total_qty, sold_qty, reserved_qty, product_id)
        VALUES (?, ?, 200, 100, 50, 0, 0, ?)
      `).run('Metrics Dry Fruit Variant', 'METRICS_BC_' + Date.now() + '_' + Math.floor(Math.random() * 100000), prodId);
      variantId = v.lastInsertRowid as number;
    });

    it('should track checkout attempts, successful orders, and online revenue', () => {
      const order = orderService.createOnlineOrder({
        customer_id: customerId,
        items: [{ product_id: variantId, quantity: 2 }],
        payment_mode: 'COD',
        delivery_type: 'DELIVERY',
        delivery_charge: 50,
        discount: 10
      });

      const summary = metricsAggregator.getSummary();
      expect(summary.business.successfulOrders.online).toBe(1);
      expect(summary.business.onlineRevenueInr).toBe(440); // 200*2 + 50 - 10
      expect(summary.business.averageOrderValueInr.online).toBe(440);
    });

    it('should track offline revenue and checkout attempts via POS', () => {
      billingService.createBill('2026-10-09', '10:00 AM', [{
        id: variantId,
        name: 'POS Cashew',
        qty: 1,
        price: 200,
        mrp: 250,
        cost: 100,
        total: 200,
        tax_rate: 0
      }], 'Walk-in Customer', '9888877777', 0, 'Cash', null);

      const summary = metricsAggregator.getSummary();
      expect(summary.business.successfulOrders.offline).toBe(1);
      expect(summary.business.offlineRevenueInr).toBe(200);
      expect(summary.business.averageOrderValueInr.offline).toBe(200);
    });

    it('should track stock-outs when requested quantity exceeds available stock', () => {
      expect(() => {
        orderService.createOnlineOrder({
          customer_id: customerId,
          items: [{ product_id: variantId, quantity: 9999 }], // Exceeds available stock
          payment_mode: 'COD',
          delivery_type: 'STORE_PICKUP',
          delivery_charge: 0,
          discount: 0
        });
      }).toThrow(/Insufficient stock/);

      const summary = metricsAggregator.getSummary();
      expect(summary.business.stockOuts.total).toBe(1);
      expect(summary.business.stockOuts.byProduct['Metrics Dry Fruit Variant']).toBe(1);
    });

    it('should track repeat customers and repeat order rate', () => {
      // First order
      orderService.createOnlineOrder({
        customer_id: customerId,
        items: [{ product_id: variantId, quantity: 1 }],
        payment_mode: 'COD',
        delivery_type: 'STORE_PICKUP',
        delivery_charge: 0,
        discount: 0
      });

      // Second order by same customer
      orderService.createOnlineOrder({
        customer_id: customerId,
        items: [{ product_id: variantId, quantity: 1 }],
        payment_mode: 'COD',
        delivery_type: 'STORE_PICKUP',
        delivery_charge: 0,
        discount: 0
      });

      const summary = metricsAggregator.getSummary();
      expect(summary.business.successfulOrders.total).toBe(2);
      expect(summary.business.repeatCustomers.totalOrdersByRepeatCustomers).toBe(1);
      expect(summary.business.repeatCustomers.repeatCustomerRatePercent).toBe(50);
    });

    it('should track cancellations', () => {
      const order = orderService.createOnlineOrder({
        customer_id: customerId,
        items: [{ product_id: variantId, quantity: 1 }],
        payment_mode: 'COD',
        delivery_type: 'STORE_PICKUP',
        delivery_charge: 0,
        discount: 0
      });

      orderService.updateOrderStatus(order.id, 'CANCELLED', 'Customer Requested');

      const summary = metricsAggregator.getSummary();
      expect(summary.business.cancellations.total).toBe(1);
      expect(summary.business.cancellations.byReason['Customer Requested']).toBe(1);
    });

    it('should track WhatsApp conversion rate', () => {
      // Notification sent
      metricsAggregator.recordWhatsAppNotificationSent();
      metricsAggregator.recordWhatsAppNotificationSent();

      // Customer confirms 1 of 2
      metricsAggregator.recordWhatsAppConversion();

      const summary = metricsAggregator.getSummary();
      expect(summary.business.whatsappConversion.notificationsSent).toBe(2);
      expect(summary.business.whatsappConversion.conversions).toBe(1);
      expect(summary.business.whatsappConversion.conversionRatePercent).toBe(50);
    });
  });

  describe('3. OpenTelemetry Distributed Tracing Journey', () => {
    let traceVariantId: number;

    beforeEach(() => {
      const p = db.prepare('INSERT INTO products (name) VALUES (?)').run('Trace Almonds ' + Date.now());
      const prodId = p.lastInsertRowid as number;

      const v = db.prepare(`
        INSERT INTO product_variants (name, barcode, selling_price, cost_price, total_qty, sold_qty, reserved_qty, product_id)
        VALUES (?, ?, 250, 150, 50, 0, 0, ?)
      `).run('Trace Almonds Premium', 'TRACE_BC_' + Date.now() + '_' + Math.floor(Math.random() * 100000), prodId);
      traceVariantId = v.lastInsertRowid as number;
      db.prepare("DELETE FROM background_jobs WHERE status = 'PENDING'").run();
    });

    it('should record an end-to-end trace: HTTP request → order service → database → WhatsApp notification → webhook → order status change', async () => {
      vi.spyOn(whatsappClient, 'sendTextMessage').mockResolvedValue({ messages: [{ id: 'mock_msg_trace' }] });
      vi.spyOn(whatsappClient, 'sendTemplateMessage').mockResolvedValue({ messages: [{ id: 'mock_tpl_trace' }] });

      const agent = request.agent(app);
      const homeRes = await agent.get('/');
      let csrfToken = '';
      const match = homeRes.text.match(/<meta name="csrf-token" content="(.*?)">/);
      if (match) csrfToken = match[1];

      // Add item to cart
      const addRes = await agent.post('/api/v1/cart/add')
        .set('CSRF-Token', csrfToken)
        .send({ product_id: traceVariantId, quantity: 1, _csrf: csrfToken });
      if (addRes.headers['x-csrf-token']) csrfToken = addRes.headers['x-csrf-token'];

      // Step 1: Client sends HTTP Checkout request
      const phoneDigits = '98' + Math.floor(10000000 + Math.random() * 90000000);
      const checkoutRes = await agent
        .post('/api/v1/store/checkout')
        .set('CSRF-Token', csrfToken)
        .send({
          name: 'Trace Journey User',
          phone: phoneDigits,
          delivery_type: 'STORE_PICKUP',
          payment_mode: 'COD',
          notes: 'Observability Test',
          _csrf: csrfToken
        });

      expect([200, 201]).toContain(checkoutRes.status);
      const traceId = checkoutRes.headers['x-trace-id'];
      expect(traceId).toBeDefined();

      // Step 2: Customer replies "YES" via WhatsApp webhook
      vi.spyOn(whatsappClient, 'verifySignature').mockReturnValue(true);
      const webhookPayload = JSON.stringify({
        From: `whatsapp:+91${phoneDigits}`,
        Body: 'YES',
        MessageSid: `msg_trace_${Date.now()}`
      });

      const webhookRes = await request(app)
        .post('/api/v1/whatsapp/webhook')
        .set('Content-Type', 'application/json')
        .set('x-hub-signature-256', 'sha256=test_signature')
        .send(webhookPayload);

      expect(webhookRes.status).toBe(200);

      // Inspect recorded OpenTelemetry spans
      const recordedSpans = getRecordedSpans();
      expect(recordedSpans.length).toBeGreaterThan(0);

      // Verify each phase of the journey exists:
      // 1. HTTP request
      const httpCheckoutSpan = recordedSpans.find((s) => s.name.includes('/store/checkout'));
      expect(httpCheckoutSpan).toBeDefined();

      // 2. Order service
      const orderServiceSpan = recordedSpans.find((s) => s.name === 'order.service:createOnlineOrder');
      expect(orderServiceSpan).toBeDefined();

      // 3. Database operations
      const dbQuerySpans = recordedSpans.filter((s) => s.name.startsWith('db.query'));
      expect(dbQuerySpans.length).toBeGreaterThan(0);

      // 4. WhatsApp notification
      const whatsappNotifySpan = recordedSpans.find((s) => s.name.startsWith('whatsapp.service'));
      expect(whatsappNotifySpan).toBeDefined();

      // 5. Webhook receiver
      const webhookSpan = recordedSpans.find((s) => s.name.includes('handleIncomingMessage'));
      expect(webhookSpan).toBeDefined();

      // 6. Order status change
      const statusChangeSpan = recordedSpans.find((s) => s.name === 'order.service:updateOrderStatus');
      expect(statusChangeSpan).toBeDefined();
      expect(statusChangeSpan?.attributes['order.target_status']).toBe('CONFIRMED');

      // Verify the trace tree can be reconstructed and queried
      const traceTree = buildTraceTree(traceId);
      expect(traceTree).toBeDefined();
      expect(traceTree?.traceId).toBe(traceId);
      expect(traceTree?.steps.length).toBeGreaterThan(0);
    });
  });

  describe('4. Observability Inspection Endpoints', () => {
    it('should expose Prometheus metrics at GET /metrics', async () => {
      const res = await request(app).get('/metrics');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
      expect(res.text).toContain('http_requests_total');
      expect(res.text).toContain('http_request_duration_seconds');
      expect(res.text).toContain('db_query_duration_seconds');
      expect(res.text).toContain('business_revenue_inr_total');
      expect(res.text).toContain('business_orders_total');
    });

    it('should expose structured JSON metrics summary at GET /api/v1/observability/summary', async () => {
      const res = await request(app).get('/api/v1/observability/summary');
      expect(res.status).toBe(200);
      expect(res.body.technical).toBeDefined();
      expect(res.body.technical.httpRequestCount).toBeDefined();
      expect(res.body.technical.requestLatencyMs).toBeDefined();
      expect(res.body.technical.dbLatencyMs).toBeDefined();
      expect(res.body.technical.authenticationFailures).toBeDefined();
      expect(res.body.technical.webhookFailures).toBeDefined();
      expect(res.body.technical.backgroundJobFailures).toBeDefined();

      expect(res.body.business).toBeDefined();
      expect(res.body.business.checkoutAttempts).toBeDefined();
      expect(res.body.business.successfulOrders).toBeDefined();
      expect(res.body.business.cancellations).toBeDefined();
      expect(res.body.business.averageOrderValueInr).toBeDefined();
      expect(res.body.business.onlineRevenueInr).toBeDefined();
      expect(res.body.business.offlineRevenueInr).toBeDefined();
      expect(res.body.business.whatsappConversion).toBeDefined();
      expect(res.body.business.stockOuts).toBeDefined();
      expect(res.body.business.repeatCustomers).toBeDefined();
    });

    it('should expose OpenTelemetry trace queries at GET /api/v1/observability/traces', async () => {
      const res = await request(app).get('/api/v1/observability/traces');
      expect(res.status).toBe(200);
      expect(res.body.traces).toBeInstanceOf(Array);
    });
  });
});
