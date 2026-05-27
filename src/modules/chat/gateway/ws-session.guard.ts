import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Socket } from 'socket.io';
import { SessionService } from '@/modules/auth/session.service';

/**
 * Validates `socket.handshake.auth.token` (the bearer sessionId) and
 * attaches the loaded user onto `socket.data.user` so the gateway can
 * use it without re-querying. Reuses the same SessionService method
 * the HTTP JwtStrategy now calls, so HTTP and WS auth can never drift.
 *
 * Returning false here causes Nest to disconnect the socket.
 */
@Injectable()
export class WsSessionGuard implements CanActivate {
  constructor(private readonly sessionService: SessionService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const socket = ctx.switchToWs().getClient<Socket>();
    if (socket.data?.user) return true; // already validated on connect

    const token = this.extractToken(socket);
    if (!token) return false;

    const user = await this.sessionService.validateBearerAndLoadUser(token);
    if (!user) return false;

    socket.data.user = user;
    return true;
  }

  private extractToken(socket: Socket): string | null {
    const auth = socket.handshake.auth as { token?: string } | undefined;
    if (auth?.token) return auth.token;
    const header = socket.handshake.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.substring(7);
    return null;
  }
}
