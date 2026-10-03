import db from './database.js';
import bcrypt from 'bcryptjs';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface User {
  id: number;
  username: string;
  password_hash: string;
  role: 'admin' | 'staff';
}

export interface Product {
  id: number;
  name: string;
  barcode: string;
  cost_price: number;
  selling_price: number;
  mrp: number;
  total_qty: number;
  sold_qty: number;
  category: string;
  image_url?: string;
  tax_rate: number;
}

export interface Bill {
  id: number;
  bill_date: string;
  bill_time: string;
  total_amount: number;
  customer_name?: string;
  customer_phone?: string;
  discount_amount?: number;
  payment_method?: string;
  shift_id?: number | null;
}

export interface Sale {
  id: number;
  bill_id: number;
  product_id: number;
  qty_sold: number;
  profit_made: number;
  sale_date: string;
  unit_price: number;
}

export interface Shift {
  id: number;
  user_id: number;
  opening_time: string;
  closing_time: string | null;
  opening_cash: number;
  expected_closing_cash: number | null;
  actual_closing_cash: number | null;
  status: 'open' | 'closed';
}

export interface CartItem {
  id: number;
  name: string;
  qty: number;
  price: number;
  mrp: number;
  cost: number;
  total: number;
  tax_rate: number;
}

// ─── Seed default data if empty ─────────────────────────────────────────────

function seedDefaults() {
  const userCount = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
  if (userCount === 0) {
    const adminHash = bcrypt.hashSync('admin123', 10);
    const staffHash = bcrypt.hashSync('staff123', 10);
    db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run('admin', adminHash, 'admin');
    db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run('staff', staffHash, 'staff');
    console.log('✅ Default users created: admin/admin123 and staff/staff123 — CHANGE THESE IN PRODUCTION!');
  }

  const productCount = (db.prepare('SELECT COUNT(*) as c FROM products').get() as { c: number }).c;
  if (productCount === 0) {
    const seedProducts = [
      { name: 'Almonds Premium', barcode: '1001', cost_price: 700, selling_price: 850, mrp: 999, total_qty: 50, category: 'Dry Fruits' },
      { name: 'Cashews W210', barcode: '1002', cost_price: 800, selling_price: 950, mrp: 1100, total_qty: 40, category: 'Dry Fruits' },
      { name: 'Pistachios Roasted', barcode: '1003', cost_price: 950, selling_price: 1100, mrp: 1300, total_qty: 30, category: 'Dry Fruits' },
      { name: 'Raisins Golden', barcode: '1004', cost_price: 250, selling_price: 320, mrp: 400, total_qty: 100, category: 'Dry Fruits' },
      { name: 'Walnuts Akhrot', barcode: '1005', cost_price: 850, selling_price: 1050, mrp: 1250, total_qty: 25, category: 'Dry Fruits' },
      { name: 'Premium Dates', barcode: '1006', cost_price: 300, selling_price: 450, mrp: 550, total_qty: 60, category: 'Dry Fruits' },
      { name: 'Dried Figs', barcode: '1007', cost_price: 600, selling_price: 750, mrp: 900, total_qty: 35, category: 'Dry Fruits' },
      { name: 'Dried Apricots', barcode: '1008', cost_price: 450, selling_price: 550, mrp: 650, total_qty: 45, category: 'Dry Fruits' },
    ];
    const insert = db.prepare('INSERT INTO products (name, barcode, cost_price, selling_price, mrp, total_qty, sold_qty, category) VALUES (?, ?, ?, ?, ?, ?, 0, ?)');
    for (const p of seedProducts) {
      insert.run(p.name, p.barcode, p.cost_price, p.selling_price, p.mrp, p.total_qty, p.category);
    }
  }
}

seedDefaults();

// ─── Users ──────────────────────────────────────────────────────────────────

export function getUsers(): User[] {
  return db.prepare('SELECT * FROM users').all() as User[];
}

export function getUserById(id: number): User | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;
}

export function getUserByUsername(username: string): User | undefined {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username) as User | undefined;
}

export function updateUser(id: number, username: string, password: string): User {
  const existing = db.prepare('SELECT * FROM users WHERE username = ? AND id != ?').get(username, id);
  if (existing) throw new Error('Username already taken');
  const passwordHash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE users SET username = ?, password_hash = ? WHERE id = ?').run(username, passwordHash, id);
  return getUserById(id)!;
}

export function verifyPassword(plainText: string, hash: string): boolean {
  return bcrypt.compareSync(plainText, hash);
}

// ─── Products ────────────────────────────────────────────────────────────────

export function getProducts(): Product[] {
  return db.prepare('SELECT * FROM products ORDER BY name ASC').all() as Product[];
}

export function getProductById(id: number): Product | undefined {
  return db.prepare('SELECT * FROM products WHERE id = ?').get(id) as Product | undefined;
}

export function getProductByBarcode(barcode: string): Product | undefined {
  return db.prepare('SELECT * FROM products WHERE barcode = ?').get(barcode) as Product | undefined;
}

export function addProduct(name: string, barcode: string, total_qty: number, cost_price: number, selling_price: number, mrp: number, category = 'Dry Fruits', image_url = '', tax_rate = 0): Product {
  const existing = db.prepare('SELECT id FROM products WHERE barcode = ?').get(barcode);
  if (existing) throw new Error('Barcode already exists');
  const result = db.prepare(
    'INSERT INTO products (name, barcode, total_qty, sold_qty, cost_price, selling_price, mrp, category, image_url, tax_rate) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?)'
  ).run(name, barcode, total_qty, cost_price, selling_price, mrp, category, image_url, tax_rate);
  return getProductById(result.lastInsertRowid as number)!;
}

export function updateProduct(id: number, name: string, barcode: string, total_qty: number, cost_price: number, selling_price: number, mrp: number, category = 'Dry Fruits', image_url = '', tax_rate = 0): Product {
  const existing = db.prepare('SELECT id FROM products WHERE barcode = ? AND id != ?').get(barcode, id);
  if (existing) throw new Error('Barcode already exists');
  db.prepare(
    'UPDATE products SET name=?, barcode=?, total_qty=?, cost_price=?, selling_price=?, mrp=?, category=?, image_url=?, tax_rate=? WHERE id=?'
  ).run(name, barcode, total_qty, cost_price, selling_price, mrp, category, image_url, tax_rate, id);
  return getProductById(id)!;
}

export function addStock(id: number, qty: number, imageUrl?: string): Product {
  if (imageUrl !== undefined) {
    db.prepare('UPDATE products SET total_qty = total_qty + ?, image_url = ? WHERE id = ?').run(qty, imageUrl, id);
  } else {
    db.prepare('UPDATE products SET total_qty = total_qty + ? WHERE id = ?').run(qty, id);
  }
  return getProductById(id)!;
}

export function deleteProduct(id: number): void {
  db.prepare('DELETE FROM products WHERE id = ?').run(id);
}

// ─── Bills ───────────────────────────────────────────────────────────────────

export function getBills(): Bill[] {
  return db.prepare('SELECT * FROM bills ORDER BY id DESC').all() as Bill[];
}

export function getBillById(id: number): Bill | undefined {
  return db.prepare('SELECT * FROM bills WHERE id = ?').get(id) as Bill | undefined;
}

export function getSales(): Sale[] {
  return db.prepare('SELECT * FROM sales').all() as Sale[];
}

export function getSalesByBillId(billId: number): Sale[] {
  return db.prepare('SELECT * FROM sales WHERE bill_id = ?').all(billId) as Sale[];
}

export function getSaleById(id: number): Sale | undefined {
  return db.prepare('SELECT * FROM sales WHERE id = ?').get(id) as Sale | undefined;
}

// ─── Shifts ─────────────────────────────────────────────────────────────────

export function getOpenShiftByUserId(userId: number): Shift | undefined {
  return db.prepare("SELECT * FROM shifts WHERE user_id = ? AND status = 'open'").get(userId) as Shift | undefined;
}

export function openShift(userId: number, openingCash: number): Shift {
  const existing = getOpenShiftByUserId(userId);
  if (existing) throw new Error('User already has an open shift');
  const now = new Date().toISOString();
  const result = db.prepare(
    "INSERT INTO shifts (user_id, opening_time, opening_cash, status) VALUES (?, ?, ?, 'open')"
  ).run(userId, now, openingCash);
  return db.prepare('SELECT * FROM shifts WHERE id = ?').get(result.lastInsertRowid) as Shift;
}

export function getExpectedClosingCash(shiftId: number): number {
  const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(shiftId) as Shift;
  if (!shift) return 0;
  
  // Calculate total cash sales in this shift
  const cashSales = (db.prepare("SELECT SUM(total_amount) as total FROM bills WHERE shift_id = ? AND payment_method = 'Cash'").get(shiftId) as { total: number | null }).total || 0;
  
  return shift.opening_cash + cashSales;
}

export function closeShift(shiftId: number, actualCash: number): Shift {
  const expectedCash = getExpectedClosingCash(shiftId);
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE shifts SET status = 'closed', closing_time = ?, expected_closing_cash = ?, actual_closing_cash = ? WHERE id = ?"
  ).run(now, expectedCash, actualCash, shiftId);
  return db.prepare('SELECT * FROM shifts WHERE id = ?').get(shiftId) as Shift;
}

// ─── Bills & Sales ──────────────────────────────────────────────────────────

export function createBill(
  dateStr: string,
  timeStr: string,
  items: CartItem[],
  customer_name = '',
  customer_phone = '',
  discount_amount = 0,
  payment_method = 'Cash',
  shift_id: number | null = null
): Bill {
  const subtotal = items.reduce((sum, item) => sum + item.total, 0);
  const totalAmount = Math.max(0, subtotal - discount_amount);

  const createBillAndSales = db.transaction(() => {
    const billResult = db.prepare(
      'INSERT INTO bills (bill_date, bill_time, total_amount, customer_name, customer_phone, discount_amount, payment_method, shift_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(dateStr, timeStr, totalAmount, customer_name, customer_phone, discount_amount, payment_method, shift_id);
    const billId = billResult.lastInsertRowid as number;

    let totalDiscountDistributed = 0;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      db.prepare('UPDATE products SET sold_qty = sold_qty + ? WHERE id = ?').run(item.qty, item.id);

      const itemRatio = subtotal > 0 ? (item.total / subtotal) : (1 / items.length);
      const itemDiscount = (i === items.length - 1)
        ? (discount_amount - totalDiscountDistributed)
        : Math.round(discount_amount * itemRatio * 100) / 100;
      totalDiscountDistributed += itemDiscount;

      const baseProfit = (item.price - item.cost) * item.qty;
      const profit = Math.max(0, baseProfit - itemDiscount);

      db.prepare(
        'INSERT INTO sales (bill_id, product_id, qty_sold, profit_made, sale_date, unit_price) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(billId, item.id, item.qty, profit, dateStr, item.price);
    }

    return getBillById(billId)!;
  });

  try {
    return createBillAndSales();
  } catch (error: any) {
    if (error.code === 'SQLITE_CONSTRAINT_CHECK' || (error.message && error.message.includes('check_inventory'))) {
      throw new Error('Transaction failed: Item out of stock');
    }
    throw error;
  }
}

export function returnItem(billId: number, saleId: number, productId: number, returnQty: number): boolean {
  const bill = getBillById(billId);
  const sale = getSaleById(saleId);
  const product = getProductById(productId);

  if (!bill || !sale || !product || returnQty <= 0 || returnQty > sale.qty_sold) return false;

  const returnTransaction = db.transaction(() => {
    const refundAmount = returnQty * sale.unit_price;
    const profitDeduction = returnQty * (sale.unit_price - product.cost_price);

    db.prepare('UPDATE products SET sold_qty = sold_qty - ? WHERE id = ?').run(returnQty, productId);
    db.prepare('UPDATE bills SET total_amount = total_amount - ? WHERE id = ?').run(refundAmount, billId);

    const newQty = sale.qty_sold - returnQty;
    if (newQty <= 0) {
      db.prepare('DELETE FROM sales WHERE id = ?').run(saleId);
    } else {
      db.prepare('UPDATE sales SET qty_sold = ?, profit_made = profit_made - ? WHERE id = ?').run(newQty, profitDeduction, saleId);
    }
  });

  returnTransaction();
  return true;
}

export function updateProfitForBill(billId: number, newProfitTotal: number): boolean {
  const billSales = getSalesByBillId(billId);
  if (billSales.length === 0) return false;
  const currentSum = billSales.reduce((sum, s) => sum + s.profit_made, 0);
  const diff = newProfitTotal - currentSum;
  db.prepare('UPDATE sales SET profit_made = profit_made + ? WHERE id = ?').run(diff, billSales[0].id);
  return true;
}
