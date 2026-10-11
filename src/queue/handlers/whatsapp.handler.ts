import { Job, InvalidPayloadError, MissingReferencedRecordError } from '../types.js';
import { whatsappService } from '../../services/whatsapp.service.js';
import { whatsappClient } from '../../integrations/whatsapp/client.js';
import { whatsappNotificationRepository } from '../../repositories/whatsapp_notification.repository.js';
import { onlineOrderRepository } from '../../repositories/online_order.repository.js';
import { metricsAggregator } from '../../observability/index.js';
import logger from '../../logger.js';

export interface WhatsappJobPayload {
  orderId?: number;
  status?: string;
  orderDetails?: any;
  phone: string;
  templateName?: string;
  components?: any[];
  fallbackText?: string;
  isTextMessage?: boolean;
  messageText?: string;
}

export async function processWhatsappNotification(payload: WhatsappJobPayload, job: Job<WhatsappJobPayload>): Promise<void> {
  // 1. Validate payload presence and structure
  if (!payload || typeof payload !== 'object') {
    throw new InvalidPayloadError(`Invalid WhatsApp notification payload for Job #${job.id}: payload must be an object`);
  }

  const { phone, orderId, status, orderDetails, templateName, components, fallbackText, isTextMessage, messageText } = payload;

  // 2. Validate recipient phone number
  if (!phone || typeof phone !== 'string' || phone.trim().length === 0) {
    throw new InvalidPayloadError(`Invalid WhatsApp notification payload for Job #${job.id}: missing or empty recipient phone number`);
  }

  const trimmedPhone = phone.trim();
  const maskedPhone = trimmedPhone.length >= 4 ? '***' + trimmedPhone.slice(-4) : 'N/A';
  logger.info(`[Queue] Processing WhatsApp notification for ${maskedPhone} (Job #${job.id}, Attempt ${job.attempts + 1})`);

  // 3. Validate message content intent
  const hasTextMessage = Boolean(isTextMessage && messageText);
  const hasOrderStatus = Boolean(orderId !== undefined && status);
  const hasTemplate = Boolean(templateName && components);
  const hasFallback = Boolean(fallbackText);

  if (!hasTextMessage && !hasOrderStatus && !hasTemplate && !hasFallback) {
    throw new InvalidPayloadError(`Invalid WhatsApp notification payload for Job #${job.id}: missing message content, valid template, or order status`);
  }

  // 4. Validate referenced order if orderId is specified
  let verifiedOrder: any = null;
  if (orderId !== undefined) {
    if (typeof orderId !== 'number' || isNaN(orderId) || orderId <= 0) {
      throw new InvalidPayloadError(`Invalid WhatsApp notification payload for Job #${job.id}: orderId must be a positive integer, received ${orderId}`);
    }

    verifiedOrder = onlineOrderRepository.getOrderById(orderId);
    if (!verifiedOrder) {
      const diagMsg = `Referenced online_order #${orderId} does not exist in database`;
      logger.warn(`[Queue] ⚠️ Job #${job.id} cannot be processed: ${diagMsg} (recipient: ${maskedPhone})`);
      throw new MissingReferencedRecordError(diagMsg, {
        jobId: job.id,
        orderId,
        recipient: maskedPhone
      });
    }
  }

  let messageId: string | undefined;

  try {
    if (hasTextMessage && messageText) {
      await whatsappService.sendTextMessage(trimmedPhone, messageText);
    } else if (hasOrderStatus && orderId && status) {
      const effectiveOrderDetails = {
        id: verifiedOrder?.id || orderId,
        orderNumber: verifiedOrder?.order_number,
        ...orderDetails
      };
      await whatsappService.notifyOrderStatus(trimmedPhone, status, effectiveOrderDetails);
      const record = whatsappNotificationRepository.getNotification(orderId, status);
      if (record && record.delivery_status === 'FAILED') {
        throw new Error(record.error_reason || 'WhatsApp delivery failed');
      }
    } else if (hasTemplate && templateName && components) {
      const res = await whatsappClient.sendTemplateMessage(trimmedPhone, templateName, components);
      messageId = res.messages?.[0]?.id;
      metricsAggregator.recordWhatsAppNotificationSent();
    } else if (hasFallback && fallbackText) {
      await whatsappService.sendTextMessage(trimmedPhone, fallbackText);
    }

    if (orderId && templateName) {
      const existing = whatsappNotificationRepository.getNotification(orderId, templateName);
      if (existing) {
        whatsappNotificationRepository.markAsSent(existing.id, messageId || 'job_sent');
      }
    }

    logger.info(`[Queue] WhatsApp notification delivered for Job #${job.id}`, { phone: maskedPhone });
  } catch (error: any) {
    logger.warn(`[Queue] WhatsApp notification attempt failed for Job #${job.id}: ${error.message}`);
    // Re-throw so QueueService applies retry or marks non-retryable failure
    throw error;
  }
}
