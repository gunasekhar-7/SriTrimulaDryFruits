import express from 'express';
import { requireAuth, requireAdmin, csrfProtection } from '../middleware/auth.js';
import { adminController } from '../controllers/admin.controller.js';

const router = express.Router();

router.get('/search_bill', requireAuth, csrfProtection, adminController.getSearchBill.bind(adminController));
router.post('/search_bill', requireAuth, csrfProtection, adminController.postSearchBill.bind(adminController));

router.post('/return_item', requireAuth, csrfProtection, adminController.returnItem.bind(adminController));

router.get('/profit', requireAdmin, csrfProtection, adminController.getProfit.bind(adminController));
router.post('/update_profit', requireAdmin, csrfProtection, adminController.updateProfit.bind(adminController));

router.get('/analytics', requireAdmin, adminController.getAnalytics.bind(adminController));
router.get('/api/analytics', requireAdmin, adminController.getAnalyticsApi.bind(adminController));

router.get('/settings', requireAdmin, csrfProtection, adminController.getSettings.bind(adminController));
router.post('/update_user', requireAdmin, csrfProtection, adminController.updateUser.bind(adminController));

router.get('/admin/audit-logs', requireAdmin, csrfProtection, adminController.getAuditLogs.bind(adminController));
router.get('/audit-logs', requireAdmin, csrfProtection, adminController.getAuditLogs.bind(adminController));
router.get('/api/admin/audit-logs', requireAdmin, adminController.getAuditLogsApi.bind(adminController));
router.get('/api/admin/audit-logs/verify', requireAdmin, adminController.verifyAuditLedgerApi.bind(adminController));

export default router;
