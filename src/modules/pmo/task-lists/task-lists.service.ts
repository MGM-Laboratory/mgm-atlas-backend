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
