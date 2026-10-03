import express from 'express';
import { z } from 'zod';
import * as repo from '../repository.js';
import { requireAuth, requireAdmin, csrfProtection } from '../middleware/auth.js';
import logger from '../logger.js';
const router = express.Router();
const productSchema = z.object({
    name: z.string().min(1, 'Product name is required').max(150),
    barcode: z.string().min(1, 'Barcode is required').max(50),
    qty: z.string().transform(v => { const n = parseFloat(v); if (isNaN(n) || n < 0)
        throw new Error('Invalid qty'); return n; }),
    cost: z.string().transform(v => { const n = parseFloat(v); if (isNaN(n) || n < 0)
        throw new Error('Invalid cost'); return n; }),
    sell: z.string().transform(v => { const n = parseFloat(v); if (isNaN(n) || n < 0)
        throw new Error('Invalid price'); return n; }),
    mrp: z.string().transform(v => { const n = parseFloat(v); if (isNaN(n) || n < 0)
        throw new Error('Invalid mrp'); return n; }),
    category: z.string().default('Dry Fruits'),
    image_url: z.string().url().optional().or(z.literal('')),
    tax_rate: z.string().optional().transform(v => { const n = parseFloat(v || '0'); return isNaN(n) ? 0 : n; }),
});
// GET /stock
router.get('/stock', requireAuth, csrfProtection, (req, res) => {
    const products = repo.getProducts();
    res.render('stock', { products, csrfToken: res.locals.csrfToken });
});
// GET /add
router.get('/add', requireAdmin, csrfProtection, (req, res) => {
    res.render('add_product', { csrfToken: res.locals.csrfToken, errors: null });
});
// POST /add
router.post('/add', requireAdmin, csrfProtection, (req, res) => {
    const parsed = productSchema.safeParse(req.body);
    if (!parsed.success) {
        req.flash('info', `❌ Validation Error: ${parsed.error.issues.map(i => i.message).join(', ')}`);
        return res.redirect('/add');
    }
    const { name, barcode, qty, cost, sell, mrp, category, image_url, tax_rate } = parsed.data;
    try {
        repo.addProduct(name, barcode, qty, cost, sell, mrp, category, image_url || '', tax_rate);
        logger.info(`Product added: ${name} (${barcode}) by ${req.session.user}`);
        req.flash('info', '✅ Product added successfully!');
        res.redirect('/stock');
    }
    catch (e) {
        req.flash('info', `❌ Error: ${e.message}`);
        res.redirect('/add');
    }
});
// GET /edit/:id
router.get('/edit/:id', requireAdmin, csrfProtection, (req, res) => {
    const id = parseInt(req.params.id);
    const product = repo.getProductById(id);
    if (!product)
        return res.redirect('/stock');
    const current_stock = product.total_qty - (product.sold_qty || 0);
    res.render('edit_product', { product, current_stock, csrfToken: res.locals.csrfToken });
});
// POST /edit/:id
router.post('/edit/:id', requireAdmin, csrfProtection, (req, res) => {
    const id = parseInt(req.params.id);
    const product = repo.getProductById(id);
    if (!product)
        return res.redirect('/stock');
    const parsed = productSchema.safeParse(req.body);
    if (!parsed.success) {
        req.flash('info', `❌ Validation Error: ${parsed.error.issues.map(i => i.message).join(', ')}`);
        return res.redirect(`/edit/${id}`);
    }
    const { name, barcode, qty, cost, sell, mrp, category, image_url, tax_rate } = parsed.data;
    const new_total_qty = qty + (product.sold_qty || 0);
    try {
        repo.updateProduct(id, name, barcode, new_total_qty, cost, sell, mrp, category, image_url || '', tax_rate);
        logger.info(`Product updated: ${name} (id=${id}) by ${req.session.user}`);
        req.flash('info', '✅ Product details updated!');
        res.redirect('/stock');
    }
    catch (e) {
        req.flash('info', `❌ Error: ${e.message}`);
        res.redirect(`/edit/${id}`);
    }
});
// GET /add_stock/:id
router.get('/add_stock/:id', requireAuth, csrfProtection, (req, res) => {
    const id = parseInt(req.params.id);
    const product = repo.getProductById(id);
    if (!product)
        return res.redirect('/stock');
    res.render('add_stock', { product, csrfToken: res.locals.csrfToken });
});
// POST /add_stock/:id
router.post('/add_stock/:id', requireAuth, csrfProtection, (req, res) => {
    const id = parseInt(req.params.id);
    const product = repo.getProductById(id);
    if (!product)
        return res.redirect('/stock');
    const added_qty = parseFloat(req.body.added_qty);
    if (isNaN(added_qty) || added_qty <= 0) {
        req.flash('info', '❌ Invalid quantity.');
        return res.redirect(`/add_stock/${id}`);
    }
    const image_url = req.body.image_url || undefined;
    repo.addStock(id, added_qty, image_url);
    logger.info(`Stock added: ${added_qty} to ${product.name} (id=${id}) by ${req.session.user}`);
    req.flash('info', `✅ Added ${added_qty} to ${product.name}`);
    res.redirect('/stock');
});
// POST /delete/:id  (changed from GET to POST for safety)
router.post('/delete/:id', requireAdmin, csrfProtection, (req, res) => {
    const id = parseInt(req.params.id);
    const product = repo.getProductById(id);
    if (product) {
        repo.deleteProduct(id);
        logger.warn(`Product deleted: ${product.name} (id=${id}) by ${req.session.user}`);
        req.flash('info', `✅ Deleted ${product.name}`);
    }
    res.redirect('/stock');
});
// GET /print_label/:id
router.get('/print_label/:id', requireAuth, (req, res) => {
    const id = parseInt(req.params.id);
    const product = repo.getProductById(id);
    if (!product)
        return res.status(404).render('error', { statusCode: 404, title: 'Not Found', message: 'Product not found.' });
    res.render('barcode_label', { product });
});
export default router;
