import { Injectable, Logger } from '@nestjs/common';
import type { Namespace } from 'socket.io';
import type { VoiceChannelPublic } from './voice-channels.service';

/**
 * Central emit point for voice realtime events. All mutation services
 * call this — never `gateway.server.emit` directly — so the wire shape
 * is defined in one place. Mirrors ChatRealtimePublisher.
 *
 * Room conventions:
 *   project:{id}    — project-level fanout (channel.* + lobby occupancy)
 *   channel:{id}    — per-room events (participant.joined/left, speaker.update)
 *   voice-lobby     — workspace-wide lobby channel-list updates
 */
@Injectable()
export class VoiceRealtimePublisher {
  private readonly logger = new Logger(VoiceRealtimePublisher.name);
  private ns: Namespace | null = null;

  attach(ns: Namespace): void {
    this.ns = ns;
    this.logger.log('voice realtime publisher attached');
  }

  private emit(room: string, event: string, payload: unknown): void {
    if (!this.ns) return;
    this.ns.to(room).emit(event, payload);
  }

  private channelRoom(channelId: string) {
    return `channel:${channelId}`;
  }

  private projectRoom(projectId: string) {
    return `project:${projectId}`;
  }

  private lobbyRoom() {
    return 'voice-lobby';
  }

  // ─── Channel CRUD fanout ────────────────────────────────────────────

  channelCreated(channel: VoiceChannelPublic): void {
    const room = channel.projectId ? this.projectRoom(channel.projectId) : this.lobbyRoom();
    this.emit(room, 'voice.channel.created', channel);
  }

  channelUpdated(channel: VoiceChannelPublic): void {
    const room = channel.projectId ? this.projectRoom(channel.projectId) : this.lobbyRoom();
    this.emit(room, 'voice.channel.updated', channel);
  }

  channelArchived(channel: { id: string; projectId: string | null }): void {
    const room = channel.projectId ? this.projectRoom(channel.projectId) : this.lobbyRoom();
    this.emit(room, 'voice.channel.archived', { channelId: channel.id });
  }

  // ─── Participant lifecycle ──────────────────────────────────────────

  participantJoined(
    channelId: string,
    projectId: string | null,
    payload: {
      userId: string;
      name: string;
      avatarUrl: string | null;
      joinedAt: Date;
    },
  ): void {
    // Channel-level event (so peers in the room update their roster).
    this.emit(this.channelRoom(channelId), 'voice.participant.joined', {
      channelId,
      ...payload,
    });
    // Project / lobby-level event (so channel-list sidebars get the
    // updated avatar stack for users who haven't joined the room).
    const listRoom = projectId ? this.projectRoom(projectId) : this.lobbyRoom();
    this.emit(listRoom, 'voice.roster.update', { channelId });
  }

  participantLeft(
    channelId: string,
    projectId: string | null,
    payload: { userId: string },
  ): void {
    this.emit(this.channelRoom(channelId), 'voice.participant.left', {
      channelId,
      ...payload,
    });
    const listRoom = projectId ? this.projectRoom(projectId) : this.lobbyRoom();
    this.emit(listRoom, 'voice.roster.update', { channelId });
  }

  /**
   * Phase 1 emits this from the LiveKit client side, not the backend
   * (each browser sees ActiveSpeakersChanged from its Room directly).
   * The signature is here so Phase 5+ moderator-mute can broadcast a
   * forced "stopped speaking" update.
   */
  speakerUpdate(channelId: string, speakers: string[]): void {
    this.emit(this.channelRoom(channelId), 'voice.speaker.update', {
      channelId,
      speakers,
    });
  }

  /**
   * Screen-share lifecycle, derived from LiveKit's track_published /
   * track_unpublished webhooks. Used by the sidebar to badge channels
   * where someone is sharing — clients in the room see this directly
   * via their LiveKit Room events and don't need the fanout.
   */
  screenShareState(channelId: string, payload: { userId: string; active: boolean }): void {
    this.emit(this.channelRoom(channelId), 'voice.screenshare.update', {
      channelId,
      ...payload,
    });
  }

  // ─── Moderation fanout (Phase 5) ────────────────────────────────────

  /**
   * Mod muted/unmuted a participant server-side. Peers in the channel
   * update the badge instantly; the targeted user sees they've been
   * force-muted by a mod.
   */
  moderationMute(
    channelId: string,
    _projectId: string | null,
    payload: { targetUserId: string; muted: boolean; byUserId: string },
  ): void {
    this.emit(this.channelRoom(channelId), 'voice.moderation.mute', {
      channelId,
      ...payload,
    });
  }

  /**
   * Mod kicked a participant. The targeted user's LiveKit room
   * already disconnected (RoomServiceClient.removeParticipant fires
   * a server-side disconnect), so this event is mainly for the
   * channel-list roster + toast on the kicked user's side.
   */
  moderationKick(
    channelId: string,
    _projectId: string | null,
    payload: {
      targetUserId: string;
      byUserId: string;
      reason: string | null;
    },
  ): void {
    this.emit(this.channelRoom(channelId), 'voice.moderation.kick', {
      channelId,
      ...payload,
    });
    // Also emit a personally-addressed event so the kicked user's
    // active tab (which may have already left the LiveKit room) gets
    // the toast even if they were the only one in the channel.
    this.emit(this.userRoom(payload.targetUserId), 'voice.moved-or-kicked', {
      kind: 'kicked',
      channelId,
      reason: payload.reason,
    });
  }

  /**
   * Mod moved a participant to a different channel. The TARGET user
   * gets a personally-addressed event with the minted LiveKit token
   * for the destination room — the client connects without an extra
   * REST roundtrip.
   */
  moderationMove(
    targetChannelId: string,
    targetProjectId: string | null,
    payload: {
      targetUserId: string;
      sourceChannelId: string;
      targetChannelId: string;
      targetChannelName: string;
      byUserId: string;
      url: string;
      token: string;
    },
  ): void {
    // Channel-level event so peers in the target channel see the
    // roster update; doesn't carry the JWT (everyone would see it).
    this.emit(this.channelRoom(targetChannelId), 'voice.moderation.move', {
      channelId: targetChannelId,
      sourceChannelId: payload.sourceChannelId,
      targetUserId: payload.targetUserId,
      byUserId: payload.byUserId,
    });
    // Personally-addressed event with the JWT — only the targeted
    // user's sockets see this.
    this.emit(this.userRoom(payload.targetUserId), 'voice.moved-or-kicked', {
      kind: 'moved',
      sourceChannelId: payload.sourceChannelId,
      targetChannelId: payload.targetChannelId,
      targetChannelName: payload.targetChannelName,
      projectId: targetProjectId,
      url: payload.url,
      token: payload.token,
    });
  }

  /** Per-user broadcast room used for personally-addressed events. */
  private userRoom(userId: string) {
    return `user:${userId}`;
  }

  // ─── Recording lifecycle (Phase 7) ──────────────────────────────────

  /**
   * A moderator just requested a recording. Sent to the channel so
   * peers can render the red REC badge + consent banner immediately
   * (even before LiveKit's egress_started webhook arrives).
   */
  recordingStarted(
    channelId: string,
    _projectId: string | null,
    payload: {
      recordingId: string;
      startedByUserId: string;
      startedByName: string;
    },
  ): void {
    this.emit(this.channelRoom(channelId), 'voice.recording.started', {
      channelId,
      ...payload,
    });
  }

  /**
   * Lifecycle update from the egress webhook (PENDING → RUNNING). The
   * UI doesn't usually need to distinguish PENDING vs RUNNING, but
   * keeping the wire shape symmetrical helps debugging.
   */
  recordingStatusChanged(
    channelId: string,
    _projectId: string | null,
    payload: { recordingId: string; status: 'RUNNING' | 'COMPLETED' | 'FAILED' },
  ): void {
    this.emit(this.channelRoom(channelId), 'voice.recording.status', {
      channelId,
      ...payload,
    });
  }

  /**
   * egress_ended arrived (success or failure). UI removes the REC
   * badge + shows a toast.
   */
  recordingStopped(
    channelId: string,
    _projectId: string | null,
    payload: {
      recordingId: string;
      success: boolean;
      durationSec: number | null;
    },
  ): void {
    this.emit(this.channelRoom(channelId), 'voice.recording.stopped', {
      channelId,
      ...payload,
    });
  }
}
