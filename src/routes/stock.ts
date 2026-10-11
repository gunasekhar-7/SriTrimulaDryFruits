import express from 'express';
import { requireAuth, requireAdmin, csrfProtection } from '../middleware/auth.js';
import { stockController } from '../controllers/stock.controller.js';

const router = express.Router();

router.get('/stock', requireAuth, csrfProtection, stockController.getStock.bind(stockController));

router.get('/add', requireAdmin, csrfProtection, stockController.getAdd.bind(stockController));
router.post('/add', requireAdmin, csrfProtection, stockController.postAdd.bind(stockController));

router.get('/edit/:id', requireAdmin, csrfProtection, stockController.getEdit.bind(stockController));
router.post('/edit/:id', requireAdmin, csrfProtection, stockController.postEdit.bind(stockController));

router.get('/add_stock/:id', requireAuth, csrfProtection, stockController.getAddStock.bind(stockController));
router.post('/add_stock/:id', requireAuth, csrfProtection, stockController.postAddStock.bind(stockController));

router.post('/delete/:id', requireAdmin, csrfProtection, stockController.deleteProduct.bind(stockController));

router.get('/print_label/:id', requireAuth, stockController.printLabel.bind(stockController));

export default router;
