import db from '../database.js';
import { Customer, CustomerAddress } from '../types/index.js';
import { normalizePhone, formatPhoneLocal } from '../utils/phone.js';

export class CustomerRepository {
  findOrCreateCustomer(phone: string, name: string, address: string = '', landmark: string = '', pincode: string = ''): Customer {
    let normalized = phone;
    try {
      normalized = normalizePhone(phone);
    } catch {
      // Fallback to raw if not valid Indian mobile (e.g., test mocks)
    }

    db.prepare(`
      INSERT OR IGNORE INTO customers (phone, name, delivery_address, landmark, pincode)
      VALUES (?, ?, ?, ?, ?)
    `).run(normalized, name, address, landmark, pincode);
  
    return this.getCustomerByPhone(normalized)!;
  }

  getCustomerById(id: number): Customer | undefined {
    return db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as Customer | undefined;
  }

  getCustomerByEmail(email: string): Customer | undefined {
    return db.prepare('SELECT * FROM customers WHERE email = ?').get(email) as Customer | undefined;
  }

  getCustomerByPhone(phone: string): Customer | undefined {
    try {
      const normalized = normalizePhone(phone);
      const local = formatPhoneLocal(normalized);
      return db.prepare('SELECT * FROM customers WHERE phone = ? OR phone = ? LIMIT 1').get(normalized, local) as Customer | undefined;
    } catch {
      return db.prepare('SELECT * FROM customers WHERE phone = ? LIMIT 1').get(phone) as Customer | undefined;
    }
  }

  createCustomer(name: string, phone: string, email: string, passwordHash: string): Customer {
    let normalized = phone;
    try {
      normalized = normalizePhone(phone);
    } catch {
      // Fallback to raw if not valid Indian mobile
    }

    const result = db.prepare(`
      INSERT INTO customers (name, phone, email, password_hash)
      VALUES (?, ?, ?, ?)
    `).run(name, normalized, email, passwordHash);

    return this.getCustomerById(result.lastInsertRowid as number)!;
  }

  updateCustomerProfile(id: number, name: string, phone: string, email: string): void {
    let normalized = phone;
    try {
      normalized = normalizePhone(phone);
    } catch {
      // Fallback
    }

    db.prepare(`
      UPDATE customers 
      SET name = ?, phone = ?, email = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(name, normalized, email, id);
  }

  upgradeGuestCustomer(id: number, name: string, email: string, passwordHash: string): boolean {
    const result = db.prepare(`
      UPDATE customers 
      SET name = ?, email = ?, password_hash = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND password_hash IS NULL
    `).run(name, email, passwordHash, id);
    return result.changes > 0;
  }

  getAddresses(customerId: number): CustomerAddress[] {
    return db.prepare('SELECT * FROM customer_addresses WHERE customer_id = ? ORDER BY is_default DESC, id DESC').all(customerId) as CustomerAddress[];
  }

  getAddressById(addressId: number): CustomerAddress | undefined {
    return db.prepare('SELECT * FROM customer_addresses WHERE id = ?').get(addressId) as CustomerAddress | undefined;
  }

  addAddress(data: { customer_id: number, label: string, recipient_name: string, phone: string, address_line1: string, address_line2?: string, landmark?: string, city: string, state: string, pincode: string, is_default?: number }): number {
    if (data.is_default) {
      db.prepare('UPDATE customer_addresses SET is_default = 0 WHERE customer_id = ?').run(data.customer_id);
    }
    
    const result = db.prepare(`
      INSERT INTO customer_addresses (
        customer_id, label, recipient_name, phone, address_line1, address_line2, landmark, city, state, pincode, is_default
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.customer_id, data.label, data.recipient_name, data.phone, data.address_line1, data.address_line2 || '', data.landmark || '', data.city, data.state, data.pincode, data.is_default ? 1 : 0
    );

    return result.lastInsertRowid as number;
  }

  setDefaultAddress(customerId: number, addressId: number): void {
    db.prepare('UPDATE customer_addresses SET is_default = 0 WHERE customer_id = ?').run(customerId);
    db.prepare('UPDATE customer_addresses SET is_default = 1 WHERE id = ? AND customer_id = ?').run(addressId, customerId);
  }

  deleteAddress(customerId: number, addressId: number): void {
    db.prepare('DELETE FROM customer_addresses WHERE id = ? AND customer_id = ?').run(addressId, customerId);
  }
}

export const customerRepository = new CustomerRepository();
