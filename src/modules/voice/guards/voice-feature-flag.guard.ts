import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Global kill switch for the entire voice-chat module. When VOICE_ENABLED
 * is false every voice route 404s — the feature is invisible to clients
 * and old API consumers see no change. Apply at the controller class level
 * on every voice controller as it's introduced (Phases 1+).
 */
@Injectable()
export class VoiceFeatureFlagGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(_context: ExecutionContext): boolean {
    if (!this.config.get<boolean>('voice.enabled', false)) {
      throw new NotFoundException();
    }
    return true;
  }
}
