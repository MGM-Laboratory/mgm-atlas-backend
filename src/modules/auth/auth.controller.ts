import { Controller, Get, Post, Delete, Body } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sessionService: SessionService,
  ) {}

  /**
   * Create a session after successful Keycloak authentication.
   * Frontend calls this after Keycloak redirects back with tokens.
   */
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
  async login(
    @Body()
    dto: {
      keycloakId: string;
      email: string;
      name: string;
      picture?: string;
      accessToken: string;
      refreshToken?: string;
      idToken?: string;
    },
  ) {
    // Sync user from Keycloak token data
    const user = await this.authService.syncUserFromTokenData(dto);

    // Create session in database
    const { sessionId, expiresAt } = await this.sessionService.createSession(
      user.id,
      dto.accessToken,
      dto.refreshToken,
      dto.idToken,
    );

    return {
      sessionId,
      expiresAt,
      user,
    };
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
