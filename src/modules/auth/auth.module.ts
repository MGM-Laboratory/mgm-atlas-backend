import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { KeycloakTokenService } from './keycloak-token.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt', session: false })],
  controllers: [AuthController],
  providers: [AuthService, SessionService, KeycloakTokenService, JwtStrategy],
  exports: [AuthService, SessionService, KeycloakTokenService],
})
export class AuthModule {}
