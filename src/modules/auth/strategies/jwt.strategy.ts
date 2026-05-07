import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { AuthService } from '../auth.service';

interface KeycloakJwtPayload {
  sub: string;
  email?: string;
  email_verified?: boolean;
  preferred_username?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  iss: string;
  aud?: string | string[];
  exp: number;
  iat: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    private readonly config: ConfigService,
    private readonly authService: AuthService,
  ) {
    const jwksUri = config.getOrThrow<string>('keycloak.jwksUri');
    const issuer = config.getOrThrow<string>('keycloak.issuer');
    const audience = config.get<string>('keycloak.audience') ?? 'account';

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      issuer,
      audience,
      algorithms: ['RS256'],
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        cacheMaxAge: 10 * 60 * 1000,
        rateLimit: true,
        jwksRequestsPerMinute: 10,
        jwksUri,
      }),
    });
  }

  async validate(payload: KeycloakJwtPayload): Promise<AuthenticatedUser> {
    if (!payload.sub) {
      throw new UnauthorizedException('Token has no subject claim.');
    }
    if (!payload.email) {
      // Keycloak should always send email for our realm — if it's missing, the
      // token was likely issued for a service account or misconfigured client.
      throw new UnauthorizedException('Token has no email claim.');
    }

    try {
      return await this.authService.syncUserFromToken(payload);
    } catch (err) {
      this.logger.error('Failed to sync user from Keycloak token', err as Error);
      throw new UnauthorizedException('Could not establish user session.');
    }
  }
}
