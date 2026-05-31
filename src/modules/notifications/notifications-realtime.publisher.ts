import { Injectable, Logger } from '@nestjs/common';
import type { Namespace } from 'socket.io';

/**
 * Central emit point for notification realtime events. The gateway
 * attaches its `/notifications` Namespace once on init. Until attached,
 * publish calls are silent no-ops so REST + push delivery keep working.
 *
 * Room convention:
 *   user:{userId} — every socket connected by that user
 */
@Injectable()
export class NotificationsRealtimePublisher {
  private readonly logger = new Logger(NotificationsRealtimePublisher.name);
  private ns: Namespace | null = null;

  attach(ns: Namespace): void {
    this.ns = ns;
    this.logger.log('notifications realtime publisher attached');
  }

  static userRoom(userId: string): string {
    return `user:${userId}`;
  }

  private emit(room: string, event: string, payload: unknown): void {
    if (!this.ns) return;
    this.ns.to(room).emit(event, payload);
  }

  /** Fire-and-forget delivery of a newly persisted notification to the recipient. */
  notificationCreated(userId: string, notification: NotificationWire): void {
    this.emit(NotificationsRealtimePublisher.userRoom(userId), 'notification:new', notification);
  }

  /** Live-update the unread badge when the user reads on another device. */
  unreadChanged(userId: string, unread: number): void {
    this.emit(NotificationsRealtimePublisher.userRoom(userId), 'notification:unread', { unread });
  }
}

export interface NotificationWire {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  metadata: unknown;
  readAt: string | null;
  createdAt: string;
}
