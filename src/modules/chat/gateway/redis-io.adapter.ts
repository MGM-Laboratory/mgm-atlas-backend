import { INestApplication, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Redis } from 'ioredis';
import type { ServerOptions } from 'socket.io';

/**
 * IoAdapter subclass that wires socket.io's Redis adapter onto the
 * server. With this in place, multiple backend replicas share rooms
 * and broadcasts via Redis pub/sub.
 *
 * If `pub` or `sub` is null (REDIS_URL unset), we fall back to the
 * vanilla IoAdapter — sockets still work on a single instance, just
 * without cross-instance fanout. Boot succeeds either way.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);

  constructor(
    app: INestApplication,
    private readonly pub: Redis | null,
    private readonly sub: Redis | null,
  ) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions): unknown {
    const server = super.createIOServer(port, options);
    if (this.pub && this.sub) {
      const adapter = createAdapter(this.pub, this.sub);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (server as any).adapter(adapter);
      this.logger.log('socket.io Redis adapter enabled');
    } else {
      this.logger.warn('socket.io running without Redis adapter — single-instance only');
    }
    return server;
  }
}
