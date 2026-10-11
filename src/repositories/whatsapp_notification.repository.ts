import db from '../database.js';
import { MissingReferencedRecordError } from '../queue/types.js';
import logger from '../logger.js';

export interface WhatsappNotification {
  id: number;
  order_id: number;
  phone: string;
  status_event: string;
  message_id: string | null;
  delivery_status: 'PENDING' | 'SENT' | 'FAILED';
  error_reason: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
}

export class WhatsappNotificationRepository {
  createNotification(orderId: number, phone: string, statusEvent: string): number | null {
    try {
      const result = db.prepare(`
        INSERT INTO whatsapp_notifications (order_id, phone, status_event, delivery_status, attempts)
        VALUES (?, ?, ?, 'PENDING', 0)
      `).run(orderId, phone, statusEvent);
      return result.lastInsertRowid as number;
    } catch (err: any) {
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        // Notification already exists for this order & status combination
        return null; 
      }
      if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY' || (err.message && err.message.includes('FOREIGN KEY constraint failed'))) {
        const maskedPhone = phone && phone.length >= 4 ? '***' + phone.slice(-4) : 'N/A';
        logger.error(`[WhatsApp Notification DB] FOREIGN KEY constraint failed on INSERT into whatsapp_notifications: referenced order_id ${orderId} does not exist in online_orders (status_event: ${statusEvent}, recipient: ${maskedPhone})`);
        throw new MissingReferencedRecordError(
          `FOREIGN KEY constraint failed: referenced order_id ${orderId} does not exist in online_orders table`,
          { table: 'whatsapp_notifications', constraint: 'FOREIGN KEY (order_id) REFERENCES online_orders(id)', orderId, statusEvent }
        );
      }
      throw err;
    }
  }

  getNotification(orderId: number, statusEvent: string): WhatsappNotification | undefined {
    return db.prepare(`
      SELECT * FROM whatsapp_notifications
      WHERE order_id = ? AND status_event = ?
    `).get(orderId, statusEvent) as WhatsappNotification | undefined;
  }

  markAsSent(id: number, messageId: string): void {
    db.prepare(`
      UPDATE whatsapp_notifications
      SET delivery_status = 'SENT', message_id = ?, attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(messageId, id);
  }

  markAsFailed(id: number, errorReason: string): void {
    db.prepare(`
      UPDATE whatsapp_notifications
      SET delivery_status = 'FAILED', error_reason = ?, attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(errorReason, id);
  }

  getFailedNotificationsForRetry(maxAttempts: number = 3): WhatsappNotification[] {
    return db.prepare(`
      SELECT * FROM whatsapp_notifications
      WHERE delivery_status = 'FAILED' AND attempts < ?
    `).all(maxAttempts) as WhatsappNotification[];
  }
}

export const whatsappNotificationRepository = new WhatsappNotificationRepository();
