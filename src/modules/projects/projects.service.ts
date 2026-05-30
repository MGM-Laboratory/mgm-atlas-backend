import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Project, ProjectVisibility } from '@prisma/client';
import { paginate } from '@/common/dto/pagination.dto';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { toUniqueSlug } from '@/common/utils/slug.util';
import { PrismaService } from '@/prisma/prisma.service';
import { VoiceChannelsService } from '@/modules/voice/services/voice-channels.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { ListProjectsDto } from './dto/list-projects.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectAccess } from './project-access.service';

const CARD_SELECT = {
  id: true,
  slug: true,
  title: true,
  shortDescription: true,
  thumbnailUrl: true,
  thumbnailType: true,
  phase: true,
  visibility: true,
  collaborationRoles: true,
  archivedAt: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
  owner: { select: { id: true, name: true, avatarUrl: true } },
  tags: { include: { tag: true } },
  media: {
    where: { order: { gt: 0 } },
    orderBy: { order: 'asc' },
    take: 4,
    select: { id: true, url: true, type: true, order: true },
  },
  _count: { select: { members: true } },
} satisfies Prisma.ProjectSelect;

const DETAIL_INCLUDE = {
  owner: { select: { id: true, name: true, email: true, avatarUrl: true } },
  tags: { include: { tag: true } },
  media: { orderBy: { order: 'asc' } },
  members: {
    include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
    orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
  },
  _count: { select: { members: true, contributionRequests: { where: { status: 'PENDING' } } } },
} satisfies Prisma.ProjectInclude;

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly voiceChannels: VoiceChannelsService,
  ) {}

  // ─── Create ────────────────────────────────────────────────────────────

  async create(user: AuthenticatedUser, dto: CreateProjectDto): Promise<Project> {
    const slug = toUniqueSlug(dto.title);
    return this.prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          slug,
          title: dto.title.trim(),
          shortDescription: dto.shortDescription.trim(),
          description: dto.description as Prisma.InputJsonValue,
          techStack: dto.techStack ?? [],
          phase: dto.phase,
          visibility: dto.visibility,
          collaborationRoles: dto.collaborationRoles ?? [],
          internalLinks: dto.internalLinks as Prisma.InputJsonValue | undefined,
          ownerId: user.id,
          publishedAt: new Date(),
          tags: dto.tagIds?.length ? { create: dto.tagIds.map((tagId) => ({ tagId })) } : undefined,
        },
      });
      await tx.projectMember.create({
        data: { projectId: project.id, userId: user.id, role: 'PROJECT_MANAGER' },
      });
      // Auto-create the project's #general chat channel. Inlined here
      // (rather than calling ChatChannelsService) to avoid a circular
      // dependency between ProjectsModule and ChatModule. The partial
      // unique index on (projectId) WHERE isGeneral guarantees there
      // can never be more than one #general per project.
      await tx.chatChannel.create({
        data: {
          projectId: project.id,
          name: 'general',
          slug: 'general',
          isGeneral: true,
          createdById: user.id,
        },
      });
      // Auto-create the default voice channel — gated by the feature
      // flag so VOICE_ENABLED=false makes new projects identical to
      // pre-voice projects (no orphan VoiceChannel rows).
      if (this.config.get<boolean>('voice.enabled', false)) {
        await this.voiceChannels.createDefaultForProject(tx, {
          projectId: project.id,
          createdById: user.id,
        });
      }
      return project;
    });
  }

  // ─── Read (single) ─────────────────────────────────────────────────────

  async findOne(projectId: string, access: ProjectAccess, userId?: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, deletedAt: null },
      include: DETAIL_INCLUDE,
    });
    if (!project) throw new NotFoundException('Project not found.');

    let bookmarked = false;
    if (userId) {
      const bm = await this.prisma.bookmark.findUnique({
        where: { userId_projectId: { userId, projectId: project.id } },
        select: { userId: true },
      });
      bookmarked = !!bm;
    }
    return { ...this.shapeForAccess(project, access), bookmarked };
  }

  // ─── Read (list / discovery) ───────────────────────────────────────────

  async list(user: AuthenticatedUser, dto: ListProjectsDto) {
    const where = this.buildWhere(user, dto);
    const orderBy = this.buildOrderBy(dto.sort);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.project.findMany({
        where,
        select: CARD_SELECT,
        orderBy,
        skip: (dto.page - 1) * dto.pageSize,
        take: dto.pageSize,
      }),
      this.prisma.project.count({ where }),
    ]);

    return paginate(
      items.map((p) => this.shapeCard(p)),
      total,
      dto.page,
      dto.pageSize,
    );
  }

  /**
   * Netflix-style discovery payload assembled in one call:
   *   - hero: admin-curated featured projects
   *   - myProjects: managed + contributing
   *   - pendingRequests: applicant-side
   *   - rows: phase-grouped + tag-grouped lanes
   */
  async discover(user: AuthenticatedUser) {
    const baseVisibility = this.visibilityClause(user);

    const [featured, memberships, pendingRequests, recruiting, recent, shipped, allTags] =
      await this.prisma.$transaction([
        this.prisma.featuredProject.findMany({
          orderBy: { order: 'asc' },
          where: { project: { deletedAt: null, archivedAt: null, ...baseVisibility } },
          include: { project: { select: CARD_SELECT } },
        }),
        this.prisma.projectMember.findMany({
          where: { userId: user.id, project: { deletedAt: null } },
          include: { project: { select: CARD_SELECT } },
          orderBy: { joinedAt: 'desc' },
        }),
        this.prisma.contributionRequest.findMany({
          where: { userId: user.id, status: 'PENDING' },
          include: { project: { select: CARD_SELECT } },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.project.findMany({
          where: {
            deletedAt: null,
            archivedAt: null,
            ...baseVisibility,
            collaborationRoles: { isEmpty: false },
          },
          select: CARD_SELECT,
          orderBy: { updatedAt: 'desc' },
          take: 20,
        }),
        this.prisma.project.findMany({
          where: { deletedAt: null, archivedAt: null, ...baseVisibility },
          select: CARD_SELECT,
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
        this.prisma.project.findMany({
          where: { deletedAt: null, archivedAt: null, phase: 'SHIPPED', ...baseVisibility },
          select: CARD_SELECT,
          orderBy: { updatedAt: 'desc' },
          take: 20,
        }),
        this.prisma.tag.findMany({ orderBy: [{ category: 'asc' }, { name: 'asc' }] }),
      ]);

    const managed = memberships
      .filter((m) => m.role === 'PROJECT_MANAGER')
      .map((m) => this.shapeCard(m.project));
    const contributing = memberships
      .filter((m) => m.role === 'CONTRIBUTOR')
      .map((m) => this.shapeCard(m.project));

    return {
      hero: featured.map((f) => this.shapeCard(f.project)),
      myProjects: { managed, contributing },
      pendingRequests: pendingRequests.map((r) => ({
        id: r.id,
        role: r.role,
        createdAt: r.createdAt,
        project: this.shapeCard(r.project),
      })),
      rows: [
        {
          key: 'recruiting',
          label: 'Currently recruiting',
          items: recruiting.map((p) => this.shapeCard(p)),
        },
        { key: 'recent', label: 'New this month', items: recent.map((p) => this.shapeCard(p)) },
        { key: 'shipped', label: 'Shipped projects', items: shipped.map((p) => this.shapeCard(p)) },
      ].filter((row) => row.items.length > 0),
      tags: allTags,
    };
  }

  // ─── Update ────────────────────────────────────────────────────────────

  async update(projectId: string, dto: UpdateProjectDto): Promise<Project> {
    const data: Prisma.ProjectUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.shortDescription !== undefined) data.shortDescription = dto.shortDescription.trim();
    if (dto.description !== undefined) data.description = dto.description as Prisma.InputJsonValue;
    if (dto.techStack !== undefined) data.techStack = dto.techStack;
    if (dto.phase !== undefined) data.phase = dto.phase;
    if (dto.visibility !== undefined) data.visibility = dto.visibility;
    if (dto.collaborationRoles !== undefined) data.collaborationRoles = dto.collaborationRoles;
    if (dto.internalLinks !== undefined) {
      data.internalLinks = dto.internalLinks as Prisma.InputJsonValue;
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.tagIds !== undefined) {
        await tx.projectTag.deleteMany({ where: { projectId } });
        if (dto.tagIds.length > 0) {
          await tx.projectTag.createMany({
            data: dto.tagIds.map((tagId) => ({ projectId, tagId })),
            skipDuplicates: true,
          });
        }
      }
      return tx.project.update({ where: { id: projectId }, data });
    });
  }

  async archive(projectId: string) {
    return this.prisma.project.update({
      where: { id: projectId },
      data: { archivedAt: new Date(), phase: 'ARCHIVED' },
    });
  }

  async unarchive(projectId: string) {
    return this.prisma.project.update({
      where: { id: projectId },
      data: { archivedAt: null },
    });
  }

  async softDelete(projectId: string) {
    await this.prisma.project.update({
      where: { id: projectId },
      data: { deletedAt: new Date() },
    });
    return { deleted: true };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private visibilityClause(user: AuthenticatedUser): Prisma.ProjectWhereInput {
    if (user.isAdmin) return {};
    return {
      OR: [{ visibility: ProjectVisibility.PUBLIC }, { members: { some: { userId: user.id } } }],
    };
  }

  private buildWhere(user: AuthenticatedUser, dto: ListProjectsDto): Prisma.ProjectWhereInput {
    const and: Prisma.ProjectWhereInput[] = [{ deletedAt: null }, this.visibilityClause(user)];

    if (dto.archived !== true) and.push({ archivedAt: null });
    if (dto.archived === true) and.push({ archivedAt: { not: null } });

    if (dto.q?.trim()) {
      const q = dto.q.trim();
      and.push({
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { shortDescription: { contains: q, mode: 'insensitive' } },
          { tags: { some: { tag: { name: { contains: q, mode: 'insensitive' } } } } },
        ],
      });
    }
    if (dto.phase?.length) and.push({ phase: { in: dto.phase } });
    if (dto.visibility) and.push({ visibility: dto.visibility });
    if (dto.tagIds?.length) {
      and.push({ tags: { some: { tagId: { in: dto.tagIds } } } });
    }
    if (dto.recruitingFor?.trim()) {
      and.push({ collaborationRoles: { has: dto.recruitingFor.trim() } });
    }
    if (dto.bookmarkedOnly) {
      and.push({ bookmarks: { some: { userId: user.id } } });
    }
    return { AND: and };
  }

  private buildOrderBy(sort?: ListProjectsDto['sort']): Prisma.ProjectOrderByWithRelationInput[] {
    switch (sort) {
      case 'oldest':
        return [{ createdAt: 'asc' }];
      case 'recently-updated':
        return [{ updatedAt: 'desc' }];
      case 'title':
        return [{ title: 'asc' }];
      case 'newest':
      default:
        return [{ createdAt: 'desc' }];
    }
  }

  private shapeCard<P extends Prisma.ProjectGetPayload<{ select: typeof CARD_SELECT }>>(p: P) {
    return {
      id: p.id,
      slug: p.slug,
      title: p.title,
      shortDescription: p.shortDescription,
      thumbnailUrl: p.thumbnailUrl,
      thumbnailType: p.thumbnailType,
      phase: p.phase,
      visibility: p.visibility,
      collaborationRoles: p.collaborationRoles,
      archivedAt: p.archivedAt,
      publishedAt: p.publishedAt,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      owner: p.owner,
      tags: p.tags.map((t) => t.tag),
      previewMedia: p.media,
      memberCount: p._count.members,
    };
  }

  private shapeForAccess(
    project: Prisma.ProjectGetPayload<{ include: typeof DETAIL_INCLUDE }>,
    access: ProjectAccess,
  ) {
    const base = {
      id: project.id,
      slug: project.slug,
      title: project.title,
      shortDescription: project.shortDescription,
      description: project.description,
      thumbnailUrl: project.thumbnailUrl,
      thumbnailType: project.thumbnailType,
      techStack: project.techStack,
      phase: project.phase,
      visibility: project.visibility,
      collaborationRoles: project.collaborationRoles,
      archivedAt: project.archivedAt,
      publishedAt: project.publishedAt,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      owner: {
        id: project.owner.id,
        name: project.owner.name,
        avatarUrl: project.owner.avatarUrl,
      },
      tags: project.tags.map((t) => t.tag),
      media: project.media,
      managers: project.members
        .filter((m) => m.role === 'PROJECT_MANAGER')
        .map((m) => ({ id: m.user.id, name: m.user.name, avatarUrl: m.user.avatarUrl })),
      memberCount: project._count.members,
      access: { level: access.level, isInsider: access.isInsider, isManager: access.isManager },
    };

    if (!access.isInsider) {
      // Viewer view: omit internal links and detailed contributor list.
      return base;
    }

    return {
      ...base,
      internalLinks: project.internalLinks,
      members: project.members.map((m) => ({
        id: m.id,
        role: m.role,
        title: m.title,
        joinedAt: m.joinedAt,
        user: {
          id: m.user.id,
          name: m.user.name,
          email: m.user.email,
          avatarUrl: m.user.avatarUrl,
        },
      })),
      pendingRequestCount: access.isManager ? project._count.contributionRequests : undefined,
      ownerEmail: project.owner.email,
    };
  }

  // ─── Featured projects (admin) ─────────────────────────────────────────

  async setFeatured(adminId: string, projectIds: string[]) {
    if (projectIds.length > 12) {
      throw new BadRequestException('At most 12 featured projects.');
    }
    const valid = await this.prisma.project.findMany({
      where: { id: { in: projectIds }, deletedAt: null, archivedAt: null },
      select: { id: true },
    });
    const validIds = new Set(valid.map((p) => p.id));
    const ordered = projectIds.filter((id) => validIds.has(id));

    await this.prisma.$transaction([
      this.prisma.featuredProject.deleteMany({ where: { projectId: { notIn: ordered } } }),
      ...ordered.map((projectId, order) =>
        this.prisma.featuredProject.upsert({
          where: { projectId },
          create: { projectId, setById: adminId, order },
          update: { setById: adminId, order, setAt: new Date() },
        }),
      ),
    ]);
    return { featured: ordered };
  }

  listFeatured() {
    return this.prisma.featuredProject.findMany({
      orderBy: { order: 'asc' },
      include: { project: { select: CARD_SELECT } },
    });
  }
}
