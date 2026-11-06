import { Injectable } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';

/**
 * Prometheus metrics (NFR observability). A private registry keeps tests that
 * boot several apps independent. Labels use the ROUTE TEMPLATE (e.g.
 * /api/v1/transactions/:id), never raw URLs, ids or query strings — bounded
 * cardinality and no personal data in metrics.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  private readonly duration = new Histogram({
    name: 'takawise_http_request_duration_seconds',
    help: 'HTTP request duration by route template',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });

  private readonly requests = new Counter({
    name: 'takawise_http_requests_total',
    help: 'HTTP requests by route template and status class',
    labelNames: ['method', 'route', 'status_class'] as const,
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry, prefix: 'takawise_' });
  }

  /** Express middleware recording every request once it finishes. */
  middleware() {
    return (req: Request, res: Response, next: NextFunction): void => {
      const end = this.duration.startTimer();
      res.on('finish', () => {
        const template = (req.route as { path?: string } | undefined)?.path;
        const route = template ? `${req.baseUrl}${template}` : 'unmatched';
        const status = String(res.statusCode);
        end({ method: req.method, route, status });
        this.requests.inc({ method: req.method, route, status_class: `${status[0]}xx` });
      });
      next();
    };
  }

  async render(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
