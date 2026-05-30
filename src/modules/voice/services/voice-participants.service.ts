import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, VoiceParticipant } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { LivekitService } from './livekit.service';

/**
 * Tracks who is currently inside each voice channel and mints the
 * LiveKit JWT they use to actually connect. The DB is the source of
 * truth for "is this user currently in channel X" (cross-instance
 * coordination point); LiveKit's own session state is reconciled to
 * the DB by the webhook receiver when sessions end unexpectedly.
 *
 * Phase 1 only handles audio. Phase 2 will extend mintAccessToken with
 * camera + screen-share track permissions.
 */
@Injectable()
export class VoiceParticipantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly livekit: LivekitService,
  ) {}

  /**
   * Returns the in-room roster for a channel (currently connected users
   * only). Used by the channel-list sidebar to show stacked avatars
   * before anyone clicks to join.
   */
  listLive(channelId: string) {
    return this.prisma.voiceParticipant.findMany({
      where: { channelId, leftAt: null },
      select: {
        id: true,
        userId: true,
        joinedAt: true,
        mutedByMod: true,
        user: {
          select: { id: true, name: true, avatarUrl: true },
        },
      },
      orderBy: { joinedAt: 'asc' },
    });
  }

  /** Live occupancy count for a single channel (used for userLimit gate). */
  countLive(channelId: string) {
    return this.prisma.voiceParticipant.count({
      where: { channelId, leftAt: null },
    });
  }

  /**
   * Join flow:
   *   1. assert channel exists + not archived
   *   2. assert userLimit not exceeded
   *   3. if user already has an active participant row for ANY channel,
   *      mark it left (single-room invariant)
   *   4. upsert (channel, user, leftAt:null) row
   *   5. mint a LiveKit JWT scoped to this channel's room
   *
   * Returns the full join envelope the controller sends back to the
   * client: `{ url, token, channel, participant }`.
   */
  async join(args: {
    channelId: string;
    userId: string;
    userName: string;
    avatarUrl: string | null;
    canPublish?: boolean;
    canSubscribe?: boolean;
  }) {
    if (!this.livekit.isAvailable()) {
      throw new ServiceUnavailableException('Voice service is temporarily unavailable.');
    }

    const channel = await this.prisma.voiceChannel.findUnique({
      where: { id: args.channelId },
      select: {
        id: true,
        archivedAt: true,
        userLimit: true,
        audioQuality: true,
        name: true,
      },
    });
    if (!channel) throw new NotFoundException('Voice channel not found.');
    if (channel.archivedAt) {
      throw new ForbiddenException('This voice channel is archived.');
    }

    // userLimit gate. Counted BEFORE we insert so we don't have to
    // roll back. Tolerates a small race in concurrent joins — at worst
    // 1-2 users over the limit, which is fine for an MVP.
    if (channel.userLimit && channel.userLimit > 0) {
      const live = await this.countLive(channel.id);
      if (live >= channel.userLimit) {
        throw new ConflictException('This voice channel is full.');
      }
    }

    // Enforce single-room invariant: leaving any prior active session
    // first. The frontend also disconnects from the LiveKit room
    // client-side when switching, but this is the server-side guarantee.
    await this.prisma.voiceParticipant.updateMany({
      where: { userId: args.userId, leftAt: null },
      data: { leftAt: new Date() },
    });

    const participant = await this.prisma.voiceParticipant.create({
      data: {
        channelId: channel.id,
        userId: args.userId,
      },
      select: {
        id: true,
        channelId: true,
        userId: true,
        joinedAt: true,
        mutedByMod: true,
      },
    });

    const roomName = LivekitService.roomNameForChannel(channel.id);
    const token = await this.livekit.mintAccessToken({
      roomName,
      identity: args.userId,
      name: args.userName,
      metadata: { avatarUrl: args.avatarUrl ?? null, channelId: channel.id },
      canPublish: args.canPublish ?? true,
      canSubscribe: args.canSubscribe ?? true,
    });
    if (!token) {
      // Roll back the participant row so we don't leave a phantom occupant.
      await this.prisma.voiceParticipant.update({
        where: { id: participant.id },
        data: { leftAt: new Date() },
      });
      throw new ServiceUnavailableException('Failed to mint voice access token.');
    }

    return {
      url: this.livekit.getPublicUrl(),
      token,
      roomName,
      participant,
      channel: { id: channel.id, name: channel.name, audioQuality: channel.audioQuality },
    };
  }

  /**
   * Leave flow. Idempotent — marking a non-existent or already-left
   * row is a no-op (we tolerate the client re-firing leave during
   * page-unload + disconnect events).
   */
  async leave(args: { channelId: string; userId: string }) {
    const result = await this.prisma.voiceParticipant.updateMany({
      where: { channelId: args.channelId, userId: args.userId, leftAt: null },
      data: { leftAt: new Date() },
    });
    return { left: result.count > 0 };
  }

  /**
   * Reconcile from a LiveKit webhook. When LiveKit reports a participant
   * left (graceful or crash), we close the corresponding DB row. Called
   * from VoiceWebhooksController on `participant_left` events.
   */
  async reconcileLeftFromWebhook(args: { roomName: string; identity: string }) {
    const channelId = args.roomName.startsWith('voice:')
      ? args.roomName.slice('voice:'.length)
      : null;
    if (!channelId) return { left: 0 };
    const result = await this.prisma.voiceParticipant.updateMany({
      where: { channelId, userId: args.identity, leftAt: null },
      data: { leftAt: new Date() },
    });
    return { left: result.count };
  }

  /**
   * Reconcile from a LiveKit `room_finished` webhook (all participants
   * disconnected). Closes every still-open participant row for that
   * channel.
   */
  async reconcileRoomFinishedFromWebhook(args: { roomName: string }) {
    const channelId = args.roomName.startsWith('voice:')
      ? args.roomName.slice('voice:'.length)
      : null;
    if (!channelId) return { left: 0 };
    const result = await this.prisma.voiceParticipant.updateMany({
      where: { channelId, leftAt: null },
      data: { leftAt: new Date() },
    });
    return { left: result.count };
  }
}

export type VoiceParticipantPublic = Pick<
  VoiceParticipant,
  'id' | 'channelId' | 'userId' | 'joinedAt' | 'leftAt' | 'mutedByMod'
>;
