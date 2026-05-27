import { Controller, Get, Inject, Optional } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, type HealthIndicatorResult } from '@nestjs/terminus';
import type { Redis } from 'ioredis';
import { Public } from '@/common/decorators/public.decorator';
import { REDIS_PUB } from '@/infra/redis/redis.module';
import { PrismaService } from '@/prisma/prisma.service';
import { S3HealthIndicator } from './indicators/s3.indicator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly s3: S3HealthIndicator,
    private readonly prisma: PrismaService,
    @Optional() @Inject(REDIS_PUB) private readonly redis: Redis | null = null,
  ) {}

  /**
   * Structured JSON health check designed for Gatus.
   *
   * Gatus pattern: status `up` if `info.database.status === up && info.s3.status === up`.
   * The `redis` key is reported as `disabled` when REDIS_URL is unset
   * (production safety: existing deploys boot unchanged) and as
   * `down` if it's configured but unreachable. Neither state causes
   * a 503 so Watchtower / orchestrators don't restart-loop the
   * container if Redis is briefly out — chat features just degrade.
   */
  @Public()
  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      async () => {
        try {
          await this.prisma.$queryRaw`SELECT 1`;
          return { database: { status: 'up' } };
        } catch (err) {
          return { database: { status: 'down', error: (err as Error).message } };
        }
      },
      () => this.s3.isHealthy('s3'),
      async (): Promise<HealthIndicatorResult> => {
        // When Redis isn't configured, report 'up' with mode:'disabled'
        // — semantically "the container is fine, chat realtime is
        // simply turned off". Reporting 'down' here would have Gatus
        // flag the deploy as unhealthy on every existing env that
        // hasn't set REDIS_URL yet.
        if (!this.redis) return { redis: { status: 'up', mode: 'disabled' } };
        try {
          const pong = await this.redis.ping();
          return { redis: { status: pong === 'PONG' ? 'up' : 'down' } };
        } catch (err) {
          return { redis: { status: 'down', error: (err as Error).message } };
        }
      },
    ]);
  }
}
