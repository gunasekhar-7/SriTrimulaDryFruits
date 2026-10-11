import { queueService } from './queue.service.js';
import { processWhatsappNotification } from './handlers/whatsapp.handler.js';
import { processWebhookMessage } from './handlers/webhook.handler.js';
import { processPdfGeneration } from './handlers/pdf.handler.js';
import { processEmailNotification } from './handlers/email.handler.js';
import { processAnalyticsAggregation } from './handlers/analytics.handler.js';
import { processBackupVerification } from './handlers/backup_verification.handler.js';
import { processOtpDelivery } from './handlers/otp.handler.js';
import { reservationReaperService } from '../services/reservation-reaper.service.js';

// Register standard handlers for the durable background job types
queueService.registerHandler('whatsapp_notification', processWhatsappNotification);
queueService.registerHandler('webhook_processing', processWebhookMessage);
queueService.registerHandler('pdf_generation', processPdfGeneration);
queueService.registerHandler('email', processEmailNotification);
queueService.registerHandler('analytics_aggregation', processAnalyticsAggregation);
queueService.registerHandler('backup_verification', processBackupVerification);
queueService.registerHandler('otp_delivery', processOtpDelivery);
queueService.registerHandler('reservation_expiry', async (payload: any) => {
  return reservationReaperService.executeReap(payload);
});

export * from './types.js';
export * from './queue.repository.js';
export * from './queue.service.js';
export {
  processWhatsappNotification,
  processWebhookMessage,
  processPdfGeneration,
  processEmailNotification,
  processAnalyticsAggregation,
  processBackupVerification,
  processOtpDelivery
};
