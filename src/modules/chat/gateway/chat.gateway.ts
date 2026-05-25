import { Logger, UseGuards } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { SessionService } from '@/modules/auth/session.service';
import { ProjectAccessService } from '@/modules/projects/project-access.service';
import { ChatPresenceService } from '../services/chat-presence.service';
import { ChatRealtimePublisher } from '../services/chat-realtime.publisher';
import { ChatTypingService } from '../services/chat-typing.service';
import { WsSessionGuard } from './ws-session.guard';

/**
 * `/chat` namespace. Authentication happens on the connection handshake
 * (not via @UseGuards on every event) so an invalid token disconnects
 * the socket immediately — never holds a half-open connection.
 *
 * Room model:
 *   project:{id}  → presence, channel.created/archived, unread.update
 *   channel:{id}  → message.*, reaction.*, pin.*, typing.*
 *
 * The gateway only owns room management + presence/typing. Mutation
 * events (message.created etc.) come through ChatRealtimePublisher,
 * which the REST services call after every write.
 */
@WebSocketGateway({
  namespace: '/chat',
  cors: { origin: true, credentials: true },
  transports: ['websocket'],
})
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChatGateway.name);

  // With `namespace: '/chat'`, Nest injects the Namespace here — NOT
  // the root socket.io Server. We don't call `.of()` on it (that's a
  // Server method, doesn't exist on Namespace); we use it directly.
  @WebSocketServer()
  server!: Namespace;

  constructor(
    private readonly sessionService: SessionService,
    private readonly access: ProjectAccessService,
    private readonly presence: ChatPresenceService,
    private readonly typing: ChatTypingService,
    private readonly realtime: ChatRealtimePublisher,
  ) {}

  // ─── Lifecycle ──────────────────────────────────────────────────────

  afterInit(ns: Namespace): void {
    // `ns` is this gateway's `/chat` namespace (Nest passes the
    // namespace, not the root Server, when the gateway declares one).
    // Hand it to the publisher so REST controllers can emit through it.
    this.realtime.attach(ns);
    this.logger.log('ChatGateway initialised');
  }

  async handleConnection(@ConnectedSocket() socket: Socket) {
    const token = this.extractToken(socket);
    if (!token) {
      socket.disconnect();
      return;
    }
    const user = await this.sessionService.validateBearerAndLoadUser(token);
    if (!user) {
      socket.disconnect();
      return;
    }
    socket.data.user = user;
    socket.data.projects = new Set<string>();

    const firstSocket = await this.presence.addSocket(user.id, socket.id);
    this.logger.debug(`connect user=${user.id} sock=${socket.id} firstSocket=${firstSocket}`);
  }

  async handleDisconnect(@ConnectedSocket() socket: Socket) {
    const result = await this.presence.removeSocket(socket.id);
    if (!result) return;
    if (result.nowOffline) {
      for (const projectId of result.projects) {
        // `this.server` is already the `/chat` namespace — emit directly.
        this.server
          .to(`project:${projectId}`)
          .emit('presence.update', { userId: result.userId, online: false });
      }
    }
    this.logger.debug(
      `disconnect user=${result.userId} sock=${socket.id} offline=${result.nowOffline}`,
    );
  }

  // ─── Subscribe / unsubscribe ────────────────────────────────────────

  /** Client opened a channel — verify access and join the rooms. */
  @UseGuards(WsSessionGuard)
  @SubscribeMessage('chat:subscribe')
  async subscribe(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { projectId: string; channelId?: string },
  ): Promise<{ ok: boolean; error?: string }> {
    const user = socket.data.user as AuthenticatedUser;
    try {
      const { projectId, access } = await this.access.resolve(body.projectId, user);
      this.access.assertInsider(access);

      const projectRoom = `project:${projectId}`;
      if (!socket.rooms.has(projectRoom)) {
        await socket.join(projectRoom);
        (socket.data.projects as Set<string>).add(projectId);
        await this.presence.trackProject(socket.id, projectId);
        // Announce to other listeners in the project that this user is online.
        socket.to(projectRoom).emit('presence.update', { userId: user.id, online: true });
      }
      if (body.channelId) {
        await socket.join(`channel:${body.channelId}`);
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /** Leave only the channel room (presence/project room stays). */
  @UseGuards(WsSessionGuard)
  @SubscribeMessage('chat:unsubscribe')
  async unsubscribe(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { channelId?: string },
  ): Promise<{ ok: boolean }> {
    if (body.channelId) {
      await socket.leave(`channel:${body.channelId}`);
    }
    return { ok: true };
  }

  // ─── Heartbeat / typing ────────────────────────────────────────────

  @UseGuards(WsSessionGuard)
  @SubscribeMessage('presence:heartbeat')
  async heartbeat(@ConnectedSocket() socket: Socket): Promise<void> {
    const user = socket.data.user as AuthenticatedUser;
    await this.presence.heartbeat(user.id, socket.id);
  }

  @UseGuards(WsSessionGuard)
  @SubscribeMessage('typing:ping')
  async typingPing(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { channelId: string },
  ): Promise<void> {
    const user = socket.data.user as AuthenticatedUser;
    if (!body?.channelId) return;
    if (!socket.rooms.has(`channel:${body.channelId}`)) return;
    const fresh = await this.typing.ping(body.channelId, user.id);
    if (fresh) {
      socket
        .to(`channel:${body.channelId}`)
        .emit('typing.start', { channelId: body.channelId, userId: user.id, name: user.name });
    }
  }

  @UseGuards(WsSessionGuard)
  @SubscribeMessage('typing:stop')
  async typingStop(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { channelId: string },
  ): Promise<void> {
    const user = socket.data.user as AuthenticatedUser;
    if (!body?.channelId) return;
    const stopped = await this.typing.stop(body.channelId, user.id);
    if (stopped) {
      socket
        .to(`channel:${body.channelId}`)
        .emit('typing.stop', { channelId: body.channelId, userId: user.id });
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private extractToken(socket: Socket): string | null {
    const auth = socket.handshake.auth as { token?: string } | undefined;
    if (auth?.token) return auth.token;
    const header = socket.handshake.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.substring(7);
    return null;
  }
}
