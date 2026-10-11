import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { whatsappService } from '../src/services/whatsapp.service.js';
import { whatsappNotificationRepository } from '../src/repositories/whatsapp_notification.repository.js';
import { whatsappClient } from '../src/integrations/whatsapp/client.js';
import db from '../src/database.js';

describe('WhatsApp Integration', () => {
  let testOrderId = 0;
  let testPhone = '';

  beforeEach(() => {
    db.prepare('DELETE FROM whatsapp_notifications').run();
    
    // Create a dummy customer and order to satisfy foreign key constraints
    testPhone = '999' + Math.floor(1000000 + Math.random() * 9000000).toString();
    const custResult = db.prepare(`INSERT INTO customers (name, phone) VALUES ('Test', ?)`).run(testPhone);
    const orderResult = db.prepare(`
      INSERT INTO online_orders (customer_id, order_number, status, subtotal, total_amount)
      VALUES (?, 'STDF-TEST-0001', 'NEW', 100, 100)
    `).run(custResult.lastInsertRowid);
    testOrderId = orderResult.lastInsertRowid as number;

    vi.restoreAllMocks();
  });

  afterEach(() => {
    db.prepare('DELETE FROM whatsapp_notifications').run();
    if (testOrderId) {
      db.prepare('DELETE FROM online_orders WHERE id = ?').run(testOrderId);
    }
    if (testPhone) {
      db.prepare('DELETE FROM customers WHERE phone = ?').run(testPhone);
    }
  });

  it('should successfully save and send a NEW notification', async () => {
    const sendMock = vi.spyOn(whatsappClient, 'sendTemplateMessage').mockResolvedValue({ messages: [{ id: 'mock_message_id_1' }] });
    
    await whatsappService.notifyOrderStatus('9999911111', 'NEW', {
      id: testOrderId,
      orderNumber: 'STDF-TEST-0001',
      customerName: 'Test Customer'
    });

    expect(sendMock).toHaveBeenCalledTimes(1);

    const record = whatsappNotificationRepository.getNotification(testOrderId, 'NEW');
    expect(record).toBeDefined();
    expect(record?.delivery_status).toBe('SENT');
    expect(record?.message_id).toBe('mock_message_id_1');
  });

  it('should save as FAILED when whatsapp client throws an error', async () => {
    const sendMock = vi.spyOn(whatsappClient, 'sendTemplateMessage').mockRejectedValue(new Error('Network error'));
    const textMock = vi.spyOn(whatsappClient, 'sendTextMessage').mockRejectedValue(new Error('Network error again'));

    await whatsappService.notifyOrderStatus('9999911111', 'CONFIRMED', {
      id: testOrderId,
      orderNumber: 'STDF-TEST-0001'
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(textMock).toHaveBeenCalledTimes(1);

    const record = whatsappNotificationRepository.getNotification(testOrderId, 'CONFIRMED');
    expect(record).toBeDefined();
    expect(record?.delivery_status).toBe('FAILED');
    expect(record?.error_reason).toContain('Network error');
  });

  it('should retry failed notifications successfully', async () => {
    // Manually create a FAILED record
    whatsappNotificationRepository.createNotification(testOrderId, '9999911111', 'PACKING');
    const record = whatsappNotificationRepository.getNotification(testOrderId, 'PACKING')!;
    whatsappNotificationRepository.markAsFailed(record.id, 'Timeout');

    expect(record.delivery_status).toBe('PENDING'); // We didn't fetch it again
    
    const sendMock = vi.spyOn(whatsappClient, 'sendTemplateMessage').mockResolvedValue({ messages: [{ id: 'mock_message_id_retry' }] });

    await whatsappService.retryFailedMessages();

    expect(sendMock).toHaveBeenCalledTimes(1);

    const updatedRecord = whatsappNotificationRepository.getNotification(testOrderId, 'PACKING');
    expect(updatedRecord?.delivery_status).toBe('SENT');
    expect(updatedRecord?.message_id).toBe('mock_message_id_retry');
    expect(updatedRecord?.attempts).toBe(2);
  });

  it('should avoid duplicate messages for the same order and status', async () => {
    const sendMock = vi.spyOn(whatsappClient, 'sendTemplateMessage').mockResolvedValue({ messages: [{ id: 'msg1' }] });
    
    await whatsappService.notifyOrderStatus('9999911111', 'READY', {
      id: testOrderId,
      orderNumber: 'STDF-TEST-0001'
    });

    // Send again
    await whatsappService.notifyOrderStatus('9999911111', 'READY', {
      id: testOrderId,
      orderNumber: 'STDF-TEST-0001'
    });

    expect(sendMock).toHaveBeenCalledTimes(1); // Only called once
  });

  it('should ignore unknown statuses gracefully', async () => {
    const sendMock = vi.spyOn(whatsappClient, 'sendTemplateMessage');

    await whatsappService.notifyOrderStatus('9999911111', 'INVALID_STATUS', {
      id: testOrderId,
      orderNumber: 'STDF-TEST-0001'
    });

    expect(sendMock).not.toHaveBeenCalled();

    const record = whatsappNotificationRepository.getNotification(testOrderId, 'INVALID_STATUS');
    expect(record).toBeDefined();
    expect(record?.delivery_status).toBe('FAILED');
    expect(record?.error_reason).toBe('Unmapped status');
  });
});
