import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';
import type { Request } from 'express';
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
  private readonly issuer: string;
  private readonly audience?: string;

  constructor(
    private readonly config: ConfigService,
    private readonly authService: AuthService,
  ) {
    const jwksUri = config.getOrThrow<string>('keycloak.jwksUri');
    const issuer = config.getOrThrow<string>('keycloak.issuer');
    // An empty KEYCLOAK_AUDIENCE skips audience validation. This is useful in
    // setups where the Keycloak client hasn't been configured with an audience
    // mapper (the access token's `aud` defaults to ["account"] or to the
    // client id depending on Keycloak version).
    const audience = config.get<string>('keycloak.audience');

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      issuer,
      ...(audience ? { audience } : {}),
      algorithms: ['RS256'],
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        cacheMaxAge: 10 * 60 * 1000,
        rateLimit: true,
        jwksRequestsPerMinute: 10,
        jwksUri,
      }),
      passReqToCallback: true,
    });

    this.issuer = issuer;
    this.audience = audience;
  }

  async validate(req: Request, payload: KeycloakJwtPayload): Promise<AuthenticatedUser> {
    if (!payload.sub) {
      throw new UnauthorizedException('Token has no subject claim.');
    }

    let email = payload.email;
    let name = payload.name;
    let picture = payload.picture;
    let preferred = payload.preferred_username;
    let given = payload.given_name;
    let family = payload.family_name;

    // Keycloak's default mapper puts `email` in the ID token but NOT the
    // access token. Fall back to /userinfo using the same bearer token if the
    // access token lacks it — this works as long as the `email` scope was
    // requested (which the frontend always does).
    if (!email) {
      const fallback = await this.fetchUserInfo(req);
      if (fallback) {
        email = fallback.email ?? email;
        name = name ?? fallback.name;
        picture = picture ?? fallback.picture;
        preferred = preferred ?? fallback.preferred_username;
        given = given ?? fallback.given_name;
        family = family ?? fallback.family_name;
      }
    }

    if (!email) {
      this.logger.warn(
        `Keycloak token for sub=${payload.sub} has no email claim and userinfo did not return one. ` +
          `Check that the Keycloak client requests the "email" scope and that the email mapper is enabled for the access token (or at least for userinfo).`,
      );
      throw new UnauthorizedException('Token has no email claim.');
    }

    try {
      return await this.authService.syncUserFromToken({
        sub: payload.sub,
        email,
        name,
        picture,
        preferred_username: preferred,
        given_name: given,
        family_name: family,
      });
    } catch (err) {
      this.logger.error('Failed to sync user from Keycloak token', err as Error);
      throw new UnauthorizedException('Could not establish user session.');
    }
  }

  private async fetchUserInfo(req: Request): Promise<{
    email?: string;
    name?: string;
    picture?: string;
    preferred_username?: string;
    given_name?: string;
    family_name?: string;
  } | null> {
    const auth = req.headers.authorization;
    if (!auth) return null;
    const userinfoUrl = `${this.issuer.replace(/\/$/, '')}/protocol/openid-connect/userinfo`;
    try {
      const res = await fetch(userinfoUrl, {
        headers: { Authorization: auth },
        // Keycloak userinfo is fast; fail closed if it stalls.
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        this.logger.warn(
          `Keycloak userinfo lookup failed: ${res.status} ${res.statusText}`,
        );
        return null;
      }
      return (await res.json()) as Awaited<ReturnType<JwtStrategy['fetchUserInfo']>>;
    } catch (err) {
      this.logger.warn(`Keycloak userinfo request errored: ${(err as Error).message}`);
      return null;
    }
  }
}
