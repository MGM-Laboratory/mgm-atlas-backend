import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationType, Prisma, TaskActivityKind, TaskComment } from '@prisma/client';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { PrismaService } from '@/prisma/prisma.service';
import { TaskActivityService } from '../tasks/task-activity.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';

/// Shared mention syntax: `@[Display Name](uuid)`. Same convention as the
/// chat module so the same UI components can author both surfaces.
const MENTION_REGEX = /@\[[^\]]+\]\(([0-9a-f-]{8,})\)/g;

type AccessKind = 'admin' | 'manager' | 'contributor';

export interface CommentResponse {
  id: string;
  taskId: string;
  markdown: string;
  replyToId: string | null;
  editedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  author: { id: string; name: string; avatarUrl: string | null };
}

@Injectable()
export class TaskCommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly activity: TaskActivityService,
  ) {}

  // ─── Reads ─────────────────────────────────────────────────────────

  async list(
    projectId: string,
    taskId: string,
    page = 1,
    pageSize = 50,
  ): Promise<{ items: CommentResponse[]; total: number; page: number; pageSize: number }> {
    await this.assertTaskExists(projectId, taskId);
    const [rows, total] = await Promise.all([
      this.prisma.taskComment.findMany({
        where: { taskId },
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          author: { select: { id: true, name: true, avatarUrl: true } },
        },
      }),
      this.prisma.taskComment.count({ where: { taskId } }),
    ]);
    return {
      items: rows.map((r) => this.shape(r)),
      total,
      page,
      pageSize,
    };
  }

  // ─── Mutations ─────────────────────────────────────────────────────

  async create(
    user: AuthenticatedUser,
    projectId: string,
    taskId: string,
    dto: CreateCommentDto,
  ): Promise<CommentResponse> {
    const task = await this.assertTaskExists(projectId, taskId);

    if (dto.replyToId) {
      const parent = await this.prisma.taskComment.findFirst({
        where: { id: dto.replyToId, taskId, deletedAt: null },
        select: { id: true, replyToId: true, authorId: true },
      });
      if (!parent) {
        throw new BadRequestException('Reply target not found.');
      }
      // Flatten threads to a single level: replies to a reply attach to
      // the original parent. Matches the Phase 0 plan note "1-level indent".
      if (parent.replyToId) dto.replyToId = parent.replyToId;
    }

    const mentionedUserIds = this.extractMentions(dto.markdown);

    const created = await this.prisma.$transaction(async (tx) => {
      const comment = await tx.taskComment.create({
        data: {
          taskId,
          authorId: user.id,
          markdown: dto.markdown,
          replyToId: dto.replyToId,
        },
        include: { author: { select: { id: true, name: true, avatarUrl: true } } },
      });

      await this.activity.record({
        taskId,
        actorId: user.id,
        kind: TaskActivityKind.COMMENT_ADDED,
        payload: { commentId: comment.id, replyToId: dto.replyToId ?? null },
        tx,
      });
      for (const uid of mentionedUserIds) {
        await this.activity.record({
          taskId,
          actorId: user.id,
          kind: TaskActivityKind.MENTIONED,
          payload: { userId: uid, commentId: comment.id },
          tx,
        });
      }

      return comment;
    });

    // Notify mentioned users + the parent's author (if it's a reply and
    // they're not the same person who just commented). Fire-and-forget so
    // a notify hiccup doesn't break the response.
    void this.dispatchSideEffects({
      user,
      task,
      comment: created,
      mentionedUserIds,
    });

    return this.shape(created);
  }

  async update(
    user: AuthenticatedUser,
    access: AccessKind,
    projectId: string,
    commentId: string,
    dto: UpdateCommentDto,
  ): Promise<CommentResponse> {
    const existing = await this.prisma.taskComment.findFirst({
      where: { id: commentId, task: { projectId, deletedAt: null } },
      include: { author: { select: { id: true, name: true, avatarUrl: true } } },
    });
    if (!existing || existing.deletedAt) {
      throw new NotFoundException('Comment not found.');
    }
    if (existing.authorId !== user.id) {
      throw new ForbiddenException('Only the comment author can edit it.');
    }
    const editWindow = this.config.get<number>('chat.editWindowHours', 24) * 60 * 60 * 1000;
    if (Date.now() - existing.createdAt.getTime() > editWindow) {
      throw new ForbiddenException(
        `Comments can only be edited within ${editWindow / 3_600_000} hours.`,
      );
    }
    const updated = await this.prisma.taskComment.update({
      where: { id: commentId },
      data: { markdown: dto.markdown, editedAt: new Date() },
      include: { author: { select: { id: true, name: true, avatarUrl: true } } },
    });
    return this.shape(updated);
  }

  async softDelete(
    user: AuthenticatedUser,
    access: AccessKind,
    projectId: string,
    commentId: string,
  ): Promise<{ ok: true }> {
    const existing = await this.prisma.taskComment.findFirst({
      where: { id: commentId, task: { projectId, deletedAt: null } },
    });
    if (!existing || existing.deletedAt) {
      throw new NotFoundException('Comment not found.');
    }
    const isAuthor = existing.authorId === user.id;
    const isManagerLike = access === 'admin' || access === 'manager';
    if (!isAuthor && !isManagerLike) {
      throw new ForbiddenException('Only the author or a project manager can delete a comment.');
    }
    await this.prisma.taskComment.update({
      where: { id: commentId },
      data: { deletedAt: new Date() },
    });
    return { ok: true };
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  private extractMentions(markdown: string): string[] {
    const ids = new Set<string>();
    for (const m of markdown.matchAll(MENTION_REGEX)) ids.add(m[1]!);
    return [...ids];
  }

  private async dispatchSideEffects(args: {
    user: AuthenticatedUser;
    task: { id: string; key: string; title: string; projectId: string };
    comment: TaskComment & { author: { id: string; name: string } };
    mentionedUserIds: string[];
  }) {
    try {
      // Find the project slug for the in-app link.
      const project = await this.prisma.project.findUnique({
        where: { id: args.task.projectId },
        select: { slug: true },
      });
      const link = project ? `/projects/${project.slug}/lists/_/tasks/${args.task.key}` : undefined;

      // Notify mentioned users (skip self). notifyMany fans out to socket
      // + push; pushTag groups multiple comments on the same task into
      // one OS banner per recipient.
      const recipients = args.mentionedUserIds.filter((uid) => uid !== args.user.id);
      if (recipients.length > 0) {
        await this.notifications.notifyMany(recipients, {
          type: NotificationType.TASK_MENTIONED,
          title: `${args.user.name} mentioned you in ${args.task.key}`,
          body: args.task.title,
          link,
          metadata: {
            taskId: args.task.id,
            taskKey: args.task.key,
            commentId: args.comment.id,
          },
          pushTag: `task:${args.task.id}`,
        });
      }

      // If this is a reply, ping the parent's author too (if not self,
      // not already mentioned).
      if (args.comment.replyToId) {
        const parent = await this.prisma.taskComment.findUnique({
          where: { id: args.comment.replyToId },
          select: { authorId: true },
        });
        if (parent && parent.authorId !== args.user.id && !recipients.includes(parent.authorId)) {
          await this.notifications.notify({
            userId: parent.authorId,
            type: NotificationType.TASK_COMMENT_REPLY,
            title: `${args.user.name} replied to your comment on ${args.task.key}`,
            body: args.task.title,
            link,
            metadata: {
              taskId: args.task.id,
              taskKey: args.task.key,
              commentId: args.comment.id,
            },
            pushTag: `task:${args.task.id}`,
          });
        }
      }
    } catch {
      // Side-effects are best-effort. A failure here must not bubble up
      // and reject the comment-create response the user already saw succeed.
    }
  }

  private async assertTaskExists(projectId: string, taskId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, projectId, deletedAt: null },
      select: { id: true, key: true, title: true, projectId: true },
    });
    if (!task) throw new NotFoundException('Task not found.');
    return task;
  }

  private shape(
    c: TaskComment & { author: { id: string; name: string; avatarUrl: string | null } },
  ): CommentResponse {
    return {
      id: c.id,
      taskId: c.taskId,
      markdown: c.deletedAt ? '_[comment removed]_' : c.markdown,
      replyToId: c.replyToId,
      editedAt: c.editedAt,
      deletedAt: c.deletedAt,
      createdAt: c.createdAt,
      author: c.author,
    };
  }
}

// Keep Prisma's type referenced even when unused at the file top-level.
void Prisma;
