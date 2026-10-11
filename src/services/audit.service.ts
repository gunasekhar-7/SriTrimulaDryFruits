import { Request } from 'express';
import { auditRepository } from '../repositories/audit.repository.js';
import {
  AuditAction,
  AuditEntity,
  AuditLogEntry,
  AuditLogFilter,
  AuditLogInput,
  AuditLogSearchResult
} from '../types/audit.js';
import logger from '../logger.js';

export class AuditService {
  /**
   * Primary entrypoint to log an immutable audit event.
   */
  logEvent(input: AuditLogInput): AuditLogEntry | null {
    try {
      const entry = auditRepository.insertAuditLog(input);
      logger.info(`[AUDIT] ${input.action} on ${input.entity}:${input.entity_id || 'N/A'} by ${input.actor}`);
      return entry;
    } catch (error: any) {
      logger.error(`[AUDIT ERROR] Failed to record audit log: ${error.message}`, {
        input,
        error: error.stack
      });
      return null;
    }
  }

  // ─── 1. Login & Authentication ─────────────────────────────────────────────

  recordLogin(params: {
    actor: string;
    source: string;
    entityId?: string | number;
    metadata?: Record<string, any>;
  }): AuditLogEntry | null {
    return this.logEvent({
      actor: params.actor,
      action: 'LOGIN',
      entity: 'USER',
      entity_id: params.entityId,
      source: params.source,
      metadata: params.metadata || {}
    });
  }

  recordFailedLogin(params: {
    actor: string;
    source: string;
    reason: string;
    entityId?: string | number;
    metadata?: Record<string, any>;
  }): AuditLogEntry | null {
    return this.logEvent({
      actor: params.actor,
      action: 'FAILED_LOGIN',
      entity: 'AUTH',
      entity_id: params.entityId,
      source: params.source,
      metadata: {
        reason: params.reason,
        ...(params.metadata || {})
      }
    });
  }

  // ─── 2. Product Management ──────────────────────────────────────────────────

  recordProductCreation(params: {
    actor: string;
    source: string;
    productId: number;
    productName: string;
    variantData: {
      barcode: string;
      total_qty: number;
      cost_price: number;
      selling_price: number;
      mrp: number;
      category?: string;
    };
  }): AuditLogEntry | null {
    return this.logEvent({
      actor: params.actor,
      action: 'PRODUCT_CREATE',
      entity: 'PRODUCT',
      entity_id: params.productId,
      source: params.source,
      metadata: {
        name: params.productName,
        barcode: params.variantData.barcode,
        initial_stock: params.variantData.total_qty,
        cost_price: params.variantData.cost_price,
        selling_price: params.variantData.selling_price,
        mrp: params.variantData.mrp,
        category: params.variantData.category || 'Dry Fruits'
      }
    });
  }

  recordProductUpdate(params: {
    actor: string;
    source: string;
    productId: number;
    productName: string;
    changes: Record<string, { old: any; new: any }>;
  }): AuditLogEntry | null {
    return this.logEvent({
      actor: params.actor,
      action: 'PRODUCT_UPDATE',
      entity: 'PRODUCT',
      entity_id: params.productId,
      source: params.source,
      metadata: {
        name: params.productName,
        changes: params.changes
      }
    });
  }

  // ─── 3. Price Modification ──────────────────────────────────────────────────

  recordPriceModification(params: {
    actor: string;
    source: string;
    productId: number;
    productName: string;
    priceChanges: {
      oldSellingPrice?: number;
      newSellingPrice?: number;
      oldMrp?: number;
      newMrp?: number;
      oldCostPrice?: number;
      newCostPrice?: number;
    };
  }): AuditLogEntry | null {
    return this.logEvent({
      actor: params.actor,
      action: 'PRICE_MODIFY',
      entity: 'PRODUCT_VARIANT',
      entity_id: params.productId,
      source: params.source,
      metadata: {
        productName: params.productName,
        ...params.priceChanges
      }
    });
  }

  // ─── 4. Inventory Adjustment ────────────────────────────────────────────────

  recordInventoryAdjustment(params: {
    actor: string;
    source: string;
    productId: number;
    productName: string;
    adjustmentQty: number;
    oldQty?: number;
    newQty?: number;
    reason?: string;
  }): AuditLogEntry | null {
    return this.logEvent({
      actor: params.actor,
      action: 'INVENTORY_ADJUST',
      entity: 'INVENTORY',
      entity_id: params.productId,
      source: params.source,
      metadata: {
        productName: params.productName,
        adjustmentQty: params.adjustmentQty,
        oldQty: params.oldQty,
        newQty: params.newQty,
        reason: params.reason || 'Manual Adjustment'
      }
    });
  }

  // ─── 5. Order Confirmation & Cancellation ───────────────────────────────────

  recordOrderConfirmation(params: {
    actor: string;
    source: string;
    orderId: number;
    orderNumber: string;
    customerId: number;
    totalAmount: number;
  }): AuditLogEntry | null {
    return this.logEvent({
      actor: params.actor,
      action: 'ORDER_CONFIRM',
      entity: 'ORDER',
      entity_id: params.orderNumber || params.orderId,
      source: params.source,
      metadata: {
        orderId: params.orderId,
        orderNumber: params.orderNumber,
        customerId: params.customerId,
        totalAmount: params.totalAmount
      }
    });
  }

  recordOrderCancellation(params: {
    actor: string;
    source: string;
    orderId: number;
    orderNumber: string;
    customerId: number;
    previousStatus: string;
    reason?: string;
  }): AuditLogEntry | null {
    return this.logEvent({
      actor: params.actor,
      action: 'ORDER_CANCEL',
      entity: 'ORDER',
      entity_id: params.orderNumber || params.orderId,
      source: params.source,
      metadata: {
        orderId: params.orderId,
        orderNumber: params.orderNumber,
        customerId: params.customerId,
        previousStatus: params.previousStatus,
        reason: params.reason || 'Cancelled'
      }
    });
  }

  // ─── 6. Return & Refund ─────────────────────────────────────────────────────

  recordReturn(params: {
    actor: string;
    source: string;
    billId: number;
    saleId: number;
    productId: number;
    productName?: string;
    returnQty: number;
    unitPrice: number;
    refundAmount: number;
  }): AuditLogEntry | null {
    return this.logEvent({
      actor: params.actor,
      action: 'RETURN',
      entity: 'RETURN',
      entity_id: `BILL-${params.billId}-SALE-${params.saleId}`,
      source: params.source,
      metadata: {
        billId: params.billId,
        saleId: params.saleId,
        productId: params.productId,
        productName: params.productName || 'Item',
        returnQty: params.returnQty,
        unitPrice: params.unitPrice,
        refundAmount: params.refundAmount
      }
    });
  }

  recordRefund(params: {
    actor: string;
    source: string;
    referenceType: 'BILL' | 'ORDER';
    referenceId: string | number;
    refundAmount: number;
    method?: string;
    reason?: string;
  }): AuditLogEntry | null {
    return this.logEvent({
      actor: params.actor,
      action: 'REFUND',
      entity: params.referenceType === 'BILL' ? 'BILL' : 'ORDER',
      entity_id: params.referenceId,
      source: params.source,
      metadata: {
        referenceType: params.referenceType,
        referenceId: params.referenceId,
        refundAmount: params.refundAmount,
        method: params.method || 'Cash',
        reason: params.reason || 'Item Return / Cancellation'
      }
    });
  }

  // ─── 7. Role Change ─────────────────────────────────────────────────────────

  recordRoleChange(params: {
    actor: string;
    source: string;
    targetUserId: number;
    targetUsername: string;
    oldRole: string;
    newRole: string;
  }): AuditLogEntry | null {
    return this.logEvent({
      actor: params.actor,
      action: 'ROLE_CHANGE',
      entity: 'USER',
      entity_id: params.targetUserId,
      source: params.source,
      metadata: {
        targetUserId: params.targetUserId,
        targetUsername: params.targetUsername,
        oldRole: params.oldRole,
        newRole: params.newRole
      }
    });
  }

  // ─── 8. POS Conversion ──────────────────────────────────────────────────────

  recordPosConversion(params: {
    actor: string;
    source: string;
    orderId: number;
    orderNumber: string;
    newBillId: number;
    totalAmount: number;
  }): AuditLogEntry | null {
    return this.logEvent({
      actor: params.actor,
      action: 'POS_CONVERT',
      entity: 'ORDER',
      entity_id: params.orderNumber || params.orderId,
      source: params.source,
      metadata: {
        orderId: params.orderId,
        orderNumber: params.orderNumber,
        newBillId: params.newBillId,
        totalAmount: params.totalAmount
      }
    });
  }

  // ─── Query & Verification ───────────────────────────────────────────────────

  queryAuditLogs(filter: AuditLogFilter): AuditLogSearchResult {
    const limit = filter.limit && filter.limit > 0 ? Math.min(filter.limit, 100) : 50;
    const page = filter.offset ? Math.floor(filter.offset / limit) + 1 : 1;
    const offset = (page - 1) * limit;

    const queryFilter: AuditLogFilter = { ...filter, limit, offset };
    const logs = auditRepository.searchAuditLogs(queryFilter);
    const total = auditRepository.countAuditLogs(filter);
    const totalPages = Math.ceil(total / limit) || 1;

    return {
      logs,
      total,
      page,
      totalPages,
      limit
    };
  }

  verifyLedgerIntegrity(): { isValid: boolean; checkedCount: number; brokenAtId?: number; reason?: string } {
    return auditRepository.verifyLedgerIntegrity();
  }

  getAuditStats() {
    return auditRepository.getAuditStats();
  }

  // ─── HTTP Context Helpers ───────────────────────────────────────────────────

  extractSource(req: Request, channelOverride?: string): string {
    const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip || '127.0.0.1';
    const cleanIp = Array.isArray(ip) ? ip[0] : (typeof ip === 'string' ? ip.split(',')[0].trim() : '127.0.0.1');
    const channel = channelOverride || (req.originalUrl?.startsWith('/api') ? 'API' : (req.originalUrl?.startsWith('/admin') ? 'ADMIN_PORTAL' : 'STOREFRONT'));
    const userAgent = (req.headers['user-agent'] || 'unknown').substring(0, 100);
    return `IP:${cleanIp} | CH:${channel} | UA:${userAgent}`;
  }

  extractActor(req: Request, fallback = 'SYSTEM'): string {
    if (req.session?.user) {
      return `staff:${req.session.user_id || 0} (${req.session.user}:${req.session.role || 'staff'})`;
    }
    if (req.session?.customer_id) {
      return `customer:${req.session.customer_id}`;
    }
    return fallback;
  }
}

export const auditService = new AuditService();
