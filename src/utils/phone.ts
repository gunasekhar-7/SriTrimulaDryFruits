/**
 * Utility for Indian mobile phone number normalization and validation.
 * Standardizes to canonical 12-digit format: 91XXXXXXXXXX (country code 91 + 10-digit mobile)
 */

export function normalizePhone(rawPhone: string): string {
  if (!rawPhone || typeof rawPhone !== 'string') {
    throw new Error('Phone number is required.');
  }

  const trimmed = rawPhone.trim();
  // Strip all non-digit characters
  const digits = trimmed.replace(/\D/g, '');

  // 10 digits starting with 6, 7, 8, or 9 (standard Indian mobile)
  if (digits.length === 10 && /^[6-9]/.test(digits)) {
    return '91' + digits;
  }

  // 11 digits starting with 0 followed by 6-9 (trunk prefix, e.g. 09876543210)
  if (digits.length === 11 && digits.startsWith('0') && /^[6-9]/.test(digits.slice(1))) {
    return '91' + digits.slice(1);
  }

  // 13 digits starting with 910 followed by 6-9 (country code + trunk 0, e.g. +9109876543210)
  if (digits.length === 13 && digits.startsWith('910') && /^[6-9]/.test(digits.slice(3))) {
    return '91' + digits.slice(3);
  }

  // 12 digits starting with 91 followed by 6-9 (canonical E.164 Indian mobile)
  if (digits.length === 12 && digits.startsWith('91') && /^[6-9]/.test(digits.slice(2))) {
    return digits;
  }

  // International format: raw input explicitly starts with '+' and has 10-15 valid digits
  if (trimmed.startsWith('+') && digits.length >= 10 && digits.length <= 15) {
    return digits;
  }

  throw new Error('Invalid mobile phone number. Must be a valid 10-digit number or international E.164 number.');
}

export function formatE164(phone: string): string {
  const normalized = normalizePhone(phone);
  return normalized.startsWith('+') ? normalized : '+' + normalized;
}

export function maskPhone(phone: string): string {
  if (!phone || typeof phone !== 'string') return 'N/A';
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return '***' + digits.slice(-4);
}

export function formatPhoneLocal(normalizedPhone: string): string {
  if (normalizedPhone.length === 12 && normalizedPhone.startsWith('91')) {
    return normalizedPhone.slice(2);
  }
  return normalizedPhone;
}

export function isValidIndianMobile(rawPhone: string): boolean {
  try {
    normalizePhone(rawPhone);
    return true;
  } catch {
    return false;
  }
}
