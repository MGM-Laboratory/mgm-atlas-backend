import { Global, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { type Redis as RedisClient } from 'ioredis';

/**
 * Two ioredis connections are exposed:
 *   REDIS_PUB  — used by the app for normal commands AND as the socket.io
 *                adapter's publisher.
 *   REDIS_SUB  — dedicated subscriber connection (socket.io adapter
 *                requirement; subscriber connections in Redis can't
 *                run regular commands so we keep it separate).
 *
 * When `REDIS_URL` is empty (e.g. existing prod environments that
 * haven't been upgraded), BOTH providers resolve to `null`. Consumers
 * MUST check for null and gracefully degrade — see ChatPresenceService
 * and ChatTypingService for the fallback pattern. The container boots
 * either way; chat REST endpoints stay functional, only the live
 * features (presence, typing, multi-instance fanout) are disabled.
 */
export const REDIS_PUB = 'REDIS_PUB';
export const REDIS_SUB = 'REDIS_SUB';
export const REDIS_ENABLED = 'REDIS_ENABLED';

const logger = new Logger('RedisModule');

function makeClient(url: string, role: 'pub' | 'sub'): RedisClient {
  const client = new Redis(url, {
    lazyConnect: false,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    retryStrategy: (times) => Math.min(times * 200, 2000),
    reconnectOnError: () => true,
  });
  client.on('error', (err) => {
    logger.warn(`Redis (${role}) error: ${err.message}`);
  });
  client.once('ready', () => {
    logger.log(`Redis (${role}) connected`);
  });
  return client;
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_ENABLED,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => Boolean(config.get<string>('redis.url')),
    },
    {
      provide: REDIS_PUB,
      inject: [ConfigService],
      useFactory: (config: ConfigService): RedisClient | null => {
        const url = config.get<string>('redis.url');
        if (!url) {
          logger.warn('REDIS_URL is unset — chat sockets / presence / typing will be disabled.');
          return null;
        }
        return makeClient(url, 'pub');
      },
    },
    {
      provide: REDIS_SUB,
      inject: [ConfigService],
      useFactory: (config: ConfigService): RedisClient | null => {
        const url = config.get<string>('redis.url');
        if (!url) return null;
        return makeClient(url, 'sub');
      },
    },
  ],
  exports: [REDIS_PUB, REDIS_SUB, REDIS_ENABLED],
})
export class RedisModule implements OnApplicationShutdown {
  async onApplicationShutdown() {
    // ioredis cleans up on process exit, but explicit quit avoids
    // half-open connections on graceful shutdown via SIGTERM.
  }
}
