import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../src/database.js';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const jsonPath = path.join(__dirname, '../database.json');

if (!fs.existsSync(jsonPath)) {
  console.log('No database.json found. Skipping migration.');
  process.exit(0);
}

const oldData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

db.transaction(() => {
  // Users
  if (oldData.users) {
    const insertUser = db.prepare('INSERT OR IGNORE INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)');
    for (const u of oldData.users) {
      const hash = bcrypt.hashSync(u.password, 10);
      insertUser.run(u.id, u.username, hash, u.role);
    }
    console.log(`Migrated ${oldData.users.length} users.`);
  }

  // Products
  if (oldData.products) {
    const insertProduct = db.prepare('INSERT OR IGNORE INTO products (id, name, barcode, cost_price, selling_price, mrp, total_qty, sold_qty, category, image_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const p of oldData.products) {
      insertProduct.run(p.id, p.name, p.barcode, p.cost_price, p.selling_price, p.mrp, p.total_qty, p.sold_qty, p.category || 'Dry Fruits', p.image_url || '');
    }
    console.log(`Migrated ${oldData.products.length} products.`);
  }

  // Bills
  if (oldData.bills) {
    const insertBill = db.prepare('INSERT OR IGNORE INTO bills (id, bill_date, bill_time, total_amount, customer_name, customer_phone, discount_amount) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const b of oldData.bills) {
      insertBill.run(b.id, b.bill_date, b.bill_time, b.total_amount, b.customer_name || '', b.customer_phone || '', b.discount_amount || 0);
    }
    console.log(`Migrated ${oldData.bills.length} bills.`);
  }

  // Sales
  if (oldData.sales) {
    const insertSale = db.prepare('INSERT OR IGNORE INTO sales (id, bill_id, product_id, qty_sold, profit_made, sale_date, unit_price) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const s of oldData.sales) {
      insertSale.run(s.id, s.bill_id, s.product_id, s.qty_sold, s.profit_made, s.sale_date, s.unit_price);
    }
    console.log(`Migrated ${oldData.sales.length} sales.`);
  }
})();

console.log('Migration completed successfully.');
