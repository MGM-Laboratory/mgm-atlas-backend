import { Controller, Get, Post, Delete, Body, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@/common/decorators/public.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { KeycloakTokenService } from './keycloak-token.service';
import { LoginDto } from './dto/login.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly sessionService: SessionService,
    private readonly keycloakTokens: KeycloakTokenService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Create a session after successful Keycloak authentication.
   * Frontend calls this after Keycloak redirects back with tokens.
   */
  @Public()
  @Post('login')
  @ApiOperation({ summary: 'Create a session from Keycloak tokens' })
  @ApiOkResponse({
    description: 'Session created. Return sessionId to frontend.',
    schema: {
      properties: {
        sessionId: { type: 'string' },
        expiresAt: { type: 'string', format: 'date-time' },
        user: {
          properties: {
            id: { type: 'string' },
            keycloakId: { type: 'string' },
            email: { type: 'string' },
            name: { type: 'string' },
            avatarUrl: { type: 'string', nullable: true },
            isAdmin: { type: 'boolean' },
          },
        },
      },
    },
  })
  async login(@Body() dto: LoginDto) {
    try {
      this.logger.log('Login request received', { keycloakId: dto.keycloakId, email: dto.email });

      const verifyTokens = this.config.get<boolean>('auth.verifyTokens') ?? true;
      let user;
      if (verifyTokens) {
        // Identity comes from the cryptographically verified token, never
        // from the request body. The body fields are cosmetic fallbacks.
        const claims = await this.keycloakTokens.verifyLoginTokens(dto);
        if (dto.keycloakId !== claims.sub) {
          this.logger.warn('Client-supplied keycloakId differs from verified token subject', {
            supplied: dto.keycloakId,
            verified: claims.sub,
          });
        }
        if (!claims.name && !claims.given_name && !claims.preferred_username && dto.name) {
          claims.name = dto.name;
        }
        user = await this.authService.syncUserFromToken(claims);
      } else {
        this.logger.warn(
          'AUTH_VERIFY_TOKENS=false — accepting unverified identity claims (emergency mode)',
        );
        user = await this.authService.syncUserFromTokenData(dto);
      }
      this.logger.log('User synced', { userId: user.id });

      // Create session in database
      const { sessionId, expiresAt } = await this.sessionService.createSession(
        user.id,
        dto.accessToken,
        dto.refreshToken,
        dto.idToken,
      );
      this.logger.log('Session created', { sessionId, userId: user.id });

      return {
        sessionId,
        expiresAt,
        user,
      };
    } catch (error) {
      this.logger.error('Login failed', error);
      throw error;
    }
  }

  /**
   * Returns the current session derived from the bearer token.
   * Used for session validation and getting the authenticated user.
   *
   * The frontend includes the sessionId in the Authorization header:
   * Authorization: Bearer <sessionId>
   */
  @ApiBearerAuth()
  @Get('session')
  @ApiOperation({ summary: 'Return the current authenticated session' })
  @ApiOkResponse({ description: 'Current Atlas user and session info.' })
  session(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }

  /**
   * Logout: destroy the session.
   * Frontend includes sessionId in Authorization header.
   */
  @ApiBearerAuth()
  @Delete('logout')
  @ApiOperation({ summary: 'Destroy the current session' })
  @ApiOkResponse({ description: 'Session destroyed.' })
  async logout(@CurrentUser() user: AuthenticatedUser): Promise<{ ok: boolean }> {
    // Session ID is extracted from the Authorization header by the strategy
    // The strategy validates it and passes the user. Now we destroy it.
    // Note: This is handled at the middleware level for now.
    // In a full implementation, the session ID would be passed through context.
    return { ok: true };
  }
}
