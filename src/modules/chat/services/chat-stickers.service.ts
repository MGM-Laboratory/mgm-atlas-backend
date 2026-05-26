import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { customAlphabet } from 'nanoid';
import { toSlug } from '@/common/utils/slug.util';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { S3Service } from '@/modules/media/s3.service';
import { PrismaService } from '@/prisma/prisma.service';
import {
  CreateStickerPackDto,
  PresignStickerDto,
  RegisterStickerDto,
  UpdateStickerPackDto,
} from '../dto/sticker.dto';

const objectId = customAlphabet('0123456789abcdefghijkmnopqrstuvwxyz', 12);
const ALLOWED_MIMES = new Set(['image/png', 'image/webp', 'image/gif', 'image/jpeg']);

/**
 * Globally-configured sticker library. Admin creates packs + uploads
 * sticker PNGs to S3 (prefix `stickers/{packId}/...`); every chat
 * insider sees the full library via the picker. Stored once, used
 * everywhere — no per-channel rights.
 */
@Injectable()
export class ChatStickersService {
  private readonly maxBytes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    config: ConfigService,
  ) {
    // Reuse the existing image-attachment cap; stickers are images.
    this.maxBytes = config.get<number>('media.maxImageBytes') ?? 10 * 1024 * 1024;
  }

  // ─── Public reads (any chat insider) ─────────────────────────────────

  async listActivePacks() {
    return this.prisma.stickerPack.findMany({
      where: { isArchived: false },
      orderBy: [{ createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        stickers: {
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            name: true,
            keywords: true,
            url: true,
            mime: true,
            width: true,
            height: true,
          },
        },
      },
    });
  }

  // ─── Admin writes ────────────────────────────────────────────────────

  listAllPacks() {
    return this.prisma.stickerPack.findMany({
      orderBy: [{ isArchived: 'asc' }, { createdAt: 'desc' }],
      include: { _count: { select: { stickers: true } } },
    });
  }

  async createPack(user: AuthenticatedUser, dto: CreateStickerPackDto) {
    const slug = `${toSlug(dto.name)}-${objectId().slice(0, 4)}`;
    return this.prisma.stickerPack.create({
      data: {
        name: dto.name.trim(),
        slug,
        description: dto.description?.trim() || null,
        createdById: user.id,
      },
    });
  }

  async updatePack(packId: string, dto: UpdateStickerPackDto) {
    const data: Prisma.StickerPackUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.description !== undefined) data.description = dto.description.trim() || null;
    return this.prisma.stickerPack.update({ where: { id: packId }, data });
  }

  async archivePack(packId: string) {
    return this.prisma.stickerPack.update({
      where: { id: packId },
      data: { isArchived: true },
    });
  }

  async unarchivePack(packId: string) {
    return this.prisma.stickerPack.update({
      where: { id: packId },
      data: { isArchived: false },
    });
  }

  // ─── Sticker upload (admin) ──────────────────────────────────────────

  async presignSticker(packId: string, dto: PresignStickerDto) {
    if (!ALLOWED_MIMES.has(dto.contentType)) {
      throw new BadRequestException('Sticker must be PNG, WebP, GIF, or JPEG.');
    }
    if (dto.contentLength > this.maxBytes) {
      throw new BadRequestException(`Sticker exceeds the ${this.maxBytes}-byte limit.`);
    }
    // Verify pack exists & isn't archived.
    const pack = await this.prisma.stickerPack.findUnique({ where: { id: packId } });
    if (!pack) throw new NotFoundException('Sticker pack not found.');
    if (pack.isArchived) throw new BadRequestException('Cannot add stickers to an archived pack.');

    const safeName =
      dto.filename
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .slice(0, 60) || 'sticker';
    const key = `stickers/${packId}/${Date.now()}-${objectId()}-${safeName}`;
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
      contentType: dto.contentType,
    };
  }

  async registerSticker(packId: string, dto: RegisterStickerDto) {
    const pack = await this.prisma.stickerPack.findUnique({ where: { id: packId } });
    if (!pack) throw new NotFoundException('Sticker pack not found.');
    const last = await this.prisma.sticker.findFirst({
      where: { packId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    return this.prisma.sticker.create({
      data: {
        packId,
        name: dto.name.trim(),
        keywords: dto.keywords ?? [],
        s3Key: dto.s3Key,
        url: dto.url,
        mime: dto.mime,
        width: dto.width,
        height: dto.height,
        position: (last?.position ?? -1) + 1,
      },
    });
  }

  async deleteSticker(stickerId: string) {
    const sticker = await this.prisma.sticker.findUnique({ where: { id: stickerId } });
    if (!sticker) throw new NotFoundException('Sticker not found.');
    await this.prisma.sticker.delete({ where: { id: stickerId } });
    // Best-effort S3 cleanup — keep the DB consistent even if it fails.
    await this.s3.deleteObject(sticker.s3Key);
    return { deleted: true };
  }
}
