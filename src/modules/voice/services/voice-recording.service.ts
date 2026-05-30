import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VoiceRecordingStatus } from '@prisma/client';
import { customAlphabet } from 'nanoid';
import { PrismaService } from '@/prisma/prisma.service';
import { S3Service } from '@/modules/media/s3.service';
import { LivekitService } from './livekit.service';
import { VoiceRealtimePublisher } from './voice-realtime.publisher';

const slugId = customAlphabet('0123456789abcdefghijkmnopqrstuvwxyz', 12);

/**
 * Per-channel recording orchestration backed by LiveKit Egress.
 *
 *   start → calls egress.startRoomCompositeEgress, opens a
 *           VoiceRecording row in PENDING.
 *   stop  → calls egress.stopEgress; webhook arrives shortly after
 *           with the final s3Key + duration + size, closes the row.
 *
 * Authorization is enforced upstream in the controller (project
 * manager for project channels, admin for lobby).
 *
 * Retention: an explicit retentionUntil column lets a future janitor
 * delete expired S3 objects. Default window comes from
 * `VOICE_RECORDING_RETENTION_DAYS` (set in Phase 0 config; 30 by
 * default; 0 = keep forever).
 */
@Injectable()
export class VoiceRecordingService {
  private readonly logger = new Logger(VoiceRecordingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly livekit: LivekitService,
    private readonly s3: S3Service,
    private readonly realtime: VoiceRealtimePublisher,
    private readonly config: ConfigService,
  ) {}

  /**
   * Returns the active (PENDING or RUNNING) recording for a channel,
   * or null. The UI uses this on join to decide whether to show the
   * red REC badge + consent banner.
   */
  async activeForChannel(channelId: string) {
    return this.prisma.voiceRecording.findFirst({
      where: {
        channelId,
        status: { in: [VoiceRecordingStatus.PENDING, VoiceRecordingStatus.RUNNING] },
      },
      orderBy: { startedAt: 'desc' },
      include: {
        startedBy: { select: { id: true, name: true, avatarUrl: true } },
      },
    });
  }

  /** Channel history (newest first). Includes the starter's user info. */
  listForChannel(channelId: string) {
    return this.prisma.voiceRecording.findMany({
      where: { channelId },
      orderBy: { startedAt: 'desc' },
      include: {
        startedBy: { select: { id: true, name: true, avatarUrl: true } },
      },
    });
  }

  /** Start a recording. Refuses if one is already active in this channel. */
  async start(args: {
    channelId: string;
    startedByUserId: string;
    audioOnly?: boolean;
  }) {
    if (!this.livekit.isAvailable()) {
      throw new ServiceUnavailableException('Voice service is temporarily unavailable.');
    }

    const existing = await this.activeForChannel(args.channelId);
    if (existing) {
      throw new BadRequestException('A recording is already in progress for this channel.');
    }

    const channel = await this.prisma.voiceChannel.findUnique({
      where: { id: args.channelId },
      select: { id: true, projectId: true, name: true, archivedAt: true },
    });
    if (!channel) throw new NotFoundException('Voice channel not found.');
    if (channel.archivedAt) {
      throw new ForbiddenException('This voice channel is archived.');
    }

    const filepath = this.buildS3Key(args.channelId);
    const result = await this.livekit.startRoomCompositeEgress({
      roomName: LivekitService.roomNameForChannel(args.channelId),
      s3: {
        accessKey: this.config.getOrThrow<string>('s3.accessKeyId'),
        secret: this.config.getOrThrow<string>('s3.secretAccessKey'),
        region: this.config.getOrThrow<string>('s3.region'),
        bucket: this.config.getOrThrow<string>('s3.bucket'),
      },
      filepath,
      audioOnly: args.audioOnly,
    });
    if (!result) {
      throw new ServiceUnavailableException(
        'Recording service is unavailable (no egress worker reachable).',
      );
    }

    const retentionDays = this.config.get<number>('voice.recordingRetentionDays', 30);
    const retentionUntil =
      retentionDays && retentionDays > 0
        ? new Date(Date.now() + retentionDays * 86_400_000)
        : null;

    const recording = await this.prisma.voiceRecording.create({
      data: {
        channelId: channel.id,
        startedByUserId: args.startedByUserId,
        egressId: result.egressId,
        status: VoiceRecordingStatus.PENDING,
        retentionUntil,
        // s3Key is filled when the webhook reports completion, but we
        // optimistically store the planned key so the UI can reason
        // about the in-flight recording without an extra query.
        s3Key: filepath,
      },
      include: {
        startedBy: { select: { id: true, name: true, avatarUrl: true } },
      },
    });

    this.realtime.recordingStarted(channel.id, channel.projectId, {
      recordingId: recording.id,
      startedByUserId: args.startedByUserId,
      startedByName: recording.startedBy.name,
    });

    return recording;
  }

  /**
   * Stop a recording. The DB transition to COMPLETED happens when the
   * egress_ended webhook arrives — here we just request the stop and
   * mark the row so the UI hides the start button.
   */
  async stop(args: { channelId: string }) {
    const active = await this.activeForChannel(args.channelId);
    if (!active) {
      throw new BadRequestException('No active recording for this channel.');
    }
    const ok = await this.livekit.stopEgress(active.egressId);
    if (!ok) {
      this.logger.warn(
        `stopEgress returned false for ${active.egressId} — webhook should still close the row.`,
      );
    }
    return { ok: true, recordingId: active.id };
  }

  /**
   * Returns a fresh presigned GET URL for a completed recording.
   * Refuses when the recording is past its retention window (UI also
   * hides the download button in that case).
   */
  async downloadUrl(recordingId: string) {
    const rec = await this.prisma.voiceRecording.findUnique({
      where: { id: recordingId },
      select: {
        id: true,
        status: true,
        s3Key: true,
        retentionUntil: true,
      },
    });
    if (!rec) throw new NotFoundException('Recording not found.');
    if (rec.status !== VoiceRecordingStatus.COMPLETED || !rec.s3Key) {
      throw new BadRequestException('Recording is not ready for download.');
    }
    if (rec.retentionUntil && rec.retentionUntil < new Date()) {
      throw new ForbiddenException('Recording is past its retention window.');
    }
    // Presigned GET. We reuse the same S3 service the rest of the
    // codebase uses; only the operation differs.
    return this.s3.presignGet(rec.s3Key);
  }

  // ─── Webhook hooks (called from VoiceWebhooksController) ────────────

  /**
   * Mark the row RUNNING when LiveKit reports egress_started.
   */
  async onEgressStarted(egressId: string) {
    const row = await this.prisma.voiceRecording.findUnique({
      where: { egressId },
      include: { channel: { select: { id: true, projectId: true } } },
    });
    if (!row) return;
    if (row.status !== VoiceRecordingStatus.PENDING) return;
    await this.prisma.voiceRecording.update({
      where: { id: row.id },
      data: { status: VoiceRecordingStatus.RUNNING },
    });
    this.realtime.recordingStatusChanged(row.channel.id, row.channel.projectId, {
      recordingId: row.id,
      status: 'RUNNING',
    });
  }

  /**
   * Close the row when LiveKit reports egress_ended. The webhook
   * payload includes the final file size + duration on success.
   */
  async onEgressEnded(args: {
    egressId: string;
    success: boolean;
    durationSec?: number;
    sizeBytes?: number | bigint;
    error?: string;
  }) {
    const row = await this.prisma.voiceRecording.findUnique({
      where: { egressId: args.egressId },
      include: { channel: { select: { id: true, projectId: true } } },
    });
    if (!row) return;
    const nextStatus = args.success
      ? VoiceRecordingStatus.COMPLETED
      : VoiceRecordingStatus.FAILED;
    await this.prisma.voiceRecording.update({
      where: { id: row.id },
      data: {
        status: nextStatus,
        endedAt: new Date(),
        durationSec: args.durationSec ?? null,
        sizeBytes:
          args.sizeBytes !== undefined ? BigInt(args.sizeBytes) : null,
        errorMessage: args.error ?? null,
      },
    });
    this.realtime.recordingStopped(row.channel.id, row.channel.projectId, {
      recordingId: row.id,
      success: args.success,
      durationSec: args.durationSec ?? null,
    });
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private buildS3Key(channelId: string): string {
    return `voice-recordings/${channelId}/${Date.now()}-${slugId()}.mp4`;
  }
}
