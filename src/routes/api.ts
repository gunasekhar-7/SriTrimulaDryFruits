import express from 'express';
import { cartController } from '../controllers/cart.controller.js';
import { storeController } from '../controllers/store.controller.js';
import { whatsappController } from '../controllers/whatsapp.controller.js';
import { apiErrorHandler } from '../middleware/apiErrorHandler.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { productService } from '../services/product.service.js';
import { adminController } from '../controllers/admin.controller.js';
import { billingController } from '../controllers/billing.controller.js';

export const apiV1Router = express.Router();

// Generate requestId for all API requests
apiV1Router.use((req, res, next) => {
  res.locals.requestId = crypto.randomUUID();
  next();
});

// Products API
const productsApiRouter = express.Router();
productsApiRouter.get('/', (req, res, next) => {
  try {
    const products = productService.getProducts().map(p => ({
      id: p.id, name: p.name, barcode: p.barcode, mrp: p.mrp,
      selling_price: p.selling_price,
      available: p.total_qty - (p.sold_qty || 0),
      category: p.category || 'Dry Fruits'
    }));
    sendSuccess(res, { products });
  } catch (err) { next(err); }
});
productsApiRouter.get('/:barcode', (req, res, next) => {
  try {
    const product = productService.getProductByBarcode(req.params.barcode);
    if (!product) throw new Error('Product not found');
    sendSuccess(res, { 
      product: {
        id: product.id, name: product.name, mrp: product.mrp, 
        selling_price: product.selling_price, available: product.total_qty - (product.sold_qty || 0)
      }
    });
  } catch (err) { next(err); }
});
apiV1Router.use('/products', productsApiRouter);

// 4. Cart API
const cartApiRouter = express.Router();
cartApiRouter.get('/', (req, res, next) => {
  // We'll map the controller to use sendSuccess inside, or wrap it
  try { cartController.getCartApi(req, res); } catch(err) { next(err); }
});
cartApiRouter.post('/add', (req, res, next) => {
  try { cartController.addItemApi(req, res); } catch(err) { next(err); }
});
cartApiRouter.post('/update', (req, res, next) => {
  try { cartController.updateItemApi(req, res); } catch(err) { next(err); }
});
cartApiRouter.delete('/remove/:product_id', (req, res, next) => {
  try { cartController.removeItemApi(req, res); } catch(err) { next(err); }
});
apiV1Router.use('/cart', cartApiRouter);

// 5. Orders API
const ordersApiRouter = express.Router();
ordersApiRouter.get('/pending-count', requireAuth, (req, res, next) => {
  try {
    storeController.getPendingOrdersCountApi(req, res);
  } catch(err) { next(err); }
});
apiV1Router.use('/orders', ordersApiRouter);

import rateLimit from 'express-rate-limit';
const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 1000 : 15,
  message: 'Too many checkout requests from this IP, please try again after 15 minutes',
});

// 6. Store API
const storeApiRouter = express.Router();
storeApiRouter.post('/checkout', checkoutLimiter, (req, res, next) => {
  storeController.checkoutApi(req, res).catch(next);
});
apiV1Router.use('/store', storeApiRouter);

// 6.1 Sales API (POS Terminal Checkout)
const salesApiRouter = express.Router();
salesApiRouter.post('/complete', requireAuth, (req, res, next) => {
  billingController.completeSaleApi(req, res).catch(next);
});
apiV1Router.use('/sales', salesApiRouter);

// 7. WhatsApp API
const whatsappApiRouter = express.Router();
whatsappApiRouter.post('/webhook', express.json({
  verify: (req, res, buf) => { (req as any).rawBody = buf; }
}), (req, res, next) => {
  whatsappController.handleIncomingMessage(req, res).catch(next);
});
whatsappApiRouter.get('/webhook', (req, res) => whatsappController.verifyWebhook(req, res));
apiV1Router.use('/whatsapp', whatsappApiRouter);

// 8. Admin API
const adminApiRouter = express.Router();
adminApiRouter.use(requireAuth, requireAdmin);
adminApiRouter.get('/analytics', (req, res) => adminController.getAnalyticsApi(req, res));
adminApiRouter.get('/audit-logs', (req, res) => adminController.getAuditLogsApi(req, res));
adminApiRouter.get('/audit-logs/verify', (req, res) => adminController.verifyAuditLedgerApi(req, res));

apiV1Router.use('/admin', adminApiRouter);
apiV1Router.use('/', adminApiRouter);

// 9. Background Jobs API
import jobRouter from './job.js';
apiV1Router.use('/jobs', requireAuth, requireAdmin, jobRouter);

apiV1Router.use(apiErrorHandler);
