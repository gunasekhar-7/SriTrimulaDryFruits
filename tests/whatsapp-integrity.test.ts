import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import db from '../src/database.js';
import { queueService, queueRepository } from '../src/queue/index.js';
import { whatsappClient } from '../src/integrations/whatsapp/client.js';
import { whatsappNotificationRepository } from '../src/repositories/whatsapp_notification.repository.js';
import { orderService } from '../src/services/order.service.js';
import logger from '../src/logger.js';

describe('WhatsApp Notification Integrity & Queue Reliability', () => {
  let createdCustomerId: number = 0;
  let createdOrderId: number = 0;
  let testPhone = '';

  beforeEach(() => {
    vi.restoreAllMocks();

    // Create a valid customer and order for test cases that need valid records
    testPhone = '9198' + Math.floor(10000000 + Math.random() * 90000000).toString().slice(0, 8);
    const custRes = db.prepare('INSERT INTO customers (name, phone) VALUES (?, ?)').run('Integrity Tester', testPhone);
    createdCustomerId = custRes.lastInsertRowid as number;

    const p = db.prepare('INSERT INTO products (name) VALUES (?)').run('Test Product ' + Date.now());
    const prodId = p.lastInsertRowid as number;

    const v = db.prepare(`
      INSERT INTO product_variants (name, barcode, selling_price, cost_price, total_qty, sold_qty, reserved_qty, product_id)
      VALUES ('Test Variant', ?, 250, 150, 50, 0, 0, ?)
    `).run('BAR_' + Date.now(), prodId);
    const variantId = v.lastInsertRowid as number;

    const order = orderService.createOnlineOrder({
      customer_id: createdCustomerId,
      items: [{ product_id: variantId, quantity: 1 }],
      payment_mode: 'COD',
      delivery_type: 'STORE_PICKUP',
      delivery_charge: 0,
      discount: 0
    });
    createdOrderId = order.id;

    // Clear background jobs created during test setup or prior runs so tests start with a clean state
    db.prepare("DELETE FROM background_jobs").run();
    db.prepare('DELETE FROM whatsapp_notifications WHERE order_id = ?').run(createdOrderId);
  });

  afterEach(() => {
    db.prepare("DELETE FROM background_jobs WHERE idempotency_key LIKE 'test_%'").run();
    if (createdOrderId) {
      try {
        db.prepare('DELETE FROM whatsapp_notifications WHERE order_id = ?').run(createdOrderId);
        db.prepare('DELETE FROM stock_reservations WHERE order_id = ?').run(createdOrderId);
        db.prepare('DELETE FROM stock_movements WHERE reference_id = ?').run(createdOrderId.toString());
        db.prepare('DELETE FROM order_status_logs WHERE order_id = ?').run(createdOrderId);
        db.prepare('DELETE FROM online_order_items WHERE order_id = ?').run(createdOrderId);
        db.prepare('DELETE FROM online_orders WHERE id = ?').run(createdOrderId);
      } catch {}
    }
    if (createdCustomerId) {
      try {
        db.prepare('DELETE FROM customers WHERE id = ?').run(createdCustomerId);
      } catch {}
    }
  });

  describe('1. Valid Lifecycle & Notification Persistence', () => {
    it('should process a valid order notification end-to-end and mark job COMPLETED', async () => {
      vi.spyOn(whatsappClient, 'sendTemplateMessage').mockResolvedValue({
        messages: [{ id: 'wa_msg_valid_123' }]
      });

      const job = queueService.enqueue({
        name: 'whatsapp_notification',
        payload: {
          orderId: createdOrderId,
          status: 'NEW',
          phone: testPhone,
          orderDetails: {
            id: createdOrderId,
            customerName: 'Integrity Tester',
            orderNumber: `STDF-2026-${createdOrderId}`
          }
        },
        idempotencyKey: `test_valid_${createdOrderId}_NEW`
      });

      const processedCount = await queueService.processNextBatch();
      expect(processedCount).toBe(1);

      const updatedJob = queueService.getJobById(job.id);
      expect(updatedJob?.status).toBe('COMPLETED');
      expect(updatedJob?.last_error).toBeNull();

      // Check notification table persistence
      const notif = whatsappNotificationRepository.getNotification(createdOrderId, 'NEW');
      expect(notif).toBeDefined();
      expect(notif?.delivery_status).toBe('SENT');
      expect(notif?.message_id).toBe('wa_msg_valid_123');
      expect(notif?.order_id).toBe(createdOrderId);
    });
  });

  describe('2. Missing Referenced Records & Foreign Key Safety', () => {
    it('should immediately fail without retries when referenced order does not exist', async () => {
      const nonExistentOrderId = 9999999;
      const sendMock = vi.spyOn(whatsappClient, 'sendTemplateMessage');

      const job = queueService.enqueue({
        name: 'whatsapp_notification',
        payload: {
          orderId: nonExistentOrderId,
          status: 'NEW',
          phone: testPhone,
          orderDetails: {
            id: nonExistentOrderId,
            orderNumber: `STDF-2026-${nonExistentOrderId}`
          }
        },
        maxRetries: 5,
        idempotencyKey: `test_missing_${nonExistentOrderId}`
      });

      await queueService.processNextBatch();

      const updatedJob = queueService.getJobById(job.id);
      // Must be terminal FAILED immediately (NOT PENDING with backoff)
      expect(updatedJob?.status).toBe('FAILED');
      // Must have recorded 1 attempt only, not all 5
      expect(updatedJob?.attempts).toBe(1);
      // Last error must clearly indicate missing referenced order
      expect(updatedJob?.last_error).toContain(`Referenced online_order #${nonExistentOrderId} does not exist`);

      // WhatsApp API must never have been called
      expect(sendMock).not.toHaveBeenCalled();

      // No corrupt or orphaned rows in whatsapp_notifications
      const count = db.prepare('SELECT COUNT(*) as c FROM whatsapp_notifications WHERE order_id = ?').get(nonExistentOrderId) as any;
      expect(count.c).toBe(0);
    });

    it('should catch foreign key violation in repository and throw non-retryable MissingReferencedRecordError', () => {
      expect(() => {
        whatsappNotificationRepository.createNotification(8888888, '919999988888', 'NEW');
      }).toThrowError(/FOREIGN KEY constraint failed.*8888888/);
    });
  });

  describe('3. PII Masking and Safe Diagnostics', () => {
    it('should mask phone numbers in queue logs and diagnostics', async () => {
      const warnSpy = vi.spyOn(logger, 'warn');
      const nonExistentOrderId = 7777777;
      const sensitivePhone = '919876543210';

      queueService.enqueue({
        name: 'whatsapp_notification',
        payload: {
          orderId: nonExistentOrderId,
          status: 'CONFIRMED',
          phone: sensitivePhone
        },
        idempotencyKey: `test_pii_${nonExistentOrderId}`
      });

      await queueService.processNextBatch();

      const warnCalls = warnSpy.mock.calls.map(c => JSON.stringify(c));
      const hasFullPhone = warnCalls.some(c => c.includes(sensitivePhone));
      expect(hasFullPhone).toBe(false);

      const hasMaskedPhone = warnCalls.some(c => c.includes('***3210'));
      expect(hasMaskedPhone).toBe(true);
    });
  });

  describe('4. Invalid Job Payloads Handling', () => {
    it('should immediately fail on missing recipient phone number', async () => {
      const job = queueService.enqueue({
        name: 'whatsapp_notification',
        payload: {
          orderId: createdOrderId,
          status: 'NEW',
          phone: ''
        } as any,
        maxRetries: 5,
        idempotencyKey: `test_no_phone_${Date.now()}`
      });

      await queueService.processNextBatch();

      const updatedJob = queueService.getJobById(job.id);
      expect(updatedJob?.status).toBe('FAILED');
      expect(updatedJob?.attempts).toBe(1);
      expect(updatedJob?.last_error).toContain('missing or empty recipient phone number');
    });

    it('should immediately fail on invalid orderId type', async () => {
      const job = queueService.enqueue({
        name: 'whatsapp_notification',
        payload: {
          orderId: -10,
          status: 'NEW',
          phone: testPhone
        } as any,
        maxRetries: 5,
        idempotencyKey: `test_bad_id_${Date.now()}`
      });

      await queueService.processNextBatch();

      const updatedJob = queueService.getJobById(job.id);
      expect(updatedJob?.status).toBe('FAILED');
      expect(updatedJob?.attempts).toBe(1);
      expect(updatedJob?.last_error).toContain('orderId must be a positive integer');
    });

    it('should immediately fail on missing message intent', async () => {
      const job = queueService.enqueue({
        name: 'whatsapp_notification',
        payload: {
          phone: testPhone
        } as any,
        maxRetries: 5,
        idempotencyKey: `test_no_intent_${Date.now()}`
      });

      await queueService.processNextBatch();

      const updatedJob = queueService.getJobById(job.id);
      expect(updatedJob?.status).toBe('FAILED');
      expect(updatedJob?.attempts).toBe(1);
      expect(updatedJob?.last_error).toContain('missing message content, valid template, or order status');
    });
  });

  describe('5. Retry Classification: Transient vs Deterministic', () => {
    it('should retry transient external WhatsApp errors with exponential backoff', async () => {
      vi.spyOn(whatsappClient, 'sendTemplateMessage').mockRejectedValue(new Error('WhatsApp 503 Service Unavailable'));
      vi.spyOn(whatsappClient, 'sendTextMessage').mockRejectedValue(new Error('WhatsApp 503 Service Unavailable'));

      const job = queueService.enqueue({
        name: 'whatsapp_notification',
        payload: {
          orderId: createdOrderId,
          status: 'CONFIRMED',
          phone: testPhone,
          orderDetails: { id: createdOrderId, orderNumber: `STDF-2026-${createdOrderId}` }
        },
        maxRetries: 3,
        idempotencyKey: `test_transient_${createdOrderId}`
      });

      await queueService.processNextBatch();

      const updatedJob = queueService.getJobById(job.id);
      // Transient error should remain PENDING for retry, not terminal FAILED
      expect(updatedJob?.status).toBe('PENDING');
      expect(updatedJob?.attempts).toBe(1);
      expect(updatedJob?.last_error).toContain('WhatsApp 503');
    });
  });

  describe('6. Duplicate Delivery Prevention & Idempotency', () => {
    it('should not resend messages if notification was already SENT', async () => {
      const sendMock = vi.spyOn(whatsappClient, 'sendTemplateMessage').mockResolvedValue({
        messages: [{ id: 'wa_sent_first' }]
      });

      // 1. First execution sends message
      const job1 = queueService.enqueue({
        name: 'whatsapp_notification',
        payload: {
          orderId: createdOrderId,
          status: 'NEW',
          phone: testPhone,
          orderDetails: { id: createdOrderId, orderNumber: `STDF-2026-${createdOrderId}` }
        },
        idempotencyKey: `test_idem_first_${createdOrderId}`
      });

      await queueService.processNextBatch();
      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(queueService.getJobById(job1.id)?.status).toBe('COMPLETED');

      // 2. Second execution (e.g. re-enqueued or redelivered job) must NOT send another message
      const job2 = queueService.enqueue({
        name: 'whatsapp_notification',
        payload: {
          orderId: createdOrderId,
          status: 'NEW',
          phone: testPhone,
          orderDetails: { id: createdOrderId, orderNumber: `STDF-2026-${createdOrderId}` }
        },
        idempotencyKey: `test_idem_second_${createdOrderId}`
      });

      await queueService.processNextBatch();
      // Send mock count should STILL be 1 (duplicate avoided)
      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(queueService.getJobById(job2.id)?.status).toBe('COMPLETED');
    });

    it('should allow retry if previous delivery was FAILED', async () => {
      // 1. Initial attempt fails
      const sendMock = vi.spyOn(whatsappClient, 'sendTemplateMessage').mockRejectedValueOnce(new Error('Gateway Timeout'));
      vi.spyOn(whatsappClient, 'sendTextMessage').mockRejectedValueOnce(new Error('Gateway Timeout'));

      const job = queueService.enqueue({
        name: 'whatsapp_notification',
        payload: {
          orderId: createdOrderId,
          status: 'PACKING',
          phone: testPhone,
          orderDetails: { id: createdOrderId, orderNumber: `STDF-2026-${createdOrderId}` }
        },
        maxRetries: 3,
        idempotencyKey: `test_retry_packing_${createdOrderId}`
      });

      await queueService.processNextBatch();
      expect(queueService.getJobById(job.id)?.status).toBe('PENDING');

      const notifAfterFailure = whatsappNotificationRepository.getNotification(createdOrderId, 'PACKING');
      expect(notifAfterFailure?.delivery_status).toBe('FAILED');

      // 2. Mock service recovered: reset call history and mock success
      sendMock.mockClear();
      sendMock.mockResolvedValue({
        messages: [{ id: 'wa_retry_success' }]
      });

      // Force run_at to now for retry processing
      db.prepare("UPDATE background_jobs SET run_at = datetime('now') WHERE id = ?").run(job.id);
      await queueService.processNextBatch();

      expect(sendMock).toHaveBeenCalledTimes(1);
      const notifAfterRetry = whatsappNotificationRepository.getNotification(createdOrderId, 'PACKING');
      expect(notifAfterRetry?.delivery_status).toBe('SENT');
      expect(notifAfterRetry?.message_id).toBe('wa_retry_success');
      expect(queueService.getJobById(job.id)?.status).toBe('COMPLETED');
    });
  });

  describe('7. Production Mock Prevention', () => {
    it('should throw error in production environment when credentials are missing', async () => {
      const origEnv = process.env.NODE_ENV;
      const origToken = process.env.WHATSAPP_ACCESS_TOKEN;
      const origPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

      try {
        process.env.NODE_ENV = 'production';
        delete process.env.WHATSAPP_ACCESS_TOKEN;
        delete process.env.WHATSAPP_PHONE_NUMBER_ID;

        const { WhatsAppClient } = await import('../src/integrations/whatsapp/client.js');
        const prodClient = new WhatsAppClient({ accessToken: '', phoneNumberId: '' });

        await expect(prodClient.sendTemplateMessage('919999900000', 'template', [])).rejects.toThrow(
          /WhatsApp API credentials missing in production environment/
        );
        await expect(prodClient.sendTextMessage('919999900000', 'hello')).rejects.toThrow(
          /WhatsApp API credentials missing in production environment/
        );
      } finally {
        process.env.NODE_ENV = origEnv;
        if (origToken) process.env.WHATSAPP_ACCESS_TOKEN = origToken;
        if (origPhoneId) process.env.WHATSAPP_PHONE_NUMBER_ID = origPhoneId;
      }
    });
  });
});
