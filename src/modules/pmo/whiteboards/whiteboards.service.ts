import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { customAlphabet } from 'nanoid';
import { S3Service } from '@/modules/media/s3.service';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateWhiteboardDto } from './dto/create-whiteboard.dto';
import { PresignThumbnailDto } from './dto/presign-thumbnail.dto';
import { UpdateWhiteboardDto } from './dto/update-whiteboard.dto';

const objectId = customAlphabet('0123456789abcdefghijkmnopqrstuvwxyz', 12);

const THUMB_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const THUMB_MAX_BYTES = 5 * 1024 * 1024;

const listSelect = {
  id: true,
  projectId: true,
  title: true,
  description: true,
  thumbnailUrl: true,
  createdById: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.WhiteboardSelect;

@Injectable()
export class WhiteboardsService {
  private readonly maxWhiteboards: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    config: ConfigService,
  ) {
    this.maxWhiteboards = config.get<number>('pmo.maxWhiteboardsPerProject') ?? 100;
  }

  async list(projectId: string) {
    const whiteboards = await this.prisma.whiteboard.findMany({
      where: { projectId, deletedAt: null },
      select: listSelect,
      orderBy: { updatedAt: 'desc' },
    });
    return { whiteboards };
  }

  async get(projectId: string, wbId: string) {
    const wb = await this.prisma.whiteboard.findFirst({
      where: { id: wbId, projectId, deletedAt: null },
    });
    if (!wb) throw new NotFoundException('Whiteboard not found.');
    return wb;
  }

  async create(userId: string, projectId: string, dto: CreateWhiteboardDto) {
    const count = await this.prisma.whiteboard.count({ where: { projectId, deletedAt: null } });
    if (count >= this.maxWhiteboards) {
      throw new BadRequestException(`A project can have at most ${this.maxWhiteboards} whiteboards.`);
    }
    const id = randomUUID();
    const yDocKey = `whiteboard:${id}`;
    return this.prisma.$transaction(async (tx) => {
      const wb = await tx.whiteboard.create({
        data: {
          id,
          projectId,
          title: dto.title?.trim() || 'Untitled whiteboard',
          description: dto.description ?? null,
          yDocKey,
          createdById: userId,
        },
      });
      await tx.yDocSnapshot.create({ data: { docKey: yDocKey, state: Buffer.alloc(0), size: 0 } });
      return wb;
    });
  }

  async update(projectId: string, wbId: string, dto: UpdateWhiteboardDto, actorId?: string) {
    await this.get(projectId, wbId);
    const data: Prisma.WhiteboardUncheckedUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title.trim() || 'Untitled whiteboard';
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.thumbnailUrl !== undefined) data.thumbnailUrl = dto.thumbnailUrl;
    if (dto.sceneSnapshot !== undefined) {
      data.sceneSnapshot = dto.sceneSnapshot as Prisma.InputJsonValue;
    }

    // Scene edits also write a WhiteboardRevision. Title/description
    // changes do not — they're metadata-only and not history-relevant.
    if (dto.sceneSnapshot !== undefined) {
      const snapshot = dto.sceneSnapshot as Prisma.InputJsonValue;
      const size = Buffer.byteLength(JSON.stringify(snapshot ?? null));
      return this.prisma.$transaction(async (tx) => {
        const updated = await tx.whiteboard.update({ where: { id: wbId }, data });
        await tx.whiteboardRevision.create({
          data: {
            whiteboardId: wbId,
            sceneSnapshot: snapshot,
            size,
            authorId: actorId ?? null,
          },
        });
        return updated;
      });
    }

    return this.prisma.whiteboard.update({ where: { id: wbId }, data });
  }

  async listRevisions(projectId: string, wbId: string, take = 100) {
    await this.get(projectId, wbId);
    return this.prisma.whiteboardRevision.findMany({
      where: { whiteboardId: wbId },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        createdAt: true,
        size: true,
        isCheckpoint: true,
        author: { select: { id: true, name: true, avatarUrl: true } },
      },
    });
  }

  async getRevision(projectId: string, wbId: string, revisionId: string) {
    await this.get(projectId, wbId);
    const rev = await this.prisma.whiteboardRevision.findFirst({
      where: { id: revisionId, whiteboardId: wbId },
    });
    if (!rev) throw new NotFoundException('Revision not found.');
    return rev;
  }

  async restoreRevision(projectId: string, wbId: string, revisionId: string, actorId: string) {
    const rev = await this.getRevision(projectId, wbId, revisionId);
    const size = Buffer.byteLength(JSON.stringify(rev.sceneSnapshot ?? null));
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.whiteboard.update({
        where: { id: wbId },
        data: { sceneSnapshot: rev.sceneSnapshot as Prisma.InputJsonValue },
      });
      await tx.whiteboardRevision.create({
        data: {
          whiteboardId: wbId,
          sceneSnapshot: rev.sceneSnapshot as Prisma.InputJsonValue,
          size,
          authorId: actorId,
        },
      });
      return updated;
    });
  }

  async remove(projectId: string, wbId: string) {
    await this.get(projectId, wbId);
    await this.prisma.whiteboard.update({ where: { id: wbId }, data: { deletedAt: new Date() } });
    return { deleted: true };
  }

  /** `.mgm` export — a versioned JSON wrapper around the Excalidraw scene. */
  async export(projectId: string, wbId: string) {
    const wb = await this.get(projectId, wbId);
    return {
      format: 'mgm.whiteboard',
      version: 1,
      exportedAt: new Date().toISOString(),
      atlas: { projectId, whiteboardId: wb.id, title: wb.title },
      scene: wb.sceneSnapshot,
      mentions: [] as unknown[],
    };
  }

  async presignThumbnail(projectId: string, wbId: string, dto: PresignThumbnailDto) {
    await this.get(projectId, wbId);
    if (!THUMB_MIMES.has(dto.contentType)) {
      throw new BadRequestException('Thumbnail must be a PNG, JPEG, or WebP image.');
    }
    if (dto.contentLength > THUMB_MAX_BYTES) {
      throw new BadRequestException(`Thumbnail exceeds the ${THUMB_MAX_BYTES}-byte limit.`);
    }
    const ext = dto.contentType === 'image/png' ? 'png' : dto.contentType === 'image/webp' ? 'webp' : 'jpg';
    const key = `projects/${projectId}/whiteboards/${wbId}/thumb-${objectId()}.${ext}`;
    const { uploadUrl, expiresIn } = await this.s3.presignPut({
      key,
      contentType: dto.contentType,
      contentLength: dto.contentLength,
    });
    return { uploadUrl, expiresIn, s3Key: key, url: this.s3.publicUrlFor(key) };
  }
}
