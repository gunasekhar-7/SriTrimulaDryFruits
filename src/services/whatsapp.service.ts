import { whatsappClient } from '../integrations/whatsapp/client.js';
import { OrderTemplates, buildTemplateComponents } from '../integrations/whatsapp/templates.js';
import { whatsappNotificationRepository } from '../repositories/whatsapp_notification.repository.js';
import logger from '../logger.js';
import { withSpan, metricsAggregator } from '../observability/index.js';

export class WhatsappIntegrationService {
  async notifyOrderStatus(phone: string, status: string, orderDetails: any): Promise<void> {
    return withSpan('whatsapp.service:notifyOrderStatus', {
      attributes: {
        'whatsapp.phone': phone,
        'whatsapp.status': status,
        'whatsapp.order_id': orderDetails.id || orderDetails.order_id
      }
    }, async () => {
      const orderId = orderDetails.id || orderDetails.order_id || (orderDetails.orderNumber ? parseInt(orderDetails.orderNumber.split('-').pop()!) : 0);
    
      // Deduplication check - Create pending record if it doesn't exist
      let notificationId: number | null = null;
      if (orderId > 0) {
        notificationId = whatsappNotificationRepository.createNotification(orderId, phone, status);
        if (notificationId === null) {
          const existing = whatsappNotificationRepository.getNotification(orderId, status);
          if (existing && existing.delivery_status === 'SENT') {
            logger.info(`Notification for order ${orderId} and status ${status} already exists and was SENT. Skipping duplicate.`);
            return;
          }
          if (existing) {
            // It's a retry of a PENDING or FAILED delivery
            notificationId = existing.id;
          }
        }
      }

    try {
      let templateName = '';
      let fallbackText = '';
      
      switch (status) {
        case 'NEW':
          templateName = OrderTemplates.ORDER_CREATED;
          fallbackText = `🌴 *SRI TIRUMALA DRY FRUITS* 🌴\nHi ${orderDetails.customerName},\nWe received your order #${orderDetails.orderNumber}. Reply "YES" to confirm.`;
          break;
        case 'CONFIRMED':
          templateName = OrderTemplates.ORDER_CONFIRMED;
          fallbackText = `✅ Thank you! Your order #${orderDetails.orderNumber} has been confirmed.`;
          break;
        case 'PACKING':
          templateName = OrderTemplates.ORDER_PACKING;
          fallbackText = `📦 We are now packing your order #${orderDetails.orderNumber}.`;
          break;
        case 'READY':
          templateName = OrderTemplates.ORDER_READY;
          fallbackText = `🛍️ Your order #${orderDetails.orderNumber} is READY for pickup!`;
          break;
        case 'DISPATCHED':
          templateName = OrderTemplates.ORDER_DISPATCHED;
          fallbackText = `🚚 Your order #${orderDetails.orderNumber} has been dispatched!`;
          break;
        case 'COMPLETED':
          templateName = OrderTemplates.ORDER_COMPLETED;
          fallbackText = `🎉 Your order #${orderDetails.orderNumber} is complete. Thanks for shopping with us!`;
          break;
        case 'CANCELLED':
          templateName = OrderTemplates.ORDER_CANCELLED;
          fallbackText = `❌ Your order #${orderDetails.orderNumber} has been cancelled.`;
          break;
        default:
          logger.warn(`No template mapped for status: ${status}`);
          if (notificationId) whatsappNotificationRepository.markAsFailed(notificationId, 'Unmapped status');
          return;
      }

      let messageId = '';
      try {
        const components = buildTemplateComponents(status, orderDetails);
        const res = await whatsappClient.sendTemplateMessage(phone, templateName, components);
        if (res && res.messages && res.messages.length > 0) {
          messageId = res.messages[0].id;
        }
      } catch (err: any) {
        logger.info('Falling back to text message notification');
        const res = await whatsappClient.sendTextMessage(phone, fallbackText);
        if (res && res.messages && res.messages.length > 0) {
          messageId = res.messages[0].id;
        }
      }

      if (notificationId) {
        whatsappNotificationRepository.markAsSent(notificationId, messageId || 'unknown_id');
        metricsAggregator.recordWhatsAppNotificationSent();
        logger.info('WhatsApp message sent', { event: 'whatsapp.sent', messageId, orderId, phone: '***' + phone.slice(-4), templateName });
      }

    } catch (error: any) {
      logger.error('Failed to deliver WhatsApp notification (Order persistence is unaffected):', { event: 'whatsapp.failed', orderId, error: error.message });
      if (notificationId) {
        whatsappNotificationRepository.markAsFailed(notificationId, error.message || 'Unknown error');
      }
    }
  });
}

  async retryFailedMessages(): Promise<void> {
    const startHr = process.hrtime();
    let hasFailure = false;
    let failureReason = '';

    try {
      const failedNotifications = whatsappNotificationRepository.getFailedNotificationsForRetry(3);
      for (const notif of failedNotifications) {
        logger.info(`Retrying notification ${notif.id} for order ${notif.order_id}, status ${notif.status_event}`);
        try {
          // Build mock orderDetails, in real system we would fetch from DB, but this works for testing the retry wrapper
          const orderDetails = { id: notif.order_id, orderNumber: `STDF-2026-${String(notif.order_id).padStart(4, '0')}`, customerName: 'Customer' };
          
          let templateName = '';
          let fallbackText = `Retry for order #${orderDetails.orderNumber}`;
          switch (notif.status_event) {
            case 'NEW': templateName = OrderTemplates.ORDER_CREATED; break;
            case 'CONFIRMED': templateName = OrderTemplates.ORDER_CONFIRMED; break;
            case 'PACKING': templateName = OrderTemplates.ORDER_PACKING; break;
            case 'READY': templateName = OrderTemplates.ORDER_READY; break;
            case 'DISPATCHED': templateName = OrderTemplates.ORDER_DISPATCHED; break;
            case 'COMPLETED': templateName = OrderTemplates.ORDER_COMPLETED; break;
            case 'CANCELLED': templateName = OrderTemplates.ORDER_CANCELLED; break;
          }

          let messageId = '';
          try {
            const components = buildTemplateComponents(notif.status_event, orderDetails);
            const res = await whatsappClient.sendTemplateMessage(notif.phone, templateName, components);
            if (res && res.messages && res.messages.length > 0) messageId = res.messages[0].id;
          } catch (err) {
            const res = await whatsappClient.sendTextMessage(notif.phone, fallbackText);
            if (res && res.messages && res.messages.length > 0) messageId = res.messages[0].id;
          }

          whatsappNotificationRepository.markAsSent(notif.id, messageId || 'retry_id');
        } catch (error: any) {
          hasFailure = true;
          failureReason = error.message;
          logger.error(`Retry failed for notification ${notif.id}:`, error);
          whatsappNotificationRepository.markAsFailed(notif.id, error.message || 'Unknown retry error');
        }
      }

      const diff = process.hrtime(startHr);
      const durationSeconds = diff[0] + diff[1] / 1e9;
      metricsAggregator.recordBackgroundJobRun('whatsapp_retry', durationSeconds, !hasFailure, failureReason);
    } catch (err: any) {
      const diff = process.hrtime(startHr);
      const durationSeconds = diff[0] + diff[1] / 1e9;
      metricsAggregator.recordBackgroundJobRun('whatsapp_retry', durationSeconds, false, err.message);
    }
  }

  // Backwards compatibility for exact methods used in existing tests/controllers
  generateCheckoutMessageUrl(order: any, parsedDetails: any, messageItems: string[], subtotal: number, deliveryCharge: number, totalAmount: number): string {
    const orderDate = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const storePhone = process.env.STORE_WHATSAPP_PHONE || '919133133931';
    
    const deliveryStr = deliveryCharge === 0 ? 'FREE' : `₹${deliveryCharge}`;
    const paymentStr = parsedDetails.payment_mode === 'COD' ? 'Cash on Delivery' : 'UPI';
    const typeStr = parsedDetails.delivery_type === 'DELIVERY' ? 'Home Delivery' : 'Store Pickup';
    
    const message = `🌴 *SRI TIRUMALA DRY FRUITS — NEW ORDER* 🌴\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n🆔 *Order ID:* #${order.order_number}\n📅 *Date:* ${orderDate}\n\n👤 *Customer Details:*\n• Name: ${parsedDetails.name}\n• Phone: +91 ${parsedDetails.phone}\n• Type: ${typeStr}\n• Address: ${parsedDetails.address || 'N/A'}, ${parsedDetails.landmark || 'N/A'}\n\n📦 *Order Items:*\n${messageItems.join('\n')}\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n💵 *Subtotal:* ₹${subtotal}\n🚚 *Delivery:* ${deliveryStr}\n💰 *Grand Total:* *₹${totalAmount}*\n💳 *Payment:* ${paymentStr}\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n👉 *Reply "YES" to confirm this order.*`;

    const encodedMessage = encodeURIComponent(message);
    return `https://wa.me/${storePhone}?text=${encodedMessage}`;
  }

  async sendTextMessage(phone: string, message: string): Promise<void> {
    return withSpan('whatsapp.service:sendTextMessage', {
      attributes: {
        'whatsapp.recipient': phone
      }
    }, async () => {
      try {
        await whatsappClient.sendTextMessage(phone, message);
      } catch (e: any) {
        logger.error('Failed to deliver fallback text message', e);
        throw e;
      }
    });
  }
}

export const whatsappService = new WhatsappIntegrationService();
