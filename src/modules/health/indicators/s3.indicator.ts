import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { S3Service } from '@/modules/media/s3.service';

@Injectable()
export class S3HealthIndicator extends HealthIndicator {
  constructor(private readonly s3: S3Service) {
    super();
  }

  async isHealthy(key = 's3'): Promise<HealthIndicatorResult> {
    const ok = await this.s3.ping();
    const result = this.getStatus(key, ok);
    if (!ok) {
      throw new HealthCheckError('S3 bucket unreachable', result);
    }
    return result;
  }
}
