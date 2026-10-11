import { AsyncLocalStorage } from 'async_hooks';
import {
  trace,
  context,
  ROOT_CONTEXT,
  SpanStatusCode,
  SpanKind,
  Span,
  SpanContext,
  TraceFlags,
  Context,
  ContextManager,
  Link
} from '@opentelemetry/api';
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
  ReadableSpan,
  InMemorySpanExporter
} from '@opentelemetry/sdk-trace-base';
import { RecordedSpan, TraceTreeNode, TraceTreeSummary } from './types.js';

// ─── OpenTelemetry Context Manager ───────────────────────────────────────────
class AsyncLocalStorageContextManager implements ContextManager {
  private storage = new AsyncLocalStorage<Context>();

  active(): Context {
    return this.storage.getStore() || ROOT_CONTEXT;
  }

  with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    ctx: Context,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
  ): ReturnType<F> {
    return this.storage.run(ctx, () => fn.apply(thisArg, args));
  }

  bind<T>(ctx: Context, target: T): T {
    if (typeof target === 'function') {
      const self = this;
      return function (this: any, ...args: any[]) {
        return self.with(ctx, () => (target as Function).apply(this, args));
      } as any;
    }
    return target;
  }

  enable(): this {
    return this;
  }

  disable(): this {
    return this;
  }
}

const contextManager = new AsyncLocalStorageContextManager();
context.setGlobalContextManager(contextManager);

// ─── In-Memory Span Exporter & Trace Buffer ────────────────────────────────────
export const inMemorySpanExporter = new InMemorySpanExporter();

// ─── Tracer Provider Initialization ───────────────────────────────────────────
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(inMemorySpanExporter)]
});
trace.setGlobalTracerProvider(provider);

export const otelTracer = trace.getTracer('sri-tirumala-store', '1.0.0');

// ─── W3C Traceparent Helpers ──────────────────────────────────────────────────
export function formatTraceparent(spanContext: SpanContext): string {
  const traceId = spanContext.traceId;
  const spanId = spanContext.spanId;
  const traceFlags = (spanContext.traceFlags ?? TraceFlags.SAMPLED).toString(16).padStart(2, '0');
  return `00-${traceId}-${spanId}-${traceFlags}`;
}

export function parseTraceparent(header?: string | null): SpanContext | null {
  if (!header) return null;
  const parts = header.trim().split('-');
  if (parts.length < 4) return null;
  const [version, traceId, spanId, flags] = parts;
  if (version !== '00' || traceId.length !== 32 || spanId.length !== 16) return null;

  return {
    traceId,
    spanId,
    traceFlags: parseInt(flags, 16) || TraceFlags.SAMPLED,
    isRemote: true
  };
}

// ─── Span Execution Helpers ───────────────────────────────────────────────────
export function withSpan<T>(
  name: string,
  options: {
    kind?: SpanKind;
    attributes?: Record<string, any>;
    parentContext?: Context;
    links?: Link[];
  },
  fn: (span: Span) => T
): T {
  const parent = options.parentContext || context.active();
  const span = otelTracer.startSpan(
    name,
    {
      kind: options.kind || SpanKind.INTERNAL,
      attributes: options.attributes,
      links: options.links
    },
    parent
  );

  return context.with(trace.setSpan(parent, span), () => {
    try {
      const result = fn(span);
      if (result && typeof (result as any).then === 'function') {
        return (result as any)
          .then((resolved: any) => {
            span.setStatus({ code: SpanStatusCode.OK });
            span.end();
            return resolved;
          })
          .catch((error: any) => {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: error?.message || 'Unknown error'
            });
            span.recordException(error);
            span.end();
            throw error;
          }) as any;
      }

      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
      return result;
    } catch (error: any) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error?.message || 'Unknown error'
      });
      span.recordException(error);
      span.end();
      throw error;
    }
  });
}

export function startManualSpan(
  name: string,
  options: {
    kind?: SpanKind;
    attributes?: Record<string, any>;
    parentContext?: Context;
    links?: Link[];
  }
): { span: Span; ctx: Context } {
  const parent = options.parentContext || context.active();
  const span = otelTracer.startSpan(
    name,
    {
      kind: options.kind || SpanKind.INTERNAL,
      attributes: options.attributes,
      links: options.links
    },
    parent
  );
  const ctx = trace.setSpan(parent, span);
  return { span, ctx };
}

export function getActiveTraceId(): string | undefined {
  const activeSpan = trace.getSpan(context.active());
  return activeSpan?.spanContext().traceId;
}

export function getActiveSpanContext(): SpanContext | undefined {
  const activeSpan = trace.getSpan(context.active());
  return activeSpan?.spanContext();
}

// ─── Trace Tree Reconstruction & Querying ──────────────────────────────────────
export function getRecordedSpans(): RecordedSpan[] {
  return inMemorySpanExporter.getFinishedSpans().map((s) => {
    const spanContext = s.spanContext();
    const startMs = s.startTime[0] * 1000 + s.startTime[1] / 1e6;
    const endMs = s.endTime[0] * 1000 + s.endTime[1] / 1e6;
    const durationMs = Math.max(0, endMs - startMs);

    return {
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
      parentSpanId: (s as any).parentSpanId,
      name: s.name,
      kind: SpanKind[s.kind] || 'INTERNAL',
      startTimeMs: startMs,
      endTimeMs: endMs,
      durationMs: Number(durationMs.toFixed(2)),
      status: {
        code: SpanStatusCode[s.status.code] || 'UNSET',
        message: s.status.message
      },
      attributes: { ...s.attributes },
      events: s.events.map((e) => ({
        name: e.name,
        timeMs: e.time[0] * 1000 + e.time[1] / 1e6,
        attributes: e.attributes
      })),
      links: (s.links || []).map((l) => ({
        traceId: l.context.traceId,
        spanId: l.context.spanId,
        attributes: l.attributes
      }))
    };
  });
}

export function buildTraceTree(traceId: string): TraceTreeSummary | null {
  const allSpans = getRecordedSpans().filter(
    (s) => s.traceId === traceId || s.links.some((l) => l.traceId === traceId)
  );

  if (allSpans.length === 0) return null;

  // Build node lookup map
  const nodesMap = new Map<string, TraceTreeNode>();
  for (const s of allSpans) {
    nodesMap.set(s.spanId, { ...s, children: [] });
  }

  const rootNodes: TraceTreeNode[] = [];

  for (const s of allSpans) {
    const node = nodesMap.get(s.spanId)!;
    if (s.parentSpanId && nodesMap.has(s.parentSpanId)) {
      nodesMap.get(s.parentSpanId)!.children.push(node);
    } else {
      rootNodes.push(node);
    }
  }

  // Sort children by startTime
  const sortChildren = (node: TraceTreeNode) => {
    node.children.sort((a, b) => a.startTimeMs - b.startTimeMs);
    node.children.forEach(sortChildren);
  };
  rootNodes.forEach(sortChildren);
  rootNodes.sort((a, b) => a.startTimeMs - b.startTimeMs);

  const primaryRoot = rootNodes[0];
  const earliestTime = Math.min(...allSpans.map((s) => s.startTimeMs));
  const latestTime = Math.max(...allSpans.map((s) => s.endTimeMs));

  const steps = allSpans.map((s) => s.name);

  return {
    traceId,
    rootSpanName: primaryRoot?.name || 'Root Span',
    totalDurationMs: Number((latestTime - earliestTime).toFixed(2)),
    startTime: new Date(earliestTime).toISOString(),
    spanCount: allSpans.length,
    steps,
    spans: rootNodes
  };
}

export function getRecentTraces(limit = 25): TraceTreeSummary[] {
  const spans = getRecordedSpans();
  const traceIds = Array.from(new Set(spans.map((s) => s.traceId))).reverse();
  const summaries: TraceTreeSummary[] = [];

  for (const tid of traceIds.slice(0, limit)) {
    const tree = buildTraceTree(tid);
    if (tree) summaries.push(tree);
  }

  return summaries;
}
