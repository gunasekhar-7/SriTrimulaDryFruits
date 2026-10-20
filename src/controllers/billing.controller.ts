import { Request, Response } from 'express';
import { z } from 'zod';
import db from '../database.js';
import { billingService } from '../services/billing.service.js';
import { orderService } from '../services/order.service.js';
import { productService } from '../services/product.service.js';
import { billRepository } from '../repositories/bill.repository.js';
import { saleRepository } from '../repositories/sale.repository.js';
import { onlineOrderRepository } from '../repositories/online_order.repository.js';
import * as repo from '../repository.js';
import logger from '../logger.js';
import { metricsAggregator } from '../observability/index.js';

const addItemSchema = z.object({
  barcode: z.string().optional(),
  name: z.string().optional(),
  mrp: z.string().optional(),
  price: z.string().optional(),
  qty: z.string().transform(v => parseFloat(v) || 1.0),
});

export class BillingController {
  getSell(req: Request, res: Response) {
    const cart = req.session.cart || [];
    const grandTotal = cart.reduce((sum: number, item: any) => sum + (item.total || 0), 0);
    const held_bills = req.session.held_bills || [];
    const customer_name = (req.session as any).posCustomerName || '';
    const customer_phone = (req.session as any).posCustomerPhone || '';
    const currentShift = res.locals.currentShift || (req.session?.user_id ? repo.getOpenShiftByUserId(req.session.user_id) : undefined);
    res.render('sell', { 
      cart, 
      total: grandTotal, 
      error: null, 
      held_bills, 
      customer_name, 
      customer_phone, 
      currentShift,
      csrfToken: res.locals.csrfToken 
    });
  }

  postSell(req: Request, res: Response) {
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

    const product = barcode ? productService.getProductByBarcode(barcode) : null;
    const grandTotal = cart.reduce((sum: number, item: any) => sum + (item.total || 0), 0);

    if (product) {
      const available_stock = Math.max(0, product.total_qty - (product.sold_qty || 0) - (product.reserved_qty || 0));
      const final_name = custom_name || product.name;
      let final_mrp = custom_mrp ? parseFloat(custom_mrp) : (product.mrp || 0);
      let final_price = custom_price ? parseFloat(custom_price) : product.selling_price;
      if (isNaN(final_mrp)) final_mrp = product.mrp || 0;
      if (isNaN(final_price)) final_price = product.selling_price;

      const current_cart_qty = cart
        .filter((item: any) => item.id === product.id)
        .reduce((sum: number, item: any) => sum + item.qty, 0);

      if ((current_cart_qty + input_qty) > available_stock) {
        metricsAggregator.recordStockOut(product.name, 'offline');
        return res.render('sell', {
          cart, total: grandTotal, held_bills,
          error: `Stock Limit: Only ${available_stock} available.`,
          csrfToken: res.locals.csrfToken
        });
      }

      cart.push({ id: product.id, name: final_name, qty: input_qty, price: final_price, mrp: final_mrp, cost: product.cost_price, total: final_price * input_qty, tax_rate: product.tax_rate });
      req.session.cart = cart;
      return res.redirect('/sell');
    } else {
      return res.render('sell', {
        cart, total: grandTotal, held_bills,
        error: 'Product not found!',
        csrfToken: res.locals.csrfToken
      });
    }
  }

  updateCartItem(req: Request, res: Response) {
    const index = parseInt(req.params.index);
    const cart = req.session.cart || [];
    if (index >= 0 && index < cart.length) {
      const new_qty = parseFloat(req.body.qty);
      if (!isNaN(new_qty) && new_qty >= 0.001) {
        const item = cart[index];
        const product = productService.getProductById(item.id);
        if (product) {
          const available_stock = Math.max(0, product.total_qty - (product.sold_qty || 0) - (product.reserved_qty || 0) + item.qty);
          if (new_qty <= available_stock) {
            item.qty = new_qty;
            item.total = item.price * new_qty;
            req.session.cart = cart;
          } else {
            metricsAggregator.recordStockOut(product.name, 'offline');
            req.flash('info', `Stock Limit: Only ${available_stock} available.`);
          }
        }
      }
    }
    res.redirect('/sell');
  }

  deleteCartItem(req: Request, res: Response) {
    const index = parseInt(req.params.index);
    const cart = req.session.cart || [];
    if (index >= 0 && index < cart.length) {
      cart.splice(index, 1);
      req.session.cart = cart;
    }
    res.redirect('/sell');
  }

  clearCart(req: Request, res: Response) {
    req.session.cart = [];
    res.redirect('/sell');
  }

  holdBill(req: Request, res: Response) {
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
  }

  resumeBill(req: Request, res: Response) {
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
  }

  discardHeldBill(req: Request, res: Response) {
    const index = parseInt(req.params.index);
    const held_bills = req.session.held_bills || [];
    if (index >= 0 && index < held_bills.length) {
      held_bills.splice(index, 1);
      req.session.held_bills = held_bills;
    }
    res.redirect('/sell');
  }

  finalizeBill(req: Request, res: Response) {
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
      const newBill = billingService.createBill(dateStr, timeStr, cart, customer_name, customer_phone, discount_amount, payment_method, shift_id);
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
  }

  getBillById(req: Request, res: Response) {
    const billId = parseInt(req.params.id, 10);
    if (isNaN(billId)) {
      return res.status(404).render('error', {
        statusCode: 404,
        title: 'Bill Not Found',
        message: 'The requested bill ID is invalid.'
      });
    }

    const bill = billRepository.getBillById(billId);
    if (!bill) {
      return res.status(404).render('error', {
        statusCode: 404,
        title: 'Bill Not Found',
        message: `Bill #${billId} could not be found.`
      });
    }

    const sales = saleRepository.getSalesByBillId(billId);
    const items = sales.map(sale => {
      const prod = productService.getProductById(sale.product_id);
      return {
        sale_id: sale.id,
        product_id: sale.product_id,
        name: prod ? prod.name : 'Unknown Product',
        qty: sale.qty_sold,
        price: sale.unit_price,
        mrp: prod ? (prod.mrp || sale.unit_price) : sale.unit_price,
        tax_rate: prod ? (prod.tax_rate || 5) : 5,
        total: sale.qty_sold * sale.unit_price
      };
    });

    res.render('bill', {
      items,
      total: bill.total_amount,
      subtotal: bill.total_amount + (bill.discount_amount || 0),
      discount_amount: bill.discount_amount || 0,
      customer_name: bill.customer_name || '',
      customer_phone: bill.customer_phone || '',
      date: bill.bill_date,
      time: bill.bill_time,
      sale_id: bill.id,
      payment_method: bill.payment_method || 'Cash',
      allow_return: true,
      csrfToken: res.locals.csrfToken
    });
  }

  getPendingPickups(req: Request, res: Response) {
    try {
      const orders = db.prepare(`
        SELECT o.id, o.order_number, o.customer_id, o.total_amount, o.status, o.created_at,
               c.name as customer_name, c.phone as customer_phone
        FROM online_orders o
        JOIN customers c ON o.customer_id = c.id
        WHERE (o.delivery_type = 'STORE_PICKUP' OR o.delivery_type = 'PICKUP') AND o.status NOT IN ('COMPLETED', 'CANCELLED')
        ORDER BY o.id DESC
      `).all() as any[];

      const ordersWithItems = orders.map(ord => {
        const items = onlineOrderRepository.getOrderItems(ord.id);
        return {
          ...ord,
          itemsCount: items.length,
          items: items.map(i => ({
            product_id: i.product_id,
            product_name: i.product_name,
            quantity: i.quantity,
            unit_price: i.unit_price,
            total_price: i.total_price
          }))
        };
      });

      res.json({ success: true, orders: ordersWithItems });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  loadOrderToCart(req: Request, res: Response) {
    const orderId = parseInt(req.params.id, 10);
    if (isNaN(orderId)) {
      return res.status(400).json({ success: false, error: 'Invalid order ID' });
    }

    const order = onlineOrderRepository.getOrderById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    const orderItems = onlineOrderRepository.getOrderItems(orderId);
    if (!req.session.cart) req.session.cart = [];

    for (const item of orderItems) {
      const p = productService.getProductById(item.product_id);
      if (!p) continue;
      const qty = item.quantity;

      const existing = req.session.cart.find((c: any) => c.id === p.id);
      if (existing) {
        existing.qty += qty;
        existing.total = existing.qty * existing.price;
      } else {
        req.session.cart.push({
          id: p.id,
          name: p.name,
          barcode: p.barcode,
          mrp: p.mrp || p.selling_price,
          price: item.unit_price || p.selling_price,
          cost: p.cost_price,
          qty,
          total: qty * (item.unit_price || p.selling_price),
          tax_rate: p.tax_rate || 5
        });
      }
    }

    const customer = db.prepare('SELECT name, phone FROM customers WHERE id = ?').get(order.customer_id) as any;
    (req.session as any).posCustomerName = customer ? customer.name : '';
    (req.session as any).posCustomerPhone = customer ? customer.phone : '';
    (req.session as any).posOrderId = order.id;

    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({
        success: true,
        loadedItems: orderItems.length,
        customerName: customer?.name || '',
        customerPhone: customer?.phone || ''
      });
    }

    res.redirect('/sell');
  }

  async completeSaleApi(req: Request, res: Response) {
    const shift = res.locals.currentShift || (req.session?.user_id ? repo.getOpenShiftByUserId(req.session.user_id) : undefined);
    if (!shift) {
      return res.status(403).json({ success: false, error: { code: 'SHIFT_REQUIRED', message: 'Active shift required' } });
    }

    const items = req.body.cart || req.session.cart || [];
    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, error: { code: 'EMPTY_CART', message: 'Cart is empty' } });
    }

    const today = new Date();
    const dateStr = today.toISOString().split('T')[0];
    const timeStr = today.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

    const customer_name = req.body.customer_name || (req.session as any)?.posCustomerName || '';
    const customer_phone = req.body.customer_phone || (req.session as any)?.posCustomerPhone || '';
    const payment_method = req.body.payment_method || 'Cash';
    let discount_amount = parseFloat(req.body.discount_amount || '0');
    if (isNaN(discount_amount) || discount_amount < 0) discount_amount = 0;

    const subtotal = items.reduce((sum: number, i: any) => sum + (i.total || 0), 0);
    const finalTotal = Math.max(0, subtotal - discount_amount);

    try {
      const posOrderId = (req.session as any)?.posOrderId;
      const saleTx = db.transaction(() => {
        if (posOrderId) {
          orderService.updateOrderStatus(posOrderId, 'COMPLETED', req.session.user || 'POS Cashier', { isPosConversion: true });
        }
        return billingService.createBill(
          dateStr, timeStr, items, customer_name, customer_phone, discount_amount, payment_method, shift.id
        );
      });

      const newBill = saleTx();

      req.session.cart = [];
      delete (req.session as any).posCustomerName;
      delete (req.session as any).posCustomerPhone;
      delete (req.session as any).posOrderId;

      res.json({
        success: true,
        data: {
          bill_id: newBill.id,
          total: finalTotal,
          subtotal,
          discount_amount,
          payment_method,
          customer_name,
          date: dateStr,
          time: timeStr
        }
      });
    } catch (err: any) {
      res.status(400).json({ success: false, error: { message: err.message } });
    }
  }
}

export const billingController = new BillingController();
