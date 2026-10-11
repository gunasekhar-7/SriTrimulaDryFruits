import { Request, Response, NextFunction } from 'express';
import { SpanKind, SpanStatusCode, trace, context } from '@opentelemetry/api';
import crypto from 'crypto';
import { otelTracer, parseTraceparent, formatTraceparent } from './tracer.js';
import { metricsAggregator } from './metrics.js';

function normalizeRoute(req: Request): string {
  // Use matched express route if available to avoid unbounded metric cardinality
  if (req.route && req.route.path) {
    const base = req.baseUrl || '';
    return `${base}${req.route.path}`;
  }
  
  // Basic route normalization for standard parameterized paths
  let path = req.path || '/';
  // Replace UUIDs
  path = path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id');
  // Replace numeric IDs
  path = path.replace(/\/\d+(\/|$)/g, '/:id$1');
  return path;
}

export function observabilityMiddleware(req: Request, res: Response, next: NextFunction) {
  // Allow health probes to bypass heavy tracing to avoid noise
  if (req.path === '/health' || req.path === '/ready') {
    return next();
  }

  const startHr = process.hrtime();
  const startTime = Date.now();
  const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
  res.locals.requestId = requestId;

  // Extract inbound W3C traceparent if present
  const incomingTraceparent = req.headers['traceparent'] as string | undefined;
  const parentSpanContext = parseTraceparent(incomingTraceparent);
  const parentContext = parentSpanContext
    ? trace.setSpanContext(context.active(), parentSpanContext)
    : context.active();

  const spanName = `HTTP ${req.method} ${req.path}`;
  const span = otelTracer.startSpan(
    spanName,
    {
      kind: SpanKind.SERVER,
      attributes: {
        'http.method': req.method,
        'http.target': req.originalUrl || req.url,
        'http.route': req.path,
        'http.user_agent': req.headers['user-agent'] || 'unknown',
        'http.client_ip': req.ip || req.socket.remoteAddress || 'unknown',
        'app.request_id': requestId
      }
    },
    parentContext
  );

  const spanContext = span.spanContext();
  const traceId = spanContext.traceId;
  const traceparent = formatTraceparent(spanContext);

  res.locals.traceId = traceId;
  res.locals.traceparent = traceparent;

  res.setHeader('x-request-id', requestId);
  res.setHeader('x-trace-id', traceId);
  res.setHeader('traceparent', traceparent);

  res.on('finish', () => {
    const diff = process.hrtime(startHr);
    const durationSeconds = diff[0] + diff[1] / 1e9;
    const durationMs = Number((durationSeconds * 1000).toFixed(2));
    const statusCode = res.statusCode;
    const route = normalizeRoute(req);

    // Update Span attributes and status
    span.setAttributes({
      'http.status_code': statusCode,
      'http.route': route,
      'http.duration_ms': durationMs
    });

    if (statusCode >= 500) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: `HTTP Server Error ${statusCode}`
      });
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }

    span.end();

    // Record Prometheus technical metrics
    metricsAggregator.recordHttpRequest(req.method, route, statusCode, durationSeconds);
  });

  // Run downstream handlers inside the OpenTelemetry context
  context.with(trace.setSpan(parentContext, span), () => {
    next();
  });
}
