import { Request, Response } from 'express';
import { z } from 'zod';
import { orderService } from '../services/order.service.js';
import { productService } from '../services/product.service.js';
import { customerRepository } from '../repositories/customer.repository.js';
import { onlineOrderRepository } from '../repositories/online_order.repository.js';
import { whatsappService } from '../services/whatsapp.service.js';
import { billingService } from '../services/billing.service.js';
import { shiftService } from '../services/shift.service.js';
import { cartService } from '../services/cart.service.js';
import { idempotencyService } from '../services/idempotency.service.js';
import db from '../database.js';
import crypto from 'crypto';
import logger from '../logger.js';
import { metricsAggregator } from '../observability/index.js';
import { queueService } from '../queue/index.js';
import { seoService } from '../services/seo.service.js';
import { auditService } from '../services/audit.service.js';
import { getEnrichedProductContent } from '../utils/product-content.js';

export const checkoutSchema = z.object({
  name: z.string().min(2).max(60),
  phone: z.string().regex(/^[6-9]\d{9}$/, 'Invalid phone number'),
  address: z.string().optional(),
  landmark: z.string().optional(),
  delivery_type: z.enum(['DELIVERY', 'STORE_PICKUP']),
  payment_mode: z.enum(['COD', 'UPI_QR']),
  notes: z.string().max(300).optional(),
}).refine(data => {
  if (data.delivery_type === 'DELIVERY' && (!data.address || data.address.trim() === '')) {
    return false;
  }
  return true;
}, {
  message: "Address is required for HOME DELIVERY",
  path: ["address"]
});

export class StoreController {
  getCheckoutView(req: Request, res: Response) {
    let cartData;
    if (req.session.customer_id) {
      cartData = cartService.getCart(req.session.customer_id);
    } else {
      cartData = cartService.validateSessionCart(req.session.cart || []);
    }

    if (!cartData || cartData.items.length === 0) {
      req.flash('error', 'Your cart is empty');
      return res.redirect('/');
    }

    let customer = null;
    let addresses: any[] = [];
    if (req.session.customer_id) {
      customer = customerRepository.getCustomerById(req.session.customer_id);
      addresses = customerRepository.getAddresses(req.session.customer_id);
    }

    res.render('checkout', {
      title: 'Checkout',
      cart: cartData,
      customer,
      addresses,
      csrfToken: res.locals.csrfToken
    });
  }

  async checkout(req: Request, res: Response) {
    metricsAggregator.recordCheckoutAttempt('online');
    try {
      const parsed = checkoutSchema.parse(req.body);
      
      const formattedPhone = '91' + parsed.phone;
      
      const customer = customerRepository.findOrCreateCustomer(
        formattedPhone,
        parsed.name,
        parsed.address || '',
        parsed.landmark || '',
        ''
      );
      
      // Get cart
      let cartData;
      if (req.session.customer_id) {
        cartData = cartService.getCart(req.session.customer_id);
      } else {
        cartData = cartService.validateSessionCart(req.session.cart || []);
      }
      
      if (!cartData || !cartData.items || cartData.items.length === 0) {
        return res.status(400).json({ message: "Cart is empty or items unavailable." });
      }

      const validatedItems: any[] = [];
      const messageItems: any[] = [];
      
      for (let i = 0; i < cartData.items.length; i++) {
        const item = cartData.items[i];
        if (!item.available) continue;
        
        const total_price = item.price * item.qty;
        
        validatedItems.push({ product_id: item.id, quantity: item.qty });
        messageItems.push(`${i + 1}. ${item.name} × ${item.qty} = ₹${total_price}`);
      }
      
      if (validatedItems.length === 0) {
        return res.status(400).json({ message: "No valid items in cart." });
      }
      
      const subtotal = cartData.subtotal;
      const delivery_charge = (parsed.delivery_type === 'STORE_PICKUP' || subtotal >= 500) ? 0 : 50;
      const discount = 0;
      const total_amount = subtotal + delivery_charge - discount;
      
      const idempotencyKey = (req.headers['idempotency-key'] as string) || crypto.createHash('md5').update(JSON.stringify(req.body) + customer.id).digest('hex');

      const action = async () => {
        let order;
        try {
          order = orderService.createOnlineOrder({
            customer_id: customer.id,
            items: validatedItems,
            payment_mode: parsed.payment_mode,
            delivery_type: parsed.delivery_type,
            delivery_charge,
            discount,
            notes: parsed.notes || '',
          });
        } catch (e: any) {
          if (e.message && e.message.includes('Insufficient stock')) {
            return { status: 409, body: { message: e.message } };
          }
          throw e;
        }

        const whatsappUrl = whatsappService.generateCheckoutMessageUrl(order, parsed, messageItems, subtotal, delivery_charge, total_amount);

        if (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true') {
          await queueService.processNextBatch();
        }

        // Clear cart after checkout
        cartService.clearCart((cartData as any).cart?.id);

        return { status: 201, body: { order: order as any, whatsapp_url: whatsappUrl, success: true, redirect: req.session.customer_id ? '/account/orders' : '/' } as any };
      };

      const result = await idempotencyService.executeAsync(idempotencyKey, 'checkout', action);
      res.status(result.status).json(result.body);
    } catch (error: any) {
      if (error.message === 'Concurrent request in progress') {
        return res.status(409).json({ message: "Request already in progress. Please wait." });
      }
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: (error as any).errors });
      }
      logger.error('Checkout error:', error);
      res.status(500).json({ message: "Internal server error" });
    }
  }

  getPendingCount(req: Request, res: Response) {
    try {
      const count = onlineOrderRepository.getPendingOrdersCount();
      res.json({ count });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  getOnlineOrdersAdmin(req: Request, res: Response) {
    const status = req.query.status as string;
    const search = req.query.search as string;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    const page = parseInt(req.query.page as string) || 1;
    const limit = 50;
    const offset = (page - 1) * limit;

    const filters: any = { limit, offset };
    if (status && status !== 'ALL') filters.status = status;
    if (search) filters.search = search;
    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;

    const orders = orderService.getOnlineOrders(filters);
    const pendingCount = onlineOrderRepository.getPendingOrdersCount();

    const todayIso = new Date(new Date().getTime() + 5.5 * 3600000).toISOString().split('T')[0];
    const allOrders = orderService.getOnlineOrders();
    const todayOrders = allOrders.filter(o => o.created_at.startsWith(todayIso));
    const todayRevenue = todayOrders.filter(o => o.status !== 'CANCELLED').reduce((sum, o) => sum + o.total_amount, 0);

    res.render('online_orders', {
      title: 'Online Orders',
      orders,
      currentFilter: status || 'ALL',
      search: search || '',
      startDate: startDate || '',
      endDate: endDate || '',
      pendingCount,
      todayOrderCount: todayOrders.length,
      todayRevenue
    });
  }

  getOnlineOrderDetailAdmin(req: Request, res: Response) {
    const orderId = parseInt(req.params.id);
    const order = orderService.getOnlineOrderById(orderId);
    if (!order) {
      (req as any).flash('error', 'Order not found');
      return res.redirect('/admin/online-orders');
    }

    const logs = onlineOrderRepository.getStatusLogs(orderId);

    res.render('order_detail', {
      title: `Order #${order.order_number}`,
      order,
      logs
    });
  }

  updateOrderStatusAdmin(req: Request, res: Response) {
    const orderId = parseInt(req.params.id);
    const newStatus = req.body.new_status;
    
    const allowedStatuses = ['NEW', 'CONFIRMED', 'PACKING', 'READY', 'DISPATCHED', 'COMPLETED', 'CANCELLED'];
    if (!allowedStatuses.includes(newStatus)) {
      (req as any).flash('error', 'Invalid status');
      return res.redirect(`/admin/online-orders/${orderId}`);
    }

    try {
      const changedBy = (req.session as any).user || 'Admin';
      orderService.updateOrderStatus(orderId, newStatus, changedBy);
      (req as any).flash('success', `Order status updated to ${newStatus}`);
    } catch (error: any) {
      (req as any).flash('error', error.message);
    }

    res.redirect(`/admin/online-orders/${orderId}`);
  }

  pushToPosAdmin(req: Request, res: Response) {
    const orderId = parseInt(req.params.id);
    const order = orderService.getOnlineOrderById(orderId);
    
    if (!order) {
      (req as any).flash('error', 'Order not found');
      return res.redirect('/admin/online-orders');
    }

    if (order.status === 'COMPLETED' || order.status === 'CANCELLED') {
      (req as any).flash('error', 'Order already completed or cancelled');
      return res.redirect(`/admin/online-orders/${orderId}`);
    }

    try {
      const dateObj = new Date(new Date().getTime() + 5.5 * 3600000);
      const dateStr = dateObj.toISOString().split('T')[0];
      const timeStr = dateObj.toISOString().split('T')[1].substring(0, 8);

      const cartItems = order.items.map(i => {
        const p = productService.getProductById(i.product_id)!;
        return {
          id: p.id,
          name: p.name,
          qty: i.quantity,
          price: i.unit_price,
          mrp: p.mrp,
          cost: p.cost_price,
          total: i.total_price,
          tax_rate: p.tax_rate
        };
      });

      const shiftId = (req.session as any).user_id ? shiftService.getOpenShift((req.session as any).user_id)?.id : null;

      const conversionTx = db.transaction(() => {
        orderService.updateOrderStatus(orderId, 'COMPLETED', (req.session as any).user || 'System POS Conversion', { isPosConversion: true });

        const bill = billingService.createBill(
          dateStr,
          timeStr,
          cartItems,
          order.customer.name,
          order.customer.phone,
          order.discount,
          order.payment_mode === 'UPI_QR' ? 'UPI' : 'Cash',
          shiftId || null
        );

        return bill;
      });

      const newBill = conversionTx();

      const actor = auditService.extractActor(req, 'System POS Conversion');
      const source = auditService.extractSource(req, 'POS_TERMINAL');
      auditService.recordPosConversion({
        actor,
        source,
        orderId,
        orderNumber: order.order_number,
        newBillId: newBill.id,
        totalAmount: newBill.total_amount
      });

      (req as any).flash('success', 'Successfully converted to POS Bill!');
      return res.redirect(`/search_bill?bill_id=${newBill.id}`);

    } catch (error: any) {
      (req as any).flash('error', `Failed to push to POS: ${error.message}`);
      return res.redirect(`/admin/online-orders/${orderId}`);
    }
  }

  // --- API V1 Methods ---
  
  async checkoutApi(req: Request, res: Response) {
    metricsAggregator.recordCheckoutAttempt('online');
    // Rely on centralized error handler for try/catch and sendSuccess for success
    const { sendSuccess } = await import('../utils/apiResponse.js');
    const parsed = checkoutSchema.parse(req.body);
    
    const originalCustomerId = req.session.customer_id;
    let customerId = originalCustomerId;
    if (!customerId) {
      const { normalizePhone } = await import('../utils/phone.js');
      const normalizedPhone = normalizePhone(parsed.phone);
      const existing = customerRepository.getCustomerByPhone(normalizedPhone);
      if (existing) {
        customerId = existing.id;
      } else {
        const newCustomer = customerRepository.findOrCreateCustomer(normalizedPhone, parsed.name);
        customerId = newCustomer.id;
      }
      // Security: Do NOT set req.session.customer_id for unauthenticated guest checkout
    }
    
    const customer = customerRepository.getCustomerById(customerId);
    if (!customer) throw new Error("Customer not found.");
    
    const crypto = await import('crypto');
    const idempotencyKey = (req.headers['idempotency-key'] as string) || crypto.createHash('md5').update(JSON.stringify(req.body) + customer.id).digest('hex');

    const action = async () => {
      const { cartService } = await import('../services/cart.service.js');
      let cartData;
      if (originalCustomerId) {
        cartData = cartService.getCart(customer.id);
      } else {
        if (!req.session.cart) req.session.cart = [];
        cartData = cartService.validateSessionCart(req.session.cart);
      }
      if (!cartData || cartData.items.length === 0) throw new Error("Cart is empty.");
      
      const validatedItems: any[] = [];
      const messageItems: any[] = [];
      for (let i = 0; i < cartData.items.length; i++) {
        const item = cartData.items[i];
        if (!item.available) continue;
        validatedItems.push({ product_id: item.id, quantity: item.qty });
        messageItems.push(`${i + 1}. ${item.name} × ${item.qty} = ₹${item.price * item.qty}`);
      }
      
      if (validatedItems.length === 0) throw new Error("No valid items in cart.");
      
      const subtotal = cartData.subtotal;
      const delivery_charge = (parsed.delivery_type === 'STORE_PICKUP' || subtotal >= 500) ? 0 : 50;
      const discount = 0;
      const total_amount = subtotal + delivery_charge - discount;

      const { orderService } = await import('../services/order.service.js');
      const order = orderService.createOnlineOrder({
        customer_id: customer.id,
        items: validatedItems,
        payment_mode: parsed.payment_mode,
        delivery_type: parsed.delivery_type,
        delivery_charge,
        discount,
        notes: parsed.notes || '',
      });
      const { whatsappService } = await import('../services/whatsapp.service.js');
      const whatsappUrl = whatsappService.generateCheckoutMessageUrl(order, parsed, messageItems, subtotal, delivery_charge, total_amount);
      cartService.clearCart((cartData as any).cart?.id || customer.id);
      return { status: 201, body: { ...order, whatsapp_url: whatsappUrl } };
    };

    const { idempotencyService } = await import('../services/idempotency.service.js');
    const result = await idempotencyService.executeAsync(idempotencyKey, 'checkout', action);
    if (result.status >= 400) {
      const error = new Error((result.body as any).message || 'Checkout failed');
      (error as any).status = result.status;
      throw error;
    }
    
    sendSuccess(res, { order: result.body, redirect: req.session.customer_id ? '/account/orders' : '/' }, 201);
  }

  async getPendingOrdersCountApi(req: Request, res: Response) {
    const { onlineOrderRepository } = await import('../repositories/online_order.repository.js');
    const count = onlineOrderRepository.getPendingOrdersCount();
    const { sendSuccess } = await import('../utils/apiResponse.js');
    sendSuccess(res, { count });
  }

  getTrackOrderView(req: Request, res: Response) {
    const orderNumber = (req.query.orderNumber as string || '').trim();
    const phone = (req.query.phone as string || '').trim();

    const siteUrl = seoService.getSiteUrl(req);
    const seo = seoService.buildTrackOrderSeo(siteUrl);

    if (orderNumber && phone) {
      const order = onlineOrderRepository.getOrderByNumberAndPhone(orderNumber, phone);
      if (order) {
        const items = onlineOrderRepository.getOrderItems(order.id);
        const statusLogs = onlineOrderRepository.getStatusLogs(order.id);
        return res.render('order_tracking', {
          ...seo,
          siteUrl,
          order,
          items,
          statusLogs,
          orderNumber,
          phone,
          error: null,
          csrfToken: res.locals.csrfToken
        });
      } else {
        return res.render('order_tracking', {
          ...seo,
          siteUrl,
          order: null,
          items: [],
          statusLogs: [],
          orderNumber,
          phone,
          error: 'No order found matching this order number and phone number. Please check details.',
          csrfToken: res.locals.csrfToken
        });
      }
    }

    res.render('order_tracking', {
      ...seo,
      siteUrl,
      order: null,
      items: [],
      statusLogs: [],
      orderNumber: '',
      phone: '',
      error: null,
      csrfToken: res.locals.csrfToken
    });
  }

  postTrackOrder(req: Request, res: Response) {
    const siteUrl = seoService.getSiteUrl(req);
    const seo = seoService.buildTrackOrderSeo(siteUrl);
    const orderNumber = (req.body.orderNumber as string || '').trim();
    const phone = (req.body.phone as string || '').trim();

    if (!orderNumber || !phone) {
      return res.render('order_tracking', {
        ...seo,
        siteUrl,
        order: null,
        items: [],
        statusLogs: [],
        orderNumber,
        phone,
        error: 'Please enter both your Order Number and Registered Phone Number.',
        csrfToken: res.locals.csrfToken
      });
    }

    const order = onlineOrderRepository.getOrderByNumberAndPhone(orderNumber, phone);
    if (!order) {
      return res.render('order_tracking', {
        ...seo,
        siteUrl,
        order: null,
        items: [],
        statusLogs: [],
        orderNumber,
        phone,
        error: 'No order found with the provided details. Please verify your order number and phone number.',
        csrfToken: res.locals.csrfToken
      });
    }

    const items = onlineOrderRepository.getOrderItems(order.id);
    const statusLogs = onlineOrderRepository.getStatusLogs(order.id);

    res.render('order_tracking', {
      ...seo,
      siteUrl,
      order,
      items,
      statusLogs,
      orderNumber,
      phone,
      error: null,
      csrfToken: res.locals.csrfToken
    });
  }

  getProductDetailView(req: Request, res: Response) {
    const productId = parseInt(req.params.id, 10);
    if (isNaN(productId)) {
      return res.status(404).render('error', {
        statusCode: 404,
        title: 'Product Not Found',
        message: 'The requested product ID is invalid.'
      });
    }

    const product = productService.getProductById(productId);
    if (!product) {
      return res.status(404).render('error', {
        statusCode: 404,
        title: 'Product Not Found',
        message: 'The requested product could not be found or has been removed from our catalog.'
      });
    }

    const siteUrl = seoService.getSiteUrl(req);
    const seo = seoService.buildProductSeo(product, siteUrl);
    const stock = product.total_qty - (product.sold_qty || 0);

    // Get related products with authentic relationships
    const relatedProducts = productService.getRelatedProducts(product, 6);
    const content = getEnrichedProductContent(product);

    res.render('product_detail', {
      product,
      stock,
      content,
      relatedProducts,
      siteUrl,
      ...seo,
      csrfToken: res.locals.csrfToken
    });
  }

  getCategoryView(req: Request, res: Response) {
    if (req.session && req.session.user) {
      return res.redirect('/sell');
    }
    const rawCategory = req.params.category || '';
    const category = decodeURIComponent(rawCategory).trim();
    if (!category) {
      return res.status(404).render('error', {
        statusCode: 404,
        title: 'Category Not Found',
        message: 'The requested category is invalid or missing.'
      });
    }

    const knownCategories = productService.getCategories();
    const matchedCategory = knownCategories.find(c => c.toLowerCase() === category.toLowerCase());

    const allProducts = productService.getProducts();
    const products = allProducts.filter(p => (p.category || '').toLowerCase() === category.toLowerCase());

    if (!matchedCategory && products.length === 0) {
      return res.status(404).render('error', {
        statusCode: 404,
        title: 'Category Not Found',
        message: `The category "${category}" could not be found or has been removed from our catalog.`
      });
    }

    const canonicalCategory = matchedCategory || category;
    const siteUrl = seoService.getSiteUrl(req);
    const seo = seoService.buildCategorySeo(canonicalCategory, siteUrl);

    res.render('home', {
      products,
      activeCategory: canonicalCategory,
      siteUrl,
      ...seo,
      csrfToken: res.locals.csrfToken
    });
  }

  getSitemapXml(req: Request, res: Response) {
    const siteUrl = seoService.getSiteUrl(req);
    const products = productService.getProducts();
    const categories = productService.getCategories();

    const xml = seoService.generateSitemapXml(siteUrl, products, categories);
    res.header('Content-Type', 'application/xml; charset=utf-8');
    res.status(200).send(xml);
  }

  getRobotsTxt(req: Request, res: Response) {
    const siteUrl = seoService.getSiteUrl(req);
    const txt = seoService.generateRobotsTxt(siteUrl);
    res.header('Content-Type', 'text/plain; charset=utf-8');
    res.status(200).send(txt);
  }
}

export const storeController = new StoreController();
