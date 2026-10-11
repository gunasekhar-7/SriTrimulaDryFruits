import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import db from '../src/database.js';
import { customerService } from '../src/services/customer.service.js';
import { customerRepository } from '../src/repositories/customer.repository.js';
import { otpService, MockOtpProvider } from '../src/services/otp.service.js';
import bcrypt from 'bcryptjs';

describe('Customer E-commerce Account Features', () => {
  
  beforeAll(() => {
    db.prepare('DELETE FROM phone_verifications').run();
    db.prepare('DELETE FROM customer_addresses').run();
    db.prepare('DELETE FROM online_orders').run();
    db.prepare('DELETE FROM customers').run();
  });

  afterAll(() => {
    db.prepare('DELETE FROM phone_verifications').run();
    db.prepare('DELETE FROM customer_addresses').run();
    db.prepare('DELETE FROM online_orders').run();
    db.prepare('DELETE FROM customers').run();
  });

  let custA: any;
  let custB: any;
  let addressA: number;

  it('should create a new customer via registration', () => {
    custA = customerService.register('Customer A', '9133133932', 'a@example.com', 'password123');
    expect(custA.name).toBe('Customer A');
    expect(custA.email).toBe('a@example.com');
    expect(custA.account_status).toBe('ACTIVE');
    expect(bcrypt.compareSync('password123', custA.password_hash)).toBe(true);
  });

  it('should preserve an existing customer and upgrade to full account with verified OTP', async () => {
    // Simulate a guest checkout creation
    customerRepository.findOrCreateCustomer('9133133933', 'Guest User');
    
    // Unverified upgrade attempt must be rejected
    expect(() => {
      customerService.register('Customer B', '9133133933', 'b@example.com', 'password456');
    }).toThrow(/Phone verification required/);

    // Request OTP challenge
    await otpService.sendOtp('9133133933', 'REGISTRATION');
    const mockProvider = otpService.getProvider() as MockOtpProvider;
    const otp = mockProvider.getLastOtp('919133133933', 'REGISTRATION') || mockProvider.getLastOtp('9133133933', 'REGISTRATION');
    expect(otp).toBeTruthy();

    // Upgrade via verified registration
    custB = customerService.register('Customer B', '9133133933', 'b@example.com', 'password456', otp);
    expect(custB.name).toBe('Customer B');
    expect(custB.email).toBe('b@example.com');
  });

  it('should authenticate a customer', () => {
    const authUser = customerService.authenticate('a@example.com', 'password123');
    expect(authUser).not.toBeNull();
    expect(authUser?.id).toBe(custA.id);

    const failUser = customerService.authenticate('a@example.com', 'wrongpass');
    expect(failUser).toBeNull();
  });

  it('should update customer profile', () => {
    const updated = customerService.updateProfile(custA.id, 'Customer A Updated', '9133133932', 'a_new@example.com');
    expect(updated.name).toBe('Customer A Updated');
    expect(updated.email).toBe('a_new@example.com');
  });

  it('should add a customer address', () => {
    customerService.addAddress({
      customer_id: custA.id,
      label: 'Home',
      recipient_name: 'Customer A',
      phone: '9133133932',
      address_line1: '123 Main St',
      city: 'Tekkali',
      state: 'AP',
      pincode: '532201',
      is_default: 1
    });

    const addresses = customerService.getAddresses(custA.id);
    expect(addresses.length).toBe(1);
    expect(addresses[0].is_default).toBe(1);
    addressA = addresses[0].id;
  });

  it('should change default address', () => {
    customerService.addAddress({
      customer_id: custA.id,
      label: 'Work',
      recipient_name: 'Customer A',
      phone: '9133133932',
      address_line1: '456 Work St',
      city: 'Tekkali',
      state: 'AP',
      pincode: '532201',
      is_default: 1 // sets new to default, unsets old
    });

    const addresses = customerService.getAddresses(custA.id);
    expect(addresses.length).toBe(2);
    const defaultAddr = addresses.find(a => a.is_default === 1);
    expect(defaultAddr?.label).toBe('Work');
  });

  it("should prevent Customer A from modifying Customer B's address", () => {
    expect(() => {
      customerService.setDefaultAddress(custB.id, addressA);
    }).toThrow('Address not found or does not belong to you.');

    expect(() => {
      customerService.deleteAddress(custB.id, addressA);
    }).toThrow('Address not found or does not belong to you.');
    
    // Address A should still exist
    const address = customerRepository.getAddressById(addressA);
    expect(address).not.toBeUndefined();
  });
});
