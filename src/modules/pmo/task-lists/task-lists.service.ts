import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, TaskList, TaskListTab, TaskStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import {
  DEFAULT_TASK_LIST_TABS,
  DEFAULT_TASK_STATUSES,
  deriveProjectKey,
} from './task-list-defaults';
import { CreateTaskListDto } from './dto/create-task-list.dto';
import { UpdateTaskListDto } from './dto/update-task-list.dto';
import { ReorderTabsDto } from './dto/reorder-tabs.dto';
import { ReorderTaskListsDto } from './dto/reorder-task-lists.dto';
import {
  BulkUpdateStatusesDto,
  StatusEntryDto,
} from '../tasks/dto/bulk-update-statuses.dto';

export type TaskListWithRelations = TaskList & {
  statuses: TaskStatus[];
  tabs: TaskListTab[];
  _count?: { tasks: number };
};

@Injectable()
export class TaskListsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /// Lists for a project, ordered by `order`, deleted ones excluded.
  /// Archived lists are included so the UI can show them in a separate group.
  async list(projectId: string): Promise<TaskListWithRelations[]> {
    return this.prisma.taskList.findMany({
      where: { projectId, deletedAt: null },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      include: this.relationInclude(),
    });
  }

  async get(projectId: string, listId: string): Promise<TaskListWithRelations> {
    const list = await this.prisma.taskList.findFirst({
      where: { id: listId, projectId, deletedAt: null },
      include: this.relationInclude(),
    });
    if (!list) throw new NotFoundException('Task list not found.');
    return list;
  }

  /// Create a TaskList and seed its default statuses + built-in tabs in a
  /// single transaction. Enforces the per-project list count limit so a
  /// runaway script can't fill the table.
  async create(projectId: string, dto: CreateTaskListDto): Promise<TaskListWithRelations> {
    const max = this.config.get<number>('pmo.maxListsPerProject', 50);
    const existingCount = await this.prisma.taskList.count({
      where: { projectId, deletedAt: null },
    });
    if (existingCount >= max) {
      throw new ConflictException(
        `Project already has ${existingCount} task lists. Maximum is ${max}.`,
      );
    }

    const order = existingCount; // append to end
    const projectKey = dto.projectKey ?? deriveProjectKey(dto.name);

    return this.prisma.$transaction(async (tx) => {
      const list = await tx.taskList.create({
        data: {
          projectId,
          name: dto.name,
          iconName: dto.iconName ?? 'list-todo',
          iconColor: dto.iconColor ?? 'blue',
          order,
          projectKey,
          contributorsCanCreateTasks: dto.contributorsCanCreateTasks ?? true,
        },
      });

      await tx.taskStatus.createMany({
        data: DEFAULT_TASK_STATUSES.map((s, i) => ({
          taskListId: list.id,
          name: s.name,
          color: s.color,
          category: s.category,
          order: i,
          isDefault: s.isDefault,
        })),
      });

      await tx.taskListTab.createMany({
        data: DEFAULT_TASK_LIST_TABS.map((t, i) => ({
          taskListId: list.id,
          kind: t.kind,
          iconName: t.iconName,
          order: i,
          hidden: false,
        })),
      });

      return tx.taskList.findUniqueOrThrow({
        where: { id: list.id },
        include: this.relationInclude(),
      });
    });
  }

  async update(
    projectId: string,
    listId: string,
    dto: UpdateTaskListDto,
  ): Promise<TaskListWithRelations> {
    await this.assertExists(projectId, listId);
    if (Object.keys(dto).length === 0) {
      return this.get(projectId, listId);
    }
    await this.prisma.taskList.update({
      where: { id: listId },
      data: dto,
    });
    return this.get(projectId, listId);
  }

  async archive(projectId: string, listId: string): Promise<TaskListWithRelations> {
    const list = await this.assertExists(projectId, listId);
    if (list.archivedAt) return this.get(projectId, listId);
    await this.prisma.taskList.update({
      where: { id: listId },
      data: { archivedAt: new Date() },
    });
    return this.get(projectId, listId);
  }

  async unarchive(projectId: string, listId: string): Promise<TaskListWithRelations> {
    await this.assertExists(projectId, listId);
    await this.prisma.taskList.update({
      where: { id: listId },
      data: { archivedAt: null },
    });
    return this.get(projectId, listId);
  }

  async softDelete(projectId: string, listId: string): Promise<{ ok: true }> {
    await this.assertExists(projectId, listId);
    await this.prisma.taskList.update({
      where: { id: listId },
      data: { deletedAt: new Date() },
    });
    return { ok: true };
  }

  /// Bulk reorder lists in the project sidebar. Only ids that belong to
  /// the project are touched; unknown ids are silently ignored.
  async reorderLists(projectId: string, dto: ReorderTaskListsDto): Promise<{ ok: true }> {
    const owned = await this.prisma.taskList.findMany({
      where: { id: { in: dto.listIds }, projectId, deletedAt: null },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((l) => l.id));
    await this.prisma.$transaction(
      dto.listIds
        .filter((id) => ownedIds.has(id))
        .map((id, idx) =>
          this.prisma.taskList.update({ where: { id }, data: { order: idx } }),
        ),
    );
    return { ok: true };
  }

  /// Bulk reorder + show/hide tabs within a task list. The `hidden` flag
  /// is optional on each item; built-in tabs cannot be deleted, just hidden.
  async reorderTabs(
    projectId: string,
    listId: string,
    dto: ReorderTabsDto,
  ): Promise<TaskListWithRelations> {
    await this.assertExists(projectId, listId);
    const tabs = await this.prisma.taskListTab.findMany({
      where: { taskListId: listId, id: { in: dto.tabs.map((t) => t.id) } },
      select: { id: true },
    });
    const ownedIds = new Set(tabs.map((t) => t.id));
    const updates: Prisma.PrismaPromise<unknown>[] = [];
    dto.tabs.forEach((t, idx) => {
      if (!ownedIds.has(t.id)) return;
      const data: Prisma.TaskListTabUpdateInput = { order: idx };
      if (t.hidden !== undefined) data.hidden = t.hidden;
      updates.push(this.prisma.taskListTab.update({ where: { id: t.id }, data }));
    });
    if (updates.length === 0) {
      throw new BadRequestException('No matching tabs to reorder.');
    }
    await this.prisma.$transaction(updates);
    return this.get(projectId, listId);
  }

  /**
   * Apply a full status set to a TaskList in one transaction.
   *
   * - Entries with `id` set update an existing status.
   * - Entries without `id` create a new one.
   * - Existing statuses absent from the payload are deleted; their
   *   tasks (if any) move to `moveTasksTo` first.
   * - Exactly one entry ends up as `isDefault: true` — if none flagged,
   *   the first entry wins. The default status is what new tasks land
   *   in when a creator doesn't pick one explicitly.
   * - Order matches the array position.
   *
   * Postgres can't reorder rows under `@@unique([taskListId, order])` in
   * place, so we shift existing orders into a temporary high range
   * (10_000+) first, then write the final orders. Atomic from the
   * caller's perspective (single $transaction).
   */
  async updateStatuses(
    projectId: string,
    listId: string,
    dto: BulkUpdateStatusesDto,
  ): Promise<TaskListWithRelations> {
    await this.assertExists(projectId, listId);

    const currentStatuses = await this.prisma.taskStatus.findMany({
      where: { taskListId: listId },
      orderBy: { order: 'asc' },
    });
    const currentById = new Map(currentStatuses.map((s) => [s.id, s]));

    // Validate: every id in the payload must match an existing status in
    // this list. Stops a crafted payload from updating statuses elsewhere.
    for (const entry of dto.statuses) {
      if (entry.id && !currentById.has(entry.id)) {
        throw new BadRequestException(`Status ${entry.id} not found in this list.`);
      }
    }

    // Determine deletions.
    const keepIds = new Set(dto.statuses.filter((e) => e.id).map((e) => e.id!));
    const toDelete = currentStatuses.filter((s) => !keepIds.has(s.id));
    if (toDelete.length > 0) {
      const tasksReferencingDeleted = await this.prisma.task.count({
        where: { statusId: { in: toDelete.map((s) => s.id) }, deletedAt: null },
      });
      if (tasksReferencingDeleted > 0) {
        if (!dto.moveTasksTo) {
          throw new BadRequestException(
            'Deleting a status with tasks requires moveTasksTo set to a kept status.',
          );
        }
        if (!keepIds.has(dto.moveTasksTo)) {
          throw new BadRequestException('moveTasksTo must reference a kept status.');
        }
      }
    }

    // Resolve which entry is default.
    const defaultIndex = (() => {
      const explicit = dto.statuses.findIndex((e) => e.isDefault === true);
      return explicit === -1 ? 0 : explicit;
    })();

    return this.prisma.$transaction(async (tx) => {
      // 1. Move tasks off about-to-delete statuses.
      if (toDelete.length > 0 && dto.moveTasksTo) {
        await tx.task.updateMany({
          where: { statusId: { in: toDelete.map((s) => s.id) } },
          data: { statusId: dto.moveTasksTo },
        });
      }

      // 2. Shift existing statuses to a high temporary order range so we
      //    can rewrite the final orders without bumping into the
      //    @@unique constraint.
      for (let i = 0; i < currentStatuses.length; i++) {
        await tx.taskStatus.update({
          where: { id: currentStatuses[i]!.id },
          data: { order: 10_000 + i, isDefault: false },
        });
      }

      // 3. Delete removed statuses (now safely out of the constraint).
      if (toDelete.length > 0) {
        await tx.taskStatus.deleteMany({
          where: { id: { in: toDelete.map((s) => s.id) } },
        });
      }

      // 4. Apply the final set in order.
      const written: { id: string; entry: StatusEntryDto }[] = [];
      for (let i = 0; i < dto.statuses.length; i++) {
        const entry = dto.statuses[i]!;
        const data = {
          name: entry.name,
          color: entry.color ?? 'neutral',
          category: entry.category ?? 'TODO',
          order: i,
          isDefault: i === defaultIndex,
        } as const;
        if (entry.id) {
          await tx.taskStatus.update({ where: { id: entry.id }, data });
          written.push({ id: entry.id, entry });
        } else {
          const created = await tx.taskStatus.create({
            data: { ...data, taskListId: listId },
          });
          written.push({ id: created.id, entry });
        }
      }

      return tx.taskList.findUniqueOrThrow({
        where: { id: listId },
        include: this.relationInclude(),
      });
    });
  }

  // ─── private helpers ────────────────────────────────────────────────

  private async assertExists(projectId: string, listId: string): Promise<TaskList> {
    const list = await this.prisma.taskList.findFirst({
      where: { id: listId, projectId, deletedAt: null },
    });
    if (!list) throw new NotFoundException('Task list not found.');
    return list;
  }

  private relationInclude() {
    return {
      statuses: { orderBy: { order: 'asc' as const } },
      tabs: { orderBy: { order: 'asc' as const } },
      _count: { select: { tasks: { where: { deletedAt: null, archivedAt: null } } } },
    };
  }
}
