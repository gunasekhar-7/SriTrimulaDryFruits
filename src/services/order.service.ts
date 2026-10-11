import db from '../database.js';
import { onlineOrderRepository } from '../repositories/online_order.repository.js';
import { productRepository } from '../repositories/product.repository.js';
import { customerRepository } from '../repositories/customer.repository.js';
import { inventoryRepository } from '../repositories/inventory.repository.js';
import { OnlineOrder, OnlineOrderFull } from '../types/index.js';
import { OrderStateMachine, OrderStatus } from './order-state-machine.js';
import { whatsappService } from './whatsapp.service.js';
import logger from '../logger.js';
import { withSpan, getActiveSpanContext, formatTraceparent, metricsAggregator } from '../observability/index.js';
import { queueService } from '../queue/index.js';
import { auditService } from './audit.service.js';

export class OrderService {
  createOnlineOrder(data: { customer_id: number; items: Array<{ product_id: number; quantity: number }>; payment_mode: 'COD' | 'UPI_QR'; delivery_type: 'DELIVERY' | 'STORE_PICKUP'; delivery_charge: number; discount: number; notes?: string; }): OnlineOrder {
    return withSpan('order.service:createOnlineOrder', {
      attributes: {
        'customer.id': data.customer_id,
        'order.delivery_type': data.delivery_type,
        'order.payment_mode': data.payment_mode,
        'order.items_count': data.items.length
      }
    }, () => {
      // Check repeat customer status before placing the order
      const priorOrders = onlineOrderRepository.getOrdersByCustomer(data.customer_id);
      const isRepeatCustomer = priorOrders.length > 0;

      const currentSpanContext = getActiveSpanContext();
      const traceparent = currentSpanContext ? formatTraceparent(currentSpanContext) : undefined;

      const transaction = db.transaction(() => {
        let subtotal = 0;
        const orderItems: Array<{ product_id: number, product_name: string, unit_price: number, quantity: number, total_price: number }> = [];

        for (const item of data.items) {
          const product = productRepository.getProductById(item.product_id);
          if (!product) throw new Error(`Product not found: ${item.product_id}`);

          const availableQty = product.total_qty - product.sold_qty - (product.reserved_qty || 0);
          if (availableQty < item.quantity) {
            metricsAggregator.recordStockOut(product.name, 'online');
            throw new Error(`Insufficient stock for ${product.name}. Available: ${availableQty}, Requested: ${item.quantity}`);
          }

          const total_price = product.selling_price * item.quantity;
          subtotal += total_price;
          orderItems.push({
            product_id: product.id,
            product_name: product.name,
            unit_price: product.selling_price,
            quantity: item.quantity,
            total_price
          });
        }

        const total_amount = Math.max(0, subtotal + data.delivery_charge - data.discount);

        const orderId = onlineOrderRepository.insertOrder({
          order_number: 'TEMP',
          customer_id: data.customer_id,
          subtotal,
          delivery_charge: data.delivery_charge,
          discount: data.discount,
          total_amount,
          payment_mode: data.payment_mode,
          delivery_type: data.delivery_type,
          notes: data.notes || '',
          status: 'NEW',
          traceparent
        });
        
        const year = new Date().getFullYear();
        const orderNumber = `STDF-${year}-${orderId.toString().padStart(4, '0')}`;

        onlineOrderRepository.updateOrderNumber(orderId, orderNumber);

        for (const item of orderItems) {
          onlineOrderRepository.insertOrderItem(orderId, item.product_id, item.product_name, item.unit_price, item.quantity, item.total_price);
          inventoryRepository.reserveStock(item.product_id, item.quantity, orderId);
          inventoryRepository.recordMovement(item.product_id, -item.quantity, 'RESERVATION', `Customer:${data.customer_id}`, 'OnlineOrder', orderId.toString(), 'Order Placed');
        }

        onlineOrderRepository.insertStatusLog(orderId, null, 'NEW', 'CUSTOMER');
        
        const newOrder = onlineOrderRepository.getOrderById(orderId)!;
        logger.info('Order created', { event: 'order.created', orderId, customerId: data.customer_id, orderNumber: orderNumber });

        // Record business metrics
        metricsAggregator.recordOrderSuccess('online', data.payment_mode, total_amount);
        if (isRepeatCustomer) {
          metricsAggregator.recordRepeatCustomerOrder('online');
        }
        
        return newOrder;
      });

      const newOrder = transaction();

      // Enqueue durable WhatsApp notification after transaction commits to database
      try {
        const customer = customerRepository.getCustomerById(data.customer_id);
        if (customer && customer.phone) {
          queueService.enqueue({
            name: 'whatsapp_notification',
            payload: {
              orderId: newOrder.id,
              status: 'NEW',
              phone: customer.phone,
              orderDetails: {
                id: newOrder.id,
                customerName: customer.name,
                orderNumber: newOrder.order_number
              }
            },
            idempotencyKey: `whatsapp_order_${newOrder.id}_NEW`
          });
        }
      } catch (err: any) {
        logger.warn(`Failed to enqueue WhatsApp notification for order #${newOrder.id}: ${err.message}`);
      }

      return newOrder;
    }) as any;
  }

  getOnlineOrderById(id: number): OnlineOrderFull | null {
    const order = onlineOrderRepository.getOrderById(id);
    if (!order) return null;

    const customer = customerRepository.getCustomerById(order.customer_id)!;
    const items = onlineOrderRepository.getOrderItems(id);

    return { ...order, customer, items };
  }

  getOnlineOrders(filters?: { status?: string, search?: string, startDate?: string, endDate?: string, limit?: number, offset?: number }): OnlineOrderFull[] {
    const orders = onlineOrderRepository.getOrders(filters);
    return orders.map(order => {
      const customer = customerRepository.getCustomerById(order.customer_id)!;
      const items = onlineOrderRepository.getOrderItems(order.id);
      return { ...order, customer, items };
    });
  }

  updateOrderStatus(orderId: number, newStatus: string, changedBy: string, options?: { isPosConversion: boolean }): void {
    withSpan('order.service:updateOrderStatus', {
      attributes: {
        'order.id': orderId,
        'order.target_status': newStatus,
        'order.changed_by': changedBy
      }
    }, () => {
      const transaction = db.transaction(() => {
        const order = onlineOrderRepository.getOrderById(orderId);
        if (!order) throw new Error('Order not found');

        const previousStatus = order.status as OrderStatus;
        const targetStatus = newStatus as OrderStatus;

        OrderStateMachine.validateTransition(previousStatus, targetStatus);

        onlineOrderRepository.insertStatusLog(orderId, previousStatus, targetStatus, changedBy);
        onlineOrderRepository.updateOrderStatus(orderId, targetStatus);

        const items = onlineOrderRepository.getOrderItems(orderId);

        if (newStatus === 'COMPLETED' && previousStatus !== 'COMPLETED') {
          inventoryRepository.commitReservationByOrder(orderId);
          
          if (!options?.isPosConversion) {
            for (const item of items) {
              db.prepare('UPDATE product_variants SET sold_qty = sold_qty + ? WHERE id = ?').run(item.quantity, item.product_id);
              // Release reservation and record actual sale
              inventoryRepository.recordMovement(item.product_id, item.quantity, 'RESERVATION_RELEASE', changedBy, 'OnlineOrder', orderId.toString(), 'Order Completed');
              inventoryRepository.recordMovement(item.product_id, -item.quantity, 'ONLINE_SALE', changedBy, 'OnlineOrder', orderId.toString(), 'Order Completed');
            }
          } else {
            // If POS conversion, just release the reservation. The POS billing system handles the sale deduction.
            for (const item of items) {
              inventoryRepository.recordMovement(item.product_id, item.quantity, 'RESERVATION_RELEASE', changedBy, 'OnlineOrder', orderId.toString(), 'Converted to POS');
            }
          }
        } else if (newStatus === 'CANCELLED' && previousStatus === 'COMPLETED') {
          for (const item of items) {
            db.prepare('UPDATE product_variants SET sold_qty = sold_qty - ? WHERE id = ?').run(item.quantity, item.product_id);
            // Record return since it was already sold
            inventoryRepository.recordMovement(item.product_id, item.quantity, 'RETURN', changedBy, 'OnlineOrder', orderId.toString(), 'Completed Order Cancelled');
          }
        } else if (newStatus === 'CANCELLED' && previousStatus !== 'COMPLETED') {
          inventoryRepository.releaseReservationByOrder(orderId);
          for (const item of items) {
            // Release reservation since order wasn't completed
            inventoryRepository.recordMovement(item.product_id, item.quantity, 'RESERVATION_RELEASE', changedBy, 'OnlineOrder', orderId.toString(), 'Pending Order Cancelled');
          }
        }
        
        if (newStatus === 'CONFIRMED') {
          logger.info('Order confirmed', { event: 'order.confirmed', orderId, changedBy });
          auditService.recordOrderConfirmation({
            actor: changedBy,
            source: 'ORDER_SERVICE',
            orderId,
            orderNumber: order.order_number,
            customerId: order.customer_id,
            totalAmount: order.total_amount
          });
        } else if (newStatus === 'CANCELLED') {
          logger.info('Order cancelled', { event: 'order.cancelled', orderId, changedBy });
          metricsAggregator.recordOrderCancellation('online', changedBy);
          auditService.recordOrderCancellation({
            actor: changedBy,
            source: 'ORDER_SERVICE',
            orderId,
            orderNumber: order.order_number,
            customerId: order.customer_id,
            previousStatus
          });
          if (previousStatus === 'COMPLETED') {
            auditService.recordRefund({
              actor: changedBy,
              source: 'ORDER_SERVICE',
              referenceType: 'ORDER',
              referenceId: order.order_number || orderId,
              refundAmount: order.total_amount,
              method: order.payment_mode,
              reason: 'Completed order cancelled'
            });
          }
        } else if (newStatus === 'COMPLETED') {
          logger.info('Order completed', { event: 'order.completed', orderId, changedBy });
          logger.info('Payment completed', { event: 'payment.completed', orderId, method: order.payment_mode, amount: order.total_amount });
        }
      });

      transaction();
    });
    
    // Enqueue durable WhatsApp notification (survives restarts, retries independently)
    try {
      const fullOrder = this.getOnlineOrderById(orderId);
      if (fullOrder && fullOrder.customer) {
        queueService.enqueue({
          name: 'whatsapp_notification',
          payload: {
            orderId,
            status: newStatus,
            phone: fullOrder.customer.phone,
            orderDetails: {
              id: orderId,
              customerName: fullOrder.customer.name,
              orderNumber: fullOrder.order_number
            }
          },
          idempotencyKey: `whatsapp_order_${orderId}_${newStatus}`
        });
      }
    } catch (e: any) {
      logger.warn(`Failed to enqueue WhatsApp notification for order #${orderId}: ${e.message}`);
    }
  }
}

export const orderService = new OrderService();
