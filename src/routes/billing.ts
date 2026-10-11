import express from 'express';
import { requireAuth, requireShift, csrfProtection } from '../middleware/auth.js';
import { billingController } from '../controllers/billing.controller.js';

const router = express.Router();

router.get('/sell', requireShift, csrfProtection, billingController.getSell.bind(billingController));
router.post('/sell', requireShift, csrfProtection, billingController.postSell.bind(billingController));

router.post('/update_cart/:index', requireShift, csrfProtection, billingController.updateCartItem.bind(billingController));
router.post('/delete_item/:index', requireAuth, csrfProtection, billingController.deleteCartItem.bind(billingController));
router.post('/clear_cart', requireAuth, csrfProtection, billingController.clearCart.bind(billingController));

router.post('/hold_bill', requireShift, csrfProtection, billingController.holdBill.bind(billingController));
router.post('/resume_bill/:index', requireShift, csrfProtection, billingController.resumeBill.bind(billingController));
router.post('/discard_held/:index', requireShift, csrfProtection, billingController.discardHeldBill.bind(billingController));

router.post('/finalize_bill', requireShift, csrfProtection, billingController.finalizeBill.bind(billingController));



export default router;
