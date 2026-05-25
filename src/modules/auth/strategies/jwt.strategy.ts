import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy as PassportCustomStrategy } from 'passport-custom';
import { Request } from 'express';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { SessionService } from '../session.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(PassportCustomStrategy, 'jwt') {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(private readonly sessionService: SessionService) {
    super();
  }

  async validate(req: Request): Promise<AuthenticatedUser> {
    const authHeader = req.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid Authorization header.');
    }
    const sessionId = authHeader.substring(7);
    const user = await this.sessionService.validateBearerAndLoadUser(sessionId);
    if (!user) {
      throw new UnauthorizedException('Invalid or expired session.');
    }
    return user;
  }
}
