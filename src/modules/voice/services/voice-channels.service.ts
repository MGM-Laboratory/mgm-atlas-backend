import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PrismaClient, VoiceChannel } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateVoiceChannelDto } from '../dto/create-voice-channel.dto';
import { UpdateVoiceChannelDto } from '../dto/update-voice-channel.dto';

/**
 * Voice-channel CRUD. Access enforcement lives in the controllers via
 * ProjectAccessService (per-project) or AdminGuard (workspace lobby) —
 * this service trusts that its caller has already authorized the op.
 *
 * Per-project channels are scoped by `projectId`; workspace-lobby
 * channels have `projectId = null` and are visible to any authenticated
 * Atlas user (admin-only mutate).
 */
@Injectable()
export class VoiceChannelsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Public projection ──────────────────────────────────────────────

  /** Columns returned to clients. Excludes nothing sensitive — voice
   *  channels are themselves non-sensitive metadata (the JWT mint is
   *  the secret-bearing step, gated separately). */
  private readonly publicSelect = {
    id: true,
    projectId: true,
    name: true,
    topic: true,
    userLimit: true,
    audioQuality: true,
    kind: true,
    isDefault: true,
    sortIndex: true,
    permissions: true,
    textThreadId: true,
    createdById: true,
    createdAt: true,
    updatedAt: true,
    archivedAt: true,
  } satisfies Prisma.VoiceChannelSelect;

  // ─── List ───────────────────────────────────────────────────────────

  /** Per-project channels (archived excluded by default). */
  listForProject(projectId: string, includeArchived = false) {
    return this.prisma.voiceChannel.findMany({
      where: {
        projectId,
        ...(includeArchived ? {} : { archivedAt: null }),
      },
      orderBy: [{ isDefault: 'desc' }, { sortIndex: 'asc' }, { createdAt: 'asc' }],
      select: this.publicSelect,
    });
  }

  /** Workspace-lobby channels (projectId = null). */
  listLobby(includeArchived = false) {
    return this.prisma.voiceChannel.findMany({
      where: {
        projectId: null,
        ...(includeArchived ? {} : { archivedAt: null }),
      },
      orderBy: [{ isDefault: 'desc' }, { sortIndex: 'asc' }, { createdAt: 'asc' }],
      select: this.publicSelect,
    });
  }

  // ─── Read ───────────────────────────────────────────────────────────

  async findById(channelId: string) {
    const channel = await this.prisma.voiceChannel.findUnique({
      where: { id: channelId },
      select: this.publicSelect,
    });
    if (!channel) throw new NotFoundException('Voice channel not found.');
    return channel;
  }

  // ─── Create ─────────────────────────────────────────────────────────

  /** Per-project channel. Caller must have already asserted manager. */
  async create(projectId: string, createdById: string, dto: CreateVoiceChannelDto) {
    return this.createInternal(projectId, createdById, dto);
  }

  /** Workspace-lobby channel. Caller must be admin. */
  async createLobby(createdById: string, dto: CreateVoiceChannelDto) {
    return this.createInternal(null, createdById, dto);
  }

  /**
   * Lazily create the default workspace lobby channel ("Voice Lobby").
   * Idempotent and concurrency-safe: VoiceChannel_one_default_lobby
   * (partial unique index, 13_workspace_global_chat) makes the loser of
   * a race hit P2002, after which we read the winner's row. Attribution:
   * first admin by signup date, falling back to the requester. The
   * isDefault flag puts it under the existing rename/archive protections.
   */
  async ensureDefaultLobby(requestingUserId: string) {
    const existing = await this.prisma.voiceChannel.findFirst({
      where: { projectId: null, isDefault: true },
      select: this.publicSelect,
    });
    if (existing) return existing;

    const admin = await this.prisma.user.findFirst({
      where: { isAdmin: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    const createdById = admin?.id ?? requestingUserId;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const voiceChannel = await tx.voiceChannel.create({
          data: {
            projectId: null,
            name: 'Voice Lobby',
            topic: 'Workspace-wide voice hangout',
            isDefault: true,
            sortIndex: 0,
            createdById,
          },
        });
        const thread = await this.createPairedThread(tx, {
          projectId: null,
          voiceChannelId: voiceChannel.id,
          createdById,
        });
        return tx.voiceChannel.update({
          where: { id: voiceChannel.id },
          data: { textThreadId: thread.id },
          select: this.publicSelect,
        });
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return this.prisma.voiceChannel.findFirstOrThrow({
          where: { projectId: null, isDefault: true },
          select: this.publicSelect,
        });
      }
      throw err;
    }
  }

  /**
   * Lazy thread backfill for lobby channels created before workspace-
   * global chat existed (their textThreadId is null). Called from the
   * voice-join thread endpoint on first open.
   */
  async ensureLobbyThread(channelId: string) {
    const channel = await this.prisma.voiceChannel.findUnique({
      where: { id: channelId },
      select: { id: true, projectId: true, textThreadId: true, createdById: true },
    });
    if (!channel) throw new NotFoundException('Voice channel not found.');
    if (channel.textThreadId) return channel.textThreadId;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const thread = await this.createPairedThread(tx, {
          projectId: channel.projectId,
          voiceChannelId: channel.id,
          createdById: channel.createdById,
        });
        await tx.voiceChannel.update({
          where: { id: channel.id },
          data: { textThreadId: thread.id },
        });
        return thread.id;
      });
    } catch (err) {
      // Concurrent first-open: the loser's thread insert hits the
      // ChatChannel_global_name_key partial unique index. The winner's
      // transaction has committed by then — read its link back.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const fresh = await this.prisma.voiceChannel.findUniqueOrThrow({
          where: { id: channelId },
          select: { textThreadId: true },
        });
        if (fresh.textThreadId) return fresh.textThreadId;
      }
      throw err;
    }
  }

  private async createInternal(
    projectId: string | null,
    createdById: string,
    dto: CreateVoiceChannelDto,
  ) {
    const name = dto.name.trim();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const voiceChannel = await tx.voiceChannel.create({
          data: {
            projectId,
            name,
            topic: dto.topic?.trim() || null,
            userLimit: dto.userLimit && dto.userLimit > 0 ? dto.userLimit : null,
            audioQuality: dto.audioQuality ?? 'STANDARD',
            kind: dto.kind ?? 'STANDARD',
            createdById,
            isDefault: false,
            sortIndex: 0,
          },
        });
        // Every voice channel gets a paired text thread (§10). Lobby
        // channels' threads are workspace-global ChatChannels
        // (projectId = null, possible since 13_workspace_global_chat).
        const thread = await this.createPairedThread(tx, {
          projectId,
          voiceChannelId: voiceChannel.id,
          createdById,
        });
        await tx.voiceChannel.update({
          where: { id: voiceChannel.id },
          data: { textThreadId: thread.id },
        });
        // Re-read with the public projection (includes textThreadId if set).
        return tx.voiceChannel.findUniqueOrThrow({
          where: { id: voiceChannel.id },
          select: this.publicSelect,
        });
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`A voice channel named "${name}" already exists here.`);
      }
      throw err;
    }
  }

  /**
   * Create the paired chat thread for a voice channel. Naming is
   * deterministic (`voice:<vcId>`) so it can never collide with a
   * user-named text channel — but it's also never user-visible because
   * ChatChannelsService.list/listGlobal filter out isVoiceThread:true.
   * Lobby channels (projectId = null) get a workspace-global thread.
   */
  private async createPairedThread(
    tx: Prisma.TransactionClient,
    args: { projectId: string | null; voiceChannelId: string; createdById: string },
  ) {
    return tx.chatChannel.create({
      data: {
        projectId: args.projectId,
        name: `voice:${args.voiceChannelId}`,
        slug: `voice-${args.voiceChannelId.slice(0, 8)}`,
        isVoiceThread: true,
        isGeneral: false,
        createdById: args.createdById,
      },
    });
  }

  // ─── Update ─────────────────────────────────────────────────────────

  async update(channelId: string, dto: UpdateVoiceChannelDto) {
    const channel = await this.prisma.voiceChannel.findUnique({
      where: { id: channelId },
      select: { id: true, isDefault: true, name: true },
    });
    if (!channel) throw new NotFoundException('Voice channel not found.');
    if (channel.isDefault && dto.name && dto.name.trim() !== channel.name) {
      throw new ForbiddenException('The default voice channel cannot be renamed.');
    }
    const data: Prisma.VoiceChannelUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.topic !== undefined) data.topic = dto.topic.trim() || null;
    if (dto.userLimit !== undefined) {
      data.userLimit = dto.userLimit > 0 ? dto.userLimit : null;
    }
    if (dto.audioQuality !== undefined) data.audioQuality = dto.audioQuality;
    return this.prisma.voiceChannel.update({
      where: { id: channelId },
      data,
      select: this.publicSelect,
    });
  }

  // ─── Delete (soft via archivedAt) ───────────────────────────────────

  /**
   * Soft-delete by setting archivedAt. The participants table remains
   * for audit; new joins are prevented by the controller checking
   * archivedAt. The default channel cannot be archived.
   */
  async archive(channelId: string) {
    const channel = await this.prisma.voiceChannel.findUnique({
      where: { id: channelId },
      select: { id: true, isDefault: true, archivedAt: true },
    });
    if (!channel) throw new NotFoundException('Voice channel not found.');
    if (channel.isDefault) {
      throw new ForbiddenException('The default voice channel cannot be archived.');
    }
    if (channel.archivedAt) return channel;
    return this.prisma.voiceChannel.update({
      where: { id: channelId },
      data: { archivedAt: new Date() },
      select: this.publicSelect,
    });
  }

  // ─── Phase 0 helpers retained ───────────────────────────────────────

  /**
   * Called from ProjectsService.create() inside its existing transaction.
   * Creates the default voice channel AND its paired text thread, and
   * links them via textThreadId.
   */
  async createDefaultForProject(
    tx: Prisma.TransactionClient | PrismaClient,
    args: { projectId: string; createdById: string; name?: string },
  ) {
    const voiceChannel = await tx.voiceChannel.create({
      data: {
        projectId: args.projectId,
        name: args.name ?? 'General Voice',
        isDefault: true,
        sortIndex: 0,
        createdById: args.createdById,
      },
    });
    // Paired text thread — same projectId + isVoiceThread flag so the
    // chat-channels list filter excludes it from the regular sidebar.
    const thread = await tx.chatChannel.create({
      data: {
        projectId: args.projectId,
        name: `voice:${voiceChannel.id}`,
        slug: `voice-${voiceChannel.id.slice(0, 8)}`,
        isVoiceThread: true,
        isGeneral: false,
        createdById: args.createdById,
      },
    });
    await tx.voiceChannel.update({
      where: { id: voiceChannel.id },
      data: { textThreadId: thread.id },
    });
    return voiceChannel;
  }

  /** Idempotent backfill — used by `prisma/seeds/voice-backfill.ts`. */
  async ensureDefaultForExistingProjects(args: { systemUserId: string }) {
    const projects = await this.prisma.project.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        ownerId: true,
        voiceChannels: { select: { id: true }, take: 1 },
      },
    });
    let created = 0;
    for (const p of projects) {
      if (p.voiceChannels.length > 0) continue;
      await this.prisma.$transaction(async (tx) => {
        await this.createDefaultForProject(tx, {
          projectId: p.id,
          createdById: p.ownerId ?? args.systemUserId,
        });
      });
      created++;
    }
    return { scanned: projects.length, created };
  }

  /**
   * Phase 4 backfill — find existing voice channels without a paired
   * text thread and create one for each. Idempotent. Covers lobby
   * channels too since 13_workspace_global_chat made ChatChannel.projectId
   * nullable (their threads are workspace-global).
   */
  async ensureTextThreadsForExistingVoiceChannels() {
    const channels = await this.prisma.voiceChannel.findMany({
      where: { textThreadId: null },
      select: { id: true, projectId: true, createdById: true },
    });
    let created = 0;
    for (const c of channels) {
      await this.prisma.$transaction(async (tx) => {
        const thread = await this.createPairedThread(tx, {
          projectId: c.projectId,
          voiceChannelId: c.id,
          createdById: c.createdById,
        });
        await tx.voiceChannel.update({
          where: { id: c.id },
          data: { textThreadId: thread.id },
        });
      });
      created++;
    }
    return { scanned: channels.length, created };
  }
}

export type VoiceChannelPublic = Pick<
  VoiceChannel,
  | 'id'
  | 'projectId'
  | 'name'
  | 'topic'
  | 'userLimit'
  | 'audioQuality'
  | 'isDefault'
  | 'sortIndex'
  | 'permissions'
  | 'textThreadId'
  | 'createdById'
  | 'createdAt'
  | 'updatedAt'
  | 'archivedAt'
>;
