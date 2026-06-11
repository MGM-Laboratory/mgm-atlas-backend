import './instrument'; // Sentry init — must be imported first (no-op without SENTRY_DSN).
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { REDIS_PUB, REDIS_SUB } from './infra/redis/redis.module';
import { RedisIoAdapter } from './modules/chat/gateway/redis-io.adapter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug'],
    bufferLogs: true,
  });

  const config = app.get(ConfigService);
  const port = config.get<number>('app.port', 3000);
  const prefix = config.get<string>('app.globalPrefix', 'api/v1');
  const corsOrigins = config.get<string[]>('app.corsOrigins', []);
  const isProd = config.get<string>('app.env') === 'production';

  app.setGlobalPrefix(prefix);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(compression());

  app.enableCors({
    origin: corsOrigins.length > 0 ? corsOrigins : true,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  // Wire the socket.io Redis adapter for the chat gateway. When
  // REDIS_URL is empty both clients resolve to null and the adapter
  // falls back to the in-process IoAdapter — the gateway still works
  // for a single instance.
  const pub = app.get(REDIS_PUB, { strict: false });
  const sub = app.get(REDIS_SUB, { strict: false });
  app.useWebSocketAdapter(new RedisIoAdapter(app, pub, sub));

  if (!isProd) {
    const swagger = new DocumentBuilder()
      .setTitle('MGM Atlas API')
      .setDescription('Project portfolio dashboard for MGM Laboratory')
      .setVersion('1.0.0')
      .addBearerAuth({
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Keycloak-issued access token',
      })
      .build();
    const doc = SwaggerModule.createDocument(app, swagger);
    SwaggerModule.setup(`${prefix}/docs`, app, doc, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  app.enableShutdownHooks();

  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`[atlas-backend] listening on :${port} (prefix /${prefix})`);
}

bootstrap();
