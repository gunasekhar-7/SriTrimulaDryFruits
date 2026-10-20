import crypto from 'crypto';
import db from '../database.js';
import logger from '../logger.js';
import { maskPhone, normalizePhone } from '../utils/phone.js';
import { resolveSecret } from '../utils/secrets.js';
import { whatsappClient } from '../integrations/whatsapp/client.js';
import { queueService, queueRepository } from '../queue/index.js';

export type OtpPurpose = 'REGISTRATION' | 'ACCOUNT_LINK' | 'PHONE_UPDATE';

export interface IOtpProvider {
  name: string;
  sendOtp(phone: string, otp: string, purpose: OtpPurpose): Promise<boolean>;
}

/**
 * Production WhatsApp OTP Provider using Meta Cloud API.
 * Fails closed in production if credentials are missing or invalid.
 */
export class WhatsAppOtpProvider implements IOtpProvider {
  name = 'WhatsAppOtpProvider';

  private getCredentials() {
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || '';
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
    const templateName = process.env.WHATSAPP_OTP_TEMPLATE || 'auth_otp_code';
    return { accessToken, phoneNumberId, templateName };
  }

  async sendOtp(phone: string, otp: string, purpose: OtpPurpose): Promise<boolean> {
    const isProduction = process.env.NODE_ENV === 'production';
    const { accessToken, phoneNumberId, templateName } = this.getCredentials();
    const maskedPhone = maskPhone(phone);

    if (!accessToken || !phoneNumberId) {
      if (isProduction) {
        logger.error(`[SECURITY] Production WhatsApp OTP delivery configuration missing for ${maskedPhone}. Failing closed.`);
        throw new Error('OTP delivery provider is not configured. Production requires valid WhatsApp credentials.');
      }
      logger.warn(`[DEV] WhatsApp credentials not configured. OTP delivery simulated for ${maskedPhone}.`);
      return true;
    }

    const fallbackText = `Your Sri Tirumala Dry Fruits verification code for ${purpose.toLowerCase().replace('_', ' ')} is: ${otp}. Valid for 5 minutes. Do not share this code with anyone.`;
    const components = [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: otp }
        ]
      },
      {
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [
          { type: 'text', text: otp }
        ]
      }
    ];

    try {
      try {
        await whatsappClient.sendTemplateMessage(phone, templateName, components);
        logger.info(`[OTP] Sent verification template '${templateName}' to ${maskedPhone} for ${purpose}`);
        return true;
      } catch (templateErr: any) {
        logger.warn(`[OTP] Template '${templateName}' send failed, attempting text message fallback for ${maskedPhone}: ${templateErr.message}`);
        await whatsappClient.sendTextMessage(phone, fallbackText);
        logger.info(`[OTP] Sent verification text message to ${maskedPhone} for ${purpose}`);
        return true;
      }
    } catch (err: any) {
      logger.error(`[OTP] Failed to deliver WhatsApp OTP to ${maskedPhone}: ${err.message}`);
      if (isProduction) {
        throw new Error('Failed to deliver verification code. Please try again later.');
      }
      throw err;
    }
  }
}

/**
 * Mock OTP Provider strictly permitted ONLY in non-production environments.
 * Throws immediately if instantiated or invoked in production.
 */
export class MockOtpProvider implements IOtpProvider {
  name = 'MockOtpProvider';
  private sentOtps = new Map<string, { otp: string; purpose: OtpPurpose; timestamp: Date }>();

  constructor() {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Security Violation: MockOtpProvider is strictly prohibited in production environment.');
    }
  }

  async sendOtp(phone: string, otp: string, purpose: OtpPurpose): Promise<boolean> {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Security Violation: MockOtpProvider is strictly prohibited in production environment.');
    }
    this.sentOtps.set(`${phone}:${purpose}`, { otp, purpose, timestamp: new Date() });
    logger.debug(`[MOCK OTP] Delivered simulated OTP for ${maskPhone(phone)}, Purpose: ${purpose}`);
    return true;
  }

  getLastOtp(phone: string, purpose: OtpPurpose): string | undefined {
    return this.sentOtps.get(`${phone}:${purpose}`)?.otp;
  }

  clear(): void {
    this.sentOtps.clear();
  }
}

export class OtpService {
  private provider: IOtpProvider;
  private readonly defaultTtlSeconds = 300; // 5 minutes
  private readonly defaultCooldownSeconds = 60; // 60 seconds
  private readonly maxAttempts = 5;

  constructor(provider?: IOtpProvider) {
    if (provider) {
      this.provider = provider;
    } else {
      this.provider = this.resolveProvider();
    }
  }

  private resolveProvider(): IOtpProvider {
    const isProduction = process.env.NODE_ENV === 'production';
    if (isProduction) {
      return new WhatsAppOtpProvider();
    }
    if (process.env.NODE_ENV === 'test' || process.env.OTP_PROVIDER === 'mock') {
      return new MockOtpProvider();
    }
    // In local development, prefer WhatsApp if credentials exist, else Mock
    const hasCreds = Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
    return hasCreds ? new WhatsAppOtpProvider() : new MockOtpProvider();
  }

  public setProvider(provider: IOtpProvider): void {
    if (process.env.NODE_ENV === 'production' && provider instanceof MockOtpProvider) {
      throw new Error('Security Violation: Cannot set MockOtpProvider in production environment.');
    }
    this.provider = provider;
  }

  public getProvider(): IOtpProvider {
    return this.provider;
  }

  private getHmacKey(): string {
    return resolveSecret('OTP_SECRET', 'OTP_SECRET_FILE', '') ||
      resolveSecret('SESSION_SECRET', 'SESSION_SECRET_FILE', 'stdf-otp-security-salt-key-2026');
  }

  private hashOtp(otp: string): string {
    const key = this.getHmacKey();
    return crypto.createHmac('sha256', key).update(otp).digest('hex');
  }

  /**
   * Generates, securely hashes, persists, and delivers a single-use verification challenge.
   */
  async sendOtp(
    rawPhone: string,
    purpose: OtpPurpose
  ): Promise<{ success: boolean; cooldownSeconds: number; expiresSeconds: number }> {
    const phone = normalizePhone(rawPhone);

    // 1. Rate Limit: Check resend cooldown
    const activeChallenge = db.prepare(`
      SELECT * FROM phone_verifications 
      WHERE phone = ? AND purpose = ? AND consumed_at IS NULL
      ORDER BY id DESC LIMIT 1
    `).get(phone, purpose) as any;

    const now = new Date();

    if (activeChallenge) {
      const resendAvailableAt = new Date(activeChallenge.resend_available_at);
      if (resendAvailableAt > now) {
        const remainingSeconds = Math.ceil((resendAvailableAt.getTime() - now.getTime()) / 1000);
        throw new Error(`Please wait ${remainingSeconds} seconds before requesting another code.`);
      }
    }

    // 2. Rate Limit: Volume check (max 5 requests per phone per 15 minutes)
    const recentCountRow = db.prepare(`
      SELECT COUNT(*) as count FROM phone_verifications
      WHERE phone = ? AND purpose = ? AND created_at > datetime('now', '-15 minutes')
    `).get(phone, purpose) as any;

    if (recentCountRow && recentCountRow.count >= 5) {
      logger.warn(`[OTP] Rate limit exceeded for phone ${phone.slice(0, 4)}**** on ${purpose}`);
      throw new Error('Too many verification requests. Please try again in 15 minutes.');
    }

    // 3. Invalidate previous active unconsumed challenges for this phone and purpose
    db.prepare(`
      UPDATE phone_verifications 
      SET consumed_at = CURRENT_TIMESTAMP 
      WHERE phone = ? AND purpose = ? AND consumed_at IS NULL
    `).run(phone, purpose);

    // 4. Generate cryptographically strong 6-digit OTP
    const otpInt = crypto.randomInt(100000, 1000000);
    const otp = otpInt.toString();
    const otpHash = this.hashOtp(otp);

    const expiresAt = new Date(now.getTime() + this.defaultTtlSeconds * 1000).toISOString();
    const resendAvailableAt = new Date(now.getTime() + this.defaultCooldownSeconds * 1000).toISOString();

    // 5. Persist challenge
    const insertRes = db.prepare(`
      INSERT INTO phone_verifications (phone, otp_hash, purpose, attempts, max_attempts, expires_at, resend_available_at)
      VALUES (?, ?, ?, 0, ?, ?, ?)
    `).run(phone, otpHash, purpose, this.maxAttempts, expiresAt, resendAvailableAt);
    const verificationId = insertRes.lastInsertRowid as number;

    // 6. Deliver OTP via configured provider inline (fails closed if production fails)
    // Synchronous inline delivery guarantees immediate customer feedback and eliminates dual-send race conditions
    try {
      await this.provider.sendOtp(phone, otp, purpose);

      // Record durable delivery job as COMPLETED for audit history and delivery tracking
      queueService.enqueue({
        name: 'otp_delivery',
        payload: {
          verificationId,
          phone,
          purpose
        },
        idempotencyKey: `otp_delivery_${verificationId}`,
        status: 'COMPLETED'
      });
    } catch (err: any) {
      // Record failed delivery attempt in job ledger
      try {
        queueService.enqueue({
          name: 'otp_delivery',
          payload: {
            verificationId,
            phone,
            purpose
          },
          idempotencyKey: `otp_delivery_${verificationId}`,
          status: 'FAILED'
        });
      } catch {}
      throw err;
    }

    return {
      success: true,
      cooldownSeconds: this.defaultCooldownSeconds,
      expiresSeconds: this.defaultTtlSeconds
    };
  }

  /**
   * Validates an OTP challenge against normalized phone, purpose, attempt count, and expiration.
   * By default, does NOT mark the challenge consumed immediately so that multi-step transactions
   * can perform atomic consumption. Pass options.consume = true to consume on verify.
   */
  verifyOtp(
    rawPhone: string,
    purpose: OtpPurpose,
    otp: string,
    options?: { consume?: boolean }
  ): { success: boolean; challengeId: number } {
    if (!otp || typeof otp !== 'string' || !/^\d{6}$/.test(otp.trim())) {
      throw new Error('Invalid verification code. Please enter the 6-digit code.');
    }

    const phone = normalizePhone(rawPhone);
    const cleanOtp = otp.trim();

    const challenge = db.prepare(`
      SELECT * FROM phone_verifications 
      WHERE phone = ? AND purpose = ? AND consumed_at IS NULL
      ORDER BY id DESC LIMIT 1
    `).get(phone, purpose) as any;

    if (!challenge) {
      throw new Error('No active verification code found. Please request a new code.');
    }

    const now = new Date();
    const expiresAt = new Date(challenge.expires_at);

    if (expiresAt < now) {
      throw new Error('Verification code has expired. Please request a new code.');
    }

    if (challenge.attempts >= challenge.max_attempts) {
      throw new Error('Maximum verification attempts exceeded. Please request a new code.');
    }

    // Increment attempt counter atomically
    db.prepare(`
      UPDATE phone_verifications 
      SET attempts = attempts + 1 
      WHERE id = ?
    `).run(challenge.id);

    // Timing-safe comparison of HMAC hashes
    const candidateHash = this.hashOtp(cleanOtp);
    const candidateBuffer = Buffer.from(candidateHash, 'hex');
    const expectedBuffer = Buffer.from(challenge.otp_hash, 'hex');

    const isMatch = candidateBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(candidateBuffer, expectedBuffer);

    if (!isMatch) {
      const remainingAttempts = challenge.max_attempts - (challenge.attempts + 1);
      if (remainingAttempts <= 0) {
        throw new Error('Maximum verification attempts exceeded. Please request a new code.');
      }
      throw new Error(`Incorrect verification code. ${remainingAttempts} attempt${remainingAttempts === 1 ? '' : 's'} remaining.`);
    }

    // If consume is requested
    if (options?.consume) {
      this.consumeChallenge(challenge.id);
    }

    return { success: true, challengeId: challenge.id };
  }

  /**
   * Atomically consumes a challenge. Ensures single-use / replay prevention.
   */
  consumeChallenge(challengeId: number): void {
    const result = db.prepare(`
      UPDATE phone_verifications 
      SET consumed_at = CURRENT_TIMESTAMP 
      WHERE id = ? AND consumed_at IS NULL
    `).run(challengeId);

    if (result.changes === 0) {
      throw new Error('Verification challenge has already been used or expired.');
    }
  }
}

export const otpService = new OtpService();
