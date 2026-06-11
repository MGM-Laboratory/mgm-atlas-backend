import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { MetricsService } from '@/infra/metrics/metrics.service';

/**
 * Records HTTP request durations into the Prometheus histogram. HTTP contexts
 * only (WebSocket frames are skipped). Uses the route template, not the raw
 * URL, so metric label cardinality stays bounded.
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<Request & { route?: { path?: string } }>();
    const res = http.getResponse<Response>();
    const start = process.hrtime.bigint();

    const record = (statusCode: number) => {
      const route = req.route?.path ?? 'unmatched';
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      this.metrics.observe(req.method, route, statusCode, seconds);
    };

    return next.handle().pipe(
      tap({
        next: () => record(res.statusCode),
        error: (err: { status?: number }) => record(err?.status ?? 500),
      }),
    );
  }
}
