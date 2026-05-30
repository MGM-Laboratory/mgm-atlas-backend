import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { customAlphabet } from 'nanoid';
import { S3Service } from '@/modules/media/s3.service';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateFolderDto } from './dto/create-folder.dto';
import { PresignFileDto } from './dto/presign-file.dto';
import { RegisterFileDto } from './dto/register-file.dto';
import { UpdateFileDto } from './dto/update-file.dto';

const objectId = customAlphabet('0123456789abcdefghijkmnopqrstuvwxyz', 12);

const uploaderSelect = {
  uploadedBy: { select: { id: true, name: true, avatarUrl: true } },
} as const;

@Injectable()
export class FilesService {
  private readonly maxBytes: number;
  private readonly allowedMime: string[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    config: ConfigService,
  ) {
    this.maxBytes = config.get<number>('pmo.fileMaxBytes') ?? 52_428_800;
    this.allowedMime = config.get<string[]>('pmo.fileAllowedMime') ?? ['*'];
  }

  /** Immediate children of a folder (or the root when folderId is omitted). */
  async list(projectId: string, folderId?: string) {
    if (folderId) await this.assertFolder(projectId, folderId);
    const items = await this.prisma.projectFile.findMany({
      where: { projectId, parentFolderId: folderId ?? null, deletedAt: null },
      include: uploaderSelect,
      orderBy: [{ isFolder: 'desc' }, { name: 'asc' }],
    });
    const breadcrumb = folderId ? await this.breadcrumb(projectId, folderId) : [];
    return { folderId: folderId ?? null, breadcrumb, items };
  }

  /** Presign a direct-to-S3 PUT. Enforces the byte cap and MIME allowlist. */
  async presign(projectId: string, dto: PresignFileDto) {
    if (dto.contentLength > this.maxBytes) {
      throw new BadRequestException(`File exceeds the ${this.maxBytes}-byte limit.`);
    }
    if (!this.mimeAllowed(dto.contentType)) {
      throw new BadRequestException(`Unsupported file type: ${dto.contentType}.`);
    }
    if (dto.parentFolderId) await this.assertFolder(projectId, dto.parentFolderId);

    const key = this.buildKey(projectId, dto.filename);
    const { uploadUrl, expiresIn } = await this.s3.presignPut({
      key,
      contentType: dto.contentType,
      contentLength: dto.contentLength,
    });
    return { uploadUrl, expiresIn, s3Key: key, url: this.s3.publicUrlFor(key) };
  }

  /** Register a ProjectFile row after the client PUTs the object to S3. */
  async register(userId: string, projectId: string, dto: RegisterFileDto) {
    if (dto.bytes > this.maxBytes) {
      throw new BadRequestException(`File exceeds the ${this.maxBytes}-byte limit.`);
    }
    if (!this.mimeAllowed(dto.mime)) {
      throw new BadRequestException(`Unsupported file type: ${dto.mime}.`);
    }
    // Re-enforce the key namespace so a client can't register an arbitrary object.
    if (!dto.s3Key.startsWith(`projects/${projectId}/files/`)) {
      throw new BadRequestException('s3Key does not belong to this project.');
    }
    if (dto.parentFolderId) await this.assertFolder(projectId, dto.parentFolderId);

    return this.prisma.projectFile.create({
      data: {
        projectId,
        parentFolderId: dto.parentFolderId ?? null,
        name: dto.name,
        isFolder: false,
        url: this.s3.publicUrlFor(dto.s3Key),
        s3Key: dto.s3Key,
        mime: dto.mime,
        bytes: dto.bytes,
        uploadedById: userId,
      },
      include: uploaderSelect,
    });
  }

  async createFolder(userId: string, projectId: string, dto: CreateFolderDto) {
    if (dto.parentFolderId) await this.assertFolder(projectId, dto.parentFolderId);
    return this.prisma.projectFile.create({
      data: {
        projectId,
        parentFolderId: dto.parentFolderId ?? null,
        name: dto.name,
        isFolder: true,
        uploadedById: userId,
      },
      include: uploaderSelect,
    });
  }

  /** Rename and/or move a file or folder. */
  async update(projectId: string, fileId: string, dto: UpdateFileDto) {
    const node = await this.getNode(projectId, fileId);
    const data: { name?: string; parentFolderId?: string | null } = {};

    if (dto.name !== undefined) data.name = dto.name;

    if (dto.parentFolderId !== undefined) {
      const target = dto.parentFolderId;
      if (target === null) {
        data.parentFolderId = null;
      } else if (target === fileId) {
        throw new BadRequestException('A folder cannot be moved into itself.');
      } else {
        await this.assertFolder(projectId, target);
        if (node.isFolder && (await this.isDescendant(projectId, fileId, target))) {
          throw new BadRequestException('A folder cannot be moved into its own descendant.');
        }
        data.parentFolderId = target;
      }
    }

    if (Object.keys(data).length === 0) {
      return this.prisma.projectFile.findUnique({ where: { id: fileId }, include: uploaderSelect });
    }
    return this.prisma.projectFile.update({ where: { id: fileId }, data, include: uploaderSelect });
  }

  /**
   * Soft-delete a file, or a folder. A non-empty folder requires `force`,
   * in which case the whole live subtree is soft-deleted in one update.
   * S3 objects are removed best-effort (failures are logged, not fatal).
   */
  async remove(projectId: string, fileId: string, force: boolean) {
    const node = await this.getNode(projectId, fileId);
    const now = new Date();

    if (!node.isFolder) {
      await this.prisma.projectFile.update({ where: { id: fileId }, data: { deletedAt: now } });
      if (node.s3Key) await this.s3.deleteObject(node.s3Key);
      return { deleted: true, count: 1 };
    }

    const subtree = await this.collectSubtree(projectId, fileId);
    if (subtree.length > 1 && !force) {
      throw new BadRequestException(
        'Folder is not empty. Pass force=1 to delete it and its contents.',
      );
    }

    await this.prisma.projectFile.updateMany({
      where: { id: { in: subtree.map((n) => n.id) }, deletedAt: null },
      data: { deletedAt: now },
    });
    await Promise.all(
      subtree
        .filter((n) => !n.isFolder && n.s3Key)
        .map((n) => this.s3.deleteObject(n.s3Key as string)),
    );
    return { deleted: true, count: subtree.length };
  }

  // ── helpers ──────────────────────────────────────────────────────────

  private mimeAllowed(mime: string): boolean {
    return this.allowedMime.includes('*') || this.allowedMime.includes(mime);
  }

  private buildKey(projectId: string, filename: string): string {
    const safeName =
      filename.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 80) || 'file';
    return `projects/${projectId}/files/${objectId()}/${safeName}`;
  }

  private async getNode(projectId: string, fileId: string) {
    const node = await this.prisma.projectFile.findFirst({
      where: { id: fileId, projectId, deletedAt: null },
    });
    if (!node) throw new NotFoundException('File not found.');
    return node;
  }

  private async assertFolder(projectId: string, folderId: string): Promise<void> {
    const folder = await this.prisma.projectFile.findFirst({
      where: { id: folderId, projectId, isFolder: true, deletedAt: null },
      select: { id: true },
    });
    if (!folder) throw new NotFoundException('Folder not found.');
  }

  /** True if `candidateId` sits anywhere below `folderId` in the tree. */
  private async isDescendant(
    projectId: string,
    folderId: string,
    candidateId: string,
  ): Promise<boolean> {
    let current: string | null = candidateId;
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      if (current === folderId) return true;
      seen.add(current);
      const parent: { parentFolderId: string | null } | null =
        await this.prisma.projectFile.findFirst({
          where: { id: current, projectId },
          select: { parentFolderId: true },
        });
      current = parent?.parentFolderId ?? null;
    }
    return false;
  }

  private async breadcrumb(projectId: string, folderId: string) {
    const chain: { id: string; name: string }[] = [];
    let current: string | null = folderId;
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      seen.add(current);
      const node: { id: string; name: string; parentFolderId: string | null } | null =
        await this.prisma.projectFile.findFirst({
          where: { id: current, projectId, deletedAt: null },
          select: { id: true, name: true, parentFolderId: true },
        });
      if (!node) break;
      chain.unshift({ id: node.id, name: node.name });
      current = node.parentFolderId;
    }
    return chain;
  }

  /** Breadth-first collection of a folder and all its live descendants. */
  private async collectSubtree(projectId: string, rootId: string) {
    const root = await this.prisma.projectFile.findFirst({
      where: { id: rootId, projectId, deletedAt: null },
    });
    if (!root) return [];
    const result = [root];
    const seen = new Set<string>([root.id]);
    let parents = root.isFolder ? [root.id] : [];
    while (parents.length) {
      const children = await this.prisma.projectFile.findMany({
        where: { projectId, parentFolderId: { in: parents }, deletedAt: null },
      });
      const next: string[] = [];
      for (const child of children) {
        if (seen.has(child.id)) continue;
        seen.add(child.id);
        result.push(child);
        if (child.isFolder) next.push(child.id);
      }
      parents = next;
    }
    return result;
  }
}
