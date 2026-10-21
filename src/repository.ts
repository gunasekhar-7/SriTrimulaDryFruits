// Re-export domain repositories and types for backward compatibility
export * from './types/index.js';
export { userRepository } from './repositories/user.repository.js';
export { productRepository } from './repositories/product.repository.js';
export { shiftRepository } from './repositories/shift.repository.js';
export { billRepository } from './repositories/bill.repository.js';
export { saleRepository } from './repositories/sale.repository.js';
export { customerRepository } from './repositories/customer.repository.js';
export { onlineOrderRepository } from './repositories/online_order.repository.js';
export { billingService } from './services/billing.service.js';
export { orderService } from './services/order.service.js';
