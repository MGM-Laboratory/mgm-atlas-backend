import { Global, Module } from '@nestjs/common';
import { AuthModule } from '@/modules/auth/auth.module';
import { ChatModule } from '@/modules/chat/chat.module';
import { MediaModule } from '@/modules/media/media.module';
import { ProjectsModule } from '@/modules/projects/projects.module';
import { VoiceChannelsController } from './controllers/voice-channels.controller';
import { VoiceJoinController } from './controllers/voice-join.controller';
import { VoiceLobbyController } from './controllers/voice-lobby.controller';
import { VoiceModerationController } from './controllers/voice-moderation.controller';
import { VoicePreferencesController } from './controllers/voice-preferences.controller';
import { VoiceRecordingController } from './controllers/voice-recording.controller';
import { VoiceSoundboardController } from './controllers/voice-soundboard.controller';
import { VoiceStageController } from './controllers/voice-stage.controller';
import { VoiceWebhooksController } from './controllers/voice-webhooks.controller';
import { VoiceGateway } from './gateway/voice.gateway';
import { VoiceFeatureFlagGuard } from './guards/voice-feature-flag.guard';
import { LivekitService } from './services/livekit.service';
import { VoiceChannelsService } from './services/voice-channels.service';
import { VoiceModerationService } from './services/voice-moderation.service';
import { VoiceParticipantsService } from './services/voice-participants.service';
import { VoicePreferencesService } from './services/voice-preferences.service';
import { VoiceRealtimePublisher } from './services/voice-realtime.publisher';
import { VoiceRecordingService } from './services/voice-recording.service';
import { VoiceSoundboardService } from './services/voice-soundboard.service';
import { VoiceStageService } from './services/voice-stage.service';

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
  imports: [AuthModule, ProjectsModule, ChatModule, MediaModule],
  controllers: [
    VoiceChannelsController,
    VoiceLobbyController,
    VoiceJoinController,
    VoiceModerationController,
    VoicePreferencesController,
    VoiceRecordingController,
    VoiceSoundboardController,
    VoiceStageController,
    VoiceWebhooksController,
  ],
  providers: [
    VoiceFeatureFlagGuard,
    LivekitService,
    VoiceChannelsService,
    VoiceModerationService,
    VoiceParticipantsService,
    VoicePreferencesService,
    VoiceRealtimePublisher,
    VoiceRecordingService,
    VoiceSoundboardService,
    VoiceStageService,
    VoiceGateway,
  ],
  exports: [
    VoiceFeatureFlagGuard,
    LivekitService,
    VoiceChannelsService,
    VoiceModerationService,
    VoiceParticipantsService,
    VoicePreferencesService,
    VoiceRealtimePublisher,
    VoiceRecordingService,
    VoiceSoundboardService,
    VoiceStageService,
  ],
})
export class VoiceModule {}
