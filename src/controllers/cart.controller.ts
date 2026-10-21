import { Request, Response } from 'express';
import { cartService } from '../services/cart.service.js';
import { productRepository } from '../repositories/product.repository.js';
import { metricsAggregator } from '../observability/index.js';
import { z } from 'zod';

const updateCartSchema = z.object({
  product_id: z.coerce.number().positive(),
  quantity: z.coerce.number().positive().optional(),
});

export class CartController {
  
  getCart(req: Request, res: Response) {
    try {
      if (req.session.customer_id) {
        const cartData = cartService.getCart(req.session.customer_id);
        return res.json(cartData);
      } else {
        // Anonymous user cart stored in session
        if (!req.session.cart) req.session.cart = [];
        const cartData = cartService.validateSessionCart(req.session.cart);
        // Save back the validated cart (removes out of stock, updates prices)
        req.session.cart = cartData.items;
        return res.json(cartData);
      }
    } catch (e: any) {
      return res.status(500).json({ message: e.message });
    }
  }

  addItem(req: Request, res: Response) {
    try {
      const parsed = updateCartSchema.parse(req.body);
      const qty = parsed.quantity || 1;

      if (req.session.customer_id) {
        const cartData = cartService.addItem(req.session.customer_id, parsed.product_id, qty);
        return res.json(cartData);
      } else {
        const product = productRepository.getProductById(parsed.product_id);
        if (!product) return res.status(404).json({ message: 'Product not found' });
        const stock = product.total_qty - (product.sold_qty || 0) - (product.reserved_qty || 0);
        if (stock <= 0) {
          metricsAggregator.recordStockOut(product.name, 'online');
          return res.status(400).json({ message: 'Product is out of stock' });
        }

        if (!req.session.cart) req.session.cart = [];
        const existing = req.session.cart.find(i => i.id === parsed.product_id);
        const currentQty = existing ? existing.qty : 0;
        if (currentQty + qty > stock) {
          metricsAggregator.recordStockOut(product.name, 'online');
          return res.status(400).json({ message: `Cannot add more than available stock (${stock})` });
        }

        if (existing) {
          existing.qty += qty;
        } else {
          req.session.cart.push({ id: parsed.product_id, qty });
        }
        const cartData = cartService.validateSessionCart(req.session.cart);
        req.session.cart = cartData.items;
        return res.json(cartData);
      }
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }
  }

  updateItem(req: Request, res: Response) {
    try {
      const parsed = updateCartSchema.parse(req.body);
      if (!parsed.quantity) return res.status(400).json({ message: 'Quantity required' });
      
      if (req.session.customer_id) {
        const cartData = cartService.updateItemQuantity(req.session.customer_id, parsed.product_id, parsed.quantity);
        return res.json(cartData);
      } else {
        const product = productRepository.getProductById(parsed.product_id);
        if (!product) return res.status(404).json({ message: 'Product not found' });
        const stock = product.total_qty - (product.sold_qty || 0) - (product.reserved_qty || 0);
        if (parsed.quantity > stock) {
          metricsAggregator.recordStockOut(product.name, 'online');
          return res.status(400).json({ message: `Only ${stock} items available` });
        }

        if (!req.session.cart) req.session.cart = [];
        if (parsed.quantity <= 0) {
          req.session.cart = req.session.cart.filter(i => i.id !== parsed.product_id);
        } else {
          const existing = req.session.cart.find(i => i.id === parsed.product_id);
          if (existing) {
            existing.qty = parsed.quantity;
          }
        }
        const cartData = cartService.validateSessionCart(req.session.cart);
        req.session.cart = cartData.items;
        return res.json(cartData);
      }
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }
  }

  removeItem(req: Request, res: Response) {
    try {
      const parsed = z.object({ product_id: z.coerce.number().positive() }).parse(req.params);
      if (req.session.customer_id) {
        const cartData = cartService.removeItem(req.session.customer_id, parsed.product_id);
        return res.json(cartData);
      } else {
        if (!req.session.cart) req.session.cart = [];
        req.session.cart = req.session.cart.filter(i => i.id !== parsed.product_id);
        const cartData = cartService.validateSessionCart(req.session.cart);
        req.session.cart = cartData.items;
        return res.json(cartData);
      }
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }
  }

  clearCart(req: Request, res: Response) {
    try {
      if (req.session.customer_id) {
        const cartData = cartService.clearCart(req.session.customer_id);
        return res.json(cartData);
      } else {
        req.session.cart = [];
        return res.json({ items: [], subtotal: 0 });
      }
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }
  }

  // --- Standardized API V1 Methods ---
  
  getCartApi(req: Request, res: Response) {
    let cartData;
    if (req.session.customer_id) {
      cartData = cartService.getCart(req.session.customer_id);
    } else {
      if (!req.session.cart) req.session.cart = [];
      cartData = cartService.validateSessionCart(req.session.cart);
      req.session.cart = cartData.items;
    }
    import('../utils/apiResponse.js').then(({ sendSuccess }) => sendSuccess(res, cartData));
  }

  addItemApi(req: Request, res: Response) {
    const parsed = updateCartSchema.parse(req.body);
    const qty = parsed.quantity || 1;
    let cartData;
    if (req.session.customer_id) {
      cartData = cartService.addItem(req.session.customer_id, parsed.product_id, qty);
    } else {
      const product = productRepository.getProductById(parsed.product_id);
      if (!product) throw new Error('Product not found');
      const stock = product.total_qty - (product.sold_qty || 0) - (product.reserved_qty || 0);
      if (stock <= 0) {
        metricsAggregator.recordStockOut(product.name, 'online');
        throw new Error('Product is out of stock');
      }

      if (!req.session.cart) req.session.cart = [];
      const existing = req.session.cart.find(i => i.id === parsed.product_id);
      const currentQty = existing ? existing.qty : 0;
      if (currentQty + qty > stock) {
        metricsAggregator.recordStockOut(product.name, 'online');
        throw new Error(`Cannot add more than available stock (${stock})`);
      }

      if (existing) {
        existing.qty += qty;
      } else {
        req.session.cart.push({ id: parsed.product_id, qty });
      }
      cartData = cartService.validateSessionCart(req.session.cart);
      req.session.cart = cartData.items;
    }
    import('../utils/apiResponse.js').then(({ sendSuccess }) => sendSuccess(res, cartData));
  }

  updateItemApi(req: Request, res: Response) {
    const parsed = updateCartSchema.parse(req.body);
    if (!parsed.quantity) throw new Error('Quantity required');
    let cartData;
    if (req.session.customer_id) {
      cartData = cartService.updateItem(req.session.customer_id, parsed.product_id, parsed.quantity);
    } else {
      const product = productRepository.getProductById(parsed.product_id);
      if (!product) throw new Error('Product not found');
      const stock = product.total_qty - (product.sold_qty || 0) - (product.reserved_qty || 0);
      if (parsed.quantity > stock) {
        metricsAggregator.recordStockOut(product.name, 'online');
        throw new Error(`Only ${stock} items available`);
      }

      if (!req.session.cart) req.session.cart = [];
      const existing = req.session.cart.find(i => i.id === parsed.product_id);
      if (existing) {
        existing.qty = parsed.quantity;
      }
      cartData = cartService.validateSessionCart(req.session.cart);
      req.session.cart = cartData.items;
    }
    import('../utils/apiResponse.js').then(({ sendSuccess }) => sendSuccess(res, cartData));
  }

  removeItemApi(req: Request, res: Response) {
    const product_id = parseInt(req.params.product_id);
    if (isNaN(product_id)) throw new Error('Invalid product ID');
    let cartData;
    if (req.session.customer_id) {
      cartData = cartService.removeItem(req.session.customer_id, product_id);
    } else {
      if (req.session.cart) {
        req.session.cart = req.session.cart.filter(i => i.id !== product_id);
      }
      cartData = cartService.validateSessionCart(req.session.cart || []);
      req.session.cart = cartData.items;
    }
    import('../utils/apiResponse.js').then(({ sendSuccess }) => sendSuccess(res, cartData));
  }
}

export const cartController = new CartController();
