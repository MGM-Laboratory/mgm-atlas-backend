import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { SessionService } from '@/modules/auth/session.service';
import { NotificationsRealtimePublisher } from './notifications-realtime.publisher';

/**
 * `/notifications` namespace. Per-user fanout for the in-app notification
 * bell + tab-title badge. Connection is authenticated on the handshake
 * (same `sessionId`-as-bearer scheme as the chat gateway) and the socket
 * is joined to `user:{userId}` — every emit through
 * NotificationsRealtimePublisher reaches every device the user has open.
 *
 * Decoupled from the chat namespace on purpose: notifications must work
 * for users who never open chat, and the room model (user-scoped vs
 * project-scoped) is fundamentally different.
 */
@WebSocketGateway({
  namespace: '/notifications',
  cors: { origin: true, credentials: true },
  transports: ['websocket'],
})
export class NotificationsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(NotificationsGateway.name);

  @WebSocketServer()
  server!: Namespace;

  constructor(
    private readonly sessionService: SessionService,
    private readonly realtime: NotificationsRealtimePublisher,
  ) {}

  afterInit(ns: Namespace): void {
    this.realtime.attach(ns);
    this.logger.log('NotificationsGateway initialised');
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
    await socket.join(NotificationsRealtimePublisher.userRoom(user.id));
    this.logger.debug(`connect user=${user.id} sock=${socket.id}`);
  }

  handleDisconnect(@ConnectedSocket() socket: Socket): void {
    const user = socket.data.user as { id?: string } | undefined;
    this.logger.debug(`disconnect user=${user?.id ?? '?'} sock=${socket.id}`);
  }

  private extractToken(socket: Socket): string | null {
    const auth = socket.handshake.auth as { token?: string } | undefined;
    if (auth?.token) return auth.token;
    const header = socket.handshake.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.substring(7);
    return null;
  }
}
