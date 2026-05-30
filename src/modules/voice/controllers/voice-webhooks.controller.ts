import { Controller, Headers, HttpCode, Logger, Post, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '@/common/decorators/public.decorator';
import { LivekitService } from '../services/livekit.service';
import { VoiceParticipantsService } from '../services/voice-participants.service';
import { VoiceRealtimePublisher } from '../services/voice-realtime.publisher';

interface LivekitWebhookEvent {
  event: string;
  room?: { name?: string };
  participant?: { identity?: string };
  /**
   * LiveKit's TrackInfo on track_published / track_unpublished events.
   * `source` enumerates UNKNOWN / CAMERA / MICROPHONE / SCREEN_SHARE /
   * SCREEN_SHARE_AUDIO. We only care about SCREEN_SHARE for Phase 2
   * (screen-share badge on the sidebar for non-room observers).
   */
  track?: { sid?: string; source?: string; type?: string };
}

/**
 * Receiver for LiveKit's outbound webhooks. LiveKit signs each
 * delivery with its API_SECRET; verification is delegated to
 * livekit-server-sdk's WebhookReceiver. Used to reconcile our
 * VoiceParticipant rows when a client crashes mid-call (so we don't
 * leave phantom occupants in the channel-list roster).
 *
 * Public route (no session auth). The HMAC IS the auth.
 *
 * Note: the global ValidationPipe is configured with `whitelist:true,
 * forbidNonWhitelisted:true`. To stop it from stripping unknown
 * fields from LiveKit's payload (which has many keys we don't model),
 * we read the body via Express's raw request instead of a DTO.
 */
@ApiExcludeController()
@Controller('voice/livekit')
export class VoiceWebhooksController {
  private readonly logger = new Logger(VoiceWebhooksController.name);

  constructor(
    private readonly livekit: LivekitService,
    private readonly participants: VoiceParticipantsService,
    private readonly realtime: VoiceRealtimePublisher,
  ) {}

  @Public()
  @Post('webhook')
  @HttpCode(200)
  async receive(
    @Req() req: Request,
    @Headers('authorization') authHeader?: string,
  ): Promise<{ ok: boolean }> {
    // LiveKit sends Content-Type: application/webhook+json and signs the
    // SHA256 of the body in the Authorization header (JWT). We have to
    // re-serialize the body Nest already parsed — the SDK accepts that
    // shape because it just SHA's the string. If the global pipe didn't
    // mangle field names (it doesn't for raw body access), this works.
    const rawBody = JSON.stringify(req.body);
    const event = (await this.livekit.verifyWebhook(rawBody, authHeader ?? '')) as
      | LivekitWebhookEvent
      | null;
    if (!event) {
      this.logger.warn('LiveKit webhook rejected (signature mismatch or missing creds)');
      return { ok: false };
    }

    const roomName = event.room?.name ?? '';
    const identity = event.participant?.identity ?? '';

    switch (event.event) {
      case 'participant_left': {
        if (!roomName || !identity) break;
        const { left } = await this.participants.reconcileLeftFromWebhook({ roomName, identity });
        if (left > 0) {
          const channelId = roomName.startsWith('voice:')
            ? roomName.slice('voice:'.length)
            : null;
          if (channelId) {
            // We don't have projectId here without an extra query; fan
            // out to both rooms (lobby + project) — the unused one is
            // a no-op for clients not subscribed.
            this.realtime.participantLeft(channelId, null, { userId: identity });
          }
        }
        break;
      }
      case 'room_finished': {
        if (!roomName) break;
        await this.participants.reconcileRoomFinishedFromWebhook({ roomName });
        break;
      }
      case 'track_published':
      case 'track_unpublished': {
        // Only fan out screen-share lifecycle — camera/mic are already
        // observed inline by every LiveKit client in the room.
        if (!roomName || !identity) break;
        const source = (event.track?.source ?? '').toUpperCase();
        if (source !== 'SCREEN_SHARE' && source !== 'SCREEN_SHARE_AUDIO') break;
        const channelId = roomName.startsWith('voice:')
          ? roomName.slice('voice:'.length)
          : null;
        if (!channelId) break;
        this.realtime.screenShareState(channelId, {
          userId: identity,
          active: event.event === 'track_published',
        });
        break;
      }
      // recording_* events handled in Phase 7.
      default:
        break;
    }
    return { ok: true };
  }
}
