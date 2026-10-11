export type AuditAction =
  | 'LOGIN'
  | 'FAILED_LOGIN'
  | 'PRODUCT_CREATE'
  | 'PRODUCT_UPDATE'
  | 'PRICE_MODIFY'
  | 'INVENTORY_ADJUST'
  | 'ORDER_CONFIRM'
  | 'ORDER_CANCEL'
  | 'RETURN'
  | 'REFUND'
  | 'ROLE_CHANGE'
  | 'POS_CONVERT';

export type AuditEntity =
  | 'USER'
  | 'PRODUCT'
  | 'PRODUCT_VARIANT'
  | 'ORDER'
  | 'BILL'
  | 'INVENTORY'
  | 'AUTH'
  | 'SECURITY'
  | 'RETURN';

export interface AuditLogEntry {
  id: number;
  actor: string;
  action: AuditAction;
  entity: AuditEntity;
  entity_id: string | null;
  timestamp: string;
  source: string;
  metadata: string | null;
  prev_hash: string | null;
  hash: string;
}

export interface AuditLogInput {
  actor: string;
  action: AuditAction;
  entity: AuditEntity;
  entity_id?: string | number | null;
  source: string;
  metadata?: Record<string, any> | string | null;
  timestamp?: string;
}

export interface AuditLogFilter {
  action?: AuditAction | 'ALL';
  entity?: AuditEntity | 'ALL';
  actor?: string;
  entityId?: string;
  source?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface AuditLogSearchResult {
  logs: AuditLogEntry[];
  total: number;
  page: number;
  totalPages: number;
  limit: number;
}
