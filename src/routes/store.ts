import express from 'express';
import { requireAuth, requireAdmin, csrfProtection } from '../middleware/auth.js';
import { storeController } from '../controllers/store.controller.js';

const router = express.Router();

router.get('/robots.txt', storeController.getRobotsTxt.bind(storeController));
router.get('/sitemap.xml', storeController.getSitemapXml.bind(storeController));

router.get('/checkout', csrfProtection, storeController.getCheckoutView.bind(storeController));
router.get('/product/:id', csrfProtection, storeController.getProductDetailView.bind(storeController));
router.get('/category/:category', csrfProtection, storeController.getCategoryView.bind(storeController));
router.get('/track', csrfProtection, storeController.getTrackOrderView.bind(storeController));
router.post('/track', csrfProtection, storeController.postTrackOrder.bind(storeController));

router.get('/admin/online-orders', requireAuth, csrfProtection, storeController.getOnlineOrdersAdmin.bind(storeController));
router.get('/admin/online-orders/:id', requireAuth, csrfProtection, storeController.getOnlineOrderDetailAdmin.bind(storeController));
router.post('/admin/online-orders/:id/status', requireAuth, csrfProtection, storeController.updateOrderStatusAdmin.bind(storeController));
router.post('/admin/online-orders/:id/push-to-pos', requireAdmin, csrfProtection, storeController.pushToPosAdmin.bind(storeController));

export default router;
