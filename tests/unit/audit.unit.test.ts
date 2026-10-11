import { describe, it, expect, beforeEach } from 'vitest';
import db from '../../src/database.js';
import { auditRepository } from '../../src/repositories/audit.repository.js';
import { auditService } from '../../src/services/audit.service.js';

describe('Immutable Audit Log System (Unit)', () => {

  describe('1. Engine-Level Immutability (Database Triggers)', () => {
    it('should insert an audit record successfully', () => {
      const entry = auditRepository.insertAuditLog({
        actor: 'unit_tester',
        action: 'LOGIN',
        entity: 'USER',
        entity_id: '99',
        source: 'IP:127.0.0.1 | CH:TEST',
        metadata: { test: true }
      });

      expect(entry).toBeDefined();
      expect(entry.id).toBeGreaterThan(0);
      expect(entry.action).toBe('LOGIN');
      expect(entry.hash).toBeDefined();
    });

    it('should strictly prohibit and REJECT any direct SQL UPDATE on audit_logs', () => {
      const entry = auditRepository.insertAuditLog({
        actor: 'hacker_target',
        action: 'PRODUCT_CREATE',
        entity: 'PRODUCT',
        entity_id: '101',
        source: 'IP:127.0.0.1',
        metadata: { initial: true }
      });

      expect(() => {
        db.prepare('UPDATE audit_logs SET action = ? WHERE id = ?').run('TAMPERED_ACTION', entry.id);
      }).toThrow(/Immutable audit log: UPDATE operations are strictly prohibited/);
    });

    it('should strictly prohibit and REJECT any direct SQL DELETE on audit_logs', () => {
      const entry = auditRepository.insertAuditLog({
        actor: 'delete_target',
        action: 'ROLE_CHANGE',
        entity: 'USER',
        entity_id: '102',
        source: 'IP:127.0.0.1',
        metadata: { role: 'admin' }
      });

      expect(() => {
        db.prepare('DELETE FROM audit_logs WHERE id = ?').run(entry.id);
      }).toThrow(/Immutable audit log: DELETE operations are strictly prohibited/);
    });
  });

  describe('2. Cryptographic Hash Chaining & Tamper Verification', () => {
    it('should correctly hash chain successive audit logs in chronological order', () => {
      const entry1 = auditRepository.insertAuditLog({
        actor: 'chain_user',
        action: 'LOGIN',
        entity: 'USER',
        entity_id: '1',
        source: 'TEST'
      });

      const entry2 = auditRepository.insertAuditLog({
        actor: 'chain_user',
        action: 'PRICE_MODIFY',
        entity: 'PRODUCT_VARIANT',
        entity_id: '1',
        source: 'TEST',
        metadata: { oldSellingPrice: 100, newSellingPrice: 120 }
      });

      expect(entry2.prev_hash).toBe(entry1.hash);
      expect(entry2.hash).not.toBe(entry1.hash);
      expect(entry2.hash.length).toBe(64); // SHA-256 hex string length
    });

    it('should verify ledger integrity across historical records', () => {
      const result = auditRepository.verifyLedgerIntegrity();
      expect(result.isValid).toBe(true);
      expect(result.checkedCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('3. Comprehensive Event Tracking Coverage (All 12 Events)', () => {
    const testSource = 'IP:192.168.1.100 | CH:UNIT_TEST | UA:Vitest';

    it('should record LOGIN event', () => {
      const entry = auditService.recordLogin({
        actor: 'admin:1 (john:admin)',
        source: testSource,
        entityId: 1,
        metadata: { method: 'password' }
      });
      expect(entry?.action).toBe('LOGIN');
      expect(entry?.entity).toBe('USER');
      expect(entry?.entity_id).toBe('1');
    });

    it('should record FAILED_LOGIN event', () => {
      const entry = auditService.recordFailedLogin({
        actor: 'unknown_intruder',
        source: testSource,
        reason: 'Invalid credentials',
        metadata: { attemptedUsername: 'admin' }
      });
      expect(entry?.action).toBe('FAILED_LOGIN');
      expect(entry?.entity).toBe('AUTH');
      expect(JSON.parse(entry?.metadata || '{}').reason).toBe('Invalid credentials');
    });

    it('should record PRODUCT_CREATE event', () => {
      const entry = auditService.recordProductCreation({
        actor: 'admin:1',
        source: testSource,
        productId: 501,
        productName: 'Organic Premium Almonds',
        variantData: { barcode: 'ALM-501', total_qty: 50, cost_price: 600, selling_price: 850, mrp: 950 }
      });
      expect(entry?.action).toBe('PRODUCT_CREATE');
      expect(entry?.entity).toBe('PRODUCT');
      expect(entry?.entity_id).toBe('501');
      expect(JSON.parse(entry?.metadata || '{}').name).toBe('Organic Premium Almonds');
    });

    it('should record PRODUCT_UPDATE event', () => {
      const entry = auditService.recordProductUpdate({
        actor: 'admin:1',
        source: testSource,
        productId: 501,
        productName: 'Organic Premium Almonds',
        changes: { name: { old: 'Organic Almonds', new: 'Organic Premium Almonds' } }
      });
      expect(entry?.action).toBe('PRODUCT_UPDATE');
      expect(entry?.entity).toBe('PRODUCT');
      expect(JSON.parse(entry?.metadata || '{}').changes.name.new).toBe('Organic Premium Almonds');
    });

    it('should record PRICE_MODIFY event', () => {
      const entry = auditService.recordPriceModification({
        actor: 'admin:1',
        source: testSource,
        productId: 501,
        productName: 'Organic Premium Almonds',
        priceChanges: { oldSellingPrice: 850, newSellingPrice: 890, oldMrp: 950, newMrp: 990 }
      });
      expect(entry?.action).toBe('PRICE_MODIFY');
      expect(entry?.entity).toBe('PRODUCT_VARIANT');
      expect(JSON.parse(entry?.metadata || '{}').newSellingPrice).toBe(890);
    });

    it('should record INVENTORY_ADJUST event', () => {
      const entry = auditService.recordInventoryAdjustment({
        actor: 'admin:1',
        source: testSource,
        productId: 501,
        productName: 'Organic Premium Almonds',
        adjustmentQty: 25,
        oldQty: 50,
        newQty: 75,
        reason: 'Shipment received'
      });
      expect(entry?.action).toBe('INVENTORY_ADJUST');
      expect(entry?.entity).toBe('INVENTORY');
      expect(JSON.parse(entry?.metadata || '{}').adjustmentQty).toBe(25);
    });

    it('should record ORDER_CONFIRM event', () => {
      const entry = auditService.recordOrderConfirmation({
        actor: 'admin:1',
        source: testSource,
        orderId: 701,
        orderNumber: 'STDF-2026-0701',
        customerId: 10,
        totalAmount: 1850
      });
      expect(entry?.action).toBe('ORDER_CONFIRM');
      expect(entry?.entity).toBe('ORDER');
      expect(entry?.entity_id).toBe('STDF-2026-0701');
    });

    it('should record ORDER_CANCEL event', () => {
      const entry = auditService.recordOrderCancellation({
        actor: 'customer:10',
        source: testSource,
        orderId: 701,
        orderNumber: 'STDF-2026-0701',
        customerId: 10,
        previousStatus: 'NEW',
        reason: 'Customer requested cancellation'
      });
      expect(entry?.action).toBe('ORDER_CANCEL');
      expect(entry?.entity).toBe('ORDER');
      expect(JSON.parse(entry?.metadata || '{}').previousStatus).toBe('NEW');
    });

    it('should record RETURN event', () => {
      const entry = auditService.recordReturn({
        actor: 'staff:2',
        source: testSource,
        billId: 901,
        saleId: 1201,
        productId: 501,
        productName: 'Organic Premium Almonds',
        returnQty: 2,
        unitPrice: 850,
        refundAmount: 1700
      });
      expect(entry?.action).toBe('RETURN');
      expect(entry?.entity).toBe('RETURN');
      expect(JSON.parse(entry?.metadata || '{}').refundAmount).toBe(1700);
    });

    it('should record REFUND event', () => {
      const entry = auditService.recordRefund({
        actor: 'staff:2',
        source: testSource,
        referenceType: 'BILL',
        referenceId: 901,
        refundAmount: 1700,
        method: 'Cash',
        reason: 'Defective packaging'
      });
      expect(entry?.action).toBe('REFUND');
      expect(entry?.entity).toBe('BILL');
      expect(JSON.parse(entry?.metadata || '{}').refundAmount).toBe(1700);
    });

    it('should record ROLE_CHANGE event', () => {
      const entry = auditService.recordRoleChange({
        actor: 'admin:1 (superadmin)',
        source: testSource,
        targetUserId: 5,
        targetUsername: 'clerk_bob',
        oldRole: 'staff',
        newRole: 'admin'
      });
      expect(entry?.action).toBe('ROLE_CHANGE');
      expect(entry?.entity).toBe('USER');
      expect(JSON.parse(entry?.metadata || '{}').oldRole).toBe('staff');
      expect(JSON.parse(entry?.metadata || '{}').newRole).toBe('admin');
    });

    it('should record POS_CONVERT event', () => {
      const entry = auditService.recordPosConversion({
        actor: 'staff:2',
        source: testSource,
        orderId: 701,
        orderNumber: 'STDF-2026-0701',
        newBillId: 902,
        totalAmount: 1850
      });
      expect(entry?.action).toBe('POS_CONVERT');
      expect(entry?.entity).toBe('ORDER');
      expect(JSON.parse(entry?.metadata || '{}').newBillId).toBe(902);
    });
  });

  describe('4. Multi-Dimensional Search & Filtering', () => {
    it('should filter audit logs by action', () => {
      const result = auditService.queryAuditLogs({ action: 'PRICE_MODIFY' });
      expect(result.logs.length).toBeGreaterThanOrEqual(1);
      result.logs.forEach(log => {
        expect(log.action).toBe('PRICE_MODIFY');
      });
    });

    it('should filter audit logs by entity', () => {
      const result = auditService.queryAuditLogs({ entity: 'USER' });
      expect(result.logs.length).toBeGreaterThanOrEqual(1);
      result.logs.forEach(log => {
        expect(log.entity).toBe('USER');
      });
    });

    it('should search audit logs by query text matching metadata or actor', () => {
      const result = auditService.queryAuditLogs({ search: 'clerk_bob' });
      expect(result.logs.length).toBeGreaterThanOrEqual(1);
      const found = result.logs.some(l => l.metadata?.includes('clerk_bob') || l.actor.includes('clerk_bob'));
      expect(found).toBe(true);
    });
  });

});
