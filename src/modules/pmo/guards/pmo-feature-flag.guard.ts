import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Global kill switch for the entire PMO module. When PMO_ENABLED is false
 * every PMO route 404s — the feature is invisible to clients and old API
 * consumers see no change. Apply at the controller class level on every
 * PMO controller as it's introduced (Phases 1+).
 */
@Injectable()
export class PmoFeatureFlagGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(_context: ExecutionContext): boolean {
    if (!this.config.get<boolean>('pmo.enabled', false)) {
      throw new NotFoundException();
    }
    return true;
  }
}
