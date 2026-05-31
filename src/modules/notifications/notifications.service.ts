import { Injectable, Logger } from '@nestjs/common';
import { Notification, NotificationType, Prisma } from '@prisma/client';
import { paginate } from '@/common/dto/pagination.dto';
import { PrismaService } from '@/prisma/prisma.service';
import {
  NotificationsRealtimePublisher,
  type NotificationWire,
} from './notifications-realtime.publisher';
import { NotificationPreferencesService } from './notification-preferences.service';
import { PushDispatchService, type PushPayload } from './push-dispatch.service';

export interface NotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
  metadata?: Prisma.InputJsonValue;
}

/**
 * `notify()` extends the original `create()` API with realtime + push
 * delivery. Three deliveries from one call, all fire-and-forget:
 *   1. Persist a `Notification` row (DB source of truth for the bell).
 *   2. Emit `notification:new` on the user's socket room (live UI).
 *   3. Dispatch Web Push to every registered subscription (background).
 * Steps 2 + 3 are wrapped in try/catch so the caller's mutation path
 * never fails because realtime is down or VAPID isn't configured.
 *
 * `create()` and `createMany()` remain unchanged for callers that
 * deliberately only want the DB row (e.g. backfills, admin tools).
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: NotificationsRealtimePublisher,
    private readonly prefs: NotificationPreferencesService,
    private readonly push: PushDispatchService,
  ) {}

  /** Persist only — legacy callers. */
  create(input: NotificationInput) {
    return this.prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        link: input.link,
        metadata: input.metadata,
      },
    });
  }

  /** Bulk persist only — legacy callers. */
  createMany(inputs: NotificationInput[]) {
    if (inputs.length === 0) return Promise.resolve({ count: 0 });
    return this.prisma.notification.createMany({
      data: inputs.map((i) => ({
        userId: i.userId,
        type: i.type,
        title: i.title,
        body: i.body,
        link: i.link,
        metadata: i.metadata as Prisma.InputJsonValue,
      })),
    });
  }

  /**
   * Persist + emit + push. The returned Notification is the persisted
   * row; realtime/push happen out-of-band and don't block the response.
   * `pushTag` collapses multiple notifications from the same thread into
   * one OS-level banner (e.g. `chat:{channelId}` for chat).
   */
  async notify(input: NotificationInput & { pushTag?: string }): Promise<Notification> {
    const row = await this.prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        link: input.link,
        metadata: input.metadata,
      },
    });

    try {
      this.realtime.notificationCreated(input.userId, toWire(row));
    } catch (err) {
      this.logger.warn(`realtime emit failed: ${String(err)}`);
    }

    // Push runs in the background — never await on the caller's path.
    void this.maybePush(input.userId, input.type, row, input.pushTag).catch((err: unknown) =>
      this.logger.warn(`push dispatch errored: ${String(err)}`),
    );

    return row;
  }

  /** Convenience wrapper for blasting the same payload to many users. */
  async notifyMany(
    userIds: string[],
    input: Omit<NotificationInput, 'userId'> & { pushTag?: string },
  ): Promise<void> {
    await Promise.all(userIds.map((userId) => this.notify({ ...input, userId })));
  }

  private async maybePush(
    userId: string,
    type: NotificationType,
    row: Notification,
    pushTag: string | undefined,
  ): Promise<void> {
    if (!this.push.isConfigured()) return;
    const allowed = await this.prefs.isPushEnabledFor(userId, type);
    if (!allowed) return;

    const payload: PushPayload = {
      title: row.title,
      body: row.body,
      link: row.link ?? undefined,
      tag: pushTag,
      notificationId: row.id,
      type,
      data: row.metadata as Record<string, unknown> | undefined,
    };
    await this.push.dispatchToUser(userId, payload);
  }

  // ─── Read paths (unchanged behaviour, plus unread fanout on reads) ────

  async list(userId: string, page = 1, pageSize = 20) {
    const where: Prisma.NotificationWhereInput = { userId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.notification.count({ where }),
    ]);
    return paginate(items, total, page, pageSize);
  }

  async unreadCount(userId: string) {
    return {
      unread: await this.prisma.notification.count({ where: { userId, readAt: null } }),
    };
  }

  async markRead(userId: string, id: string) {
    await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    void this.emitUnread(userId);
    return { ok: true };
  }

  async markAllRead(userId: string) {
    const res = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    void this.emitUnread(userId);
    return { updated: res.count };
  }

  /**
   * Emit the post-read unread count so the bell on the user's OTHER tabs
   * updates immediately. Best-effort — failures don't poison the read path.
   */
  private async emitUnread(userId: string): Promise<void> {
    try {
      const unread = await this.prisma.notification.count({
        where: { userId, readAt: null },
      });
      this.realtime.unreadChanged(userId, unread);
    } catch (err) {
      this.logger.warn(`unread emit failed: ${String(err)}`);
    }
  }
}

function toWire(row: Notification): NotificationWire {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    link: row.link,
    metadata: row.metadata,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}
