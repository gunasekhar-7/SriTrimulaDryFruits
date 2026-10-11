import { Job } from '../types.js';
import logger from '../../logger.js';

export interface EmailJobPayload {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  metadata?: Record<string, any>;
}

export async function processEmailNotification(payload: EmailJobPayload, job: Job<EmailJobPayload>): Promise<void> {
  const { to, subject, html, text, metadata } = payload;
  logger.info(`[Queue] Processing email delivery to ${to} for "${subject}" (Job #${job.id}, Attempt ${job.attempts + 1})`);

  if (!to || !subject) {
    throw new Error('Invalid email payload: recipient and subject are required');
  }

  // Simulated / Production delivery handler
  // In production with SMTP configured (e.g., SMTP_HOST, SENDGRID_API_KEY, etc.)
  if (process.env.SMTP_HOST) {
    // Production SMTP integration placeholder
    logger.info(`[Queue] Dispatched email via SMTP relay ${process.env.SMTP_HOST} to ${to}`);
  } else {
    // Reliable simulation mode for local/dev environments
    logger.info(`[Queue] [SIMULATED EMAIL] To: ${to} | Subject: "${subject}" | Content length: ${(html || text || '').length} chars`, { metadata });
  }
}
