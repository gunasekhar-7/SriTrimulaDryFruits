import { describe, it, expect } from 'vitest';
import { OrderStateMachine, OrderStatus } from '../../src/services/order-state-machine.js';

describe('Unit Tests: Order State Machine Transitions & Validation', () => {
  const allStatuses: OrderStatus[] = ['NEW', 'CONFIRMED', 'PACKING', 'READY', 'DISPATCHED', 'COMPLETED', 'CANCELLED'];

  describe('1. Happy Path Progressive State Transitions', () => {
    it('should permit standard linear e-commerce progression', () => {
      expect(OrderStateMachine.canTransition('NEW', 'CONFIRMED')).toBe(true);
      expect(OrderStateMachine.canTransition('CONFIRMED', 'PACKING')).toBe(true);
      expect(OrderStateMachine.canTransition('PACKING', 'READY')).toBe(true);
      expect(OrderStateMachine.canTransition('READY', 'DISPATCHED')).toBe(true);
      expect(OrderStateMachine.canTransition('DISPATCHED', 'COMPLETED')).toBe(true);
    });

    it('should permit express completion directly from pre-terminal states (e.g., instant over-the-counter fulfillment)', () => {
      expect(OrderStateMachine.canTransition('NEW', 'COMPLETED')).toBe(true);
      expect(OrderStateMachine.canTransition('CONFIRMED', 'COMPLETED')).toBe(true);
      expect(OrderStateMachine.canTransition('PACKING', 'COMPLETED')).toBe(true);
      expect(OrderStateMachine.canTransition('READY', 'COMPLETED')).toBe(true);
    });
  });

  describe('2. Cancellation Transitions', () => {
    it('should permit cancellation from any active processing state', () => {
      expect(OrderStateMachine.canTransition('NEW', 'CANCELLED')).toBe(true);
      expect(OrderStateMachine.canTransition('CONFIRMED', 'CANCELLED')).toBe(true);
      expect(OrderStateMachine.canTransition('PACKING', 'CANCELLED')).toBe(true);
      expect(OrderStateMachine.canTransition('READY', 'CANCELLED')).toBe(true);
      expect(OrderStateMachine.canTransition('DISPATCHED', 'CANCELLED')).toBe(true);
    });

    it('should permit cancellation from COMPLETED state to handle retail returns and refunds', () => {
      expect(OrderStateMachine.canTransition('COMPLETED', 'CANCELLED')).toBe(true);
    });

    it('should treat CANCELLED as an absolute terminal state with zero outbound transitions', () => {
      for (const target of allStatuses) {
        expect(OrderStateMachine.canTransition('CANCELLED', target)).toBe(false);
      }
    });
  });

  describe('3. Rejection of Invalid, Backward, and Illegal State Jumps', () => {
    it('should reject self-transitions (transitioning to the current state)', () => {
      for (const status of allStatuses) {
        expect(OrderStateMachine.canTransition(status, status)).toBe(false);
        expect(() => OrderStateMachine.validateTransition(status, status)).toThrow(
          `Invalid order status transition from ${status} to ${status}`
        );
      }
    });

    it('should reject backward transitions (e.g., PACKING -> CONFIRMED, DISPATCHED -> READY)', () => {
      expect(OrderStateMachine.canTransition('PACKING', 'CONFIRMED')).toBe(false);
      expect(OrderStateMachine.canTransition('READY', 'PACKING')).toBe(false);
      expect(OrderStateMachine.canTransition('DISPATCHED', 'READY')).toBe(false);
      expect(OrderStateMachine.canTransition('COMPLETED', 'DISPATCHED')).toBe(false);
    });

    it('should reject skipping forward steps illegally (e.g., NEW -> DISPATCHED, CONFIRMED -> READY)', () => {
      expect(OrderStateMachine.canTransition('NEW', 'DISPATCHED')).toBe(false);
      expect(OrderStateMachine.canTransition('CONFIRMED', 'READY')).toBe(false);
      expect(OrderStateMachine.canTransition('CONFIRMED', 'DISPATCHED')).toBe(false);
    });

    it('should throw descriptive Error on validateTransition for any illegal transition', () => {
      expect(() => OrderStateMachine.validateTransition('NEW', 'READY')).toThrow(
        'Invalid order status transition from NEW to READY'
      );
      expect(() => OrderStateMachine.validateTransition('CANCELLED', 'CONFIRMED')).toThrow(
        'Invalid order status transition from CANCELLED to CONFIRMED'
      );
    });
  });
});
