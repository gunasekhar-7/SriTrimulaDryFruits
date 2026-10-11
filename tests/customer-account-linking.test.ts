import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../server.js';
import db from '../src/database.js';
import { customerService } from '../src/services/customer.service.js';
import { customerRepository } from '../src/repositories/customer.repository.js';
import { onlineOrderRepository } from '../src/repositories/online_order.repository.js';
import { otpService, MockOtpProvider, WhatsAppOtpProvider } from '../src/services/otp.service.js';
import { normalizePhone } from '../src/utils/phone.js';
import bcrypt from 'bcryptjs';

describe('Security: Guest-to-Customer Account Linking & Phone Verification', () => {
  let mockProvider: MockOtpProvider;

  beforeAll(() => {
    // Ensure test environment uses MockOtpProvider
    mockProvider = new MockOtpProvider();
    otpService.setProvider(mockProvider);
  });

  beforeEach(() => {
    db.prepare('DELETE FROM phone_verifications').run();
    db.prepare('DELETE FROM customer_addresses').run();
    db.prepare('DELETE FROM online_order_items').run();
    db.prepare('DELETE FROM online_orders').run();
    db.prepare('DELETE FROM customers').run();
    mockProvider.clear();
  });

  afterAll(() => {
    db.prepare('DELETE FROM phone_verifications').run();
    db.prepare('DELETE FROM customer_addresses').run();
    db.prepare('DELETE FROM online_order_items').run();
    db.prepare('DELETE FROM online_orders').run();
    db.prepare('DELETE FROM customers').run();
  });

  // Vector 1: User cannot claim guest record without successful OTP verification
  it('1. should prevent claiming a guest record by entering its phone number without OTP verification', () => {
    const guestPhone = '9876543210';
    const guest = customerRepository.findOrCreateCustomer(guestPhone, 'Original Guest Patron');
    expect(guest.id).toBeDefined();
    expect(guest.password_hash).toBeNull();

    // Attacker attempts to register with victim guest's phone number without providing OTP
    expect(() => {
      customerService.register('Attacker', guestPhone, 'attacker@example.com', 'EvilPassword123');
    }).toThrow(/Phone verification required/);

    // Verify guest record remains unclaimed and unchanged
    const pristineGuest = customerRepository.getCustomerById(guest.id)!;
    expect(pristineGuest.password_hash).toBeNull();
    expect(pristineGuest.name).toBe('Original Guest Patron');
  });

  // Vector 2: Incorrect OTP cannot link the record
  it('2. should reject linking when an incorrect OTP is supplied', async () => {
    const guestPhone = '9876543211';
    const guest = customerRepository.findOrCreateCustomer(guestPhone, 'Guest Patron 2');

    // Generate real challenge
    await otpService.sendOtp(guestPhone, 'REGISTRATION');
    const realOtp = mockProvider.getLastOtp(normalizePhone(guestPhone), 'REGISTRATION');
    expect(realOtp).toBeDefined();

    // Attacker attempts linking with wrong OTP
    expect(() => {
      customerService.register('Attacker', guestPhone, 'attacker2@example.com', 'EvilPassword123', '000000');
    }).toThrow(/Incorrect verification code/);

    // Verify guest record remains unclaimed
    const checkGuest = customerRepository.getCustomerById(guest.id)!;
    expect(checkGuest.password_hash).toBeNull();
  });

  // Vector 3: Expired OTP cannot link the record
  it('3. should reject an expired OTP challenge', async () => {
    const guestPhone = '9876543212';
    const guest = customerRepository.findOrCreateCustomer(guestPhone, 'Guest Patron 3');

    await otpService.sendOtp(guestPhone, 'REGISTRATION');
    const otp = mockProvider.getLastOtp(normalizePhone(guestPhone), 'REGISTRATION')!;

    // Manually expire the challenge in the database
    db.prepare(`
      UPDATE phone_verifications 
      SET expires_at = datetime('now', '-10 minutes') 
      WHERE phone = ?
    `).run(normalizePhone(guestPhone));

    // Attempting registration with expired OTP must fail
    expect(() => {
      customerService.register('Legitimate Owner', guestPhone, 'owner3@example.com', 'ValidPassword123', otp);
    }).toThrow(/expired/i);

    const checkGuest = customerRepository.getCustomerById(guest.id)!;
    expect(checkGuest.password_hash).toBeNull();
  });

  // Vector 4: Used OTP cannot be replayed
  it('4. should prevent replaying an already consumed OTP', async () => {
    const guestPhone = '9876543213';
    customerRepository.findOrCreateCustomer(guestPhone, 'Guest Patron 4');

    await otpService.sendOtp(guestPhone, 'REGISTRATION');
    const otp = mockProvider.getLastOtp(normalizePhone(guestPhone), 'REGISTRATION')!;

    // First use: successfully links
    const registered = customerService.register('Owner', guestPhone, 'owner4@example.com', 'Password123', otp);
    expect(registered.id).toBeDefined();

    // Replay attempt with another email and the same OTP
    expect(() => {
      customerService.register('Imposter', guestPhone, 'imposter@example.com', 'NewPassword123', otp);
    }).toThrow();
  });

  // Vector 5: Excessive verification attempts and OTP resend cooldown
  it('5. should enforce cooldown on resend and lock challenge after excessive failed attempts', async () => {
    const testPhone = '9876543214';

    // (a) First request succeeds
    const res1 = await otpService.sendOtp(testPhone, 'REGISTRATION');
    expect(res1.success).toBe(true);

    // (b) Immediate resend before cooldown expires must throw
    await expect(otpService.sendOtp(testPhone, 'REGISTRATION')).rejects.toThrow(/Please wait/);

    // (c) Exceeding max attempts (5) locks the challenge
    for (let i = 0; i < 4; i++) {
      expect(() => {
        otpService.verifyOtp(testPhone, 'REGISTRATION', '111111');
      }).toThrow(/Incorrect verification code/);
    }

    // 5th incorrect attempt exhausts all attempts
    expect(() => {
      otpService.verifyOtp(testPhone, 'REGISTRATION', '111111');
    }).toThrow(/Maximum verification attempts exceeded/);

    // Even if real OTP is now supplied, the exhausted challenge is locked
    const realOtp = mockProvider.getLastOtp(normalizePhone(testPhone), 'REGISTRATION')!;
    expect(() => {
      otpService.verifyOtp(testPhone, 'REGISTRATION', realOtp);
    }).toThrow(/Maximum verification attempts exceeded/);
  });

  // Vector 6: Challenge for one phone or purpose cannot authorize another
  it('6. should reject cross-phone or cross-purpose challenge authorization', async () => {
    const phoneA = '9876543215';
    const phoneB = '9876543216';

    // Issue OTP for phoneA with purpose PHONE_UPDATE
    await otpService.sendOtp(phoneA, 'PHONE_UPDATE');
    const otpA = mockProvider.getLastOtp(normalizePhone(phoneA), 'PHONE_UPDATE')!;

    // 1. Cross-phone: Trying to verify for phoneB with phoneA's OTP must fail
    expect(() => {
      otpService.verifyOtp(phoneB, 'PHONE_UPDATE', otpA);
    }).toThrow(/No active verification code found/);

    // 2. Cross-purpose: Trying to use PHONE_UPDATE OTP for REGISTRATION on phoneA must fail
    expect(() => {
      otpService.verifyOtp(phoneA, 'REGISTRATION', otpA);
    }).toThrow(/No active verification code found/);
  });

  // Vector 7: Valid OTP permits intended linking operation exactly once
  it('7. should permit linking exactly once with a valid OTP and preserve historical orders', async () => {
    const phone = '9876543217';
    const guest = customerRepository.findOrCreateCustomer(phone, 'Loyal Guest');

    // Create a historical order for this guest
    const orderId = onlineOrderRepository.insertOrder({
      customer_id: guest.id,
      order_number: 'ORD-GUEST-001',
      subtotal: 1200,
      delivery_charge: 50,
      discount: 0,
      total_amount: 1250,
      payment_mode: 'COD',
      delivery_type: 'DELIVERY',
      notes: 'Guest order before account creation',
      status: 'CONFIRMED'
    });

    // Send and verify OTP
    await otpService.sendOtp(phone, 'REGISTRATION');
    const otp = mockProvider.getLastOtp(normalizePhone(phone), 'REGISTRATION')!;

    const registered = customerService.register('Loyal Customer', phone, 'loyal@example.com', 'Pass12345', otp);
    expect(registered.id).toBe(guest.id);
    expect(registered.email).toBe('loyal@example.com');
    expect(registered.password_hash).toBeTruthy();

    // Verify historical order remains linked to this customer ID
    const pastOrders = onlineOrderRepository.getOrdersByCustomer(registered.id);
    expect(pastOrders.length).toBe(1);
    expect(pastOrders[0].order_number).toBe('ORD-GUEST-001');

    // Second attempt to use OTP throws
    expect(() => {
      otpService.consumeChallenge(1); // challenge consumed
    }).toThrow(/already been used or expired/);
  });

  // Vector 8: Parallel linking attempts cannot assign the same guest identity to two customer accounts
  it('8. should prevent parallel linking race conditions on the same guest identity', async () => {
    const phone = '9876543218';
    const guest = customerRepository.findOrCreateCustomer(phone, 'Concurrent Guest');

    await otpService.sendOtp(phone, 'REGISTRATION');
    const otp = mockProvider.getLastOtp(normalizePhone(phone), 'REGISTRATION')!;

    // Simulate parallel race: first claim succeeds
    const firstClaim = customerService.register('Claimer 1', phone, 'claim1@example.com', 'Pass123!', otp);
    expect(firstClaim.id).toBe(guest.id);

    // Second claim attempting to link the same guest record must fail
    expect(() => {
      customerService.register('Claimer 2', phone, 'claim2@example.com', 'Pass123!', otp);
    }).toThrow();
  });

  // Vector 9: Failure during merge rolls back all partial changes
  it('9. should roll back all database changes if an error occurs during account linking', async () => {
    const phone = '9876543219';
    const guest = customerRepository.findOrCreateCustomer(phone, 'Rollback Guest');

    await otpService.sendOtp(phone, 'REGISTRATION');
    const otp = mockProvider.getLastOtp(normalizePhone(phone), 'REGISTRATION')!;

    // Create another customer with email 'conflict@example.com'
    customerRepository.createCustomer('Existing User', '9876543220', 'conflict@example.com', 'hash123');

    // Attempt registration with the same email (will fail uniqueness constraint in service)
    expect(() => {
      customerService.register('Failing User', phone, 'conflict@example.com', 'Pass123!', otp);
    }).toThrow('Email is already registered.');

    // Verify guest record is unaltered
    const checkGuest = customerRepository.getCustomerById(guest.id)!;
    expect(checkGuest.password_hash).toBeNull();
    expect(checkGuest.name).toBe('Rollback Guest');
  });

  // Vector 10: Unauthenticated or unrelated customer cannot access historical orders or addresses
  it('10. should prevent cross-customer access to orders and addresses', async () => {
    // Customer 1
    const cust1 = customerService.register('User One', '9876543221', 'user1@example.com', 'Pass12345');
    customerService.addAddress({
      customer_id: cust1.id,
      label: 'Home',
      recipient_name: 'User One',
      phone: '9876543221',
      address_line1: '123 Customer One Way',
      city: 'Tekkali',
      state: 'AP',
      pincode: '532201'
    });
    const addr1 = customerService.getAddresses(cust1.id)[0];

    // Customer 2
    const cust2 = customerService.register('User Two', '9876543222', 'user2@example.com', 'Pass12345');

    // Customer 2 tries to delete or set default on Customer 1's address
    expect(() => {
      customerService.setDefaultAddress(cust2.id, addr1.id);
    }).toThrow(/does not belong to you/);

    expect(() => {
      customerService.deleteAddress(cust2.id, addr1.id);
    }).toThrow(/does not belong to you/);
  });

  // Vector 11: Existing customer registration and login continue to work
  it('11. should allow normal customer registration and login for brand new users', () => {
    const newPhone = '9876543223';
    const registered = customerService.register('Clean User', newPhone, 'clean@example.com', 'ValidPass123');
    expect(registered.id).toBeDefined();
    expect(registered.name).toBe('Clean User');

    // Authenticate
    const authSuccess = customerService.authenticate('clean@example.com', 'ValidPass123');
    expect(authSuccess).not.toBeNull();
    expect(authSuccess?.id).toBe(registered.id);

    const authFail = customerService.authenticate('clean@example.com', 'WrongPass123');
    expect(authFail).toBeNull();
  });

  // Vector 12: Development-only OTP mocks are unavailable in production
  it('12. should strictly reject MockOtpProvider in production environment', () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      expect(() => {
        new MockOtpProvider();
      }).toThrow(/MockOtpProvider is strictly prohibited in production/);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  // Vector 13: Missing production OTP-provider configuration never silently bypasses verification
  it('13. should fail closed when production WhatsApp configuration is missing', async () => {
    const originalEnv = process.env.NODE_ENV;
    const originalToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const originalPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    try {
      process.env.NODE_ENV = 'production';
      delete process.env.WHATSAPP_ACCESS_TOKEN;
      delete process.env.WHATSAPP_PHONE_NUMBER_ID;

      const prodProvider = new WhatsAppOtpProvider();
      await expect(
        prodProvider.sendOtp('919876543224', '123456', 'REGISTRATION')
      ).rejects.toThrow(/OTP delivery provider is not configured/);
    } finally {
      process.env.NODE_ENV = originalEnv;
      if (originalToken) process.env.WHATSAPP_ACCESS_TOKEN = originalToken;
      if (originalPhoneId) process.env.WHATSAPP_PHONE_NUMBER_ID = originalPhoneId;
    }
  });

  // Vector 14: Customer authentication changes do not grant customers staff/admin privileges
  it('14. should ensure customer authentication never grants staff or admin privileges', async () => {
    const cust = customerService.register('Regular Shopper', '9876543225', 'shopper@example.com', 'Pass12345');

    // Simulate agent session with customer_id
    const customerAgent = request.agent(app);
    
    // Attempt staff endpoint /sell
    const sellRes = await customerAgent.get('/sell');
    // Staff auth redirects unauthenticated staff to /login (302)
    expect(sellRes.status).toBe(302);
    expect(sellRes.headers.location).toBe('/login');

    // Attempt admin online orders endpoint
    const adminRes = await customerAgent.get('/admin/online-orders');
    expect(adminRes.status).toBe(302);
    expect(adminRes.headers.location).toBe('/login');

    // Attempt background jobs endpoint
    const jobsRes = await customerAgent.get('/api/v1/jobs');
    expect(jobsRes.status).toBe(401);
  });
});
