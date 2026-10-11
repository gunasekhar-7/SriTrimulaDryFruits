import { Request, Response } from 'express';
import { metricsRegistry, metricsAggregator } from '../observability/metrics.js';
import { getRecentTraces, buildTraceTree } from '../observability/tracer.js';

export class ObservabilityController {
  // GET /metrics - Prometheus Scrape Endpoint
  async getMetricsPrometheus(req: Request, res: Response) {
    try {
      res.setHeader('Content-Type', metricsRegistry.contentType);
      const metrics = await metricsRegistry.metrics();
      res.send(metrics);
    } catch (err: any) {
      res.status(500).send(`Error collecting metrics: ${err.message}`);
    }
  }

  // GET /api/v1/observability/summary - JSON metrics summary for local inspection
  getMetricsSummary(req: Request, res: Response) {
    try {
      const summary = metricsAggregator.getSummary();
      res.json(summary);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  // GET /api/v1/observability/traces - Recent OpenTelemetry distributed traces
  getTraces(req: Request, res: Response) {
    try {
      const limit = parseInt(req.query.limit as string) || 20;
      const traces = getRecentTraces(limit);
      res.json({
        total: traces.length,
        traces
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  // GET /api/v1/observability/traces/:traceId - Trace detail & hierarchical span tree
  getTraceById(req: Request, res: Response) {
    try {
      const { traceId } = req.params;
      const tree = buildTraceTree(traceId);
      if (!tree) {
        return res.status(404).json({ error: `Trace ${traceId} not found` });
      }
      res.json(tree);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
}

export const observabilityController = new ObservabilityController();
