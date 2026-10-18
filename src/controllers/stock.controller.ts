import { Request, Response } from 'express';
import { z } from 'zod';
import { productService } from '../services/product.service.js';
import { auditService } from '../services/audit.service.js';
import logger from '../logger.js';

const productSchema = z.object({
  name: z.string().min(1, 'Product name is required').max(150),
  barcode: z.string().min(1, 'Barcode is required').max(50),
  qty: z.string().transform(v => { const n = parseFloat(v); if (isNaN(n) || n < 0) throw new Error('Invalid qty'); return n; }),
  cost: z.string().transform(v => { const n = parseFloat(v); if (isNaN(n) || n < 0) throw new Error('Invalid cost'); return n; }),
  sell: z.string().transform(v => { const n = parseFloat(v); if (isNaN(n) || n < 0) throw new Error('Invalid price'); return n; }),
  mrp: z.string().transform(v => { const n = parseFloat(v); if (isNaN(n) || n < 0) throw new Error('Invalid mrp'); return n; }),
  category: z.string().default('Dry Fruits'),
  image_url: z.string().url().optional().or(z.literal('')),
  tax_rate: z.string().optional().transform(v => { const n = parseFloat(v || '0'); return isNaN(n) ? 0 : n; }),
});

export class StockController {
  getStock(req: Request, res: Response) {
    const products = productService.getProducts();
    res.render('stock', { products, csrfToken: res.locals.csrfToken });
  }

  getAdd(req: Request, res: Response) {
    res.render('add_product', { csrfToken: res.locals.csrfToken, errors: null });
  }

  postAdd(req: Request, res: Response) {
    const parsed = productSchema.safeParse(req.body);
    if (!parsed.success) {
      req.flash('info', `Validation Error: ${parsed.error.issues.map(i => i.message).join(', ')}`);
      return res.redirect('/add');
    }
    const { name, barcode, qty, cost, sell, mrp, category, image_url, tax_rate } = parsed.data;
    try {
      const newProduct = productService.addProduct(name, barcode, qty, cost, sell, mrp, category, image_url || '', tax_rate);
      logger.info(`Product added: ${name} (${barcode}) by ${req.session.user}`);

      const actor = auditService.extractActor(req);
      const source = auditService.extractSource(req, 'STOCK_MANAGEMENT');

      auditService.recordProductCreation({
        actor,
        source,
        productId: newProduct.id,
        productName: name,
        variantData: { barcode, total_qty: qty, cost_price: cost, selling_price: sell, mrp, category }
      });

      if (qty > 0) {
        auditService.recordInventoryAdjustment({
          actor,
          source,
          productId: newProduct.id,
          productName: name,
          adjustmentQty: qty,
          newQty: qty,
          reason: 'Initial Product Stock'
        });
      }

      req.flash('info', 'Product added successfully!');
      res.redirect('/stock');
    } catch (e: any) {
      req.flash('info', `Error: ${e.message}`);
      res.redirect('/add');
    }
  }

  getEdit(req: Request, res: Response) {
    const id = parseInt(req.params.id);
    const product = productService.getProductById(id);
    if (!product) return res.redirect('/stock');
    const current_stock = product.total_qty - (product.sold_qty || 0);
    res.render('edit_product', { product, current_stock, csrfToken: res.locals.csrfToken });
  }

  postEdit(req: Request, res: Response) {
    const id = parseInt(req.params.id);
    const product = productService.getProductById(id);
    if (!product) return res.redirect('/stock');

    const parsed = productSchema.safeParse(req.body);
    if (!parsed.success) {
      req.flash('info', `Validation Error: ${parsed.error.issues.map(i => i.message).join(', ')}`);
      return res.redirect(`/edit/${id}`);
    }
    const { name, barcode, qty, cost, sell, mrp, category, image_url, tax_rate } = parsed.data;
    const new_total_qty = qty + (product.sold_qty || 0);
    try {
      productService.updateProduct(id, name, barcode, new_total_qty, cost, sell, mrp, category, image_url || '', tax_rate);
      logger.info(`Product updated: ${name} (id=${id}) by ${req.session.user}`);

      const actor = auditService.extractActor(req);
      const source = auditService.extractSource(req, 'STOCK_MANAGEMENT');

      // Audit price modifications if prices changed
      if (sell !== product.selling_price || mrp !== product.mrp || cost !== product.cost_price) {
        auditService.recordPriceModification({
          actor,
          source,
          productId: id,
          productName: name,
          priceChanges: {
            oldSellingPrice: product.selling_price,
            newSellingPrice: sell,
            oldMrp: product.mrp,
            newMrp: mrp,
            oldCostPrice: product.cost_price,
            newCostPrice: cost
          }
        });
      }

      // Audit inventory adjustment if quantity changed
      if (new_total_qty !== product.total_qty) {
        auditService.recordInventoryAdjustment({
          actor,
          source,
          productId: id,
          productName: name,
          adjustmentQty: new_total_qty - product.total_qty,
          oldQty: product.total_qty,
          newQty: new_total_qty,
          reason: 'Manual Inventory Edit'
        });
      }

      // Audit general product metadata update
      auditService.recordProductUpdate({
        actor,
        source,
        productId: id,
        productName: name,
        changes: {
          name: { old: product.name, new: name },
          barcode: { old: product.barcode, new: barcode },
          category: { old: product.category, new: category },
          tax_rate: { old: product.tax_rate, new: tax_rate }
        }
      });

      req.flash('info', 'Product details updated!');
      res.redirect('/stock');
    } catch (e: any) {
      req.flash('info', `Error: ${e.message}`);
      res.redirect(`/edit/${id}`);
    }
  }

  getAddStock(req: Request, res: Response) {
    const id = parseInt(req.params.id);
    const product = productService.getProductById(id);
    if (!product) return res.redirect('/stock');
    res.render('add_stock', { product, csrfToken: res.locals.csrfToken });
  }

  postAddStock(req: Request, res: Response) {
    const id = parseInt(req.params.id);
    const product = productService.getProductById(id);
    if (!product) return res.redirect('/stock');

    const added_qty = parseFloat(req.body.added_qty);
    if (isNaN(added_qty) || added_qty <= 0) {
      req.flash('info', 'Invalid quantity.');
      return res.redirect(`/add_stock/${id}`);
    }
    const image_url = req.body.image_url || undefined;
    productService.addStock(id, added_qty, image_url);
    logger.info(`Stock added: ${added_qty} to ${product.name} (id=${id}) by ${req.session.user}`);

    const actor = auditService.extractActor(req);
    const source = auditService.extractSource(req, 'STOCK_MANAGEMENT');
    auditService.recordInventoryAdjustment({
      actor,
      source,
      productId: id,
      productName: product.name,
      adjustmentQty: added_qty,
      oldQty: product.total_qty,
      newQty: product.total_qty + added_qty,
      reason: 'Manual Add Stock'
    });

    req.flash('info', `Added ${added_qty} to ${product.name}`);
    res.redirect('/stock');
  }

  deleteProduct(req: Request, res: Response) {
    const id = parseInt(req.params.id);
    const product = productService.getProductById(id);
    if (product) {
      productService.deleteProduct(id);
      logger.warn(`Product deleted: ${product.name} (id=${id}) by ${req.session.user}`);
      req.flash('info', `Deleted ${product.name}`);
    }
    res.redirect('/stock');
  }

  printLabel(req: Request, res: Response) {
    const id = parseInt(req.params.id);
    const product = productService.getProductById(id);
    if (!product) return res.status(404).render('error', { statusCode: 404, title: 'Not Found', message: 'Product not found.' });
    res.render('barcode_label', { product });
  }
}

export const stockController = new StockController();
