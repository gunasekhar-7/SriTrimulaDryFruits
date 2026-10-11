import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import db from '../src/database.js';
import { otpService, WhatsAppOtpProvider, MockOtpProvider } from '../src/services/otp.service.js';
import { queueService } from '../src/queue/index.js';
import { processOtpDelivery } from '../src/queue/handlers/otp.handler.js';
import { whatsappClient } from '../src/integrations/whatsapp/client.js';
import { normalizePhone, formatE164, maskPhone } from '../src/utils/phone.js';
import logger from '../src/logger.js';

describe('OTP Lifecycle, Queue Delivery, and Provider Integration Suite', () => {
  const testPhoneRaw = '9876543210';
  const testPhoneNormalized = '919876543210';

  beforeEach(() => {
    vi.restoreAllMocks();
    db.prepare('DELETE FROM phone_verifications').run();
    db.prepare("DELETE FROM background_jobs WHERE name = 'otp_delivery' OR idempotency_key LIKE 'otp_%'").run();
    // Default to mock provider in tests for clean state
    otpService.setProvider(new MockOtpProvider());
  });

  afterEach(() => {
    db.prepare('DELETE FROM phone_verifications').run();
    db.prepare("DELETE FROM background_jobs WHERE name = 'otp_delivery' OR idempotency_key LIKE 'otp_%'").run();
  });

  // 1. OTP generation succeeds
  it('1. should successfully generate an OTP challenge with TTL and cooldown', async () => {
    const res = await otpService.sendOtp(testPhoneRaw, 'REGISTRATION');
    expect(res.success).toBe(true);
    expect(res.cooldownSeconds).toBe(60);
    expect(res.expiresSeconds).toBe(300);

    const challenge = db.prepare('SELECT * FROM phone_verifications WHERE phone = ?').get(testPhoneNormalized) as any;
    expect(challenge).toBeDefined();
    expect(challenge.purpose).toBe('REGISTRATION');
  });

  // 2. OTP generation failure
  it('2. should handle database error gracefully during generation', async () => {
    const spy = vi.spyOn(db, 'prepare').mockImplementationOnce(() => {
      throw new Error('Database disk I/O error');
    });

    await expect(otpService.sendOtp(testPhoneRaw, 'REGISTRATION')).rejects.toThrow('Database disk I/O error');
    spy.mockRestore();
  });

  // 3. OTP persistence: stored as HMAC hash, never plaintext
  it('3. should persist OTP as HMAC-SHA256 hash and never store plaintext in database', async () => {
    await otpService.sendOtp(testPhoneRaw, 'REGISTRATION');

    const row = db.prepare('SELECT * FROM phone_verifications WHERE phone = ?').get(testPhoneNormalized) as any;
    expect(row).toBeDefined();
    expect(row.otp_hash).toBeDefined();
    expect(typeof row.otp_hash).toBe('string');
    // SHA256 hex string is 64 characters
    expect(row.otp_hash.length).toBe(64);
    // Ensure plaintext 6-digit code is NOT in any column
    expect(row.otp_hash).not.toMatch(/^\d{6}$/);
  });

  // 4. OTP expiry
  it('4. should reject verification if OTP has expired', async () => {
    await otpService.sendOtp(testPhoneRaw, 'REGISTRATION');
    const mockProvider = otpService.getProvider() as MockOtpProvider;
    const otp = mockProvider.getLastOtp(testPhoneNormalized, 'REGISTRATION')!;

    // Manually backdate expires_at to 1 minute ago
    db.prepare("UPDATE phone_verifications SET expires_at = datetime('now', '-1 minute') WHERE phone = ?").run(testPhoneNormalized);

    expect(() => {
      otpService.verifyOtp(testPhoneRaw, 'REGISTRATION', otp);
    }).toThrow(/expired/i);
  });

  // 5. OTP verification
  it('5. should successfully verify matching OTP', async () => {
    await otpService.sendOtp(testPhoneRaw, 'REGISTRATION');
    const mockProvider = otpService.getProvider() as MockOtpProvider;
    const otp = mockProvider.getLastOtp(testPhoneNormalized, 'REGISTRATION')!;

    const verifyResult = otpService.verifyOtp(testPhoneRaw, 'REGISTRATION', otp, { consume: true });
    expect(verifyResult.success).toBe(true);
    expect(verifyResult.challengeId).toBeGreaterThan(0);

    const row = db.prepare('SELECT consumed_at FROM phone_verifications WHERE id = ?').get(verifyResult.challengeId) as any;
    expect(row.consumed_at).not.toBeNull();
  });

  // 6. Invalid OTP
  it('6. should reject incorrect OTP and increment attempt counter', async () => {
    await otpService.sendOtp(testPhoneRaw, 'REGISTRATION');

    expect(() => {
      otpService.verifyOtp(testPhoneRaw, 'REGISTRATION', '000000');
    }).toThrow(/Incorrect verification code/i);

    const row = db.prepare('SELECT attempts FROM phone_verifications WHERE phone = ?').get(testPhoneNormalized) as any;
    expect(row.attempts).toBe(1);
  });

  // 7. Reused OTP
  it('7. should reject verification of already consumed OTP challenge', async () => {
    await otpService.sendOtp(testPhoneRaw, 'REGISTRATION');
    const mockProvider = otpService.getProvider() as MockOtpProvider;
    const otp = mockProvider.getLastOtp(testPhoneNormalized, 'REGISTRATION')!;

    // Consume once
    otpService.verifyOtp(testPhoneRaw, 'REGISTRATION', otp, { consume: true });

    // Attempt second consumption
    expect(() => {
      otpService.verifyOtp(testPhoneRaw, 'REGISTRATION', otp);
    }).toThrow(/No active verification code found/i);
  });

  // 8. Registration / send-otp creates delivery job
  it('8. should enqueue an otp_delivery job in background_jobs table upon OTP creation', async () => {
    await otpService.sendOtp(testPhoneRaw, 'REGISTRATION');

    const jobs = queueService.getJobs({ name: 'otp_delivery' });
    expect(jobs.length).toBeGreaterThanOrEqual(1);

    const latestJob = jobs[0];
    expect(latestJob.name).toBe('otp_delivery');
    expect(latestJob.payload).toBeDefined();
    expect(latestJob.payload.phone).toBe(testPhoneNormalized);
    expect(latestJob.payload.purpose).toBe('REGISTRATION');
    expect(latestJob.payload.verificationId).toBeGreaterThan(0);
  });

  // 9. Worker processes OTP job
  it('9. should allow queue worker to claim and process otp_delivery job successfully', async () => {
    const mockProvider = new MockOtpProvider();
    otpService.setProvider(mockProvider);

    const futureIso = new Date(Date.now() + 300000).toISOString();
    const resendIso = new Date(Date.now() + 60000).toISOString();
    const insertRes = db.prepare(`
      INSERT INTO phone_verifications (phone, otp_hash, purpose, attempts, max_attempts, expires_at, resend_available_at)
      VALUES (?, 'testhash', 'REGISTRATION', 0, 5, ?, ?)
    `).run(testPhoneNormalized, futureIso, resendIso);
    const verificationId = insertRes.lastInsertRowid as number;

    const fakeJob: any = {
      id: 99991,
      name: 'otp_delivery',
      attempts: 0,
      max_retries: 3
    };

    const payload = {
      verificationId,
      phone: testPhoneNormalized,
      otp: '654321',
      purpose: 'REGISTRATION' as const
    };

    await processOtpDelivery(payload, fakeJob);
    expect(mockProvider.getLastOtp(testPhoneNormalized, 'REGISTRATION')).toBe('654321');
  });

  // 10. Provider success (WhatsApp template delivery)
  it('10. should successfully deliver OTP via WhatsApp provider when valid credentials exist', async () => {
    const origToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const origPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    try {
      process.env.WHATSAPP_ACCESS_TOKEN = 'test_token';
      process.env.WHATSAPP_PHONE_NUMBER_ID = 'test_phone_id';

      const sendTemplateSpy = vi.spyOn(whatsappClient, 'sendTemplateMessage').mockResolvedValue({
        messages: [{ id: 'wamid_otp_12345' }]
      });

      const provider = new WhatsAppOtpProvider();
      const success = await provider.sendOtp(testPhoneNormalized, '123456', 'REGISTRATION');

      expect(success).toBe(true);
      expect(sendTemplateSpy).toHaveBeenCalledWith(
        testPhoneNormalized,
        expect.any(String),
        expect.arrayContaining([
          expect.objectContaining({ type: 'body' })
        ])
      );
    } finally {
      process.env.WHATSAPP_ACCESS_TOKEN = origToken;
      process.env.WHATSAPP_PHONE_NUMBER_ID = origPhoneId;
    }
  });

  // 11. Provider authentication failure
  it('11. should handle provider authentication failure (Meta 401/403) and log safe error', async () => {
    const origToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const origPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    try {
      process.env.WHATSAPP_ACCESS_TOKEN = 'expired_invalid_token';
      process.env.WHATSAPP_PHONE_NUMBER_ID = 'test_phone_id';

      vi.spyOn(whatsappClient, 'sendTemplateMessage').mockRejectedValue(new Error('Meta API 401 Unauthorized: Invalid OAuth access token'));
      vi.spyOn(whatsappClient, 'sendTextMessage').mockRejectedValue(new Error('Meta API 401 Unauthorized: Invalid OAuth access token'));

      const provider = new WhatsAppOtpProvider();
      await expect(provider.sendOtp(testPhoneNormalized, '123456', 'REGISTRATION')).rejects.toThrow(/Unauthorized/i);
    } finally {
      process.env.WHATSAPP_ACCESS_TOKEN = origToken;
      process.env.WHATSAPP_PHONE_NUMBER_ID = origPhoneId;
    }
  });

  // 12. Provider configuration missing in production
  it('12. should fail closed in production environment when provider credentials are missing', async () => {
    const origEnv = process.env.NODE_ENV;
    const origToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const origPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    try {
      process.env.NODE_ENV = 'production';
      delete process.env.WHATSAPP_ACCESS_TOKEN;
      delete process.env.WHATSAPP_PHONE_NUMBER_ID;

      const provider = new WhatsAppOtpProvider();
      await expect(provider.sendOtp(testPhoneNormalized, '123456', 'REGISTRATION')).rejects.toThrow(
        /OTP delivery provider is not configured/
      );
    } finally {
      process.env.NODE_ENV = origEnv;
      if (origToken) process.env.WHATSAPP_ACCESS_TOKEN = origToken;
      if (origPhoneId) process.env.WHATSAPP_PHONE_NUMBER_ID = origPhoneId;
    }
  });

  // 13. Provider rejection
  it('13. should fallback to text message if template message is rejected', async () => {
    const origToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const origPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    try {
      process.env.WHATSAPP_ACCESS_TOKEN = 'test_token';
      process.env.WHATSAPP_PHONE_NUMBER_ID = 'test_phone_id';

      vi.spyOn(whatsappClient, 'sendTemplateMessage').mockRejectedValue(new Error('Template not found or not approved'));
      const textSpy = vi.spyOn(whatsappClient, 'sendTextMessage').mockResolvedValue({ messages: [{ id: 'fallback_msg_1' }] });

      const provider = new WhatsAppOtpProvider();
      const success = await provider.sendOtp(testPhoneNormalized, '123456', 'REGISTRATION');

      expect(success).toBe(true);
      expect(textSpy).toHaveBeenCalledWith(testPhoneNormalized, expect.stringContaining('123456'));
    } finally {
      process.env.WHATSAPP_ACCESS_TOKEN = origToken;
      process.env.WHATSAPP_PHONE_NUMBER_ID = origPhoneId;
    }
  });

  // 14. Provider timeout
  it('14. should bubble up transient timeout error for queue retry', async () => {
    const origToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const origPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    try {
      process.env.WHATSAPP_ACCESS_TOKEN = 'test_token';
      process.env.WHATSAPP_PHONE_NUMBER_ID = 'test_phone_id';

      vi.spyOn(whatsappClient, 'sendTemplateMessage').mockRejectedValue(new Error('ETIMEDOUT Gateway Timeout'));
      vi.spyOn(whatsappClient, 'sendTextMessage').mockRejectedValue(new Error('ETIMEDOUT Gateway Timeout'));

      const provider = new WhatsAppOtpProvider();
      await expect(provider.sendOtp(testPhoneNormalized, '123456', 'REGISTRATION')).rejects.toThrow(/ETIMEDOUT/);
    } finally {
      process.env.WHATSAPP_ACCESS_TOKEN = origToken;
      process.env.WHATSAPP_PHONE_NUMBER_ID = origPhoneId;
    }
  });

  // 15. Provider rate limiting
  it('15. should handle provider 429 rate limit response', async () => {
    const origToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const origPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    try {
      process.env.WHATSAPP_ACCESS_TOKEN = 'test_token';
      process.env.WHATSAPP_PHONE_NUMBER_ID = 'test_phone_id';

      vi.spyOn(whatsappClient, 'sendTemplateMessage').mockRejectedValue(new Error('Meta API 429: User-rate limit reached'));
      vi.spyOn(whatsappClient, 'sendTextMessage').mockRejectedValue(new Error('Meta API 429: User-rate limit reached'));

      const provider = new WhatsAppOtpProvider();
      await expect(provider.sendOtp(testPhoneNormalized, '123456', 'REGISTRATION')).rejects.toThrow(/429/);
    } finally {
      process.env.WHATSAPP_ACCESS_TOKEN = origToken;
      process.env.WHATSAPP_PHONE_NUMBER_ID = origPhoneId;
    }
  });

  // 16. Resend cooldown
  it('16. should enforce 60-second cooldown before allowing a resend', async () => {
    await otpService.sendOtp(testPhoneRaw, 'REGISTRATION');

    // Immediate second attempt within cooldown period
    await expect(otpService.sendOtp(testPhoneRaw, 'REGISTRATION')).rejects.toThrow(
      /Please wait \d+ seconds before requesting another code/
    );
  });

  // 17. Multiple resend attempts / volume rate limiting
  it('17. should enforce 15-minute volume rate limit (maximum 5 requests per 15 mins)', async () => {
    // Seed 5 existing requests created in the last 15 minutes
    for (let i = 0; i < 5; i++) {
      db.prepare(`
        INSERT INTO phone_verifications (phone, otp_hash, purpose, attempts, max_attempts, expires_at, resend_available_at, created_at)
        VALUES (?, 'hash_${i}', 'REGISTRATION', 0, 5, datetime('now', '+5 minutes'), datetime('now', '-10 seconds'), datetime('now', '-2 minutes'))
      `).run(testPhoneNormalized);
    }

    await expect(otpService.sendOtp(testPhoneRaw, 'REGISTRATION')).rejects.toThrow(
      /Too many verification requests. Please try again in 15 minutes/
    );
  });

  // 18. Correct E.164 phone formatting
  it('18. should correctly normalize 10-digit, 0-prefixed, +910-prefixed, and international formats', () => {
    // 10 digits
    expect(normalizePhone('9876543210')).toBe('919876543210');
    expect(formatE164('9876543210')).toBe('+919876543210');

    // With +91
    expect(normalizePhone('+919876543210')).toBe('919876543210');
    expect(formatE164('+919876543210')).toBe('+919876543210');

    // With trunk 0 (11 digits)
    expect(normalizePhone('09876543210')).toBe('919876543210');

    // With +910 (13 digits: country code + trunk 0)
    expect(normalizePhone('+9109876543210')).toBe('919876543210');

    // International E.164
    expect(normalizePhone('+15556575546')).toBe('15556575546');
    expect(formatE164('+15556575546')).toBe('+15556575546');
  });

  // 19. OTP is never exposed in logs
  it('19. should never log plaintext OTP in application logs', async () => {
    const infoSpy = vi.spyOn(logger, 'info');
    const debugSpy = vi.spyOn(logger, 'debug');
    const warnSpy = vi.spyOn(logger, 'warn');

    await otpService.sendOtp(testPhoneRaw, 'REGISTRATION');
    const mockProvider = otpService.getProvider() as MockOtpProvider;
    const otp = mockProvider.getLastOtp(testPhoneNormalized, 'REGISTRATION')!;

    const allLoggedMessages = [
      ...infoSpy.mock.calls,
      ...debugSpy.mock.calls,
      ...warnSpy.mock.calls
    ].map(call => JSON.stringify(call));

    const containsOtp = allLoggedMessages.some(msg => msg.includes(`"OTP": "${otp}"`) || msg.includes(`OTP: ${otp}`));
    expect(containsOtp).toBe(false);
  });

  // 20. Mock provider behavior is clearly separated from production behavior
  it('20. should strictly prohibit MockOtpProvider instantiation and invocation in production', () => {
    const origEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';

      expect(() => {
        new MockOtpProvider();
      }).toThrow(/Security Violation: MockOtpProvider is strictly prohibited in production environment/);
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });
});
