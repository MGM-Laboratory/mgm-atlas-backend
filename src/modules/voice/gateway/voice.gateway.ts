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
import { VoiceRealtimePublisher } from '../services/voice-realtime.publisher';
import { WsSessionGuard } from '@/modules/chat/gateway/ws-session.guard';

/**
 * `/voice` namespace. Mirrors ChatGateway:
 *   - Auth on the handshake (invalid token → immediate disconnect).
 *   - Rooms: `project:{id}` (channel-list updates) + `channel:{id}`
 *     (in-room events) + `voice-lobby` (workspace lobby list updates).
 *
 * Note: the *audio media* doesn't ride this WebSocket at all — that's
 * LiveKit's own WSS signaling on /livekit/. This gateway only carries
 * Atlas-side metadata: who's in which channel, channel CRUD fanout,
 * etc.
 */
@WebSocketGateway({
  namespace: '/voice',
  cors: { origin: true, credentials: true },
  transports: ['websocket'],
})
export class VoiceGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(VoiceGateway.name);

  @WebSocketServer()
  server!: Namespace;

  constructor(
    private readonly sessionService: SessionService,
    private readonly access: ProjectAccessService,
    private readonly realtime: VoiceRealtimePublisher,
  ) {}

  afterInit(ns: Namespace): void {
    this.realtime.attach(ns);
    this.logger.log('VoiceGateway initialised');
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
    // Every socket joins its own user:<id> room so the realtime
    // publisher can emit personally-addressed events (force-mute,
    // forced move with a freshly-minted JWT, kick toast, etc.).
    // The user only sees events meant for them, even across tabs.
    await socket.join(`user:${user.id}`);
    this.logger.debug(`voice connect user=${user.id} sock=${socket.id}`);
  }

  async handleDisconnect(@ConnectedSocket() socket: Socket) {
    this.logger.debug(`voice disconnect sock=${socket.id}`);
  }

  /**
   * Subscribe to project-level voice events (channel-list updates,
   * roster avatars in the sidebar). Re-uses the existing
   * ProjectAccessService gate so non-insiders can never observe the
   * voice channel list of a project they're not in.
   */
  @UseGuards(WsSessionGuard)
  @SubscribeMessage('voice:subscribe.project')
  async subscribeProject(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { projectId: string },
  ): Promise<{ ok: boolean; error?: string }> {
    const user = socket.data.user as AuthenticatedUser;
    try {
      const { projectId, access } = await this.access.resolve(body.projectId, user);
      this.access.assertInsider(access);
      await socket.join(`project:${projectId}`);
      (socket.data.projects as Set<string>).add(projectId);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /**
   * Subscribe to the workspace-lobby channel list. Any authenticated
   * Atlas user may listen.
   */
  @UseGuards(WsSessionGuard)
  @SubscribeMessage('voice:subscribe.lobby')
  async subscribeLobby(@ConnectedSocket() socket: Socket): Promise<{ ok: boolean }> {
    await socket.join('voice-lobby');
    return { ok: true };
  }

  /**
   * Subscribe to in-room events for a specific voice channel. The
   * JWT mint at `/voice/channels/:id/join` is the actual access gate
   * (you can't join a LiveKit room without it); this just lets the
   * client observe roster + speaker updates for the channel it's
   * currently inside.
   */
  @UseGuards(WsSessionGuard)
  @SubscribeMessage('voice:subscribe.channel')
  async subscribeChannel(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { channelId: string },
  ): Promise<{ ok: boolean }> {
    if (!body?.channelId) return { ok: false };
    await socket.join(`channel:${body.channelId}`);
    return { ok: true };
  }

  @UseGuards(WsSessionGuard)
  @SubscribeMessage('voice:unsubscribe.channel')
  async unsubscribeChannel(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { channelId: string },
  ): Promise<{ ok: boolean }> {
    if (body?.channelId) {
      await socket.leave(`channel:${body.channelId}`);
    }
    return { ok: true };
  }

  /**
   * Client-side speaker indicator broadcast. The browser observes
   * ActiveSpeakersChanged from its own LiveKit Room (it's already
   * receiving every audio track), and forwards the deduped list to
   * peers via this socket so even non-LiveKit observers (e.g. the
   * channel-list sidebar showing speaking halos on tiles without a
   * full Room connection) can react.
   *
   * This is intentionally a low-trust, fire-and-forget event — we
   * don't validate that the user is actually in the channel. The
   * worst-case is a malicious user emitting fake speaker updates,
   * which is harmless (visual indicator only; the actual audio is
   * authoritative).
   */
  @UseGuards(WsSessionGuard)
  @SubscribeMessage('voice:speaking')
  async speaking(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { channelId: string; speakers: string[] },
  ): Promise<void> {
    const user = socket.data.user as AuthenticatedUser;
    if (!body?.channelId || !Array.isArray(body.speakers)) return;
    // Broadcast to other clients in this channel — not back to the
    // sender. The sender already knows it's speaking.
    socket.to(`channel:${body.channelId}`).emit('voice.speaker.update', {
      channelId: body.channelId,
      reportedBy: user.id,
      speakers: body.speakers,
    });
  }

  private extractToken(socket: Socket): string | null {
    const auth = socket.handshake.auth as { token?: string } | undefined;
    if (auth?.token) return auth.token;
    const header = socket.handshake.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.substring(7);
    return null;
  }
}
