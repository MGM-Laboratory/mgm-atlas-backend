import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { Public } from '@/common/decorators/public.decorator';
import { PrismaService } from '@/prisma/prisma.service';
import { S3HealthIndicator } from './indicators/s3.indicator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly s3: S3HealthIndicator,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Structured JSON health check designed for Gatus.
   *
   * Gatus pattern: status `up` if `info.database.status === up && info.s3.status === up`.
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
    ]);
  }
}
