import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MediaType } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { PresignUploadDto } from './dto/presign-upload.dto';
import { RegisterMediaDto } from './dto/register-media.dto';
import { S3Service } from './s3.service';

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly config: ConfigService,
  ) {}

  async presignUpload(projectId: string, dto: PresignUploadDto) {
    const allowedImages = this.config.getOrThrow<string[]>('media.allowedImageMime');
    const allowedVideos = this.config.getOrThrow<string[]>('media.allowedVideoMime');
    const maxImage = this.config.getOrThrow<number>('media.maxImageBytes');
    const maxVideo = this.config.getOrThrow<number>('media.maxVideoBytes');

    const isImage = allowedImages.includes(dto.contentType);
    const isVideo = allowedVideos.includes(dto.contentType);
    if (!isImage && !isVideo) {
      throw new BadRequestException(`Unsupported media type: ${dto.contentType}.`);
    }

    const cap = isImage ? maxImage : maxVideo;
    if (dto.contentLength > cap) {
      throw new BadRequestException(
        `File exceeds the ${isImage ? 'image' : 'video'} limit of ${cap} bytes.`,
      );
    }

    const key = this.s3.buildKey(projectId, dto.contentType);
    const { uploadUrl, expiresIn } = await this.s3.presignPut({
      key,
      contentType: dto.contentType,
      contentLength: dto.contentLength,
    });

    return {
      uploadUrl,
      expiresIn,
      objectKey: key,
      publicUrl: this.s3.publicUrlFor(key),
      type: isImage ? MediaType.IMAGE : MediaType.VIDEO,
    };
  }

  async registerMedia(projectId: string, dto: RegisterMediaDto) {
    const max = this.config.getOrThrow<number>('media.maxGalleryItems');

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.projectMedia.count({ where: { projectId } });
      if (existing >= max + 1) {
        throw new BadRequestException(`A project can have at most ${max} gallery items + 1 thumbnail.`);
      }

      // If incoming media is order=0 (thumbnail), demote any existing thumbnail.
      if (dto.order === 0) {
        const oldThumb = await tx.projectMedia.findFirst({
          where: { projectId, order: 0 },
        });
        if (oldThumb) {
          await tx.projectMedia.delete({ where: { id: oldThumb.id } });
          const oldKey = this.s3.keyFromPublicUrl(oldThumb.url);
          if (oldKey) await this.s3.deleteObject(oldKey);
        }
      } else {
        // Push subsequent items down by 1 if a position is taken.
        const collide = await tx.projectMedia.findUnique({
          where: { projectId_order: { projectId, order: dto.order } },
        });
        if (collide) {
          // Append at the next free slot instead of overwriting.
          const last = await tx.projectMedia.findFirst({
            where: { projectId },
            orderBy: { order: 'desc' },
            select: { order: true },
          });
          dto.order = (last?.order ?? 0) + 1;
        }
      }

      const created = await tx.projectMedia.create({
        data: {
          projectId,
          url: dto.url,
          type: dto.type,
          order: dto.order,
          width: dto.width,
          height: dto.height,
          sizeBytes: dto.sizeBytes,
        },
      });

      if (dto.order === 0) {
        await tx.project.update({
          where: { id: projectId },
          data: { thumbnailUrl: dto.url, thumbnailType: dto.type },
        });
      }

      return created;
    });
  }

  async reorder(projectId: string, orderedIds: string[]) {
    const items = await this.prisma.projectMedia.findMany({
      where: { projectId, id: { in: orderedIds } },
      select: { id: true },
    });
    if (items.length !== orderedIds.length) {
      throw new ForbiddenException('Some media items do not belong to this project.');
    }

    return this.prisma.$transaction(async (tx) => {
      // Two-pass: stash to temporary negative order to avoid the unique
      // constraint, then write the final positions.
      for (let i = 0; i < orderedIds.length; i++) {
        await tx.projectMedia.update({
          where: { id: orderedIds[i] },
          data: { order: -1 - i },
        });
      }
      for (let i = 0; i < orderedIds.length; i++) {
        await tx.projectMedia.update({
          where: { id: orderedIds[i] },
          data: { order: i },
        });
      }
      const head = await tx.projectMedia.findUnique({
        where: { projectId_order: { projectId, order: 0 } },
      });
      await tx.project.update({
        where: { id: projectId },
        data: {
          thumbnailUrl: head?.url ?? null,
          thumbnailType: head?.type ?? null,
        },
      });
      return tx.projectMedia.findMany({ where: { projectId }, orderBy: { order: 'asc' } });
    });
  }

  async remove(projectId: string, mediaId: string) {
    const media = await this.prisma.projectMedia.findUnique({ where: { id: mediaId } });
    if (!media || media.projectId !== projectId) {
      throw new NotFoundException('Media not found.');
    }

    await this.prisma.projectMedia.delete({ where: { id: mediaId } });

    const key = this.s3.keyFromPublicUrl(media.url);
    if (key) await this.s3.deleteObject(key);

    if (media.order === 0) {
      const next = await this.prisma.projectMedia.findFirst({
        where: { projectId },
        orderBy: { order: 'asc' },
      });
      await this.prisma.project.update({
        where: { id: projectId },
        data: {
          thumbnailUrl: next?.url ?? null,
          thumbnailType: next?.type ?? null,
        },
      });
    }
    return { deleted: true };
  }
}
