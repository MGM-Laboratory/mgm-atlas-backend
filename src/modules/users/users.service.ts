import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { UpdateMeDto } from './dto/update-me.dto';

const PUBLIC_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  avatarUrl: true,
  bio: true,
  isAdmin: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async getMe(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { ...PUBLIC_USER_SELECT, lastLoginAt: true },
    });
    if (!user) throw new NotFoundException('User not found.');
    return user;
  }

  async updateMe(id: string, dto: UpdateMeDto) {
    return this.prisma.user.update({
      where: { id },
      data: dto,
      select: PUBLIC_USER_SELECT,
    });
  }

  async listUsers(opts: { search?: string; page?: number; pageSize?: number }) {
    const page = opts.page ?? 1;
    const pageSize = Math.min(opts.pageSize ?? 24, 100);
    const where: Prisma.UserWhereInput = opts.search
      ? {
          OR: [
            { email: { contains: opts.search, mode: 'insensitive' } },
            { name: { contains: opts.search, mode: 'insensitive' } },
          ],
        }
      : {};

    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: PUBLIC_USER_SELECT,
        orderBy: [{ name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items,
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  async setAdmin(actorId: string, targetId: string, isAdmin: boolean) {
    if (actorId === targetId) {
      throw new ForbiddenException('Admins cannot change their own admin status.');
    }
    const bootstrapEmail = this.config
      .getOrThrow<string>('bootstrap.adminEmail')
      .toLowerCase();
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, email: true },
    });
    if (!target) throw new NotFoundException('User not found.');
    if (!isAdmin && target.email.toLowerCase() === bootstrapEmail) {
      throw new ForbiddenException('Cannot revoke admin from the bootstrap admin.');
    }
    return this.prisma.user.update({
      where: { id: targetId },
      data: { isAdmin },
      select: PUBLIC_USER_SELECT,
    });
  }

  async addBookmark(userId: string, projectId: string) {
    const exists = await this.prisma.project.findFirst({
      where: { id: projectId, deletedAt: null },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Project not found.');
    await this.prisma.bookmark.upsert({
      where: { userId_projectId: { userId, projectId } },
      create: { userId, projectId },
      update: {},
    });
    return { bookmarked: true };
  }

  async removeBookmark(userId: string, projectId: string) {
    await this.prisma.bookmark
      .delete({ where: { userId_projectId: { userId, projectId } } })
      .catch(() => undefined);
    return { bookmarked: false };
  }

  async listBookmarks(userId: string) {
    const rows = await this.prisma.bookmark.findMany({
      where: { userId, project: { deletedAt: null } },
      orderBy: { createdAt: 'desc' },
      include: {
        project: {
          select: {
            id: true,
            slug: true,
            title: true,
            shortDescription: true,
            phase: true,
            visibility: true,
            thumbnailUrl: true,
            thumbnailType: true,
          },
        },
      },
    });
    return rows.map((r) => r.project);
  }

  async getDashboard(userId: string) {
    const [memberships, pendingRequests, bookmarks] = await this.prisma.$transaction([
      this.prisma.projectMember.findMany({
        where: { userId, project: { deletedAt: null } },
        include: {
          project: {
            select: {
              id: true,
              slug: true,
              title: true,
              shortDescription: true,
              phase: true,
              visibility: true,
              thumbnailUrl: true,
              thumbnailType: true,
              archivedAt: true,
            },
          },
        },
        orderBy: { joinedAt: 'desc' },
      }),
      this.prisma.contributionRequest.findMany({
        where: { userId, status: 'PENDING' },
        include: {
          project: {
            select: {
              id: true,
              slug: true,
              title: true,
              shortDescription: true,
              thumbnailUrl: true,
              thumbnailType: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.bookmark.findMany({
        where: { userId, project: { deletedAt: null } },
        include: {
          project: {
            select: {
              id: true,
              slug: true,
              title: true,
              shortDescription: true,
              phase: true,
              thumbnailUrl: true,
              thumbnailType: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 12,
      }),
    ]);

    const managed = memberships
      .filter((m) => m.role === 'PROJECT_MANAGER')
      .map((m) => m.project);
    const contributing = memberships
      .filter((m) => m.role === 'CONTRIBUTOR')
      .map((m) => m.project);

    return {
      managed,
      contributing,
      pendingRequests: pendingRequests.map((r) => ({
        id: r.id,
        role: r.role,
        message: r.message,
        createdAt: r.createdAt,
        project: r.project,
      })),
      bookmarks: bookmarks.map((b) => b.project),
    };
  }
}
