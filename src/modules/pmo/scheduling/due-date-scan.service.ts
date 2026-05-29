import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationType } from '@prisma/client';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { PrismaService } from '@/prisma/prisma.service';

const SCAN_INTERVAL_MS = 60 * 60 * 1000; // hourly
const FIRST_SCAN_DELAY_MS = 30 * 1000; // shortly after boot
const DEDUP_WINDOW_MS = 20 * 60 * 60 * 1000; // at most one notification/task/user/day

/**
 * Dependency-free due-date watcher (no @nestjs/schedule). On an hourly tick
 * it finds open, assigned tasks due within 24h (TASK_DUE_SOON) or already
 * past due (TASK_OVERDUE) and notifies each assignee, deduped to ~once per
 * day per task+user via the notification's metadata.taskId. Disabled when
 * PMO is off; failures are logged, never thrown.
 */
@Injectable()
export class DueDateScanService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DueDateScanService.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (!this.config.get<boolean>('pmo.enabled')) return;
    setTimeout(() => void this.scan(), FIRST_SCAN_DELAY_MS);
    this.timer = setInterval(() => void this.scan(), SCAN_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async scan(): Promise<void> {
    try {
      const now = new Date();
      const soonCutoff = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const dedupSince = new Date(now.getTime() - DEDUP_WINDOW_MS);

      const tasks = await this.prisma.task.findMany({
        where: {
          deletedAt: null,
          archivedAt: null,
          dueDate: { not: null, lt: soonCutoff },
          status: { category: { in: ['TODO', 'IN_PROGRESS'] } },
          assignees: { some: {} },
          project: { deletedAt: null },
        },
        select: {
          id: true,
          key: true,
          title: true,
          dueDate: true,
          taskListId: true,
          project: { select: { slug: true } },
          assignees: { select: { userId: true } },
        },
      });

      let created = 0;
      for (const task of tasks) {
        if (!task.dueDate) continue;
        const overdue = task.dueDate < now;
        const type = overdue ? NotificationType.TASK_OVERDUE : NotificationType.TASK_DUE_SOON;
        const due = task.dueDate.toISOString().slice(0, 10);

        for (const { userId } of task.assignees) {
          const existing = await this.prisma.notification.findFirst({
            where: {
              userId,
              type,
              createdAt: { gte: dedupSince },
              metadata: { path: ['taskId'], equals: task.id },
            },
            select: { id: true },
          });
          if (existing) continue;

          await this.notifications.create({
            userId,
            type,
            title: overdue ? `Overdue: ${task.key}` : `Due soon: ${task.key}`,
            body: overdue
              ? `“${task.title}” was due ${due}.`
              : `“${task.title}” is due ${due}.`,
            link: `/projects/${task.project.slug}/lists/${task.taskListId}/tasks/${task.key}`,
            metadata: { taskId: task.id, kind: 'pmo-due' },
          });
          created += 1;
        }
      }
      if (created > 0) this.logger.log(`due-date scan: created ${created} notification(s)`);
    } catch (err) {
      this.logger.warn(`due-date scan failed: ${(err as Error).message}`);
    }
  }
}
