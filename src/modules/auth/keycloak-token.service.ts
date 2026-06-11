import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import jwksRsa from 'jwks-rsa';

export interface VerifiedKeycloakClaims {
  sub: string;
  email?: string;
  preferred_username?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
}

interface LoginTokens {
  accessToken: string;
  idToken?: string;
}

type TokenKind = 'access' | 'id';

/**
 * Verifies Keycloak-issued JWTs against the realm JWKS before any identity
 * claim is trusted. Sessions must only ever be minted from claims returned
 * by this service — never from the request body.
 */
@Injectable()
export class KeycloakTokenService {
  private readonly logger = new Logger(KeycloakTokenService.name);
  private readonly jwks: jwksRsa.JwksClient;
  private readonly issuer: string;
  private readonly clientId: string;
  private readonly audience: string;

  constructor(private readonly config: ConfigService) {
    this.issuer = this.config.getOrThrow<string>('keycloak.issuer');
    this.clientId = this.config.getOrThrow<string>('keycloak.clientId');
    this.audience = this.config.get<string>('keycloak.audience') ?? 'account';
    this.jwks = new jwksRsa.JwksClient({
      jwksUri: this.config.getOrThrow<string>('keycloak.jwksUri'),
      cache: true,
      cacheMaxAge: 10 * 60 * 1000,
      rateLimit: true,
      jwksRequestsPerMinute: 10,
      timeout: 10_000,
    });
  }

  /**
   * Verify the tokens sent to POST /auth/login and return the identity
   * claims of the authenticated subject.
   *
   * The access token is mandatory and must verify. When an ID token is also
   * supplied it must verify too (same subject, audience = our client); its
   * profile claims then take precedence because Keycloak puts the richer
   * profile there. A missing email is resolved via the userinfo endpoint
   * using the (already verified) access token.
   */
  async verifyLoginTokens(tokens: LoginTokens): Promise<VerifiedKeycloakClaims> {
    const access = await this.verify(tokens.accessToken, 'access');
    const id = tokens.idToken ? await this.verify(tokens.idToken, 'id') : undefined;

    if (id && id.sub !== access.sub) {
      throw new UnauthorizedException('Access and ID token subjects do not match.');
    }

    const merged = { ...access, ...(id ?? {}) };
    const claims: VerifiedKeycloakClaims = {
      sub: merged.sub as string,
      email: typeof merged.email === 'string' ? merged.email : undefined,
      preferred_username:
        typeof merged.preferred_username === 'string' ? merged.preferred_username : undefined,
      name: typeof merged.name === 'string' ? merged.name : undefined,
      given_name: typeof merged.given_name === 'string' ? merged.given_name : undefined,
      family_name: typeof merged.family_name === 'string' ? merged.family_name : undefined,
      picture: typeof merged.picture === 'string' ? merged.picture : undefined,
    };

    if (!claims.email) {
      const userinfo = await this.fetchUserinfo(tokens.accessToken, claims.sub);
      if (userinfo) {
        claims.email = claims.email ?? userinfo.email;
        claims.name = claims.name ?? userinfo.name;
        claims.preferred_username = claims.preferred_username ?? userinfo.preferred_username;
        claims.picture = claims.picture ?? userinfo.picture;
      }
    }

    return claims;
  }

  private async verify(token: string, kind: TokenKind): Promise<jwt.JwtPayload> {
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || typeof decoded === 'string' || !decoded.header.kid) {
      throw new UnauthorizedException(`Malformed ${kind} token.`);
    }

    let publicKey: string;
    try {
      const key = await this.jwks.getSigningKey(decoded.header.kid);
      publicKey = key.getPublicKey();
    } catch {
      this.logger.warn(`JWKS lookup failed for ${kind} token kid=${decoded.header.kid}`);
      throw new UnauthorizedException(`Unknown signing key for ${kind} token.`);
    }

    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(token, publicKey, {
        algorithms: ['RS256'],
        issuer: this.issuer,
        clockTolerance: 60,
      }) as jwt.JwtPayload;
    } catch (err) {
      this.logger.warn(
        `Rejected ${kind} token: ${err instanceof Error ? err.message : 'verification failed'}`,
      );
      throw new UnauthorizedException(`Invalid ${kind} token.`);
    }

    this.assertAudience(payload, kind);

    if (!payload.sub) {
      throw new UnauthorizedException(`Missing subject in ${kind} token.`);
    }
    return payload;
  }

  /**
   * Keycloak access tokens typically carry aud="account" (the built-in
   * account client) while azp names the requesting client; ID tokens are
   * audienced to the client itself. Accept either signal but never none.
   */
  private assertAudience(payload: jwt.JwtPayload, kind: TokenKind): void {
    const aud =
      payload.aud === undefined ? [] : Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    const ok =
      kind === 'id'
        ? aud.includes(this.clientId)
        : aud.includes(this.audience) ||
          aud.includes(this.clientId) ||
          payload.azp === this.clientId;
    if (!ok) {
      this.logger.warn(
        `Rejected ${kind} token: audience mismatch (aud=${aud.join(',')} azp=${payload.azp ?? ''})`,
      );
      throw new UnauthorizedException(`Unexpected audience in ${kind} token.`);
    }
  }

  private async fetchUserinfo(
    accessToken: string,
    expectedSub: string,
  ): Promise<Partial<VerifiedKeycloakClaims> | null> {
    try {
      const res = await fetch(`${this.issuer}/protocol/openid-connect/userinfo`, {
        headers: { authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as Record<string, unknown>;
      if (body.sub !== expectedSub) {
        this.logger.warn('userinfo subject does not match verified token subject; ignoring');
        return null;
      }
      return {
        email: typeof body.email === 'string' ? body.email : undefined,
        name: typeof body.name === 'string' ? body.name : undefined,
        preferred_username:
          typeof body.preferred_username === 'string' ? body.preferred_username : undefined,
        picture: typeof body.picture === 'string' ? body.picture : undefined,
      };
    } catch {
      // userinfo is best-effort enrichment; verification already succeeded.
      return null;
    }
  }
}
