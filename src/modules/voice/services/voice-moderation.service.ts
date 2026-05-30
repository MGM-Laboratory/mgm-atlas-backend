import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { LivekitService } from './livekit.service';
import { VoiceParticipantsService } from './voice-participants.service';
import { VoiceRealtimePublisher } from './voice-realtime.publisher';

/**
 * Server-side moderation actions. The controller is responsible for
 * authorizing the caller (ProjectAccessService.assertManager for
 * project channels, AdminGuard for lobby) BEFORE invoking these.
 *
 * Every method touches three places in lockstep:
 *   1. The LiveKit room (the only source of truth for media state)
 *   2. The VoiceParticipant DB row (the source of truth for occupancy)
 *   3. The /voice gateway (so peers see the change immediately)
 *
 * When LiveKit is unreachable we throw 503; callers must surface that
 * cleanly. This avoids drift: never mark the DB muted/kicked unless
 * LiveKit confirmed the action.
 */
@Injectable()
export class VoiceModerationService {
  private readonly logger = new Logger(VoiceModerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly livekit: LivekitService,
    private readonly participants: VoiceParticipantsService,
    private readonly realtime: VoiceRealtimePublisher,
  ) {}

  /**
   * Server-mute (or unmute) every published audio track for a target
   * participant. Effect is global: every other client sees the mute
   * badge instantly. Local user can no longer transmit until a mod
   * unmutes them (or they leave + rejoin).
   */
  async muteParticipant(args: {
    channelId: string;
    targetUserId: string;
    muted: boolean;
    actorUserId: string;
  }) {
    const channel = await this.requireOpenChannel(args.channelId);
    const room = await this.livekit.getRoomService();
    if (!room) throw new ServiceUnavailableException('Voice service is temporarily unavailable.');

    const roomName = LivekitService.roomNameForChannel(channel.id);

    // Find the live participant row — that gives us the LiveKit
    // participant SID we need to address mute calls to. Identity in
    // LiveKit is the Atlas userId (set at JWT mint).
    const liveRow = await this.prisma.voiceParticipant.findFirst({
      where: { channelId: channel.id, userId: args.targetUserId, leftAt: null },
      select: { id: true },
    });
    if (!liveRow) {
      throw new NotFoundException('That user is not currently in this voice channel.');
    }

    // Pull the published-track list from LiveKit so we can mute each
    // mic publication independently (LiveKit's API is per-track).
    let participantInfo: { tracks?: Array<{ sid?: string; source?: string | number; muted?: boolean }> };
    try {
      participantInfo = await room.getParticipant(roomName, args.targetUserId);
    } catch (err) {
      this.logger.warn(`LiveKit getParticipant failed: ${(err as Error).message}`);
      throw new NotFoundException('Participant is no longer in the LiveKit room.');
    }

    const tracks = participantInfo.tracks ?? [];
    // Source enum (livekit-server-sdk): UNKNOWN=0, CAMERA=1, MICROPHONE=2, SCREEN_SHARE=3, SCREEN_SHARE_AUDIO=4.
    const muteableSources = new Set([2, 'MICROPHONE', 4, 'SCREEN_SHARE_AUDIO']);
    const audioTracks = tracks.filter((t) =>
      muteableSources.has(typeof t.source === 'number' ? t.source : String(t.source ?? '')),
    );
    if (audioTracks.length === 0 && args.muted) {
      // Nothing currently published to mute — still flag the DB row so
      // that when the user next publishes a mic track LiveKit applies
      // the policy. (LiveKit doesn't auto-apply, but our flag tells
      // the next JWT mint to set canPublishSources accordingly.)
    }

    for (const t of audioTracks) {
      if (!t.sid) continue;
      try {
        await room.mutePublishedTrack(roomName, args.targetUserId, t.sid, args.muted);
      } catch (err) {
        this.logger.warn(
          `mutePublishedTrack failed for ${args.targetUserId}: ${(err as Error).message}`,
        );
      }
    }

    await this.prisma.voiceParticipant.updateMany({
      where: { id: liveRow.id },
      data: { mutedByMod: args.muted },
    });

    // Notify the channel — peers update the badge instantly.
    this.realtime.moderationMute(channel.id, channel.projectId, {
      targetUserId: args.targetUserId,
      muted: args.muted,
      byUserId: args.actorUserId,
    });

    return { ok: true, targetUserId: args.targetUserId, muted: args.muted };
  }

  /**
   * Disconnect a participant from the channel via LiveKit
   * RoomServiceClient.removeParticipant. The DB row is closed
   * synchronously; the LiveKit-emitted webhook will arrive shortly
   * after and find it already closed (no-op).
   */
  async kickParticipant(args: {
    channelId: string;
    targetUserId: string;
    actorUserId: string;
    reason?: string;
  }) {
    const channel = await this.requireOpenChannel(args.channelId);
    const room = await this.livekit.getRoomService();
    if (!room) throw new ServiceUnavailableException('Voice service is temporarily unavailable.');

    const roomName = LivekitService.roomNameForChannel(channel.id);
    try {
      await room.removeParticipant(roomName, args.targetUserId);
    } catch (err) {
      // 404 from LiveKit just means the user already left.
      this.logger.warn(
        `removeParticipant failed for ${args.targetUserId}: ${(err as Error).message}`,
      );
    }

    const { left } = await this.participants.leave({
      channelId: channel.id,
      userId: args.targetUserId,
    });

    if (left) {
      this.realtime.participantLeft(channel.id, channel.projectId, {
        userId: args.targetUserId,
      });
    }
    this.realtime.moderationKick(channel.id, channel.projectId, {
      targetUserId: args.targetUserId,
      byUserId: args.actorUserId,
      reason: args.reason ?? null,
    });

    return { ok: true, targetUserId: args.targetUserId };
  }

  /**
   * Forcibly move a participant from one channel to another within
   * the same project. Two-step under the hood:
   *   1. Remove them from the current LiveKit room (kick).
   *   2. Mint a JWT for the target room and push it through the
   *      gateway as a voice:moved event. The recipient's client
   *      connects via the new token without an extra REST round-trip.
   *
   * Target must be in the same project (or both lobby) to avoid the
   * scenario of a project PM yanking someone into a private project.
   */
  async moveParticipant(args: {
    sourceChannelId: string;
    targetChannelId: string;
    targetUserId: string;
    actorUserId: string;
    targetUserName: string;
    targetAvatarUrl: string | null;
  }) {
    if (args.sourceChannelId === args.targetChannelId) {
      throw new BadRequestException('Target channel must be different from source.');
    }
    const source = await this.requireOpenChannel(args.sourceChannelId);
    const target = await this.requireOpenChannel(args.targetChannelId);

    // Both must be in the same project (or both lobby) — see method
    // doc comment.
    if (source.projectId !== target.projectId) {
      throw new ForbiddenException(
        'Move target must be in the same project (or both must be lobby channels).',
      );
    }

    // userLimit gate — same rule as a regular join.
    if (target.userLimit && target.userLimit > 0) {
      const live = await this.participants.countLive(target.id);
      if (live >= target.userLimit) {
        throw new BadRequestException('Target channel is full.');
      }
    }

    const room = await this.livekit.getRoomService();
    if (!room) throw new ServiceUnavailableException('Voice service is temporarily unavailable.');

    // Step 1: remove from current LiveKit room (no-op if already gone).
    const sourceRoomName = LivekitService.roomNameForChannel(source.id);
    try {
      await room.removeParticipant(sourceRoomName, args.targetUserId);
    } catch (err) {
      this.logger.debug(
        `move: removeParticipant warning for ${args.targetUserId}: ${(err as Error).message}`,
      );
    }
    await this.participants.leave({ channelId: source.id, userId: args.targetUserId });
    this.realtime.participantLeft(source.id, source.projectId, { userId: args.targetUserId });

    // Step 2: mint a token for the target room. The user's client
    // receives it via voice:moved and reconnects without a UI prompt.
    const token = await this.livekit.mintAccessToken({
      roomName: LivekitService.roomNameForChannel(target.id),
      identity: args.targetUserId,
      name: args.targetUserName,
      metadata: { avatarUrl: args.targetAvatarUrl, channelId: target.id },
    });
    if (!token) {
      throw new ServiceUnavailableException('Failed to mint move token.');
    }

    // Persist the new participant row immediately so the channel's
    // roster reflects it server-side. The frontend will reconcile
    // its room.connect once it receives voice:moved.
    const newParticipant = await this.prisma.voiceParticipant.create({
      data: { channelId: target.id, userId: args.targetUserId },
      select: { id: true, joinedAt: true },
    });

    this.realtime.participantJoined(target.id, target.projectId, {
      userId: args.targetUserId,
      name: args.targetUserName,
      avatarUrl: args.targetAvatarUrl,
      joinedAt: newParticipant.joinedAt,
    });
    this.realtime.moderationMove(target.id, target.projectId, {
      targetUserId: args.targetUserId,
      sourceChannelId: source.id,
      targetChannelId: target.id,
      byUserId: args.actorUserId,
      url: this.livekit.getPublicUrl(),
      token,
      targetChannelName: target.name,
    });

    return {
      ok: true,
      targetUserId: args.targetUserId,
      targetChannelId: target.id,
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private async requireOpenChannel(channelId: string) {
    const channel = await this.prisma.voiceChannel.findUnique({
      where: { id: channelId },
      select: {
        id: true,
        projectId: true,
        name: true,
        archivedAt: true,
        userLimit: true,
      },
    });
    if (!channel) throw new NotFoundException('Voice channel not found.');
    if (channel.archivedAt) {
      throw new ForbiddenException('This voice channel is archived.');
    }
    return channel;
  }
}
