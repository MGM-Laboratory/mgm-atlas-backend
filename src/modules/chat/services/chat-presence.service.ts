import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_PUB } from '@/infra/redis/redis.module';

/**
 * User presence tracked across all sockets a user has open. Each socket
 * registers itself; presence flips to offline only when the last socket
 * disconnects. Keyed in Redis as:
 *
 *   presence:user:{userId}            — SET of socketIds (TTL 60s, refreshed)
 *   presence:socket:{socketId}        — JSON {userId, projects[]} for fanout
 *                                       on disconnect (TTL 120s)
 *   presence:project:{projectId}      — SET of userIds currently online in
 *                                       that project (refreshed; rebuilt
 *                                       lazily from per-user keys)
 *
 * Falls back to a no-op (in-memory online flag) when Redis isn't
 * configured, so single-instance dev still gets "user is here" but
 * loses persistence across restart.
 */
@Injectable()
export class ChatPresenceService {
  private static readonly USER_TTL_S = 60;
  private static readonly SOCKET_TTL_S = 120;

  // Fallback in-memory store when Redis is disabled. Keyed by userId →
  // Set of socketIds. Same shape, lossy on restart.
  private readonly memUser = new Map<string, Set<string>>();
  private readonly memSocket = new Map<string, { userId: string; projects: Set<string> }>();

  constructor(@Optional() @Inject(REDIS_PUB) private readonly redis: Redis | null) {}

  /** Register a fresh socket connection. Returns true if this is the first socket for the user. */
  async addSocket(userId: string, socketId: string): Promise<boolean> {
    if (this.redis) {
      const key = `presence:user:${userId}`;
      const added = await this.redis.sadd(key, socketId);
      await this.redis.expire(key, ChatPresenceService.USER_TTL_S);
      await this.redis.set(
        `presence:socket:${socketId}`,
        JSON.stringify({ userId, projects: [] }),
        'EX',
        ChatPresenceService.SOCKET_TTL_S,
      );
      return added === 1 && (await this.redis.scard(key)) === 1;
    }
    let set = this.memUser.get(userId);
    const firstSocket = !set || set.size === 0;
    if (!set) {
      set = new Set();
      this.memUser.set(userId, set);
    }
    set.add(socketId);
    this.memSocket.set(socketId, { userId, projects: new Set() });
    return firstSocket;
  }

  /** Remove a socket. Returns true if the user has no remaining sockets (went offline). */
  async removeSocket(
    socketId: string,
  ): Promise<{ userId: string; nowOffline: boolean; projects: string[] } | null> {
    if (this.redis) {
      const raw = await this.redis.get(`presence:socket:${socketId}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { userId: string; projects: string[] };
      await this.redis.del(`presence:socket:${socketId}`);
      const key = `presence:user:${parsed.userId}`;
      await this.redis.srem(key, socketId);
      const remaining = await this.redis.scard(key);
      if (remaining === 0) await this.redis.del(key);
      return { userId: parsed.userId, nowOffline: remaining === 0, projects: parsed.projects };
    }
    const entry = this.memSocket.get(socketId);
    if (!entry) return null;
    this.memSocket.delete(socketId);
    const set = this.memUser.get(entry.userId);
    set?.delete(socketId);
    const nowOffline = !set || set.size === 0;
    if (nowOffline) this.memUser.delete(entry.userId);
    return { userId: entry.userId, nowOffline, projects: [...entry.projects] };
  }

  /** Refresh TTLs — called on each heartbeat from the client. */
  async heartbeat(userId: string, socketId: string): Promise<void> {
    if (this.redis) {
      await this.redis.expire(`presence:user:${userId}`, ChatPresenceService.USER_TTL_S);
      await this.redis.expire(`presence:socket:${socketId}`, ChatPresenceService.SOCKET_TTL_S);
      return;
    }
    // No-op for in-memory mode — entries don't expire on their own.
  }

  /** Note which project rooms a socket has joined so we can fan out the disconnect. */
  async trackProject(socketId: string, projectId: string): Promise<void> {
    if (this.redis) {
      const raw = await this.redis.get(`presence:socket:${socketId}`);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { userId: string; projects: string[] };
      if (parsed.projects.includes(projectId)) return;
      parsed.projects.push(projectId);
      await this.redis.set(
        `presence:socket:${socketId}`,
        JSON.stringify(parsed),
        'EX',
        ChatPresenceService.SOCKET_TTL_S,
      );
      return;
    }
    const entry = this.memSocket.get(socketId);
    entry?.projects.add(projectId);
  }

  /** True if the user has at least one live socket. */
  async isOnline(userId: string): Promise<boolean> {
    if (this.redis) return (await this.redis.scard(`presence:user:${userId}`)) > 0;
    return (this.memUser.get(userId)?.size ?? 0) > 0;
  }
}
