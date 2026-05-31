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
import { VoiceRealtimePublisher } from './voice-realtime.publisher';

/**
 * Phase 8 — stage channel operations.
 *
 * Hand-raise:
 *   • Self-only. Only meaningful in STAGE channels for AUDIENCE
 *     members. STANDARD channels don't use it at all.
 *
 * Promote/demote:
 *   • Moderator-only (controller gates with ProjectAccessService).
 *   • promote → SPEAKER. Updates DB + flips LiveKit permissions via
 *     RoomServiceClient.updateParticipant so they can publish their
 *     mic without rejoining. Clears handRaisedAt.
 *   • demote  → AUDIENCE. Updates DB + flips LiveKit permissions
 *     back, AND mutes any currently-published mic track (otherwise
 *     a noisy speaker keeps broadcasting until they reconnect).
 */
@Injectable()
export class VoiceStageService {
  private readonly logger = new Logger(VoiceStageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly livekit: LivekitService,
    private readonly realtime: VoiceRealtimePublisher,
  ) {}

  /** Raise the calling user's hand. STAGE-only. AUDIENCE-only. */
  async raiseHand(args: { channelId: string; userId: string }) {
    const channel = await this.requireStageChannel(args.channelId);
    const live = await this.prisma.voiceParticipant.findFirst({
      where: { channelId: channel.id, userId: args.userId, leftAt: null },
      select: { id: true, role: true, handRaisedAt: true },
    });
    if (!live) {
      throw new BadRequestException('You must be in the channel to raise your hand.');
    }
    if (live.role === 'SPEAKER') {
      throw new BadRequestException("You're already a speaker.");
    }
    if (live.handRaisedAt) return { ok: true, handRaisedAt: live.handRaisedAt };
    const now = new Date();
    await this.prisma.voiceParticipant.update({
      where: { id: live.id },
      data: { handRaisedAt: now },
    });
    this.realtime.stageHandRaised(channel.id, channel.projectId, {
      userId: args.userId,
      handRaisedAt: now,
    });
    return { ok: true, handRaisedAt: now };
  }

  /**
   * Lower a hand. The author (the one whose hand it is) can always
   * lower their own; a moderator can also lower someone else's. The
   * actorIsModerator flag tells us which path the controller took.
   */
  async lowerHand(args: {
    channelId: string;
    targetUserId: string;
    actorUserId: string;
    actorIsModerator: boolean;
  }) {
    const channel = await this.requireStageChannel(args.channelId);
    if (args.targetUserId !== args.actorUserId && !args.actorIsModerator) {
      throw new ForbiddenException('Only moderators can lower other people\'s hands.');
    }
    const live = await this.prisma.voiceParticipant.findFirst({
      where: { channelId: channel.id, userId: args.targetUserId, leftAt: null },
      select: { id: true, handRaisedAt: true },
    });
    if (!live) {
      throw new NotFoundException('That user is not currently in this channel.');
    }
    if (!live.handRaisedAt) return { ok: true };
    await this.prisma.voiceParticipant.update({
      where: { id: live.id },
      data: { handRaisedAt: null },
    });
    this.realtime.stageHandLowered(channel.id, channel.projectId, {
      userId: args.targetUserId,
      byUserId: args.actorUserId,
    });
    return { ok: true };
  }

  /** Get the current hand-raise queue (chronological). */
  async listHandQueue(channelId: string) {
    return this.prisma.voiceParticipant.findMany({
      where: {
        channelId,
        leftAt: null,
        handRaisedAt: { not: null },
        role: 'AUDIENCE',
      },
      orderBy: { handRaisedAt: 'asc' },
      select: {
        userId: true,
        handRaisedAt: true,
        user: { select: { id: true, name: true, avatarUrl: true } },
      },
    });
  }

  /**
   * Promote an audience member to speaker. Moderator-only — the
   * controller asserts that before calling.
   */
  async promote(args: {
    channelId: string;
    targetUserId: string;
    actorUserId: string;
  }) {
    const channel = await this.requireStageChannel(args.channelId);
    const live = await this.prisma.voiceParticipant.findFirst({
      where: { channelId: channel.id, userId: args.targetUserId, leftAt: null },
      select: { id: true, role: true },
    });
    if (!live) {
      throw new NotFoundException('That user is not currently in this channel.');
    }
    if (live.role === 'SPEAKER') {
      throw new BadRequestException("That user is already a speaker.");
    }

    // Flip LiveKit permissions BEFORE updating the DB. If LiveKit
    // refuses we don't want a DB row claiming SPEAKER while the
    // client can't actually publish.
    const room = await this.livekit.getRoomService();
    if (!room) {
      throw new ServiceUnavailableException('Voice service is temporarily unavailable.');
    }
    const roomName = LivekitService.roomNameForChannel(channel.id);
    try {
      await this.updateLivekitPermissions(room, roomName, args.targetUserId, true);
    } catch (err) {
      this.logger.warn(
        `promote: updateParticipant failed for ${args.targetUserId}: ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException('Failed to update LiveKit permissions.');
    }

    await this.prisma.voiceParticipant.update({
      where: { id: live.id },
      data: { role: 'SPEAKER', handRaisedAt: null },
    });

    this.realtime.stagePromoted(channel.id, channel.projectId, {
      targetUserId: args.targetUserId,
      byUserId: args.actorUserId,
    });
    return { ok: true };
  }

  /**
   * Demote a speaker back to audience. Mutes any current mic track
   * so the demoted user stops broadcasting immediately.
   */
  async demote(args: {
    channelId: string;
    targetUserId: string;
    actorUserId: string;
  }) {
    const channel = await this.requireStageChannel(args.channelId);
    const live = await this.prisma.voiceParticipant.findFirst({
      where: { channelId: channel.id, userId: args.targetUserId, leftAt: null },
      select: { id: true, role: true },
    });
    if (!live) {
      throw new NotFoundException('That user is not currently in this channel.');
    }
    if (live.role === 'AUDIENCE') {
      throw new BadRequestException("That user is already in the audience.");
    }

    const room = await this.livekit.getRoomService();
    if (!room) {
      throw new ServiceUnavailableException('Voice service is temporarily unavailable.');
    }
    const roomName = LivekitService.roomNameForChannel(channel.id);

    // Try to mute their current mic track first so peers stop
    // hearing them immediately. Best-effort.
    try {
      const info = await room.getParticipant(roomName, args.targetUserId);
      const tracks = info?.tracks ?? [];
      for (const t of tracks) {
        if (!t?.sid) continue;
        const src = (typeof t.source === 'number'
          ? t.source
          : String(t.source ?? '').toUpperCase());
        if (src === 2 || src === 'MICROPHONE') {
          try {
            await room.mutePublishedTrack(roomName, args.targetUserId, t.sid, true);
          } catch {
            // ignore — webhook will reconcile
          }
        }
      }
    } catch (err) {
      this.logger.debug(`demote: getParticipant warning: ${(err as Error).message}`);
    }

    try {
      await this.updateLivekitPermissions(room, roomName, args.targetUserId, false);
    } catch (err) {
      this.logger.warn(
        `demote: updateParticipant failed for ${args.targetUserId}: ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException('Failed to update LiveKit permissions.');
    }

    await this.prisma.voiceParticipant.update({
      where: { id: live.id },
      data: { role: 'AUDIENCE' },
    });

    this.realtime.stageDemoted(channel.id, channel.projectId, {
      targetUserId: args.targetUserId,
      byUserId: args.actorUserId,
    });
    return { ok: true };
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private async requireStageChannel(channelId: string) {
    const channel = await this.prisma.voiceChannel.findUnique({
      where: { id: channelId },
      select: { id: true, projectId: true, archivedAt: true, kind: true },
    });
    if (!channel) throw new NotFoundException('Voice channel not found.');
    if (channel.archivedAt) {
      throw new ForbiddenException('This voice channel is archived.');
    }
    if (channel.kind !== 'STAGE') {
      throw new BadRequestException('This action is only for stage channels.');
    }
    return channel;
  }

  /**
   * Flip a participant's publish permissions live in LiveKit so they
   * gain (or lose) the ability to broadcast without reconnecting.
   *
   * The RoomServiceClient.updateParticipant API accepts a
   * ParticipantPermission with canPublish + canPublishSources. We
   * use the numeric MICROPHONE source on promote and an empty array
   * on demote.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async updateLivekitPermissions(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    room: any,
    roomName: string,
    identity: string,
    promote: boolean,
  ) {
    // ParticipantPermission shape (livekit-server-sdk):
    //   { canSubscribe, canPublish, canPublishData, canPublishSources }
    const permission = promote
      ? {
          canSubscribe: true,
          canPublish: true,
          canPublishData: true,
          // MICROPHONE only. Phase 5 already constrains video for
          // stage channels via channel.permissions; promote-to-speak
          // is mic-only by design.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          canPublishSources: [2 as any], // 2 = MICROPHONE
          hidden: false,
          recorder: false,
        }
      : {
          canSubscribe: true,
          canPublish: false,
          canPublishData: true,
          canPublishSources: [],
          hidden: false,
          recorder: false,
        };
    await room.updateParticipant(roomName, identity, undefined, permission);
  }
}
