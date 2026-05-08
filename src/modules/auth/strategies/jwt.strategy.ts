import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '@/prisma/prisma.service';
import { SessionService } from '../session.service';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionService: SessionService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      // The "token" here is actually a session ID, not a JWT
      ignoreExpiration: false,
    });
  }

  async validate(sessionId: string): Promise<AuthenticatedUser> {
    // Validate the session ID against the database
    const session = await this.sessionService.validateSession(sessionId);

    if (!session) {
      throw new UnauthorizedException('Invalid or expired session.');
    }

    // Load the user from the database
    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
      select: {
        id: true,
        keycloakId: true,
        email: true,
        name: true,
        avatarUrl: true,
        isAdmin: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found.');
    }

    return user as AuthenticatedUser;
  }
}
