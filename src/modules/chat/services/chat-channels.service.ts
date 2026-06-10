import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ChatChannel, Prisma } from '@prisma/client';
import { toSlug } from '@/common/utils/slug.util';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateChannelDto } from '../dto/create-channel.dto';
import { UpdateChannelDto } from '../dto/update-channel.dto';

/**
 * Channel CRUD for project chat. Access enforcement (insider vs manager)
 * lives in the controller via ProjectAccessService — this service trusts
 * that its caller has already authorized the operation.
 */
@Injectable()
export class ChatChannelsService {
  constructor(private readonly prisma: PrismaService) {}

  list(projectId: string) {
    return this.prisma.chatChannel.findMany({
      // Voice-thread channels (§10 of voice spec) live in the same
      // table but are never user-facing through the chat sidebar —
      // they're only reachable from inside their paired voice channel.
      where: { projectId, isVoiceThread: false },
      orderBy: [{ isGeneral: 'desc' }, { isArchived: 'asc' }, { createdAt: 'asc' }],
      select: this.publicSelect,
    });
  }

  /** Workspace-global channels (projectId = null), e.g. the workspace #general. */
  listGlobal() {
    return this.prisma.chatChannel.findMany({
      where: { projectId: null, isVoiceThread: false },
      orderBy: [{ isGeneral: 'desc' }, { isArchived: 'asc' }, { createdAt: 'asc' }],
      select: this.publicSelect,
    });
  }

  /**
   * Lazily create the workspace #general. Idempotent and concurrency-safe:
   * ChatChannel_one_general_global (partial unique index) makes the loser
   * of a race hit P2002, after which we just read the winner's row.
   * Attribution: first admin by signup date, falling back to the requester.
   */
  async ensureGlobalGeneral(requestingUserId: string) {
    const existing = await this.prisma.chatChannel.findFirst({
      where: { projectId: null, isGeneral: true },
      select: this.publicSelect,
    });
    if (existing) return existing;

    const admin = await this.prisma.user.findFirst({
      where: { isAdmin: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    try {
      return await this.prisma.chatChannel.create({
        data: {
          projectId: null,
          name: 'general',
          slug: 'general',
          topic: 'Workspace-wide discussion',
          isGeneral: true,
          createdById: admin?.id ?? requestingUserId,
        },
        select: this.publicSelect,
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return this.prisma.chatChannel.findFirstOrThrow({
          where: { projectId: null, isGeneral: true },
          select: this.publicSelect,
        });
      }
      throw err;
    }
  }

  /** Workspace-global channel. Caller must be admin (enforced by controller). */
  async createGlobal(user: AuthenticatedUser, dto: CreateChannelDto) {
    const name = dto.name.trim().toLowerCase();
    if (name === 'general') {
      throw new BadRequestException('`general` is reserved for the workspace general channel.');
    }
    try {
      return await this.prisma.chatChannel.create({
        data: {
          projectId: null,
          name,
          slug: toSlug(name),
          topic: dto.topic?.trim() || null,
          createdById: user.id,
          isGeneral: false,
        },
        select: this.publicSelect,
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`Workspace channel "${name}" already exists.`);
      }
      throw err;
    }
  }

  async findById(channelId: string) {
    const channel = await this.prisma.chatChannel.findUnique({
      where: { id: channelId },
      select: { ...this.publicSelect, projectId: true },
    });
    if (!channel) throw new NotFoundException('Channel not found.');
    return channel;
  }

  async create(projectId: string, user: AuthenticatedUser, dto: CreateChannelDto) {
    const name = dto.name.trim().toLowerCase();
    if (name === 'general') {
      throw new BadRequestException(
        '`general` is reserved; it is created automatically with each project.',
      );
    }
    try {
      return await this.prisma.chatChannel.create({
        data: {
          projectId,
          name,
          slug: toSlug(name),
          topic: dto.topic?.trim() || null,
          createdById: user.id,
          isGeneral: false,
        },
        select: this.publicSelect,
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`Channel "${name}" already exists in this project.`);
      }
      throw err;
    }
  }

  async update(channelId: string, dto: UpdateChannelDto) {
    const channel = await this.prisma.chatChannel.findUnique({ where: { id: channelId } });
    if (!channel) throw new NotFoundException('Channel not found.');
    if (channel.isGeneral && dto.name && dto.name !== channel.name) {
      throw new ForbiddenException('The `general` channel cannot be renamed.');
    }
    const data: Prisma.ChatChannelUpdateInput = {};
    if (dto.name !== undefined) {
      data.name = dto.name.trim().toLowerCase();
      data.slug = toSlug(dto.name);
    }
    if (dto.topic !== undefined) data.topic = dto.topic.trim() || null;
    try {
      return await this.prisma.chatChannel.update({
        where: { id: channelId },
        data,
        select: this.publicSelect,
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('A channel with that name already exists.');
      }
      throw err;
    }
  }

  async archive(channelId: string) {
    const channel = await this.prisma.chatChannel.findUnique({ where: { id: channelId } });
    if (!channel) throw new NotFoundException('Channel not found.');
    if (channel.isGeneral) {
      throw new ForbiddenException('The `general` channel cannot be archived.');
    }
    return this.prisma.chatChannel.update({
      where: { id: channelId },
      data: { isArchived: true, archivedAt: new Date() },
      select: this.publicSelect,
    });
  }

  async unarchive(channelId: string) {
    return this.prisma.chatChannel.update({
      where: { id: channelId },
      data: { isArchived: false, archivedAt: null },
      select: this.publicSelect,
    });
  }

  /**
   * Read-only snapshot of the requesting user's membership state. Used by
   * the frontend on channel entry to freeze the "unread cutoff" so the
   * New-messages divider doesn't move as the session continues reading.
   * Returns nulls when the user has never read the channel — that's
   * fine: every visible message then counts as unread.
   */
  async getMemberState(channelId: string, userId: string) {
    const row = await this.prisma.chatChannelMember.findUnique({
      where: { channelId_userId: { channelId, userId } },
      select: { lastReadMessageId: true, lastReadAt: true },
    });
    return {
      lastReadMessageId: row?.lastReadMessageId ?? null,
      lastReadAt: row?.lastReadAt ?? null,
    };
  }

  /** Lazily create the (channel, user) row used to track read state and mute. */
  async ensureMembership(channelId: string, userId: string) {
    return this.prisma.chatChannelMember.upsert({
      where: { channelId_userId: { channelId, userId } },
      create: { channelId, userId },
      update: {},
    });
  }

  async markRead(channelId: string, userId: string, lastReadMessageId?: string) {
    await this.ensureMembership(channelId, userId);
    return this.prisma.chatChannelMember.update({
      where: { channelId_userId: { channelId, userId } },
      data: {
        lastReadAt: new Date(),
        ...(lastReadMessageId ? { lastReadMessageId } : {}),
      },
    });
  }

  /** Used by ProjectsService at project creation time. */
  async createGeneralChannelInTx(tx: Prisma.TransactionClient, projectId: string, ownerId: string) {
    return tx.chatChannel.create({
      data: {
        projectId,
        name: 'general',
        slug: 'general',
        isGeneral: true,
        createdById: ownerId,
      },
    });
  }

  /** Channel projection returned to clients. */
  private readonly publicSelect = {
    id: true,
    projectId: true,
    name: true,
    slug: true,
    topic: true,
    isGeneral: true,
    isArchived: true,
    createdAt: true,
    updatedAt: true,
    archivedAt: true,
  } satisfies Prisma.ChatChannelSelect;
}

export type ChatChannelPublic = Pick<
  ChatChannel,
  | 'id'
  | 'projectId'
  | 'name'
  | 'slug'
  | 'topic'
  | 'isGeneral'
  | 'isArchived'
  | 'createdAt'
  | 'updatedAt'
  | 'archivedAt'
>;
