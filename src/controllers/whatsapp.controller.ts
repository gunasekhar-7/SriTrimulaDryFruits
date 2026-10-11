import { Request, Response } from 'express';
import { whatsappService } from '../services/whatsapp.service.js';
import { orderService } from '../services/order.service.js';
import { onlineOrderRepository } from '../repositories/online_order.repository.js';
import { idempotencyService } from '../services/idempotency.service.js';
import { handleWebhookVerification, verifyWebhookSignature } from '../integrations/whatsapp/webhook.js';
import logger from '../logger.js';
import { withSpan, parseTraceparent, metricsAggregator } from '../observability/index.js';
import { queueService } from '../queue/index.js';

export class WhatsappController {
  
  // Handles verification requests from Meta (WhatsApp Graph API)
  verifyWebhook(req: Request, res: Response) {
    return handleWebhookVerification(req, res);
  }

  async handleIncomingMessage(req: Request, res: Response) {
    try {
      if (!verifyWebhookSignature(req)) {
        logger.warn('WhatsApp Webhook signature verification failed');
        metricsAggregator.recordWebhookFailure('whatsapp', 'signature_verification_failed');
        return res.sendStatus(401);
      }

      const body = req.body;

      // Extract sender and message body based on typical WhatsApp API payload (Twilio or Meta)
      let from = '';
      let messageText = '';

      let messageId = '';

      // Simple Twilio-like parsing fallback for easy testing
      if (body.From && body.Body) {
        from = body.From.replace('whatsapp:', '');
        messageText = body.Body.trim().toUpperCase();
        messageId = body.MessageSid || `twilio_${Date.now()}`;
      } 
      // Meta Graph API parsing
      else if (body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages) {
        const msg = body.entry[0].changes[0].value.messages[0];
        from = msg.from;
        messageId = msg.id;
        if (msg.text && msg.text.body) {
          messageText = msg.text.body.trim().toUpperCase();
        }
      } else {
        return res.sendStatus(200); // Not a message we care about
      }

      const idempotencyKey = `whatsapp_${messageId}`;

      const action = async () => {
        // Enqueue durable background job for asynchronous webhook processing (never blocks webhook HTTP reply)
        queueService.enqueue({
          name: 'webhook_processing',
          payload: {
            source: 'whatsapp',
            from,
            messageId,
            messageText
          },
          idempotencyKey: `webhook_${messageId}`
        });

        if (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true') {
          await queueService.processNextBatch();
        }

        return { status: 200, body: 'OK' };
      };

      const result = await idempotencyService.executeAsync(idempotencyKey, 'whatsapp_webhook', action);
      res.status(result.status).send(result.body);
    } catch (error: any) {
      if (error.message === 'Concurrent request in progress') {
        metricsAggregator.recordWebhookFailure('whatsapp', 'idempotency_conflict');
        return res.sendStatus(409);
      }
      logger.error('Error handling WhatsApp webhook:', error);
      metricsAggregator.recordWebhookFailure('whatsapp', 'handler_error');
      res.sendStatus(500);
    }
  }
}

export const whatsappController = new WhatsappController();
