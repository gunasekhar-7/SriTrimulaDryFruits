import crypto from 'crypto';
import logger from '../../logger.js';

export interface WhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
  verifyToken: string;
  appSecret: string;
}

export class WhatsAppClient {
  private config: WhatsAppConfig;

  constructor(config?: Partial<WhatsAppConfig>) {
    this.config = {
      accessToken: config?.accessToken || process.env.WHATSAPP_ACCESS_TOKEN || '',
      phoneNumberId: config?.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID || '',
      verifyToken: config?.verifyToken || process.env.WHATSAPP_VERIFY_TOKEN || '',
      appSecret: config?.appSecret || process.env.WHATSAPP_APP_SECRET || ''
    };
  }

  async sendTemplateMessage(toPhone: string, templateName: string, components: any[] = []): Promise<any> {
    if (!this.config.accessToken || !this.config.phoneNumberId) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('WhatsApp API credentials missing in production environment: WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID must be configured');
      }
      logger.warn('[MOCK WhatsApp API] Access token or phone number ID missing. Simulating template send.');
      logger.info(`[MOCK WhatsApp API] Template: ${templateName}, To: ${toPhone}`);
      return { messages: [{ id: 'mock_message_id' }] };
    }

    try {
      // Intentionally avoiding real fetch if in test env, but this handles production fetch
      if (process.env.NODE_ENV === 'test') {
        logger.info(`[MOCK WhatsApp API] Test env detected. Template: ${templateName}, To: ${toPhone}`);
        return { messages: [{ id: 'mock_test_message_id' }] };
      }

      const response = await fetch(`https://graph.facebook.com/v17.0/${this.config.phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: toPhone,
          type: 'template',
          template: {
            name: templateName,
            language: { code: 'en' },
            components: components
          }
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`WhatsApp API Error: ${JSON.stringify(error)}`);
      }

      return await response.json();
    } catch (error) {
      logger.error('Failed to send WhatsApp template message:', error);
      throw error;
    }
  }

  async sendTextMessage(toPhone: string, text: string): Promise<any> {
    if (!this.config.accessToken || !this.config.phoneNumberId) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('WhatsApp API credentials missing in production environment: WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID must be configured');
      }
      logger.warn('[MOCK WhatsApp API] Access token or phone number ID missing. Simulating text send.');
      logger.info(`[MOCK WhatsApp API] Sending message to ${toPhone}: ${text}`);
      return { messages: [{ id: 'mock_message_id' }] };
    }

    try {
      if (process.env.NODE_ENV === 'test') {
        logger.info(`[MOCK WhatsApp API] Sending message to ${toPhone}: ${text}`);
        return { messages: [{ id: 'mock_test_message_id' }] };
      }

      const response = await fetch(`https://graph.facebook.com/v17.0/${this.config.phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: toPhone,
          type: 'text',
          text: { body: text }
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`WhatsApp API Error: ${JSON.stringify(error)}`);
      }

      return await response.json();
    } catch (error) {
      logger.error('Failed to send WhatsApp text message:', error);
      throw error;
    }
  }

  verifySignature(payload: string, signature: string): boolean {
    if (!this.config.appSecret) return true; // Mock verification
    try {
      const expected = `sha256=${crypto.createHmac('sha256', this.config.appSecret).update(payload).digest('hex')}`;
      const sigBuf = Buffer.from(signature);
      const expBuf = Buffer.from(expected);
      if (sigBuf.length !== expBuf.length) return false;
      return crypto.timingSafeEqual(sigBuf, expBuf);
    } catch {
      return false;
    }
  }
}

export const whatsappClient = new WhatsAppClient();
