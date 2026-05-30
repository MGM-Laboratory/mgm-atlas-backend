import { Injectable, NotFoundException } from '@nestjs/common';
import { customAlphabet } from 'nanoid';
import { PrismaService } from '@/prisma/prisma.service';
import { S3Service } from '@/modules/media/s3.service';
import {
  PresignSoundboardClipDto,
  RegisterSoundboardClipDto,
  type SoundboardMime,
} from '../dto/soundboard.dto';

const slugId = customAlphabet('0123456789abcdefghijkmnopqrstuvwxyz', 16);

/**
 * Soundboard clip management. Storage:
 *   • S3 holds the audio bytes at voice-soundboard/<rand>.<ext>
 *   • DB holds the row with the public URL + metadata
 *
 * Reads are open to any authenticated Atlas user (soundboard is
 * workspace-wide, not project-scoped). Mutations are gated to admins
 * via AdminGuard at the controller.
 */
@Injectable()
export class VoiceSoundboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
  ) {}

  list() {
    return this.prisma.voiceSoundboardClip.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        url: true,
        durationMs: true,
        createdAt: true,
        uploadedById: true,
        uploadedBy: { select: { id: true, name: true, avatarUrl: true } },
      },
    });
  }

  /**
   * Step 1 — return a presigned S3 PUT URL the client uses to upload
   * the audio bytes directly. We never proxy the file through the
   * backend.
   */
  async presign(dto: PresignSoundboardClipDto): Promise<{
    uploadUrl: string;
    expiresIn: number;
    s3Key: string;
    publicUrl: string;
  }> {
    const ext = this.extensionFor(dto.contentType);
    const s3Key = `voice-soundboard/${Date.now()}-${slugId()}${ext}`;
    const { uploadUrl, expiresIn } = await this.s3.presignPut({
      key: s3Key,
      contentType: dto.contentType,
      contentLength: dto.contentLength,
    });
    return {
      uploadUrl,
      expiresIn,
      s3Key,
      publicUrl: this.s3.publicUrlFor(s3Key),
    };
  }

  /**
   * Step 2 — persist the clip row after the client confirms the S3
   * upload completed. Public URL is derived from the s3Key so the
   * client can't lie about where the file lives.
   */
  async register(uploadedById: string, dto: RegisterSoundboardClipDto) {
    return this.prisma.voiceSoundboardClip.create({
      data: {
        name: dto.name.trim(),
        s3Key: dto.s3Key,
        url: this.s3.publicUrlFor(dto.s3Key),
        durationMs: dto.durationMs,
        uploadedById,
      },
      select: {
        id: true,
        name: true,
        url: true,
        durationMs: true,
        createdAt: true,
        uploadedById: true,
        uploadedBy: { select: { id: true, name: true, avatarUrl: true } },
      },
    });
  }

  async remove(id: string) {
    const clip = await this.prisma.voiceSoundboardClip.findUnique({
      where: { id },
      select: { id: true, s3Key: true },
    });
    if (!clip) throw new NotFoundException('Soundboard clip not found.');
    // Delete the DB row first — if S3 deletion fails the object
    // becomes orphaned but the UI is already correct.
    await this.prisma.voiceSoundboardClip.delete({ where: { id } });
    void this.s3.deleteObject(clip.s3Key); // fire-and-forget
    return { ok: true };
  }

  private extensionFor(mime: SoundboardMime): string {
    switch (mime) {
      case 'audio/mpeg':
      case 'audio/mp3':
        return '.mp3';
      case 'audio/wav':
      case 'audio/x-wav':
        return '.wav';
      case 'audio/ogg':
        return '.ogg';
      case 'audio/webm':
        return '.webm';
      case 'audio/mp4':
        return '.m4a';
      default:
        return '';
    }
  }
}
