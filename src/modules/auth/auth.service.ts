import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { PrismaService } from '@/prisma/prisma.service';

interface KeycloakClaims {
  sub: string;
  email?: string;
  preferred_username?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Upsert the user record from a freshly validated Keycloak token.
   * On first sync, the bootstrap admin email is granted `isAdmin = true`.
   */
  async syncUserFromToken(claims: KeycloakClaims): Promise<AuthenticatedUser> {
    const email = (claims.email ?? '').toLowerCase().trim();
    const name = this.resolveDisplayName(claims);
    const avatarUrl = claims.picture ?? null;
    const bootstrapAdmin = this.config
      .getOrThrow<string>('bootstrap.adminEmail')
      .toLowerCase()
      .trim();

    const existing = await this.prisma.user.findUnique({
      where: { keycloakId: claims.sub },
      select: { id: true, isAdmin: true },
    });

    const isAdminOnCreate = email === bootstrapAdmin;

    const user = await this.prisma.user.upsert({
      where: { keycloakId: claims.sub },
      create: {
        keycloakId: claims.sub,
        email,
        name,
        avatarUrl,
        isAdmin: isAdminOnCreate,
        lastLoginAt: new Date(),
      },
      update: {
        email,
        name,
        avatarUrl,
        lastLoginAt: new Date(),
        // never demote on sync; only the admin endpoint flips this flag.
        ...(existing && !existing.isAdmin && email === bootstrapAdmin ? { isAdmin: true } : {}),
      },
      select: {
        id: true,
        keycloakId: true,
        email: true,
        name: true,
        avatarUrl: true,
        isAdmin: true,
      },
    });

    return user;
  }

  /**
   * Sync user from Keycloak token data sent by the frontend.
   * Used when creating a database session.
   */
  async syncUserFromTokenData(data: {
    keycloakId: string;
    email: string;
    name: string;
    picture?: string;
  }): Promise<{ id: string; keycloakId: string; email: string; name: string; avatarUrl: string | null; isAdmin: boolean }> {
    const email = (data.email ?? '').toLowerCase().trim();
    const name = data.name ?? 'Unknown';
    const avatarUrl = data.picture ?? null;
    const bootstrapAdmin = this.config
      .getOrThrow<string>('bootstrap.adminEmail')
      .toLowerCase()
      .trim();

    const existing = await this.prisma.user.findUnique({
      where: { keycloakId: data.keycloakId },
      select: { id: true, isAdmin: true },
    });

    const isAdminOnCreate = email === bootstrapAdmin;

    const user = await this.prisma.user.upsert({
      where: { keycloakId: data.keycloakId },
      create: {
        keycloakId: data.keycloakId,
        email,
        name,
        avatarUrl,
        isAdmin: isAdminOnCreate,
        lastLoginAt: new Date(),
      },
      update: {
        email,
        name,
        avatarUrl,
        lastLoginAt: new Date(),
        ...(existing && !existing.isAdmin && email === bootstrapAdmin ? { isAdmin: true } : {}),
      },
      select: {
        id: true,
        keycloakId: true,
        email: true,
        name: true,
        avatarUrl: true,
        isAdmin: true,
      },
    });

    return user;
  }

  private resolveDisplayName(claims: KeycloakClaims): string {
    if (claims.name && claims.name.trim()) return claims.name.trim();
    const composed = [claims.given_name, claims.family_name].filter(Boolean).join(' ').trim();
    if (composed) return composed;
    if (claims.preferred_username) return claims.preferred_username;
    return claims.email ?? 'Unknown';
  }
}
