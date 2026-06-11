import { Controller, Get, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '@/common/decorators/public.decorator';
import { MetricsService } from './metrics.service';

/**
 * Prometheus scrape endpoint. Public route (so it bypasses the session guard)
 * but token-gated because /api/v1/* is reachable through the public edge:
 *   - METRICS_TOKEN unset  → 404 (feature disabled; ships dark)
 *   - wrong/missing token  → 401
 *   - correct token        → 200 text/plain exposition
 * Prometheus scrapes it over the tailnet with `Authorization: Bearer <token>`.
 */
@ApiExcludeController()
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Get()
  async scrape(@Req() req: Request, @Res() res: Response): Promise<void> {
    const token = this.config.get<string>('metrics.token') ?? '';
    if (!token) {
      res.status(404).send('Not found');
      return;
    }
    const header = req.headers['authorization'] ?? '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
    const provided = bearer || (typeof req.query.token === 'string' ? req.query.token : '');
    if (provided !== token) {
      res.status(401).send('Unauthorized');
      return;
    }
    res.setHeader('content-type', this.metrics.contentType());
    res.send(await this.metrics.metrics());
  }
}
