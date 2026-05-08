import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/prisma/prisma.service';

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Create a new session after successful Keycloak authentication.
   * Returns the session ID to be stored on the frontend (no cookies).
   */
  async createSession(
    userId: string,
    accessToken: string,
    refreshToken?: string,
    idToken?: string,
  ): Promise<{ sessionId: string; expiresAt: Date }> {
    const sessionDurationMinutes = this.config.get<number>(
      'session.durationMinutes',
      480,
    ); // 8 hours default

    const expiresAt = new Date(Date.now() + sessionDurationMinutes * 60 * 1000);

    const session = await this.prisma.session.create({
      data: {
        userId,
        accessToken,
        refreshToken,
        idToken,
        expiresAt,
      },
      select: {
        id: true,
        expiresAt: true,
      },
    });

    return {
      sessionId: session.id,
      expiresAt: session.expiresAt,
    };
  }

  /**
   * Validate a session by its ID. Returns user data if valid.
   * Clears expired sessions automatically.
   */
  async validateSession(sessionId: string): Promise<{
    userId: string;
    accessToken: string;
    refreshToken?: string;
    idToken?: string;
    expiresAt: Date;
  } | null> {
    // Clean up expired sessions periodically
    await this.prisma.session.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });

    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: {
        userId: true,
        accessToken: true,
        refreshToken: true,
        idToken: true,
        expiresAt: true,
      },
    });

    if (!session || session.expiresAt < new Date()) {
      if (session) {
        await this.prisma.session.delete({ where: { id: sessionId } });
      }
      return null;
    }

    return session;
  }

  /**
   * Destroy a session (logout).
   */
  async destroySession(sessionId: string): Promise<void> {
    await this.prisma.session.delete({
      where: { id: sessionId },
    });
  }

  /**
   * Refresh session tokens if refresh token is available.
   */
  async refreshSessionTokens(
    sessionId: string,
    newAccessToken: string,
    newRefreshToken?: string,
    newIdToken?: string,
  ): Promise<void> {
    const sessionDurationMinutes = this.config.get<number>(
      'session.durationMinutes',
      480,
    );
    const expiresAt = new Date(Date.now() + sessionDurationMinutes * 60 * 1000);

    await this.prisma.session.update({
      where: { id: sessionId },
      data: {
        accessToken: newAccessToken,
        ...(newRefreshToken && { refreshToken: newRefreshToken }),
        ...(newIdToken && { idToken: newIdToken }),
        expiresAt,
      },
    });
  }
}
