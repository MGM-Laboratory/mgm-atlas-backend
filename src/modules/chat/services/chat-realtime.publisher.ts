import { Injectable, Logger } from '@nestjs/common';
import type { Namespace } from 'socket.io';
import type { ChatChannelPublic } from './chat-channels.service';
import type { ChatMessagePublic } from './chat-messages.service';

/**
 * Central emit point for chat realtime events. All mutation services
 * call this — never `gateway.server.emit` directly — so the wire
 * shape is defined in one place.
 *
 * The gateway calls `attach(ns)` during initialization with its own
 * `/chat` Namespace (Nest passes the namespace, not the root Server,
 * to `afterInit` and `@WebSocketServer()` when the gateway declares
 * `namespace: '/chat'`). Until attached, publish calls are silent
 * no-ops (REST keeps working; the frontend falls back to polling).
 *
 * Room conventions:
 *   project:{id}  — project-level fanout (channel.created, unread.update, presence)
 *   global        — workspace-global fanout (projectId = null channels);
 *                   every authenticated socket joins it on connect
 *   channel:{id}  — per-channel events (message, reaction, pin, typing)
 */
@Injectable()
export class ChatRealtimePublisher {
  private readonly logger = new Logger(ChatRealtimePublisher.name);
  private ns: Namespace | null = null;

  attach(ns: Namespace): void {
    this.ns = ns;
    this.logger.log('realtime publisher attached');
  }

  private channelRoom(channelId: string) {
    return `channel:${channelId}`;
  }

  private projectRoom(projectId: string | null) {
    return projectId ? `project:${projectId}` : 'global';
  }

  private emit(room: string, event: string, payload: unknown): void {
    if (!this.ns) return;
    this.ns.to(room).emit(event, payload);
  }

  // ─── Message lifecycle ─────────────────────────────────────────────

  messageCreated(
    channelId: string,
    projectId: string | null,
    message: ChatMessagePublic,
    clientMessageId?: string,
  ): void {
    const wire = { ...message, clientMessageId };
    this.emit(this.channelRoom(channelId), 'message.created', wire);
    this.emit(this.projectRoom(projectId), 'unread.update', { channelId });
  }

  messageEdited(channelId: string, message: ChatMessagePublic): void {
    this.emit(this.channelRoom(channelId), 'message.edited', message);
  }

  messageDeleted(channelId: string, message: ChatMessagePublic): void {
    this.emit(this.channelRoom(channelId), 'message.deleted', message);
  }

  // ─── Reactions ─────────────────────────────────────────────────────

  reactionAdded(channelId: string, messageId: string, userId: string, emoji: string): void {
    this.emit(this.channelRoom(channelId), 'reaction.added', { messageId, userId, emoji });
  }

  reactionRemoved(channelId: string, messageId: string, userId: string, emoji: string): void {
    this.emit(this.channelRoom(channelId), 'reaction.removed', { messageId, userId, emoji });
  }

  // ─── Pins ──────────────────────────────────────────────────────────

  pinAdded(channelId: string, messageId: string, note: string | null = null): void {
    this.emit(this.channelRoom(channelId), 'pin.added', { messageId, note });
  }

  pinRemoved(channelId: string, messageId: string): void {
    this.emit(this.channelRoom(channelId), 'pin.removed', { messageId });
  }

  // ─── Channels ──────────────────────────────────────────────────────

  channelCreated(projectId: string | null, channel: ChatChannelPublic): void {
    this.emit(this.projectRoom(projectId), 'channel.created', channel);
  }

  channelUpdated(projectId: string | null, channel: ChatChannelPublic): void {
    this.emit(this.projectRoom(projectId), 'channel.updated', channel);
  }

  channelArchived(projectId: string | null, channelId: string): void {
    this.emit(this.projectRoom(projectId), 'channel.archived', { channelId });
  }
}
