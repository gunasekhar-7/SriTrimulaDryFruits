import express from 'express';
import { z } from 'zod';
import * as repo from '../repository.js';
import { requireAuth, requireShift, csrfProtection } from '../middleware/auth.js';
import logger from '../logger.js';

const router = express.Router();

const addItemSchema = z.object({
  barcode: z.string().optional(),
  name: z.string().optional(),
  mrp: z.string().optional(),
  price: z.string().optional(),
  qty: z.string().transform(v => parseFloat(v) || 1.0),
});

// GET /sell
router.get('/sell', requireShift, csrfProtection, (req, res) => {
  const cart = req.session.cart || [];
  const grandTotal = cart.reduce((sum: number, item: any) => sum + (item.total || 0), 0);
  const held_bills = req.session.held_bills || [];
  res.render('sell', { cart, total: grandTotal, error: null, held_bills, csrfToken: res.locals.csrfToken });
});

// POST /sell — add item to cart
router.post('/sell', requireShift, csrfProtection, (req, res) => {
  if (!req.session.cart) req.session.cart = [];
  const cart = req.session.cart;
  const held_bills = req.session.held_bills || [];

  const parsed = addItemSchema.safeParse(req.body);
  const data = parsed.success ? parsed.data : { barcode: '', name: '', mrp: '', price: '', qty: 1 };

  const barcode = (data.barcode || '').trim();
  const custom_name = (data.name || '').trim();
  const custom_mrp = data.mrp || '';
  const custom_price = data.price || '';
  const input_qty = typeof data.qty === 'number' ? data.qty : 1;

  const product = barcode ? repo.getProductByBarcode(barcode) : null;
  const grandTotal = cart.reduce((sum: number, item: any) => sum + (item.total || 0), 0);

  if (product) {
    const available_stock = product.total_qty - (product.sold_qty || 0);
    const final_name = custom_name || product.name;
    let final_mrp = custom_mrp ? parseFloat(custom_mrp) : (product.mrp || 0);
    let final_price = custom_price ? parseFloat(custom_price) : product.selling_price;
    if (isNaN(final_mrp)) final_mrp = product.mrp || 0;
    if (isNaN(final_price)) final_price = product.selling_price;

    const current_cart_qty = cart
      .filter((item: any) => item.id === product.id)
      .reduce((sum: number, item: any) => sum + item.qty, 0);

    if ((current_cart_qty + input_qty) > available_stock) {
      return res.render('sell', {
        cart, total: grandTotal, held_bills,
        error: `❌ Stock Limit: Only ${available_stock} available.`,
        csrfToken: res.locals.csrfToken
      });
    }

    cart.push({ id: product.id, name: final_name, qty: input_qty, price: final_price, mrp: final_mrp, cost: product.cost_price, total: final_price * input_qty, tax_rate: product.tax_rate });
    req.session.cart = cart;
    return res.redirect('/sell');
  } else {
    return res.render('sell', {
      cart, total: grandTotal, held_bills,
      error: '❌ Product not found!',
      csrfToken: res.locals.csrfToken
    });
  }
});

// POST /update_cart/:index
router.post('/update_cart/:index', requireShift, csrfProtection, (req, res) => {
  const index = parseInt(req.params.index);
  const cart = req.session.cart || [];
  if (index >= 0 && index < cart.length) {
    const new_qty = parseFloat(req.body.qty);
    if (!isNaN(new_qty) && new_qty >= 0.001) {
      const item = cart[index];
      const product = repo.getProductById(item.id);
      if (product) {
        const available_stock = product.total_qty - (product.sold_qty || 0) + item.qty;
        if (new_qty <= available_stock) {
          item.qty = new_qty;
          item.total = item.price * new_qty;
          req.session.cart = cart;
        } else {
          req.flash('info', `❌ Stock Limit: Only ${available_stock} available.`);
        }
      }
    }
  }
  res.redirect('/sell');
});

// POST /delete_item/:index
router.post('/delete_item/:index', requireAuth, csrfProtection, (req, res) => {
  const index = parseInt(req.params.index);
  const cart = req.session.cart || [];
  if (index >= 0 && index < cart.length) {
    cart.splice(index, 1);
    req.session.cart = cart;
  }
  res.redirect('/sell');
});

// POST /clear_cart
router.post('/clear_cart', requireAuth, csrfProtection, (req, res) => {
  req.session.cart = [];
  res.redirect('/sell');
});

// POST /hold_bill
router.post('/hold_bill', requireShift, csrfProtection, (req, res) => {
  const cart = req.session.cart || [];
  if (cart.length > 0) {
    if (!req.session.held_bills) req.session.held_bills = [];
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    req.session.held_bills.push({
      time: timeStr,
      total: cart.reduce((sum: number, i: any) => sum + (i.total || 0), 0),
      cart_items: cart
    });
    req.session.cart = [];
  }
  res.redirect('/sell');
});

// POST /resume_bill/:index
router.post('/resume_bill/:index', requireShift, csrfProtection, (req, res) => {
  const index = parseInt(req.params.index);
  const held_bills = req.session.held_bills || [];
  if (index >= 0 && index < held_bills.length) {
    const current_cart = req.session.cart || [];
    if (current_cart.length > 0) {
      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
      held_bills.push({ time: timeStr, total: current_cart.reduce((s: number, i: any) => s + (i.total || 0), 0), cart_items: current_cart });
    }
    const bill = held_bills.splice(index, 1)[0];
    req.session.cart = bill.cart_items;
    req.session.held_bills = held_bills;
  }
  res.redirect('/sell');
});

// POST /discard_held/:index
router.post('/discard_held/:index', requireShift, csrfProtection, (req, res) => {
  const index = parseInt(req.params.index);
  const held_bills = req.session.held_bills || [];
  if (index >= 0 && index < held_bills.length) {
    held_bills.splice(index, 1);
    req.session.held_bills = held_bills;
  }
  res.redirect('/sell');
});

// POST /finalize_bill
router.post('/finalize_bill', requireShift, csrfProtection, (req, res) => {
  const cart = req.session.cart || [];
  if (cart.length === 0) return res.redirect('/sell');

  const today = new Date();
  const dateStr = today.toISOString().split('T')[0];
  const timeStr = today.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

  const customer_name = req.body.customer_name || '';
  const customer_phone = req.body.customer_phone || '';
  const payment_method = req.body.payment_method || 'Cash';
  let discount_amount = parseFloat(req.body.discount_amount || '0');
  if (isNaN(discount_amount) || discount_amount < 0) discount_amount = 0;

  const subtotal = cart.reduce((sum: number, i: any) => sum + i.total, 0);
  const finalTotal = Math.max(0, subtotal - discount_amount);

  try {
    const shift_id = res.locals.currentShift.id;
    const newBill = repo.createBill(dateStr, timeStr, cart, customer_name, customer_phone, discount_amount, payment_method, shift_id);
    logger.info(`Bill #${newBill.id} created: ₹${finalTotal} by ${req.session.user} on Shift ${shift_id}`);

    req.session.cart = [];
    res.render('bill', {
      items: cart, total: finalTotal, subtotal, discount_amount,
      customer_name, customer_phone, date: dateStr, time: timeStr,
      sale_id: newBill.id, allow_return: false, payment_method
    });
  } catch (error: any) {
    const held_bills = req.session.held_bills || [];
    res.render('sell', {
      cart, total: subtotal, error: error.message, held_bills, csrfToken: res.locals.csrfToken
    });
  }
});

// API: GET /api/products
router.get('/api/products', requireAuth, (req, res) => {
  const products = repo.getProducts().map(p => ({
    id: p.id, name: p.name, barcode: p.barcode, mrp: p.mrp,
    selling_price: p.selling_price,
    available: p.total_qty - (p.sold_qty || 0),
    category: p.category || 'Dry Fruits'
  }));
  res.json(products);
});

// API: GET /get_product_details/:barcode
router.get('/get_product_details/:barcode', requireAuth, (req, res) => {
  const product = repo.getProductByBarcode(req.params.barcode);
  if (product) {
    res.json({ success: true, id: product.id, name: product.name, mrp: product.mrp, selling_price: product.selling_price, available: product.total_qty - (product.sold_qty || 0) });
  } else {
    res.json({ success: false });
  }
});

export default router;
