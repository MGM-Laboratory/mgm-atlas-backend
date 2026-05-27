import { Injectable } from '@nestjs/common';
import { Prisma, TaskActivityKind } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';

/**
 * Audit log writer for tasks. Every mutation in TasksService and the
 * statuses bulk-update flow funnels through `record()` so the activity
 * feed in the task popup (Phase 3) is fed automatically.
 *
 * Pass a Prisma transaction client (`tx`) when the activity must
 * succeed atomically with the mutation. Otherwise we fall back to the
 * top-level PrismaService which is still single-statement-atomic.
 */
@Injectable()
export class TaskActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async record(args: {
    taskId: string;
    actorId: string | null;
    kind: TaskActivityKind;
    payload?: Record<string, unknown>;
    tx?: Prisma.TransactionClient;
  }): Promise<void> {
    const client = args.tx ?? this.prisma;
    await client.taskActivity.create({
      data: {
        taskId: args.taskId,
        actorId: args.actorId,
        kind: args.kind,
        payload: (args.payload ?? {}) as Prisma.InputJsonValue,
      },
    });
  }
}
