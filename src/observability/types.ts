export interface TechnicalMetricsSnapshot {
  httpRequestCount: number;
  requestLatencyMs: {
    avg: number;
    p95: number;
    p99: number;
  };
  rate4xxPercent: number;
  rate5xxPercent: number;
  dbLatencyMs: {
    avg: number;
    p95: number;
    totalQueries: number;
  };
  authenticationFailures: {
    total: number;
    byType: Record<string, number>;
  };
  webhookFailures: {
    total: number;
    byType: Record<string, number>;
  };
  backgroundJobFailures: {
    total: number;
    byJob: Record<string, number>;
  };
}

export interface BusinessMetricsSnapshot {
  checkoutAttempts: {
    total: number;
    online: number;
    offline: number;
  };
  successfulOrders: {
    total: number;
    online: number;
    offline: number;
  };
  cancellations: {
    total: number;
    byReason: Record<string, number>;
  };
  averageOrderValueInr: {
    overall: number;
    online: number;
    offline: number;
  };
  onlineRevenueInr: number;
  offlineRevenueInr: number;
  totalRevenueInr: number;
  whatsappConversion: {
    notificationsSent: number;
    conversions: number;
    conversionRatePercent: number;
  };
  stockOuts: {
    total: number;
    byProduct: Record<string, number>;
  };
  repeatCustomers: {
    totalOrdersByRepeatCustomers: number;
    repeatCustomerRatePercent: number;
  };
}

export interface ObservabilitySummary {
  timestamp: string;
  uptimeSeconds: number;
  technical: TechnicalMetricsSnapshot;
  business: BusinessMetricsSnapshot;
}

export interface RecordedSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: string;
  startTimeMs: number;
  endTimeMs: number;
  durationMs: number;
  status: {
    code: string;
    message?: string;
  };
  attributes: Record<string, any>;
  events: Array<{
    name: string;
    timeMs: number;
    attributes?: Record<string, any>;
  }>;
  links: Array<{
    traceId: string;
    spanId: string;
    attributes?: Record<string, any>;
  }>;
}

export interface TraceTreeNode extends RecordedSpan {
  children: TraceTreeNode[];
}

export interface TraceTreeSummary {
  traceId: string;
  rootSpanName: string;
  totalDurationMs: number;
  startTime: string;
  spanCount: number;
  steps: string[];
  spans: TraceTreeNode[];
}
