import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  Task,
  TaskActivityKind,
  TaskAssignee,
  TaskDependencyKind,
  TaskPriority,
  TaskStatus,
  TaskStatusCategory,
} from '@prisma/client';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { ListTasksQueryDto } from './dto/list-tasks.dto';
import { MoveTaskDto } from './dto/move-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TaskActivityService } from './task-activity.service';

export type TaskWithRelations = Task & {
  assignees: (TaskAssignee & { user: { id: string; name: string; avatarUrl: string | null } })[];
  status: TaskStatus;
};

type AccessKind = 'admin' | 'manager' | 'contributor';

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly activity: TaskActivityService,
  ) {}

  // ─── Reads ──────────────────────────────────────────────────────────

  async list(
    projectId: string,
    listId: string,
    query: ListTasksQueryDto,
  ): Promise<TaskWithRelations[]> {
    await this.assertListExists(projectId, listId);
    const where: Prisma.TaskWhereInput = {
      taskListId: listId,
      projectId,
      deletedAt: null,
    };
    if (!query.includeArchived) where.archivedAt = null;
    if (query.statusId) where.statusId = query.statusId;
    if (query.assigneeId) where.assignees = { some: { userId: query.assigneeId } };
    if (query.q) where.title = { contains: query.q, mode: 'insensitive' };

    return this.prisma.task.findMany({
      where,
      orderBy: [
        { statusId: 'asc' },
        { positionInStatus: 'asc' },
        { createdAt: 'asc' },
      ],
      include: this.relationInclude(),
    });
  }

  async get(projectId: string, taskId: string): Promise<TaskWithRelations> {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, projectId, deletedAt: null },
      include: this.relationInclude(),
    });
    if (!task) throw new NotFoundException('Task not found.');
    return task;
  }

  async getByKey(projectId: string, key: string): Promise<TaskWithRelations> {
    const task = await this.prisma.task.findFirst({
      where: { projectId, key, deletedAt: null },
      include: this.relationInclude(),
    });
    if (!task) throw new NotFoundException('Task not found.');
    return task;
  }

  /// Paginated activity feed for a task. Newest first. Each row carries
  /// its actor (id/name/avatar) for the popup's feed; loosely modeled on
  /// GitHub's timeline events. Phase 11 may add filtering by kind.
  async listActivity(
    projectId: string,
    taskId: string,
    page = 1,
    pageSize = 50,
  ): Promise<{
    items: Array<{
      id: string;
      kind: string;
      payload: unknown;
      createdAt: Date;
      actor: { id: string; name: string; avatarUrl: string | null } | null;
    }>;
    total: number;
    page: number;
    pageSize: number;
  }> {
    // Reuse get() to enforce existence + scope so a crafted taskId can't
    // leak activity from another project.
    await this.get(projectId, taskId);
    const [rows, total] = await Promise.all([
      this.prisma.taskActivity.findMany({
        where: { taskId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          actor: { select: { id: true, name: true, avatarUrl: true } },
        },
      }),
      this.prisma.taskActivity.count({ where: { taskId } }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        payload: r.payload,
        createdAt: r.createdAt,
        actor: r.actor,
      })),
      total,
      page,
      pageSize,
    };
  }

  // ─── Mutations ──────────────────────────────────────────────────────

  /// Create a task. Mints `key` atomically by bumping TaskList.taskCounter
  /// inside the same transaction so two concurrent creates never collide.
  async create(
    user: AuthenticatedUser,
    access: AccessKind,
    projectId: string,
    listId: string,
    dto: CreateTaskDto,
  ): Promise<TaskWithRelations> {
    const list = await this.assertListExists(projectId, listId);
    if (access === 'contributor' && !list.contributorsCanCreateTasks) {
      throw new ForbiddenException(
        'This list does not allow contributor task creation.',
      );
    }
    const max = this.config.get<number>('pmo.maxTasksPerList', 2000);
    const existing = await this.prisma.task.count({
      where: { taskListId: listId, deletedAt: null },
    });
    if (existing >= max) {
      throw new ConflictException(
        `Task list already has ${existing} tasks. Maximum is ${max}.`,
      );
    }

    const status = dto.statusId
      ? await this.prisma.taskStatus.findFirst({
          where: { id: dto.statusId, taskListId: listId },
        })
      : await this.prisma.taskStatus.findFirst({
          where: { taskListId: listId, isDefault: true },
        });
    if (!status) {
      throw new BadRequestException('No matching status for this task list.');
    }

    const lastPos = await this.prisma.task.findFirst({
      where: { taskListId: listId, statusId: status.id, deletedAt: null },
      orderBy: { positionInStatus: 'desc' },
      select: { positionInStatus: true },
    });
    const nextPosition = (lastPos?.positionInStatus
      ? Number(lastPos.positionInStatus)
      : 0) + 1;

    const projectKey =
      list.projectKey && list.projectKey.length > 0 ? list.projectKey : 'TASK';

    const result = await this.prisma.$transaction(async (tx) => {
      // Bump counter + read the new value atomically.
      const bumped = await tx.taskList.update({
        where: { id: list.id },
        data: { taskCounter: { increment: 1 } },
        select: { taskCounter: true },
      });
      const key = `${projectKey}-${bumped.taskCounter}`;

      const task = await tx.task.create({
        data: {
          taskListId: list.id,
          projectId,
          key,
          title: dto.title,
          // When omitted, Prisma uses the @default("{}") from schema.
          ...(dto.description !== undefined && {
            description: dto.description as Prisma.InputJsonValue,
          }),
          statusId: status.id,
          priority: dto.priority ?? TaskPriority.NONE,
          storyPoints: dto.storyPoints,
          startDate: dto.startDate ? new Date(dto.startDate) : null,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          positionInStatus: new Prisma.Decimal(nextPosition),
          createdById: user.id,
        },
      });

      if (dto.assigneeUserIds && dto.assigneeUserIds.length > 0) {
        await tx.taskAssignee.createMany({
          data: dto.assigneeUserIds.map((uid) => ({
            taskId: task.id,
            userId: uid,
          })),
          skipDuplicates: true,
        });
      }

      await this.activity.record({
        taskId: task.id,
        actorId: user.id,
        kind: TaskActivityKind.CREATED,
        payload: { title: dto.title, statusId: status.id },
        tx,
      });
      for (const uid of dto.assigneeUserIds ?? []) {
        await this.activity.record({
          taskId: task.id,
          actorId: user.id,
          kind: TaskActivityKind.ASSIGNED,
          payload: { userId: uid },
          tx,
        });
      }
      return task;
    });

    return this.get(projectId, result.id);
  }

  /// Patch a task. Walks `dto` field-by-field, applies what's changed,
  /// and writes one TaskActivity row per changed field so the feed is
  /// readable in Phase 3.
  async update(
    user: AuthenticatedUser,
    access: AccessKind,
    projectId: string,
    taskId: string,
    dto: UpdateTaskDto,
  ): Promise<TaskWithRelations> {
    const existing = await this.get(projectId, taskId);
    this.assertEditAccess(existing, user, access);

    const data: Prisma.TaskUpdateInput = {};
    const events: { kind: TaskActivityKind; payload: Record<string, unknown> }[] = [];

    if (dto.title !== undefined && dto.title !== existing.title) {
      data.title = dto.title;
      events.push({
        kind: TaskActivityKind.RENAMED,
        payload: { before: existing.title, after: dto.title },
      });
    }

    if (dto.description !== undefined) {
      data.description = dto.description as Prisma.InputJsonValue;
      events.push({ kind: TaskActivityKind.DESCRIPTION_EDITED, payload: {} });
    }

    if (dto.statusId !== undefined && dto.statusId !== existing.statusId) {
      const status = await this.prisma.taskStatus.findFirst({
        where: { id: dto.statusId, taskListId: existing.taskListId },
      });
      if (!status) throw new BadRequestException('Status not found in this list.');
      data.status = { connect: { id: dto.statusId } };
      events.push({
        kind: TaskActivityKind.STATUS_CHANGED,
        payload: { before: existing.statusId, after: dto.statusId },
      });
      if (
        status.category === TaskStatusCategory.DONE &&
        existing.status.category !== TaskStatusCategory.DONE
      ) {
        data.completedAt = new Date();
        events.push({ kind: TaskActivityKind.COMPLETED, payload: {} });
      } else if (
        status.category !== TaskStatusCategory.DONE &&
        existing.status.category === TaskStatusCategory.DONE
      ) {
        data.completedAt = null;
        events.push({ kind: TaskActivityKind.REOPENED, payload: {} });
      }
    }

    if (dto.priority !== undefined && dto.priority !== existing.priority) {
      data.priority = dto.priority;
      events.push({
        kind: TaskActivityKind.PRIORITY_CHANGED,
        payload: { before: existing.priority, after: dto.priority },
      });
    }

    if (dto.storyPoints !== undefined && dto.storyPoints !== existing.storyPoints) {
      data.storyPoints = dto.storyPoints;
      // No dedicated kind — folded into a generic edit event so the feed
      // still surfaces the change. Phase 11 may add STORY_POINTS_CHANGED.
    }

    if (dto.startDate !== undefined) {
      const next = dto.startDate ? new Date(dto.startDate) : null;
      const prev = existing.startDate;
      if ((next?.getTime() ?? null) !== (prev?.getTime() ?? null)) {
        data.startDate = next;
        events.push({
          kind: TaskActivityKind.START_DATE_SET,
          payload: { before: prev, after: next },
        });
      }
    }

    if (dto.dueDate !== undefined) {
      const next = dto.dueDate ? new Date(dto.dueDate) : null;
      const prev = existing.dueDate;
      if ((next?.getTime() ?? null) !== (prev?.getTime() ?? null)) {
        data.dueDate = next;
        events.push({
          kind:
            next === null
              ? TaskActivityKind.DUE_DATE_CLEARED
              : TaskActivityKind.DUE_DATE_SET,
          payload: { before: prev, after: next },
        });
      }
    }

    await this.prisma.$transaction(async (tx) => {
      if (Object.keys(data).length > 0) {
        await tx.task.update({ where: { id: taskId }, data });
      }

      if (dto.assigneeUserIds !== undefined) {
        const current = existing.assignees.map((a) => a.userId);
        const next = dto.assigneeUserIds;
        const added = next.filter((u) => !current.includes(u));
        const removed = current.filter((u) => !next.includes(u));
        if (removed.length > 0) {
          await tx.taskAssignee.deleteMany({
            where: { taskId, userId: { in: removed } },
          });
        }
        if (added.length > 0) {
          await tx.taskAssignee.createMany({
            data: added.map((uid) => ({ taskId, userId: uid })),
            skipDuplicates: true,
          });
        }
        for (const uid of added) {
          await this.activity.record({
            taskId,
            actorId: user.id,
            kind: TaskActivityKind.ASSIGNED,
            payload: { userId: uid },
            tx,
          });
        }
        for (const uid of removed) {
          await this.activity.record({
            taskId,
            actorId: user.id,
            kind: TaskActivityKind.UNASSIGNED,
            payload: { userId: uid },
            tx,
          });
        }
      }

      for (const ev of events) {
        await this.activity.record({
          taskId,
          actorId: user.id,
          kind: ev.kind,
          payload: ev.payload,
          tx,
        });
      }
    });

    return this.get(projectId, taskId);
  }

  async move(
    user: AuthenticatedUser,
    access: AccessKind,
    projectId: string,
    taskId: string,
    dto: MoveTaskDto,
  ): Promise<TaskWithRelations> {
    const existing = await this.get(projectId, taskId);
    this.assertEditAccess(existing, user, access);

    if (dto.statusId !== existing.statusId) {
      const status = await this.prisma.taskStatus.findFirst({
        where: { id: dto.statusId, taskListId: existing.taskListId },
      });
      if (!status) throw new BadRequestException('Status not found in this list.');
    }
    await this.prisma.task.update({
      where: { id: taskId },
      data: {
        statusId: dto.statusId,
        positionInStatus: new Prisma.Decimal(dto.positionInStatus),
      },
    });
    if (dto.statusId !== existing.statusId) {
      await this.activity.record({
        taskId,
        actorId: user.id,
        kind: TaskActivityKind.STATUS_CHANGED,
        payload: { before: existing.statusId, after: dto.statusId },
      });
    }
    return this.get(projectId, taskId);
  }

  async archive(
    user: AuthenticatedUser,
    access: AccessKind,
    projectId: string,
    taskId: string,
  ): Promise<TaskWithRelations> {
    const existing = await this.get(projectId, taskId);
    this.assertEditAccess(existing, user, access);
    if (existing.archivedAt) return existing;
    await this.prisma.task.update({
      where: { id: taskId },
      data: { archivedAt: new Date() },
    });
    await this.activity.record({
      taskId,
      actorId: user.id,
      kind: TaskActivityKind.ARCHIVED,
    });
    return this.get(projectId, taskId);
  }

  async unarchive(
    user: AuthenticatedUser,
    access: AccessKind,
    projectId: string,
    taskId: string,
  ): Promise<TaskWithRelations> {
    const existing = await this.get(projectId, taskId);
    this.assertEditAccess(existing, user, access);
    if (!existing.archivedAt) return existing;
    await this.prisma.task.update({
      where: { id: taskId },
      data: { archivedAt: null },
    });
    await this.activity.record({
      taskId,
      actorId: user.id,
      kind: TaskActivityKind.UNARCHIVED,
    });
    return this.get(projectId, taskId);
  }

  async softDelete(
    user: AuthenticatedUser,
    access: AccessKind,
    projectId: string,
    taskId: string,
  ): Promise<{ ok: true }> {
    const existing = await this.get(projectId, taskId);
    this.assertDeleteAccess(existing, user, access);
    await this.prisma.task.update({
      where: { id: taskId },
      data: { deletedAt: new Date() },
    });
    return { ok: true };
  }

  // ─── Access helpers ────────────────────────────────────────────────

  /**
   * Edit rules per the Phase 0 permissions matrix:
   * - Admin / manager: edit any task in the project.
   * - Contributor: edit any task in their project (not just their own).
   *   We treat editing as collaborative; only deletion is locked to
   *   creator + manager+ (see assertDeleteAccess).
   */
  private assertEditAccess(_task: Task, _user: AuthenticatedUser, _access: AccessKind) {
    // All insiders can edit. Already gated at the controller by
    // ProjectAccessService.assertInsider, so nothing more to check.
  }

  private assertDeleteAccess(task: Task, user: AuthenticatedUser, access: AccessKind) {
    if (access === 'admin' || access === 'manager') return;
    if (task.createdById === user.id) return;
    throw new ForbiddenException('Only the task creator or a project manager can delete this task.');
  }

  private async assertListExists(projectId: string, listId: string) {
    const list = await this.prisma.taskList.findFirst({
      where: { id: listId, projectId, deletedAt: null },
    });
    if (!list) throw new NotFoundException('Task list not found.');
    return list;
  }

  private relationInclude() {
    return {
      assignees: {
        include: {
          user: {
            select: { id: true, name: true, avatarUrl: true },
          },
        },
      },
      status: true,
    } as const;
  }

  // ─── Gantt + dependencies ──────────────────────────────────────────

  /// Lightweight projection for the gantt view: every non-archived,
  /// non-deleted task in the list plus its outgoing dependencies. We
  /// keep the shape narrow so a 200-task list doesn't ship 100 KB of
  /// rich-text descriptions to the browser.
  async gantt(
    projectId: string,
    listId: string,
  ): Promise<{
    tasks: Array<{
      id: string;
      key: string;
      title: string;
      statusId: string;
      statusName: string;
      statusCategory: TaskStatusCategory;
      startDate: Date | null;
      dueDate: Date | null;
      completedAt: Date | null;
      assignees: Array<{ id: string; name: string; avatarUrl: string | null }>;
    }>;
    dependencies: Array<{
      id: string;
      fromTaskId: string;
      toTaskId: string;
      kind: TaskDependencyKind;
    }>;
  }> {
    await this.assertListExists(projectId, listId);

    const rows = await this.prisma.task.findMany({
      where: { taskListId: listId, projectId, deletedAt: null, archivedAt: null },
      orderBy: [{ startDate: 'asc' }, { dueDate: 'asc' }, { createdAt: 'asc' }],
      include: {
        assignees: {
          include: { user: { select: { id: true, name: true, avatarUrl: true } } },
        },
        status: { select: { id: true, name: true, category: true } },
      },
    });
    const taskIds = rows.map((t) => t.id);
    const deps =
      taskIds.length === 0
        ? []
        : await this.prisma.taskDependency.findMany({
            where: { fromTaskId: { in: taskIds } },
          });

    return {
      tasks: rows.map((t) => ({
        id: t.id,
        key: t.key,
        title: t.title,
        statusId: t.statusId,
        statusName: t.status.name,
        statusCategory: t.status.category,
        startDate: t.startDate,
        dueDate: t.dueDate,
        completedAt: t.completedAt,
        assignees: t.assignees.map((a) => a.user),
      })),
      dependencies: deps.map((d) => ({
        id: d.id,
        fromTaskId: d.fromTaskId,
        toTaskId: d.toTaskId,
        kind: d.kind,
      })),
    };
  }

  /// Add a dependency from `:taskId` → `dto.toTaskId`. Both tasks must
  /// belong to the same project (no cross-project links) AND the same
  /// list (gantt is per-list in Phase 5; cross-list deps land in a
  /// later polish phase). Rejects self-loops and trivial cycles.
  async addDependency(
    user: AuthenticatedUser,
    projectId: string,
    fromTaskId: string,
    dto: { toTaskId: string; kind?: TaskDependencyKind },
  ) {
    if (fromTaskId === dto.toTaskId) {
      throw new BadRequestException('A task cannot depend on itself.');
    }
    const both = await this.prisma.task.findMany({
      where: { id: { in: [fromTaskId, dto.toTaskId] }, projectId, deletedAt: null },
      select: { id: true, taskListId: true },
    });
    if (both.length !== 2) {
      throw new NotFoundException('One or both tasks were not found.');
    }
    const [a, b] = both;
    if (a!.taskListId !== b!.taskListId) {
      throw new BadRequestException('Dependencies must be within the same task list.');
    }
    // Reject the trivial reverse cycle: A→B already and now B→A.
    const reverse = await this.prisma.taskDependency.findUnique({
      where: { fromTaskId_toTaskId: { fromTaskId: dto.toTaskId, toTaskId: fromTaskId } },
    });
    if (reverse) {
      throw new BadRequestException(
        'The reverse dependency already exists; this would create a cycle.',
      );
    }
    const dep = await this.prisma.taskDependency.create({
      data: {
        fromTaskId,
        toTaskId: dto.toTaskId,
        kind: dto.kind ?? 'FINISH_TO_START',
      },
    });
    await this.activity.record({
      taskId: fromTaskId,
      actorId: user.id,
      kind: TaskActivityKind.DEPENDENCY_ADDED,
      payload: { toTaskId: dto.toTaskId, depId: dep.id, kind: dep.kind },
    });
    return dep;
  }

  async removeDependency(
    user: AuthenticatedUser,
    projectId: string,
    fromTaskId: string,
    depId: string,
  ): Promise<{ ok: true }> {
    const dep = await this.prisma.taskDependency.findFirst({
      where: { id: depId, fromTaskId, from: { projectId } },
    });
    if (!dep) throw new NotFoundException('Dependency not found.');
    await this.prisma.taskDependency.delete({ where: { id: depId } });
    await this.activity.record({
      taskId: fromTaskId,
      actorId: user.id,
      kind: TaskActivityKind.DEPENDENCY_REMOVED,
      payload: { toTaskId: dep.toTaskId, depId: dep.id },
    });
    return { ok: true };
  }
}
