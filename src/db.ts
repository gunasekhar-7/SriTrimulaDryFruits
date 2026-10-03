import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, '../database.json');

export interface User {
  id: number;
  username: string;
  password: string;
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
  category?: string; // e.g. "Dry Fruits", "Millets"
  image_url?: string; // URL or static path to product image
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

export interface HeldBill {
  time: string;
  total: number;
  cart_items: CartItem[];
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

export class InMemoryDb {
  users: User[] = [
    { id: 1, username: 'admin', password: 'admin', role: 'admin' },
    { id: 2, username: 'staff', password: 'staff', role: 'staff' }
  ];

  products: Product[] = [
    { id: 1, name: 'Almonds Premium', barcode: '1001', cost_price: 700, selling_price: 850, mrp: 999, total_qty: 50, sold_qty: 0, category: 'Dry Fruits', tax_rate: 0 },
    { id: 2, name: 'Cashews W210', barcode: '1002', cost_price: 800, selling_price: 950, mrp: 1100, total_qty: 40, sold_qty: 0, category: 'Dry Fruits', tax_rate: 0 },
    { id: 3, name: 'Pistachios Roasted', barcode: '1003', cost_price: 950, selling_price: 1100, mrp: 1300, total_qty: 30, sold_qty: 0, category: 'Dry Fruits', tax_rate: 0 },
    { id: 4, name: 'Raisins Golden', barcode: '1004', cost_price: 250, selling_price: 320, mrp: 400, total_qty: 100, sold_qty: 0, category: 'Dry Fruits', tax_rate: 0 },
    { id: 5, name: 'Walnuts Akhrot', barcode: '1005', cost_price: 850, selling_price: 1050, mrp: 1250, total_qty: 25, sold_qty: 0, category: 'Dry Fruits', tax_rate: 0 },
    { id: 6, name: 'Premium Dates', barcode: '1006', cost_price: 300, selling_price: 450, mrp: 550, total_qty: 60, sold_qty: 0, category: 'Dry Fruits', tax_rate: 0 },
    { id: 7, name: 'Dried Figs', barcode: '1007', cost_price: 600, selling_price: 750, mrp: 900, total_qty: 35, sold_qty: 0, category: 'Dry Fruits', tax_rate: 0 },
    { id: 8, name: 'Dried Apricots', barcode: '1008', cost_price: 450, selling_price: 550, mrp: 650, total_qty: 45, sold_qty: 0, category: 'Dry Fruits', tax_rate: 0 }
  ];

  bills: Bill[] = [];
  sales: Sale[] = [];

  private userIdCounter = 3;
  private productIdCounter = 9;
  private billIdCounter = 1;
  private saleIdCounter = 1;

  constructor() {
    this.load();
  }

  private save() {
    try {
      const data = {
        users: this.users,
        products: this.products,
        bills: this.bills,
        sales: this.sales,
        userIdCounter: this.userIdCounter,
        productIdCounter: this.productIdCounter,
        billIdCounter: this.billIdCounter,
        saleIdCounter: this.saleIdCounter,
      };
      fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      console.error('Error saving database.json:', e);
    }
  }

  private load() {
    try {
      if (fs.existsSync(dbPath)) {
        const fileContent = fs.readFileSync(dbPath, 'utf8');
        const data = JSON.parse(fileContent);
        if (data.users) this.users = data.users;
        if (data.products) this.products = data.products;
        if (data.bills) this.bills = data.bills;
        if (data.sales) this.sales = data.sales;
        if (data.userIdCounter) this.userIdCounter = data.userIdCounter;
        if (data.productIdCounter) this.productIdCounter = data.productIdCounter;
        if (data.billIdCounter) this.billIdCounter = data.billIdCounter;
        if (data.saleIdCounter) this.saleIdCounter = data.saleIdCounter;
      } else {
        this.save();
      }
    } catch (e) {
      console.error('Error loading database.json:', e);
    }
  }

  // Users
  getUsers() { return this.users; }
  getUserById(id: number) { return this.users.find(u => u.id === id); }
  getUserByUsername(username: string) { return this.users.find(u => u.username === username); }
  updateUser(id: number, username: string, password: string) {
    const user = this.users.find(u => u.id === id);
    if (user) {
      const existing = this.users.find(u => u.username === username && u.id !== id);
      if (existing) throw new Error('Username already taken');
      user.username = username;
      user.password = password;
      this.save();
      return user;
    }
    return null;
  }

  // Products
  getProducts() { return this.products; }
  getProductById(id: number) { return this.products.find(p => p.id === id); }
  getProductByBarcode(barcode: string) { return this.products.find(p => p.barcode === barcode); }
  
  addProduct(name: string, barcode: string, total_qty: number, cost_price: number, selling_price: number, mrp: number, category = 'Dry Fruits', image_url?: string, tax_rate = 0) {
    const existing = this.products.find(p => p.barcode === barcode);
    if (existing) throw new Error('Barcode already exists');
    const newProduct: Product = {
      id: this.productIdCounter++,
      name,
      barcode,
      total_qty,
      sold_qty: 0,
      cost_price,
      selling_price,
      mrp,
      category,
      image_url,
      tax_rate
    };
    this.products.push(newProduct);
    this.save();
    return newProduct;
  }

  updateProduct(id: number, name: string, barcode: string, total_qty: number, cost_price: number, selling_price: number, mrp: number, category = 'Dry Fruits', image_url?: string, tax_rate = 0) {
    const p = this.products.find(prod => prod.id === id);
    if (p) {
      const existing = this.products.find(prod => prod.barcode === barcode && prod.id !== id);
      if (existing) throw new Error('Barcode already exists');
      p.name = name;
      p.barcode = barcode;
      p.total_qty = total_qty;
      p.cost_price = cost_price;
      p.selling_price = selling_price;
      p.mrp = mrp;
      p.category = category;
      p.image_url = image_url;
      p.tax_rate = tax_rate;
      this.save();
      return p;
    }
    return null;
  }

  addStock(id: number, qty: number, imageUrl?: string) {
    const p = this.products.find(prod => prod.id === id);
    if (p) {
      p.total_qty += qty;
      if (imageUrl !== undefined) {
        p.image_url = imageUrl;
      }
      this.save();
      return p;
    }
    return null;
  }

  deleteProduct(id: number) {
    this.products = this.products.filter(p => p.id !== id);
    this.save();
  }

  // Bills & Sales
  getBills() { return this.bills; }
  getBillById(id: number) { return this.bills.find(b => b.id === id); }
  getSales() { return this.sales; }
  getSalesByBillId(billId: number) { return this.sales.filter(s => s.bill_id === billId); }
  getSaleById(id: number) { return this.sales.find(s => s.id === id); }

  createBill(dateStr: string, timeStr: string, items: CartItem[], customer_name = '', customer_phone = '', discount_amount = 0, payment_method = 'Cash', shift_id: number | null = null) {
    const subtotal = items.reduce((sum, item) => sum + item.total, 0);
    const totalAmount = Math.max(0, subtotal - discount_amount);
    const billId = this.billIdCounter++;
    const newBill: Bill = {
      id: billId,
      bill_date: dateStr,
      bill_time: timeStr,
      total_amount: totalAmount,
      customer_name,
      customer_phone,
      discount_amount,
      payment_method,
      shift_id
    };
    this.bills.push(newBill);

    let totalDiscountDistributed = 0;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const product = this.getProductById(item.id);
      if (product) {
        product.sold_qty = (product.sold_qty || 0) + item.qty;
      }
      
      const itemRatio = subtotal > 0 ? (item.total / subtotal) : (1 / items.length);
      const itemDiscount = (i === items.length - 1)
        ? (discount_amount - totalDiscountDistributed)
        : Math.round(discount_amount * itemRatio * 100) / 100;
      totalDiscountDistributed += itemDiscount;

      const baseProfit = (item.price - item.cost) * item.qty;
      const profit = Math.max(0, baseProfit - itemDiscount);

      const sale: Sale = {
        id: this.saleIdCounter++,
        bill_id: billId,
        product_id: item.id,
        qty_sold: item.qty,
        profit_made: profit,
        sale_date: dateStr,
        unit_price: item.price
      };
      this.sales.push(sale);
    }

    this.save();
    return newBill;
  }

  returnItem(billId: number, saleId: number, productId: number, returnQty: number) {
    const bill = this.getBillById(billId);
    const sale = this.getSaleById(saleId);
    const product = this.getProductById(productId);

    if (bill && sale && product && returnQty > 0 && returnQty <= sale.qty_sold) {
      const refundAmount = returnQty * sale.unit_price;
      const profitDeduction = returnQty * (sale.unit_price - product.cost_price);

      product.sold_qty -= returnQty;
      sale.qty_sold -= returnQty;
      sale.profit_made -= profitDeduction;

      if (sale.qty_sold <= 0) {
        this.sales = this.sales.filter(s => s.id !== saleId);
      }

      bill.total_amount -= refundAmount;
      this.save();
      return true;
    }
    return false;
  }

  updateProfitForBill(billId: number, newProfitTotal: number) {
    const billSales = this.getSalesByBillId(billId);
    if (billSales.length > 0) {
      const currentSum = billSales.reduce((sum, s) => sum + s.profit_made, 0);
      const diff = newProfitTotal - currentSum;
      billSales[0].profit_made += diff;
      this.save();
      return true;
    }
    return false;
  }
}

export const db = new InMemoryDb();
