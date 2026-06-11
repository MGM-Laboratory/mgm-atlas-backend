import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { KeycloakTokenService } from './keycloak-token.service';
import { LoginDto } from './dto/login.dto';

describe('AuthController login', () => {
  const user = {
    id: 'u1',
    keycloakId: 'kc-1',
    email: 'user@labmgm.org',
    name: 'User',
    avatarUrl: null,
    isAdmin: false,
  };
  const session = { sessionId: 's1', expiresAt: new Date() };

  const dto: LoginDto = {
    keycloakId: 'kc-1',
    email: 'user@labmgm.org',
    name: 'User',
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    idToken: 'id-token',
  };

  function makeController(verifyTokens: boolean) {
    const authService = {
      syncUserFromToken: jest.fn().mockResolvedValue(user),
      syncUserFromTokenData: jest.fn().mockResolvedValue(user),
    };
    const sessionService = { createSession: jest.fn().mockResolvedValue(session) };
    const keycloakTokens = {
      verifyLoginTokens: jest
        .fn()
        .mockResolvedValue({ sub: 'kc-1', email: 'user@labmgm.org', name: 'User' }),
    };
    const config = { get: jest.fn().mockReturnValue(verifyTokens) };
    const controller = new AuthController(
      authService as unknown as AuthService,
      sessionService as unknown as SessionService,
      keycloakTokens as unknown as KeycloakTokenService,
      config as unknown as ConfigService,
    );
    return { controller, authService, sessionService, keycloakTokens };
  }

  it('syncs the user from verified claims when verification is on (default)', async () => {
    const { controller, authService, sessionService, keycloakTokens } = makeController(true);
    const result = await controller.login(dto);

    expect(keycloakTokens.verifyLoginTokens).toHaveBeenCalledWith(dto);
    expect(authService.syncUserFromToken).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'kc-1', email: 'user@labmgm.org' }),
    );
    expect(authService.syncUserFromTokenData).not.toHaveBeenCalled();
    expect(sessionService.createSession).toHaveBeenCalledWith(
      user.id,
      dto.accessToken,
      dto.refreshToken,
      dto.idToken,
    );
    expect(result).toEqual({ sessionId: session.sessionId, expiresAt: session.expiresAt, user });
  });

  it('rejects the login and creates no session when verification fails', async () => {
    const { controller, sessionService, keycloakTokens } = makeController(true);
    keycloakTokens.verifyLoginTokens.mockRejectedValue(new UnauthorizedException());

    await expect(controller.login(dto)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(sessionService.createSession).not.toHaveBeenCalled();
  });

  it('uses the legacy unverified sync only when the kill switch is off', async () => {
    const { controller, authService, keycloakTokens } = makeController(false);
    await controller.login(dto);

    expect(keycloakTokens.verifyLoginTokens).not.toHaveBeenCalled();
    expect(authService.syncUserFromTokenData).toHaveBeenCalledWith(dto);
  });
});
