import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SentryModule } from '@sentry/nestjs/setup';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { TagsModule } from './modules/tags/tags.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { MediaModule } from './modules/media/media.module';
import { ContributionsModule } from './modules/contributions/contributions.module';
import { TeamModule } from './modules/team/team.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { MailerModule } from './modules/mailer/mailer.module';
import { HealthModule } from './modules/health/health.module';
import { VersionModule } from './modules/version/version.module';
import { FeatureFlagsModule } from './modules/feature-flags/feature-flags.module';
import { AdminModule } from './modules/admin/admin.module';
import { ChatModule } from './modules/chat/chat.module';
import { PmoModule } from './modules/pmo/pmo.module';
import { VoiceModule } from './modules/voice/voice.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RedisModule } from './infra/redis/redis.module';
import { MetricsModule } from './infra/metrics/metrics.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
      cache: true,
    }),
    // Sentry/GlitchTip request instrumentation (inert without SENTRY_DSN;
    // init happens in instrument.ts which main.ts imports first).
    SentryModule.forRoot(),
    MetricsModule,
    ThrottlerModule.forRootAsync({
      useFactory: () => [
        {
          ttl: Number(process.env.THROTTLE_TTL ?? 60) * 1000,
          limit: Number(process.env.THROTTLE_LIMIT ?? 120),
        },
      ],
    }),
    PrismaModule,
    RedisModule,
    MailerModule,
    WebhooksModule,
    AuthModule,
    UsersModule,
    TagsModule,
    ProjectsModule,
    MediaModule,
    ContributionsModule,
    TeamModule,
    NotificationsModule,
    AdminModule,
    ChatModule,
    PmoModule,
    VoiceModule,
    HealthModule,
    VersionModule,
    FeatureFlagsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
