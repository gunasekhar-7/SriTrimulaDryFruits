import express from 'express';
import { cartController } from '../controllers/cart.controller.js';
import { csrfProtection } from '../middleware/auth.js';

const router = express.Router();

router.get('/', csrfProtection, cartController.getCart.bind(cartController));
router.post('/add', csrfProtection, cartController.addItem.bind(cartController));
router.post('/update', csrfProtection, cartController.updateItem.bind(cartController));
router.post('/remove/:product_id', csrfProtection, cartController.removeItem.bind(cartController));
router.post('/clear', csrfProtection, cartController.clearCart.bind(cartController));

export default router;
