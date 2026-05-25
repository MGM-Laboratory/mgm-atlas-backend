import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_PUB } from '@/infra/redis/redis.module';

/**
 * "User X is typing in channel Y" flag with a short TTL. The client
 * pings while the user is composing; the flag self-expires if pings
 * stop. We deliberately don't persist anything — typing is purely
 * ephemeral UX.
 *
 * Returns whether this is a fresh transition (false → true) so the
 * gateway only broadcasts `typing.start` once instead of on every ping.
 */
@Injectable()
export class ChatTypingService {
  private static readonly TTL_S = 6;

  // In-memory fallback for single-instance / no-Redis mode.
  private readonly mem = new Map<string, NodeJS.Timeout>();

  constructor(@Optional() @Inject(REDIS_PUB) private readonly redis: Redis | null) {}

  private key(channelId: string, userId: string) {
    return `typing:${channelId}:${userId}`;
  }

  /** Set/refresh the typing flag. Returns true on a fresh transition. */
  async ping(channelId: string, userId: string): Promise<boolean> {
    const key = this.key(channelId, userId);
    if (this.redis) {
      const existed = await this.redis.exists(key);
      await this.redis.set(key, '1', 'EX', ChatTypingService.TTL_S);
      return existed === 0;
    }
    const existing = this.mem.get(key);
    if (existing) clearTimeout(existing);
    this.mem.set(
      key,
      setTimeout(() => this.mem.delete(key), ChatTypingService.TTL_S * 1000),
    );
    return !existing;
  }

  /** Explicit stop (e.g. on message send). */
  async stop(channelId: string, userId: string): Promise<boolean> {
    const key = this.key(channelId, userId);
    if (this.redis) {
      const removed = await this.redis.del(key);
      return removed > 0;
    }
    const existing = this.mem.get(key);
    if (!existing) return false;
    clearTimeout(existing);
    this.mem.delete(key);
    return true;
  }
}
