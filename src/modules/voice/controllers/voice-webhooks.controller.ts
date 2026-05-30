import { Controller, Headers, HttpCode, Logger, Post, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '@/common/decorators/public.decorator';
import { LivekitService } from '../services/livekit.service';
import { VoiceParticipantsService } from '../services/voice-participants.service';
import { VoiceRealtimePublisher } from '../services/voice-realtime.publisher';
import { VoiceRecordingService } from '../services/voice-recording.service';

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
  /**
   * EgressInfo on egress_started / egress_updated / egress_ended.
   * `status` enumerates EGRESS_STARTING/_ACTIVE/_ENDING/_COMPLETE/_FAILED/_ABORTED.
   * `file` carries the final S3 result on completion.
   */
  egressInfo?: {
    egressId?: string;
    roomName?: string;
    status?: string;
    error?: string;
    startedAt?: string | number | bigint;
    endedAt?: string | number | bigint;
    fileResults?: Array<{
      duration?: string | number | bigint;
      size?: string | number | bigint;
    }>;
    file?: {
      duration?: string | number | bigint;
      size?: string | number | bigint;
    };
  };
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
    private readonly recording: VoiceRecordingService,
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
      case 'egress_started':
      case 'egress_updated': {
        const egressId = event.egressInfo?.egressId ?? '';
        if (!egressId) break;
        const status = (event.egressInfo?.status ?? '').toUpperCase();
        // EGRESS_ACTIVE = the recording is actually rolling. Treat
        // STARTING the same way for the UI's purposes — the row was
        // PENDING before the worker picked it up.
        if (status === 'EGRESS_ACTIVE' || status === 'EGRESS_STARTING') {
          await this.recording.onEgressStarted(egressId);
        }
        break;
      }
      case 'egress_ended': {
        const egressId = event.egressInfo?.egressId ?? '';
        if (!egressId) break;
        const status = (event.egressInfo?.status ?? '').toUpperCase();
        const success = status === 'EGRESS_COMPLETE';
        // Pull the duration/size from either fileResults[0] (newer
        // SDK) or file (older). Values may arrive as bigints/strings.
        const fileSrc = event.egressInfo?.fileResults?.[0] ?? event.egressInfo?.file;
        const durationRaw = fileSrc?.duration;
        const sizeRaw = fileSrc?.size;
        const durationSec =
          durationRaw !== undefined
            ? Math.round(Number(durationRaw.toString()) / 1_000_000_000) // ns → s
            : undefined;
        const sizeBytes =
          sizeRaw !== undefined ? BigInt(sizeRaw.toString()) : undefined;
        await this.recording.onEgressEnded({
          egressId,
          success,
          durationSec,
          sizeBytes,
          error: event.egressInfo?.error,
        });
        break;
      }
      default:
        break;
    }
    return { ok: true };
  }
}
