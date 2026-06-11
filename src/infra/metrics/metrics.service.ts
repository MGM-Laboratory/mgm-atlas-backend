import { Injectable } from '@nestjs/common';
import { collectDefaultMetrics, Histogram, Registry } from 'prom-client';

/**
 * Owns a dedicated prom-client registry (process default metrics + an HTTP
 * latency histogram). Scraped via GET /api/v1/metrics (token-gated). The
 * histogram is labelled by the route *template* (e.g. /projects/:slug) to keep
 * label cardinality bounded.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  readonly httpDuration: Histogram<string>;

  constructor() {
    this.registry.setDefaultLabels({ app: 'atlas-backend' });
    collectDefaultMetrics({ register: this.registry });
    this.httpDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
      registers: [this.registry],
    });
  }

  observe(method: string, route: string, statusCode: number, seconds: number): void {
    this.httpDuration.observe({ method, route, status_code: String(statusCode) }, seconds);
  }

  metrics(): Promise<string> {
    return this.registry.metrics();
  }

  contentType(): string {
    return this.registry.contentType;
  }
}
