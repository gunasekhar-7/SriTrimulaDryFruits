import promClient from 'prom-client';
import { ObservabilitySummary } from './types.js';

// ─── Prometheus Registry ───────────────────────────────────────────────────────
export const metricsRegistry = new promClient.Registry();

// Enable standard Node.js runtime metrics (event loop lag, memory, GC, process CPU)
promClient.collectDefaultMetrics({
  register: metricsRegistry,
  prefix: 'nodejs_'
});

// ═══════════════════════════════════════════════════════════════════════════════
// TECHNICAL METRICS
// ═══════════════════════════════════════════════════════════════════════════════

// 1. HTTP Request Count
export const httpRequestsTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests processed by method, route, and status code.',
  labelNames: ['method', 'route', 'status_code', 'status_class'] as const,
  registers: [metricsRegistry]
});

// 2. Request Latency
export const httpRequestDurationSeconds = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds.',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry]
});

// 3. 4xx Client Error Count
export const httpClientErrorsTotal = new promClient.Counter({
  name: 'http_client_errors_total',
  help: 'Total number of 4xx client errors (bad requests, unauthorized, not found).',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [metricsRegistry]
});

// 4. 5xx Server Error Count
export const httpServerErrorsTotal = new promClient.Counter({
  name: 'http_server_errors_total',
  help: 'Total number of 5xx server errors (internal failures).',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [metricsRegistry]
});

// Calculated 4xx & 5xx Rate Gauges
export const http4xxRateGauge = new promClient.Gauge({
  name: 'http_4xx_rate_percent',
  help: 'Current percentage of HTTP requests resulting in 4xx client errors.',
  registers: [metricsRegistry]
});

export const http5xxRateGauge = new promClient.Gauge({
  name: 'http_5xx_rate_percent',
  help: 'Current percentage of HTTP requests resulting in 5xx server errors.',
  registers: [metricsRegistry]
});

// 5. Database Latency & Queries
export const dbQueryDurationSeconds = new promClient.Histogram({
  name: 'db_query_duration_seconds',
  help: 'Duration of SQLite database operations and transactions in seconds.',
  labelNames: ['operation', 'table'] as const,
  buckets: [0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.5, 1],
  registers: [metricsRegistry]
});

export const dbQueriesTotal = new promClient.Counter({
  name: 'db_queries_total',
  help: 'Total number of database queries executed by operation and status.',
  labelNames: ['operation', 'table', 'status'] as const,
  registers: [metricsRegistry]
});

// 6. Authentication Failures
export const authFailuresTotal = new promClient.Counter({
  name: 'auth_failures_total',
  help: 'Total number of failed authentication attempts by user type and failure reason.',
  labelNames: ['user_type', 'reason'] as const,
  registers: [metricsRegistry]
});

// 7. Webhook Failures
export const webhookFailuresTotal = new promClient.Counter({
  name: 'webhook_failures_total',
  help: 'Total number of failed incoming webhook events by provider and reason.',
  labelNames: ['webhook_type', 'reason'] as const,
  registers: [metricsRegistry]
});

// 8. Background Job Failures & Latency
export const backgroundJobFailuresTotal = new promClient.Counter({
  name: 'background_job_failures_total',
  help: 'Total number of background job execution failures by job name and reason.',
  labelNames: ['job_name', 'reason'] as const,
  registers: [metricsRegistry]
});

export const backgroundJobDurationSeconds = new promClient.Histogram({
  name: 'background_job_duration_seconds',
  help: 'Execution duration of background jobs in seconds.',
  labelNames: ['job_name', 'status'] as const,
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 15, 30, 60, 120],
  registers: [metricsRegistry]
});

// ═══════════════════════════════════════════════════════════════════════════════
// BUSINESS METRICS
// ═══════════════════════════════════════════════════════════════════════════════

// 1. Checkout Attempts
export const businessCheckoutAttemptsTotal = new promClient.Counter({
  name: 'business_checkout_attempts_total',
  help: 'Total number of checkout attempts initiated by customers or POS operators.',
  labelNames: ['channel'] as const, // 'online' | 'offline'
  registers: [metricsRegistry]
});

// 2. Successful Orders
export const businessOrdersTotal = new promClient.Counter({
  name: 'business_orders_total',
  help: 'Total number of successful orders placed by channel and payment mode.',
  labelNames: ['channel', 'payment_mode'] as const,
  registers: [metricsRegistry]
});

// 3. Cancellations
export const businessOrderCancellationsTotal = new promClient.Counter({
  name: 'business_order_cancellations_total',
  help: 'Total number of cancelled orders by channel and cancelled_by actor.',
  labelNames: ['channel', 'reason'] as const,
  registers: [metricsRegistry]
});

// 4. Revenue (Online vs Offline)
export const businessRevenueInrTotal = new promClient.Counter({
  name: 'business_revenue_inr_total',
  help: 'Total cumulative business revenue in INR broken down by channel.',
  labelNames: ['channel'] as const, // 'online' | 'offline'
  registers: [metricsRegistry]
});

// 5. Average Order Value (AOV)
export const businessAverageOrderValueInr = new promClient.Gauge({
  name: 'business_average_order_value_inr',
  help: 'Current average order value in INR broken down by channel.',
  labelNames: ['channel'] as const, // 'all' | 'online' | 'offline'
  registers: [metricsRegistry]
});

// 6. WhatsApp Notifications & Conversions
export const businessWhatsAppNotificationsSentTotal = new promClient.Counter({
  name: 'business_whatsapp_notifications_sent_total',
  help: 'Total number of order confirmation notifications sent via WhatsApp.',
  registers: [metricsRegistry]
});

export const businessWhatsAppConversionsTotal = new promClient.Counter({
  name: 'business_whatsapp_conversions_total',
  help: 'Total number of orders successfully confirmed via customer WhatsApp reply.',
  registers: [metricsRegistry]
});

export const businessWhatsAppConversionRate = new promClient.Gauge({
  name: 'business_whatsapp_conversion_rate_percent',
  help: 'Percentage of WhatsApp notifications converted into confirmed orders.',
  registers: [metricsRegistry]
});

// 7. Stock-outs
export const businessStockoutsTotal = new promClient.Counter({
  name: 'business_stockouts_total',
  help: 'Total occurrences of stock exhaustion or attempted purchase with insufficient stock.',
  labelNames: ['product_name', 'channel'] as const,
  registers: [metricsRegistry]
});

// 8. Repeat Customers
export const businessRepeatCustomerOrdersTotal = new promClient.Counter({
  name: 'business_repeat_customer_orders_total',
  help: 'Total number of orders placed by returning (repeat) customers.',
  labelNames: ['channel'] as const,
  registers: [metricsRegistry]
});

export const businessRepeatCustomerRate = new promClient.Gauge({
  name: 'business_repeat_customer_rate_percent',
  help: 'Percentage of total orders placed by returning repeat customers.',
  registers: [metricsRegistry]
});

// ─── In-Memory Aggregate State for Instant Queries ────────────────────────────
class MetricsAggregator {
  private totalRequests = 0;
  private total4xx = 0;
  private total5xx = 0;
  private latenciesMs: number[] = [];
  private dbLatenciesMs: number[] = [];

  private authFailuresCount: Record<string, number> = {};
  private webhookFailuresCount: Record<string, number> = {};
  private backgroundJobFailuresCount: Record<string, number> = {};

  private checkoutAttemptsOnline = 0;
  private checkoutAttemptsOffline = 0;

  private successfulOrdersOnline = 0;
  private successfulOrdersOffline = 0;

  private cancellationsCount: Record<string, number> = {};

  private revenueOnline = 0;
  private revenueOffline = 0;

  private whatsappSent = 0;
  private whatsappConverted = 0;

  private stockoutsCount: Record<string, number> = {};
  private repeatOrdersCount = 0;

  recordHttpRequest(method: string, route: string, statusCode: number, durationSeconds: number) {
    const statusClass = `${Math.floor(statusCode / 100)}xx`;
    const durationMs = durationSeconds * 1000;

    this.totalRequests++;
    this.latenciesMs.push(durationMs);
    if (this.latenciesMs.length > 2000) this.latenciesMs.shift();

    httpRequestsTotal.inc({ method, route, status_code: String(statusCode), status_class: statusClass });
    httpRequestDurationSeconds.observe({ method, route, status_code: String(statusCode) }, durationSeconds);

    if (statusCode >= 400 && statusCode < 500) {
      this.total4xx++;
      httpClientErrorsTotal.inc({ method, route, status_code: String(statusCode) });
    } else if (statusCode >= 500) {
      this.total5xx++;
      httpServerErrorsTotal.inc({ method, route, status_code: String(statusCode) });
    }

    const rate4xx = this.totalRequests > 0 ? (this.total4xx / this.totalRequests) * 100 : 0;
    const rate5xx = this.totalRequests > 0 ? (this.total5xx / this.totalRequests) * 100 : 0;

    http4xxRateGauge.set(Number(rate4xx.toFixed(2)));
    http5xxRateGauge.set(Number(rate5xx.toFixed(2)));
  }

  recordDbQuery(operation: string, table: string, durationSeconds: number, success: boolean) {
    const durationMs = durationSeconds * 1000;
    this.dbLatenciesMs.push(durationMs);
    if (this.dbLatenciesMs.length > 2000) this.dbLatenciesMs.shift();

    dbQueryDurationSeconds.observe({ operation, table }, durationSeconds);
    dbQueriesTotal.inc({ operation, table, status: success ? 'success' : 'error' });
  }

  recordAuthFailure(userType: 'staff' | 'customer' | 'admin' | 'unknown', reason: string) {
    authFailuresTotal.inc({ user_type: userType, reason });
    const key = `${userType}:${reason}`;
    this.authFailuresCount[key] = (this.authFailuresCount[key] || 0) + 1;
  }

  recordWebhookFailure(webhookType: string, reason: string) {
    webhookFailuresTotal.inc({ webhook_type: webhookType, reason });
    const key = `${webhookType}:${reason}`;
    this.webhookFailuresCount[key] = (this.webhookFailuresCount[key] || 0) + 1;
  }

  recordBackgroundJobRun(jobName: string, durationSeconds: number, success: boolean, reason?: string) {
    backgroundJobDurationSeconds.observe({ job_name: jobName, status: success ? 'success' : 'failure' }, durationSeconds);
    if (!success) {
      const errReason = reason || 'execution_error';
      backgroundJobFailuresTotal.inc({ job_name: jobName, reason: errReason });
      const key = `${jobName}:${errReason}`;
      this.backgroundJobFailuresCount[key] = (this.backgroundJobFailuresCount[key] || 0) + 1;
    }
  }

  recordCheckoutAttempt(channel: 'online' | 'offline') {
    businessCheckoutAttemptsTotal.inc({ channel });
    if (channel === 'online') {
      this.checkoutAttemptsOnline++;
    } else {
      this.checkoutAttemptsOffline++;
    }
  }

  recordOrderSuccess(channel: 'online' | 'offline', paymentMode: string, amount: number) {
    businessOrdersTotal.inc({ channel, payment_mode: paymentMode });
    businessRevenueInrTotal.inc({ channel }, amount);

    if (channel === 'online') {
      this.successfulOrdersOnline++;
      this.revenueOnline += amount;
    } else {
      this.successfulOrdersOffline++;
      this.revenueOffline += amount;
    }

    this.recalculateAov();
  }

  recordOrderCancellation(channel: 'online' | 'offline', reason: string) {
    businessOrderCancellationsTotal.inc({ channel, reason });
    this.cancellationsCount[reason] = (this.cancellationsCount[reason] || 0) + 1;
  }

  recordWhatsAppNotificationSent() {
    businessWhatsAppNotificationsSentTotal.inc();
    this.whatsappSent++;
    this.recalculateWhatsAppConversion();
  }

  recordWhatsAppConversion() {
    businessWhatsAppConversionsTotal.inc();
    this.whatsappConverted++;
    this.recalculateWhatsAppConversion();
  }

  private recalculateWhatsAppConversion() {
    const rate = this.whatsappSent > 0 ? (this.whatsappConverted / this.whatsappSent) * 100 : 0;
    businessWhatsAppConversionRate.set(Number(rate.toFixed(2)));
  }

  recordStockOut(productName: string, channel: 'online' | 'offline') {
    businessStockoutsTotal.inc({ product_name: productName, channel });
    this.stockoutsCount[productName] = (this.stockoutsCount[productName] || 0) + 1;
  }

  recordRepeatCustomerOrder(channel: 'online' | 'offline') {
    businessRepeatCustomerOrdersTotal.inc({ channel });
    this.repeatOrdersCount++;
    this.recalculateRepeatCustomerRate();
  }

  private recalculateAov() {
    const totalOrders = this.successfulOrdersOnline + this.successfulOrdersOffline;
    const totalRev = this.revenueOnline + this.revenueOffline;

    const overallAov = totalOrders > 0 ? totalRev / totalOrders : 0;
    const onlineAov = this.successfulOrdersOnline > 0 ? this.revenueOnline / this.successfulOrdersOnline : 0;
    const offlineAov = this.successfulOrdersOffline > 0 ? this.revenueOffline / this.successfulOrdersOffline : 0;

    businessAverageOrderValueInr.set({ channel: 'all' }, Number(overallAov.toFixed(2)));
    businessAverageOrderValueInr.set({ channel: 'online' }, Number(onlineAov.toFixed(2)));
    businessAverageOrderValueInr.set({ channel: 'offline' }, Number(offlineAov.toFixed(2)));
  }

  private recalculateRepeatCustomerRate() {
    const totalOrders = this.successfulOrdersOnline + this.successfulOrdersOffline;
    const rate = totalOrders > 0 ? (this.repeatOrdersCount / totalOrders) * 100 : 0;
    businessRepeatCustomerRate.set(Number(rate.toFixed(2)));
  }

  private calculatePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return Number(sorted[Math.max(0, index)].toFixed(2));
  }

  private calculateAverage(values: number[]): number {
    if (values.length === 0) return 0;
    const sum = values.reduce((acc, v) => acc + v, 0);
    return Number((sum / values.length).toFixed(2));
  }

  getSummary(): ObservabilitySummary {
    const totalOrders = this.successfulOrdersOnline + this.successfulOrdersOffline;
    const totalRev = this.revenueOnline + this.revenueOffline;

    return {
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      technical: {
        httpRequestCount: this.totalRequests,
        requestLatencyMs: {
          avg: this.calculateAverage(this.latenciesMs),
          p95: this.calculatePercentile(this.latenciesMs, 95),
          p99: this.calculatePercentile(this.latenciesMs, 99)
        },
        rate4xxPercent: this.totalRequests > 0 ? Number(((this.total4xx / this.totalRequests) * 100).toFixed(2)) : 0,
        rate5xxPercent: this.totalRequests > 0 ? Number(((this.total5xx / this.totalRequests) * 100).toFixed(2)) : 0,
        dbLatencyMs: {
          avg: this.calculateAverage(this.dbLatenciesMs),
          p95: this.calculatePercentile(this.dbLatenciesMs, 95),
          totalQueries: this.dbLatenciesMs.length
        },
        authenticationFailures: {
          total: Object.values(this.authFailuresCount).reduce((a, b) => a + b, 0),
          byType: { ...this.authFailuresCount }
        },
        webhookFailures: {
          total: Object.values(this.webhookFailuresCount).reduce((a, b) => a + b, 0),
          byType: { ...this.webhookFailuresCount }
        },
        backgroundJobFailures: {
          total: Object.values(this.backgroundJobFailuresCount).reduce((a, b) => a + b, 0),
          byJob: { ...this.backgroundJobFailuresCount }
        }
      },
      business: {
        checkoutAttempts: {
          total: this.checkoutAttemptsOnline + this.checkoutAttemptsOffline,
          online: this.checkoutAttemptsOnline,
          offline: this.checkoutAttemptsOffline
        },
        successfulOrders: {
          total: totalOrders,
          online: this.successfulOrdersOnline,
          offline: this.successfulOrdersOffline
        },
        cancellations: {
          total: Object.values(this.cancellationsCount).reduce((a, b) => a + b, 0),
          byReason: { ...this.cancellationsCount }
        },
        averageOrderValueInr: {
          overall: totalOrders > 0 ? Number((totalRev / totalOrders).toFixed(2)) : 0,
          online: this.successfulOrdersOnline > 0 ? Number((this.revenueOnline / this.successfulOrdersOnline).toFixed(2)) : 0,
          offline: this.successfulOrdersOffline > 0 ? Number((this.revenueOffline / this.successfulOrdersOffline).toFixed(2)) : 0
        },
        onlineRevenueInr: Number(this.revenueOnline.toFixed(2)),
        offlineRevenueInr: Number(this.revenueOffline.toFixed(2)),
        totalRevenueInr: Number(totalRev.toFixed(2)),
        whatsappConversion: {
          notificationsSent: this.whatsappSent,
          conversions: this.whatsappConverted,
          conversionRatePercent: this.whatsappSent > 0 ? Number(((this.whatsappConverted / this.whatsappSent) * 100).toFixed(2)) : 0
        },
        stockOuts: {
          total: Object.values(this.stockoutsCount).reduce((a, b) => a + b, 0),
          byProduct: { ...this.stockoutsCount }
        },
        repeatCustomers: {
          totalOrdersByRepeatCustomers: this.repeatOrdersCount,
          repeatCustomerRatePercent: totalOrders > 0 ? Number(((this.repeatOrdersCount / totalOrders) * 100).toFixed(2)) : 0
        }
      }
    };
  }

  reset() {
    this.totalRequests = 0;
    this.total4xx = 0;
    this.total5xx = 0;
    this.latenciesMs = [];
    this.dbLatenciesMs = [];
    this.authFailuresCount = {};
    this.webhookFailuresCount = {};
    this.backgroundJobFailuresCount = {};
    this.checkoutAttemptsOnline = 0;
    this.checkoutAttemptsOffline = 0;
    this.successfulOrdersOnline = 0;
    this.successfulOrdersOffline = 0;
    this.cancellationsCount = {};
    this.revenueOnline = 0;
    this.revenueOffline = 0;
    this.whatsappSent = 0;
    this.whatsappConverted = 0;
    this.stockoutsCount = {};
    this.repeatOrdersCount = 0;
    metricsRegistry.resetMetrics();
  }
}

export const metricsAggregator = new MetricsAggregator();
