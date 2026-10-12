// Re-exporting all methods from the new architecture for backward compatibility
import { userRepository } from './repositories/user.repository.js';
import { productRepository } from './repositories/product.repository.js';
import { shiftRepository } from './repositories/shift.repository.js';
import { billRepository } from './repositories/bill.repository.js';
import { saleRepository } from './repositories/sale.repository.js';
import { customerRepository } from './repositories/customer.repository.js';
import { onlineOrderRepository } from './repositories/online_order.repository.js';
import { billingService } from './services/billing.service.js';
import { orderService } from './services/order.service.js';
import bcrypt from 'bcryptjs';

// Types
export * from './types/index.js';

// Seed default data if empty 
// (We should ideally move this to a seeder script, but keeping it here for backward compatibility)
import db from './database.js';
function seedDefaults() {
  const userCount = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
  if (userCount === 0) {
    const adminHash = bcrypt.hashSync('admin123', 10);
    const staffHash = bcrypt.hashSync('staff123', 10);
    db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run('admin', adminHash, 'admin');
    db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run('staff', staffHash, 'staff');
  }

  // Mock products are only seeded if explicitly requested via SEED_MOCK_PRODUCTS=true
  if (process.env.SEED_MOCK_PRODUCTS === 'true') {
    const productCount = (db.prepare('SELECT COUNT(*) as c FROM product_variants').get() as { c: number }).c;
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
      const insert = db.prepare('INSERT INTO product_variants (name, barcode, cost_price, selling_price, mrp, total_qty, sold_qty, category) VALUES (?, ?, ?, ?, ?, ?, 0, ?)');
      for (const p of seedProducts) {
        insert.run(p.name, p.barcode, p.cost_price, p.selling_price, p.mrp, p.total_qty, p.category);
      }
    }
  }
}
seedDefaults();

// Users
export const getUsers = () => userRepository.getUsers();
export const getUserById = (id: number) => userRepository.getUserById(id);
export const getUserByUsername = (username: string) => userRepository.getUserByUsername(username);
export const updateUser = (id: number, username: string, password: string) => {
  if (userRepository.checkUsernameExists(username, id)) throw new Error('Username already taken');
  const hash = bcrypt.hashSync(password, 10);
  userRepository.updateUser(id, username, hash);
  return userRepository.getUserById(id)!;
};
export const verifyPassword = (plainText: string, hash: string) => bcrypt.compareSync(plainText, hash);

// Products
export const getProducts = () => productRepository.getProducts();
export const getProductById = (id: number) => productRepository.getProductById(id);
export const getProductByBarcode = (barcode: string) => productRepository.getProductByBarcode(barcode);
export const addProduct = (name: string, barcode: string, total_qty: number, cost_price: number, selling_price: number, mrp: number, category = 'Dry Fruits', image_url = '', tax_rate = 0) => {
  if (productRepository.checkBarcodeExists(barcode)) throw new Error('Barcode already exists');
  const id = productRepository.addProduct({name, barcode, total_qty, cost_price, selling_price, mrp, category, image_url, tax_rate});
  return productRepository.getProductById(id)!;
};
export const updateProduct = (id: number, name: string, barcode: string, total_qty: number, cost_price: number, selling_price: number, mrp: number, category = 'Dry Fruits', image_url = '', tax_rate = 0) => {
  if (productRepository.checkBarcodeExists(barcode, id)) throw new Error('Barcode already exists');
  productRepository.updateProduct(id, {name, barcode, total_qty, cost_price, selling_price, mrp, category, image_url, tax_rate});
  return productRepository.getProductById(id)!;
};
export const addStock = (id: number, qty: number, imageUrl?: string) => {
  productRepository.addStock(id, qty, imageUrl);
  return productRepository.getProductById(id)!;
};
export const deleteProduct = (id: number) => productRepository.deleteProduct(id);

// Bills
export const getBills = () => billRepository.getBills();
export const getBillById = (id: number) => billRepository.getBillById(id);
export const getSales = () => saleRepository.getSales();
export const getSalesByBillId = (billId: number) => saleRepository.getSalesByBillId(billId);
export const getSaleById = (id: number) => saleRepository.getSaleById(id);

// Shifts
export const getOpenShiftByUserId = (userId: number) => shiftRepository.getOpenShiftByUserId(userId);
export const openShift = (userId: number, openingCash: number) => {
  if (shiftRepository.getOpenShiftByUserId(userId)) throw new Error('User already has an open shift');
  const now = new Date().toISOString();
  const id = shiftRepository.openShift(userId, openingCash, now);
  return shiftRepository.getShiftById(id)!;
};
export const getExpectedClosingCash = (shiftId: number) => {
  const shift = shiftRepository.getShiftById(shiftId);
  if (!shift) return 0;
  const cashSales = shiftRepository.getCashSalesForShift(shiftId);
  return shift.opening_cash + cashSales;
};
export const closeShift = (shiftId: number, actualCash: number) => {
  const expectedCash = getExpectedClosingCash(shiftId);
  const now = new Date().toISOString();
  shiftRepository.closeShift(shiftId, expectedCash, actualCash, now);
  return shiftRepository.getShiftById(shiftId)!;
};

// Billing logic
export const createBill = (d: string, t: string, i: any[], n='', p='', da=0, pm='Cash', sid: number|null=null) => billingService.createBill(d, t, i, n, p, da, pm, sid);
export const returnItem = (b: number, s: number, p: number, q: number) => billingService.returnItem(b, s, p, q);
export const updateProfitForBill = (b: number, np: number) => billingService.updateProfitForBill(b, np);

// Orders
export const findOrCreateCustomer = (phone: string, name: string, address = '', landmark = '', pincode = '') => customerRepository.findOrCreateCustomer(phone, name, address, landmark, pincode);
export const createOnlineOrder = (data: any) => orderService.createOnlineOrder(data);
export const getOnlineOrderById = (id: number) => orderService.getOnlineOrderById(id);
export const getOnlineOrders = (filters?: any) => orderService.getOnlineOrders(filters);
export const updateOrderStatus = (orderId: number, newStatus: string, changedBy: string) => orderService.updateOrderStatus(orderId, newStatus, changedBy);
export const getPendingOnlineOrdersCount = () => onlineOrderRepository.getPendingOrdersCount();
export const markWhatsAppSent = (orderId: number) => onlineOrderRepository.markWhatsAppSent(orderId);
export const getOrderStatusLogs = (orderId: number) => onlineOrderRepository.getStatusLogs(orderId);
