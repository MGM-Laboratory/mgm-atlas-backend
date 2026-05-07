import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';

@ApiBearerAuth()
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  /**
   * Returns the current session derived from the bearer token.
   *
   * The Atlas frontend treats this endpoint as the post-Keycloak handoff:
   * after Keycloak redirects back, the SPA calls /auth/session to confirm
   * the token is valid and to receive the synced Atlas profile.
   */
  @Get('session')
  @ApiOperation({ summary: 'Return the current authenticated session' })
  @ApiOkResponse({ description: 'Current Atlas user, synced from Keycloak.' })
  session(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }
}
