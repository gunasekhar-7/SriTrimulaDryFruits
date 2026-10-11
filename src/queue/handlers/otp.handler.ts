import { Job, InvalidPayloadError, MissingReferencedRecordError, NonRetryableJobError } from '../types.js';
import { otpService, OtpPurpose } from '../../services/otp.service.js';
import db from '../../database.js';
import logger from '../../logger.js';
import { maskPhone } from '../../utils/phone.js';

export interface OtpDeliveryJobPayload {
  verificationId: number;
  phone: string;
  otp: string;
  purpose: OtpPurpose;
}

export async function processOtpDelivery(
  payload: OtpDeliveryJobPayload,
  job: Job<OtpDeliveryJobPayload>
): Promise<void> {
  // 1. Validate payload structure
  if (!payload || typeof payload !== 'object') {
    throw new InvalidPayloadError(`Invalid OTP delivery payload for Job #${job.id}: payload must be an object`);
  }

  const { verificationId, phone, otp, purpose } = payload;

  if (!verificationId || typeof verificationId !== 'number' || verificationId <= 0) {
    throw new InvalidPayloadError(`Invalid OTP delivery payload for Job #${job.id}: verificationId must be a positive integer`);
  }

  if (!phone || typeof phone !== 'string' || phone.trim().length === 0) {
    throw new InvalidPayloadError(`Invalid OTP delivery payload for Job #${job.id}: missing or empty recipient phone number`);
  }

  if (!otp || typeof otp !== 'string' || !/^\d{6}$/.test(otp.trim())) {
    throw new InvalidPayloadError(`Invalid OTP delivery payload for Job #${job.id}: OTP must be a 6-digit numeric string`);
  }

  if (!purpose || !['REGISTRATION', 'ACCOUNT_LINK', 'PHONE_UPDATE'].includes(purpose)) {
    throw new InvalidPayloadError(`Invalid OTP delivery payload for Job #${job.id}: invalid purpose '${purpose}'`);
  }

  const maskedPhone = maskPhone(phone);
  logger.info(`[Queue] Processing OTP delivery for ${maskedPhone} (Job #${job.id}, Purpose: ${purpose}, Attempt ${job.attempts + 1})`);

  // 2. Verify challenge state in database
  const challenge = db.prepare(`
    SELECT id, phone, purpose, consumed_at, expires_at 
    FROM phone_verifications 
    WHERE id = ?
  `).get(verificationId) as { id: number; phone: string; purpose: string; consumed_at: string | null; expires_at: string } | undefined;

  if (!challenge) {
    throw new MissingReferencedRecordError(
      `Referenced phone_verification #${verificationId} does not exist in database`,
      { verificationId, jobId: job.id }
    );
  }

  // If the challenge was already consumed or superseded, do not send stale OTP
  if (challenge.consumed_at) {
    logger.info(`[Queue] OTP challenge #${verificationId} has already been consumed or invalidated. Skipping delivery for Job #${job.id}.`);
    return;
  }

  // If the challenge has already expired, do not send expired OTP
  if (new Date(challenge.expires_at) < new Date()) {
    logger.info(`[Queue] OTP challenge #${verificationId} has expired. Skipping delivery for Job #${job.id}.`);
    return;
  }

  // 3. Deliver OTP via configured provider
  try {
    const provider = otpService.getProvider();
    await provider.sendOtp(phone, otp, purpose);
    logger.info(`[Queue] ✅ OTP delivery completed for Job #${job.id} to ${maskedPhone} via ${provider.name}`);
  } catch (err: any) {
    logger.error(`[Queue] ❌ OTP delivery attempt failed for Job #${job.id} to ${maskedPhone}: ${err.message}`);
    // If the error represents an unconfigured provider in production or security violation, fail immediately
    if (err.message && (err.message.includes('not configured') || err.message.includes('prohibited') || err.message.includes('Invalid phone'))) {
      throw new NonRetryableJobError(err.message);
    }
    throw err;
  }
}
