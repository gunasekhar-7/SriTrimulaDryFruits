import { Job } from '../types.js';
import { onlineOrderRepository } from '../../repositories/online_order.repository.js';
import { orderService } from '../../services/order.service.js';
import { whatsappService } from '../../services/whatsapp.service.js';
import { withSpan, parseTraceparent, metricsAggregator } from '../../observability/index.js';
import logger from '../../logger.js';

export interface WebhookJobPayload {
  source: string;
  from: string;
  messageId: string;
  messageText: string;
}

export async function processWebhookMessage(payload: WebhookJobPayload, job: Job<WebhookJobPayload>): Promise<void> {
  const { source, from, messageId, messageText } = payload;
  logger.info(`[Queue] Processing inbound webhook message ${messageId} from ${from} (Job #${job.id})`);

  if (source === 'whatsapp') {
    if (messageText === 'YES' || messageText === 'CONFIRM') {
      const cleanPhone = from.replace('+', '').replace(/^91/, '');
      const recentOrder = onlineOrderRepository.getRecentPendingOrderByPhone(cleanPhone);

      if (recentOrder) {
        const parentContext = recentOrder.traceparent ? parseTraceparent(recentOrder.traceparent) : null;
        const links = parentContext ? [{ context: parentContext, attributes: { 'causal.order_id': recentOrder.id } }] : [];

        await withSpan('whatsapp.webhook:handleIncomingMessage', {
          attributes: {
            'whatsapp.from': from,
            'whatsapp.message_id': messageId,
            'order.id': recentOrder.id,
            'order.number': recentOrder.order_number
          },
          links
        }, async () => {
          orderService.updateOrderStatus(recentOrder.id, 'CONFIRMED', 'System via WhatsApp');
          metricsAggregator.recordWhatsAppConversion();
          await whatsappService.sendTextMessage(from, `✅ Thank you! Your order #${recentOrder.order_number} has been confirmed and is now processing.`);
        });
      } else {
        await whatsappService.sendTextMessage(from, `❓ We couldn't find a recent pending order for this number. Please check your order status online.`);
      }
    }
  }
}
