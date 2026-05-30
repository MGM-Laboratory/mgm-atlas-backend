import { Global, Module } from '@nestjs/common';
import { VoiceFeatureFlagGuard } from './guards/voice-feature-flag.guard';
import { LivekitService } from './services/livekit.service';
import { VoiceChannelsService } from './services/voice-channels.service';

/**
 * Root voice-chat module. Submodules (gateway, soundboard, moderation,
 * recording) are added one per phase starting at Phase 1. The
 * feature-flag guard and core services are exported so the future
 * submodules — and ProjectsService for the default-channel hook — can
 * pull them in without re-importing the module.
 *
 * Marked @Global so ProjectsService can inject VoiceChannelsService
 * without ProjectsModule importing VoiceModule (mirrors how
 * WebhooksModule does it for cross-cutting injection).
 */
@Global()
@Module({
  providers: [VoiceFeatureFlagGuard, LivekitService, VoiceChannelsService],
  exports: [VoiceFeatureFlagGuard, LivekitService, VoiceChannelsService],
})
export class VoiceModule {}
