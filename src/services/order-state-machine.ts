export type OrderStatus = 'NEW' | 'CONFIRMED' | 'PACKING' | 'READY' | 'DISPATCHED' | 'COMPLETED' | 'CANCELLED';

export class OrderStateMachine {
  private static readonly TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
    'NEW': ['CONFIRMED', 'CANCELLED', 'COMPLETED'],
    'CONFIRMED': ['PACKING', 'CANCELLED', 'COMPLETED'],
    'PACKING': ['READY', 'CANCELLED', 'COMPLETED'],
    'READY': ['DISPATCHED', 'CANCELLED', 'COMPLETED'],
    'DISPATCHED': ['COMPLETED', 'CANCELLED'],
    'COMPLETED': ['CANCELLED'], // Allows returns
    'CANCELLED': [] // Terminal state
  };

  /**
   * Validates if a transition is allowed.
   */
  static canTransition(currentStatus: OrderStatus, newStatus: OrderStatus): boolean {
    if (currentStatus === newStatus) {
      return false; // Repeated transition not allowed
    }
    const allowedNextStates = this.TRANSITIONS[currentStatus];
    return allowedNextStates?.includes(newStatus) ?? false;
  }

  /**
   * Throws an error if the transition is invalid.
   */
  static validateTransition(currentStatus: OrderStatus, newStatus: OrderStatus): void {
    if (!this.canTransition(currentStatus, newStatus)) {
      throw new Error(`Invalid order status transition from ${currentStatus} to ${newStatus}`);
    }
  }
}
