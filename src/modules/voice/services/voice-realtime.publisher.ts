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
}
