import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatAttachmentKind } from '@prisma/client';
import { customAlphabet } from 'nanoid';
import { S3Service } from '@/modules/media/s3.service';
import { PresignChatAttachmentDto } from '../dto/presign-attachment.dto';

const objectId = customAlphabet('0123456789abcdefghijkmnopqrstuvwxyz', 12);

const IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
]);
const VIDEO_MIMES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
const AUDIO_MIMES = new Set(['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/webm', 'audio/ogg']);

export interface ChatAttachmentPresignResult {
  uploadUrl: string;
  expiresIn: number;
  s3Key: string;
  publicUrl: string;
  kind: ChatAttachmentKind;
  contentType: string;
}

/**
 * Reuses S3Service.presignPut with a chat-specific key prefix so chat
 * uploads can't collide with project media in the same bucket. Keys
 * land under `chat/{channelId}/{ts}-{id}-{filename}` for easy
 * filtering and per-channel deletion later.
 *
 * The size cap enforced here is the *upload* cap; the chat-message
 * service re-enforces it server-side when the message is registered,
 * so a client can't bypass by lying about contentLength.
 */
@Injectable()
export class ChatAttachmentsService {
  private readonly maxBytes: number;

  constructor(
    private readonly s3: S3Service,
    config: ConfigService,
  ) {
    this.maxBytes = config.get<number>('chat.maxAttachmentBytes') ?? 52_428_800;
  }

  async presign(
    channelId: string,
    dto: PresignChatAttachmentDto,
  ): Promise<ChatAttachmentPresignResult> {
    if (dto.contentLength > this.maxBytes) {
      throw new BadRequestException(
        `Attachment exceeds the ${this.maxBytes}-byte limit.`,
      );
    }
    const kind = this.classify(dto.contentType);
    const key = this.buildKey(channelId, dto.contentType, dto.filename);
    const presign = await this.s3.presignPut({
      key,
      contentType: dto.contentType,
      contentLength: dto.contentLength,
    });
    return {
      uploadUrl: presign.uploadUrl,
      expiresIn: presign.expiresIn,
      s3Key: key,
      publicUrl: this.s3.publicUrlFor(key),
      kind,
      contentType: dto.contentType,
    };
  }

  private classify(mime: string): ChatAttachmentKind {
    if (IMAGE_MIMES.has(mime)) return ChatAttachmentKind.IMAGE;
    if (VIDEO_MIMES.has(mime)) return ChatAttachmentKind.VIDEO;
    if (AUDIO_MIMES.has(mime)) return ChatAttachmentKind.AUDIO;
    return ChatAttachmentKind.FILE;
  }

  private buildKey(channelId: string, contentType: string, filename: string): string {
    const safeName = filename
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .slice(0, 80) || 'file';
    return `chat/${channelId}/${Date.now()}-${objectId()}-${safeName}`;
  }
}
