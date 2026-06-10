import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatDeleteActor, Prisma } from '@prisma/client';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateMessageDto } from '../dto/create-message.dto';
import { EditMessageDto } from '../dto/edit-message.dto';

/**
 * Mentions are encoded by the frontend Tiptap serializer as
 * `@[name](userId)` so we can resolve recipients server-side without
 * re-running a username lookup. Anything not matching this pattern is
 * just rendered as text.
 */
const MENTION_REGEX = /@\[[^\]]+\]\(([0-9a-f-]{8,})\)/g;

const MESSAGE_INCLUDE = {
  author: { select: { id: true, name: true, avatarUrl: true } },
  deletedBy: { select: { id: true, name: true } },
  attachments: true,
  reactions: {
    select: {
      emoji: true,
      userId: true,
      user: { select: { id: true, name: true } },
    },
  },
  replyTo: {
    select: {
      id: true,
      markdown: true,
      deletedAt: true,
      author: { select: { id: true, name: true, avatarUrl: true } },
    },
  },
  forwardedFrom: {
    select: {
      id: true,
      channelId: true,
      author: { select: { id: true, name: true } },
    },
  },
  pins: {
    select: { id: true, note: true, pinnedAt: true },
    orderBy: { pinnedAt: 'desc' },
    take: 1,
  },
} satisfies Prisma.ChatMessageInclude;

type MessageWithIncludes = Prisma.ChatMessageGetPayload<{ include: typeof MESSAGE_INCLUDE }>;

@Injectable()
export class ChatMessagesService {
  private readonly editWindowMs: number;
  private readonly maxAttachments: number;
  private readonly maxAttachmentBytes: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.editWindowMs = (config.get<number>('chat.editWindowHours') ?? 24) * 3600 * 1000;
    this.maxAttachments = config.get<number>('chat.maxAttachmentsPerMessage') ?? 10;
    this.maxAttachmentBytes = config.get<number>('chat.maxAttachmentBytes') ?? 52_428_800;
  }

  // ─── List ─────────────────────────────────────────────────────────────

  /**
   * Cursor pagination by message id. Returns newest-first; the client
   * uses `getPreviousPageParam` to scroll into older history.
   */
  async list(channelId: string, cursor: string | undefined, limit: number) {
    let cursorCreatedAt: Date | undefined;
    if (cursor) {
      const ref = await this.prisma.chatMessage.findUnique({
        where: { id: cursor },
        select: { createdAt: true },
      });
      if (!ref) throw new BadRequestException('Invalid cursor.');
      cursorCreatedAt = ref.createdAt;
    }

    const rows = await this.prisma.chatMessage.findMany({
      where: {
        channelId,
        ...(cursorCreatedAt ? { createdAt: { lt: cursorCreatedAt } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: MESSAGE_INCLUDE,
    });

    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map((m) => shapeMessage(m));
    const nextCursor = hasMore ? items[items.length - 1].id : null;
    return { items, nextCursor };
  }

  // ─── Create ──────────────────────────────────────────────────────────

  async create(
    channelId: string,
    projectId: string | null,
    user: AuthenticatedUser,
    dto: CreateMessageDto,
  ) {
    this.assertBodyOrAttachments(dto);
    this.assertAttachmentLimits(dto);

    if (dto.replyToId) {
      const target = await this.prisma.chatMessage.findFirst({
        where: { id: dto.replyToId, channelId, deletedAt: null },
        select: { id: true },
      });
      if (!target) throw new BadRequestException('Reply target not found in this channel.');
    }

    const message = await this.prisma.chatMessage.create({
      data: {
        channelId,
        authorId: user.id,
        markdown: dto.markdown,
        replyToId: dto.replyToId ?? null,
        metadata: dto.linkPreviews?.length
          ? ({ linkPreviews: dto.linkPreviews } as unknown as Prisma.InputJsonValue)
          : undefined,
        attachments: dto.attachments?.length
          ? {
              create: dto.attachments.map((a) => ({
                kind: a.kind,
                url: a.url,
                s3Key: a.s3Key,
                mime: a.mime,
                bytes: a.bytes,
                width: a.width,
                height: a.height,
                durationSec: a.durationSec,
                posterUrl: a.posterUrl,
              })),
            }
          : undefined,
      },
      include: MESSAGE_INCLUDE,
    });

    return { message: shapeMessage(message), projectId, mentions: extractMentions(dto.markdown) };
  }

  // ─── Edit ────────────────────────────────────────────────────────────

  async edit(messageId: string, user: AuthenticatedUser, dto: EditMessageDto) {
    const existing = await this.prisma.chatMessage.findUnique({
      where: { id: messageId },
      select: { id: true, authorId: true, createdAt: true, deletedAt: true, channelId: true },
    });
    if (!existing || existing.deletedAt) throw new NotFoundException('Message not found.');
    if (existing.authorId !== user.id) {
      throw new ForbiddenException('Only the author can edit a message.');
    }
    if (Date.now() - existing.createdAt.getTime() > this.editWindowMs) {
      throw new ForbiddenException(
        `Messages can only be edited within ${this.editWindowMs / 3_600_000} hours of posting.`,
      );
    }
    const message = await this.prisma.chatMessage.update({
      where: { id: messageId },
      data: { markdown: dto.markdown, editedAt: new Date() },
      include: MESSAGE_INCLUDE,
    });
    return {
      message: shapeMessage(message),
      channelId: existing.channelId,
      newMentions: extractMentions(dto.markdown),
    };
  }

  // ─── Delete (soft) ───────────────────────────────────────────────────

  async delete(messageId: string, user: AuthenticatedUser, isProjectManager: boolean) {
    const existing = await this.prisma.chatMessage.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        authorId: true,
        deletedAt: true,
        channelId: true,
        channel: { select: { projectId: true } },
      },
    });
    if (!existing || existing.deletedAt) throw new NotFoundException('Message not found.');

    const isAuthor = existing.authorId === user.id;
    const isMod = user.isAdmin || isProjectManager;
    if (!isAuthor && !isMod) {
      throw new ForbiddenException('You do not have permission to delete this message.');
    }

    const actor: ChatDeleteActor = isAuthor ? 'SELF' : 'MODERATOR';
    const message = await this.prisma.chatMessage.update({
      where: { id: messageId },
      data: {
        deletedAt: new Date(),
        deletedByUserId: user.id,
        deletedActor: actor,
        // Wipe the body so /list never serves the original text again.
        markdown: '',
      },
      include: MESSAGE_INCLUDE,
    });

    return {
      message: shapeMessage(message),
      channelId: existing.channelId,
      projectId: existing.channel.projectId,
    };
  }

  // ─── Forward ─────────────────────────────────────────────────────────

  async forward(sourceMessageId: string, targetChannelId: string, user: AuthenticatedUser) {
    const source = await this.prisma.chatMessage.findFirst({
      where: { id: sourceMessageId, deletedAt: null },
      include: { attachments: true, channel: { select: { projectId: true } } },
    });
    if (!source) throw new NotFoundException('Source message not found.');

    const target = await this.prisma.chatChannel.findUnique({
      where: { id: targetChannelId },
      select: { id: true, isArchived: true, projectId: true },
    });
    if (!target || target.isArchived) throw new NotFoundException('Target channel not available.');

    const forwarded = await this.prisma.chatMessage.create({
      data: {
        channelId: targetChannelId,
        authorId: user.id,
        markdown: source.markdown,
        forwardedFromId: source.id,
        attachments: source.attachments.length
          ? {
              create: source.attachments.map((a) => ({
                kind: a.kind,
                url: a.url,
                s3Key: a.s3Key,
                mime: a.mime,
                bytes: a.bytes,
                width: a.width,
                height: a.height,
                durationSec: a.durationSec,
                posterUrl: a.posterUrl,
              })),
            }
          : undefined,
      },
      include: MESSAGE_INCLUDE,
    });

    return {
      message: shapeMessage(forwarded),
      sourceProjectId: source.channel.projectId,
      targetProjectId: target.projectId,
    };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  private assertBodyOrAttachments(dto: CreateMessageDto) {
    const hasText = dto.markdown.trim().length > 0;
    const hasAttachments = (dto.attachments?.length ?? 0) > 0;
    if (!hasText && !hasAttachments) {
      throw new BadRequestException('Message must have text or at least one attachment.');
    }
  }

  private assertAttachmentLimits(dto: CreateMessageDto) {
    const attachments = dto.attachments ?? [];
    if (attachments.length > this.maxAttachments) {
      throw new BadRequestException(`At most ${this.maxAttachments} attachments per message.`);
    }
    for (const a of attachments) {
      if (a.bytes > this.maxAttachmentBytes) {
        throw new BadRequestException(
          `Attachment "${a.s3Key}" exceeds the ${this.maxAttachmentBytes} byte limit.`,
        );
      }
    }
  }
}

function extractMentions(markdown: string): string[] {
  const ids = new Set<string>();
  for (const m of markdown.matchAll(MENTION_REGEX)) ids.add(m[1]);
  return [...ids];
}

/**
 * Public projection. Deleted messages return a tombstone — never the
 * original text — and reactions are stripped (matches Slack/Discord).
 */
function shapeMessage(m: MessageWithIncludes) {
  const isDeleted = !!m.deletedAt;
  // Metadata is sender-render-time — wipe it on delete same as the body.
  const metadata = isDeleted ? null : (m.metadata ?? null);
  const pin = m.pins && m.pins.length > 0 ? m.pins[0] : null;
  return {
    id: m.id,
    channelId: m.channelId,
    kind: m.kind,
    createdAt: m.createdAt,
    editedAt: m.editedAt,
    deletedAt: m.deletedAt,
    deletedActor: m.deletedActor,
    deletedBy: isDeleted && m.deletedActor === 'MODERATOR' ? m.deletedBy : null,
    author: {
      id: m.author.id,
      name: m.author.name,
      avatarUrl: m.author.avatarUrl,
    },
    markdown: isDeleted ? '' : m.markdown,
    metadata,
    attachments: isDeleted ? [] : m.attachments,
    reactions: isDeleted ? [] : groupReactions(m.reactions),
    replyTo: m.replyTo
      ? {
          id: m.replyTo.id,
          preview: m.replyTo.deletedAt ? '' : m.replyTo.markdown.slice(0, 200),
          isDeleted: !!m.replyTo.deletedAt,
          author: m.replyTo.author,
        }
      : null,
    forwardedFrom: m.forwardedFrom
      ? {
          id: m.forwardedFrom.id,
          channelId: m.forwardedFrom.channelId,
          author: m.forwardedFrom.author,
        }
      : null,
    isPinned: !isDeleted && !!pin,
    pinNote: !isDeleted && pin ? pin.note : null,
  };
}

function groupReactions(
  raw: Array<{ emoji: string; userId: string; user: { id: string; name: string } }>,
) {
  const map = new Map<
    string,
    { emoji: string; count: number; users: { id: string; name: string }[] }
  >();
  for (const r of raw) {
    const entry = map.get(r.emoji) ?? { emoji: r.emoji, count: 0, users: [] };
    entry.count += 1;
    entry.users.push({ id: r.user.id, name: r.user.name });
    map.set(r.emoji, entry);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

export type ChatMessagePublic = ReturnType<typeof shapeMessage>;
