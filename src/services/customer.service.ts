import db from '../database.js';
import { customerRepository } from '../repositories/customer.repository.js';
import { Customer, CustomerAddress } from '../types/index.js';
import { normalizePhone } from '../utils/phone.js';
import { otpService } from './otp.service.js';
import { auditService } from './audit.service.js';
import bcrypt from 'bcryptjs';
import logger from '../logger.js';

export class CustomerService {
  /**
   * Registers a customer account. If an unverified guest customer record matches
   * the provided phone number, verified proof of ownership via OTP is strictly required
   * before the guest record can be upgraded and claimed.
   */
  register(name: string, phone: string, email: string, passwordPlain: string, otp?: string): Customer {
    const existingEmail = customerRepository.getCustomerByEmail(email);
    if (existingEmail) throw new Error('Email is already registered.');

    const normalizedPhone = normalizePhone(phone);
    const existingPhone = customerRepository.getCustomerByPhone(normalizedPhone);

    if (existingPhone && existingPhone.password_hash) {
      throw new Error('Phone number is already registered.');
    }

    const hash = bcrypt.hashSync(passwordPlain, 10);

    // Scenario A: An existing guest record matches the phone number
    if (existingPhone && !existingPhone.password_hash) {
      if (!otp) {
        throw new Error(
          'Phone verification required: An existing shopping profile was found for this phone number. ' +
          'Please enter the verification code sent to your phone to link your account.'
        );
      }

      // Verify OTP challenge for REGISTRATION or ACCOUNT_LINK
      let verifiedChallengeId: number | null = null;
      try {
        const result = otpService.verifyOtp(normalizedPhone, 'REGISTRATION', otp, { consume: false });
        verifiedChallengeId = result.challengeId;
      } catch (regErr: any) {
        try {
          const result = otpService.verifyOtp(normalizedPhone, 'ACCOUNT_LINK', otp, { consume: false });
          verifiedChallengeId = result.challengeId;
        } catch {
          // Re-throw the original registration verification error
          throw regErr;
        }
      }

      // Step 3: Transactionally safe account linking
      const linkTransaction = db.transaction(() => {
        // 1. Consume the challenge atomically to prevent replay or race conditions
        otpService.consumeChallenge(verifiedChallengeId!);

        // 2. Atomically upgrade the guest record to registered status
        const upgraded = customerRepository.upgradeGuestCustomer(existingPhone.id, name, email, hash);
        if (!upgraded) {
          throw new Error('Account linking failed: Guest record has already been claimed or modified.');
        }

        logger.info(`[SECURITY] Successfully verified and linked guest customer #${existingPhone.id} (${normalizedPhone})`);
        return customerRepository.getCustomerById(existingPhone.id)!;
      });

      return linkTransaction();
    }

    // Scenario B: Clean registration for a new customer
    // If an OTP was optionally supplied, verify and consume it
    if (otp) {
      const { challengeId } = otpService.verifyOtp(normalizedPhone, 'REGISTRATION', otp, { consume: false });
      const createTx = db.transaction(() => {
        otpService.consumeChallenge(challengeId);
        return customerRepository.createCustomer(name, normalizedPhone, email, hash);
      });
      return createTx();
    }

    return customerRepository.createCustomer(name, normalizedPhone, email, hash);
  }

  /**
   * Transactionally link guest orders and addresses to an authenticated customer
   * after proving phone ownership with a valid OTP.
   */
  linkGuestToAccount(customerId: number, rawPhone: string, otp: string): boolean {
    const normalizedPhone = normalizePhone(rawPhone);
    const targetCustomer = this.getProfile(customerId);

    // Verify OTP for ACCOUNT_LINK
    const { challengeId } = otpService.verifyOtp(normalizedPhone, 'ACCOUNT_LINK', otp, { consume: false });

    const guestCustomer = customerRepository.getCustomerByPhone(normalizedPhone);
    if (!guestCustomer || guestCustomer.id === customerId) {
      // No separate guest customer to merge
      otpService.consumeChallenge(challengeId);
      return true;
    }

    if (guestCustomer.password_hash) {
      throw new Error('Cannot link phone: Phone is already associated with an independent registered account.');
    }

    const mergeTx = db.transaction(() => {
      // 1. Consume challenge
      otpService.consumeChallenge(challengeId);

      // 2. Reassign online orders
      db.prepare('UPDATE online_orders SET customer_id = ? WHERE customer_id = ?')
        .run(customerId, guestCustomer.id);

      // 3. Reassign addresses
      db.prepare('UPDATE customer_addresses SET customer_id = ? WHERE customer_id = ?')
        .run(customerId, guestCustomer.id);

      // 4. Mark guest customer record merged
      db.prepare(`
        UPDATE customers 
        SET account_status = 'MERGED', notes = ?
        WHERE id = ? AND password_hash IS NULL
      `).run(`Merged into customer #${customerId} at ${new Date().toISOString()}`, guestCustomer.id);

      logger.info(`[SECURITY] Merged guest #${guestCustomer.id} into customer #${customerId} for phone ${normalizedPhone}`);
    });

    mergeTx();
    return true;
  }

  authenticate(email: string, passwordPlain: string): Customer | null {
    const customer = customerRepository.getCustomerByEmail(email);
    if (customer && customer.password_hash && bcrypt.compareSync(passwordPlain, customer.password_hash)) {
      if (customer.account_status !== 'ACTIVE') {
        throw new Error('Account is inactive.');
      }
      return customer;
    }
    return null;
  }

  getProfile(id: number): Customer {
    const customer = customerRepository.getCustomerById(id);
    if (!customer) throw new Error('Customer not found');
    return customer;
  }

  updateProfile(id: number, name: string, phone: string, email: string): Customer {
    const current = this.getProfile(id);
    const normalizedPhone = normalizePhone(phone);

    if (email !== current.email) {
      const existingEmail = customerRepository.getCustomerByEmail(email);
      if (existingEmail && existingEmail.id !== id) throw new Error('Email is already taken.');
    }
    if (normalizedPhone !== current.phone) {
      const existingPhone = customerRepository.getCustomerByPhone(normalizedPhone);
      if (existingPhone && existingPhone.id !== id) throw new Error('Phone number is already taken.');
    }
    customerRepository.updateCustomerProfile(id, name, normalizedPhone, email);
    return this.getProfile(id);
  }

  getAddresses(customerId: number): CustomerAddress[] {
    return customerRepository.getAddresses(customerId);
  }

  addAddress(data: { customer_id: number; label: string; recipient_name: string; phone: string; address_line1: string; address_line2?: string; landmark?: string; city: string; state: string; pincode: string; is_default?: number }): void {
    let normalizedPhone = data.phone;
    try {
      normalizedPhone = normalizePhone(data.phone);
    } catch {}
    customerRepository.addAddress({
      ...data,
      phone: normalizedPhone
    });
  }

  setDefaultAddress(customerId: number, addressId: number): void {
    const address = customerRepository.getAddressById(addressId);
    if (!address || address.customer_id !== customerId) {
      throw new Error('Address not found or does not belong to you.');
    }
    customerRepository.setDefaultAddress(customerId, addressId);
  }

  deleteAddress(customerId: number, addressId: number): void {
    const address = customerRepository.getAddressById(addressId);
    if (!address || address.customer_id !== customerId) {
      throw new Error('Address not found or does not belong to you.');
    }
    customerRepository.deleteAddress(customerId, addressId);
  }
}

export const customerService = new CustomerService();
