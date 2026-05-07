import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { MediaModule } from '../media/media.module';
import { HealthController } from './health.controller';
import { S3HealthIndicator } from './indicators/s3.indicator';

@Module({
  imports: [TerminusModule, MediaModule],
  controllers: [HealthController],
  providers: [S3HealthIndicator],
})
export class HealthModule {}
