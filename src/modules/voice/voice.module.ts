import { Global, Module } from '@nestjs/common';
import { AuthModule } from '@/modules/auth/auth.module';
import { ChatModule } from '@/modules/chat/chat.module';
import { ProjectsModule } from '@/modules/projects/projects.module';
import { VoiceChannelsController } from './controllers/voice-channels.controller';
import { VoiceJoinController } from './controllers/voice-join.controller';
import { VoiceLobbyController } from './controllers/voice-lobby.controller';
import { VoiceWebhooksController } from './controllers/voice-webhooks.controller';
import { VoiceGateway } from './gateway/voice.gateway';
import { VoiceFeatureFlagGuard } from './guards/voice-feature-flag.guard';
import { LivekitService } from './services/livekit.service';
import { VoiceChannelsService } from './services/voice-channels.service';
import { VoiceParticipantsService } from './services/voice-participants.service';
import { VoiceRealtimePublisher } from './services/voice-realtime.publisher';

/**
 * Discord-parity voice chat module. Phase 1 ships channel CRUD +
 * join/leave + LiveKit JWT minting + the realtime gateway. Phase 2+
 * extends with video, screen-share, soundboard, moderation, etc.
 *
 * Marked @Global so ProjectsService can inject VoiceChannelsService
 * without ProjectsModule needing to import VoiceModule (mirrors how
 * WebhooksModule does it for cross-cutting injection).
 *
 * AuthModule + ChatModule imported to reuse SessionService (WS
 * handshake auth) and the existing WsSessionGuard. ProjectsModule
 * brings ProjectAccessService for per-project access checks.
 */
@Global()
@Module({
  imports: [AuthModule, ProjectsModule, ChatModule],
  controllers: [
    VoiceChannelsController,
    VoiceLobbyController,
    VoiceJoinController,
    VoiceWebhooksController,
  ],
  providers: [
    VoiceFeatureFlagGuard,
    LivekitService,
    VoiceChannelsService,
    VoiceParticipantsService,
    VoiceRealtimePublisher,
    VoiceGateway,
  ],
  exports: [
    VoiceFeatureFlagGuard,
    LivekitService,
    VoiceChannelsService,
    VoiceParticipantsService,
    VoiceRealtimePublisher,
  ],
})
export class VoiceModule {}
