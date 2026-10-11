import { Request, Response } from 'express';
import { whatsappClient } from './client.js';
import logger from '../../logger.js';
import { metricsAggregator } from '../../observability/index.js';

export const handleWebhookVerification = (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === (process.env.WHATSAPP_VERIFY_TOKEN || 'sritirumala123')) {
      logger.info('WhatsApp Webhook verified!');
      return res.status(200).send(challenge);
    }
  }
  metricsAggregator.recordWebhookFailure('whatsapp', 'verification_token_mismatch');
  res.sendStatus(403);
};

export const verifyWebhookSignature = (req: Request): boolean => {
  const signature = req.headers['x-hub-signature-256'] as string;
  const rawBody = (req as any).rawBody;

  if (!signature || !rawBody) {
    return false;
  }
  
  return whatsappClient.verifySignature(rawBody, signature);
};
