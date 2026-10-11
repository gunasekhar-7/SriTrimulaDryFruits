import express from 'express';
import { requireCustomerAuth, csrfProtection } from '../middleware/auth.js';
import { customerController } from '../controllers/customer.controller.js';
import { onlineOrderRepository } from '../repositories/online_order.repository.js';
import { customerRepository } from '../repositories/customer.repository.js';
import { productService } from '../services/product.service.js';

const router = express.Router();

router.use(requireCustomerAuth, csrfProtection);

// Redirect /account to /account/orders or profile
router.get('/', (req, res) => {
  res.redirect('/account/orders');
});

router.get('/profile', customerController.getProfile.bind(customerController));
router.post('/profile', customerController.postProfile.bind(customerController));
router.post('/link-guest', customerController.postLinkGuest.bind(customerController));

router.get('/addresses', customerController.getAddresses.bind(customerController));
router.post('/addresses', customerController.postAddress.bind(customerController));
router.post('/addresses/:id/default', customerController.setDefaultAddress.bind(customerController));
router.post('/addresses/:id/delete', customerController.deleteAddress.bind(customerController));

router.get('/orders', (req, res) => {
  const customerId = req.session.customer_id!;
  const orders = onlineOrderRepository.getOrdersByCustomer(customerId);
  res.render('customer_orders', { orders, title: 'My Orders' });
});

router.get('/orders/:id', (req, res) => {
  const customerId = req.session.customer_id!;
  const orderId = parseInt(req.params.id);
  const order = onlineOrderRepository.getOrderById(orderId);
  
  if (!order || order.customer_id !== customerId) {
    return res.status(404).render('error', {
      statusCode: 404,
      title: 'Order Not Found',
      message: 'The requested order does not exist or you do not have permission to view it.'
    });
  }

  const items = onlineOrderRepository.getOrderItems(order.id);
  const statusLogs = onlineOrderRepository.getStatusLogs(order.id);
  
  // Attach product info to items if needed
  items.forEach((item: any) => {
    try {
      item.product = productService.getProductById(item.product_id);
    } catch {
      item.product = null;
    }
  });

  res.render('customer_order_detail', { order, items, statusLogs, title: 'Order Details' });
});

router.get('/wishlist', (req, res) => {
  // Wishlist implementation
  res.render('customer_wishlist', { items: [], title: 'My Wishlist' });
});

export default router;
