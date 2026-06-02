import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { PrismaService } from '@/prisma/prisma.service';

export type UndoOpKind = 'TASK_MOVED' | 'TASK_UPDATED';

export interface TaskMovedOp {
  taskId: string;
  statusId: string;
  positionInStatus: string;
}

export interface TaskUpdatedOp {
  taskId: string;
  /// Whitelist of reversible fields. The undo dispatcher only restores
  /// these — irreversible side-effects (mentions, notifications) are
  /// intentionally not undone. Field shapes match UpdateTaskDto so
  /// the dispatcher can hand the payload straight through.
  fields: {
    title?: string;
    description?: Record<string, unknown>;
    statusId?: string;
    priority?: string;
    storyPoints?: number | null;
    startDate?: string | null;
    dueDate?: string | null;
    assigneeUserIds?: string[];
  };
}

export type UndoOp = TaskMovedOp | TaskUpdatedOp;

interface RecordArgs {
  tx: Prisma.TransactionClient;
  actor: AuthenticatedUser;
  scope: string;
  kind: UndoOpKind;
  taskId?: string;
  forwardOp: UndoOp;
  inverseOp: UndoOp;
}

/**
 * Server-backed durable undo log. Mutations call `record()` inside their
 * existing transaction so the audit + reversal entry are atomic with
 * the state change. The HTTP endpoints in undo.controller call
 * `undoLast()` / `redoLast()` which dispatch the inverse / forward op
 * back through the regular service methods — there is no separate "raw
 * patch" path that could bypass access checks or skip activity rows.
 */
@Injectable()
export class UndoService {
  private readonly logger = new Logger(UndoService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(args: RecordArgs): Promise<void> {
    await args.tx.undoEntry.create({
      data: {
        actorId: args.actor.id,
        scope: args.scope,
        kind: args.kind,
        taskId: args.taskId ?? null,
        forwardOp: args.forwardOp as unknown as Prisma.InputJsonValue,
        inverseOp: args.inverseOp as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /** Pop the actor's most recent undoable entry and return its details
   *  so the controller can dispatch the inverse op. The entry is
   *  stamped `undoneAt = now()` atomically; a follow-up undo skips
   *  this row and picks the next-most-recent. */
  async popUndo(actor: AuthenticatedUser) {
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.undoEntry.findFirst({
        where: { actorId: actor.id, undoneAt: null },
        orderBy: { appliedAt: 'desc' },
      });
      if (!entry) throw new NotFoundException('No undoable operation.');
      await tx.undoEntry.update({
        where: { id: entry.id },
        data: { undoneAt: new Date(), redoneAt: null },
      });
      return entry;
    });
  }

  /** Pop the actor's most recently-undone entry that hasn't been
   *  redone. Same atomic stamp as popUndo. */
  async popRedo(actor: AuthenticatedUser) {
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.undoEntry.findFirst({
        where: { actorId: actor.id, undoneAt: { not: null }, redoneAt: null },
        orderBy: { undoneAt: 'desc' },
      });
      if (!entry) throw new NotFoundException('No redoable operation.');
      await tx.undoEntry.update({
        where: { id: entry.id },
        data: { redoneAt: new Date() },
      });
      return entry;
    });
  }

  /** Re-mark an entry as live (used when applying the inverse op
   *  fails — we revert the undoneAt stamp so the user can try again). */
  async restoreEntry(entryId: string, fields: { undoneAt?: null; redoneAt?: null }) {
    await this.prisma.undoEntry.update({
      where: { id: entryId },
      data: fields,
    });
  }

  /** Conflict shape exposed to the controller for the 409 toast. */
  raiseConflict(reason: string): never {
    throw new ConflictException(reason);
  }

  /** Typed cast helpers — the JSON is opaque to Prisma. */
  static asTaskMoved(op: Prisma.JsonValue): TaskMovedOp {
    if (!op || typeof op !== 'object' || Array.isArray(op)) {
      throw new ConflictException('Couldn’t undo — entry payload is malformed.');
    }
    const r = op as Record<string, unknown>;
    if (typeof r.taskId !== 'string' || typeof r.statusId !== 'string') {
      throw new ConflictException('Couldn’t undo — entry payload is malformed.');
    }
    return {
      taskId: r.taskId,
      statusId: r.statusId,
      positionInStatus:
        typeof r.positionInStatus === 'string'
          ? r.positionInStatus
          : String(r.positionInStatus ?? '0'),
    };
  }

  static asTaskUpdated(op: Prisma.JsonValue): TaskUpdatedOp {
    if (!op || typeof op !== 'object' || Array.isArray(op)) {
      throw new ConflictException('Couldn’t undo — entry payload is malformed.');
    }
    const r = op as Record<string, unknown>;
    if (typeof r.taskId !== 'string' || typeof r.fields !== 'object') {
      throw new ConflictException('Couldn’t undo — entry payload is malformed.');
    }
    return { taskId: r.taskId, fields: r.fields as TaskUpdatedOp['fields'] };
  }

  // Helper used by the controller after a state-divergence dispatch
  // fails — re-arm the entry so Cmd+Z can try again later.
  async revertUndo(entry: { id: string; undoneAt: Date | null; redoneAt: Date | null }) {
    if (entry.redoneAt) {
      // we were redoing; revert that.
      await this.restoreEntry(entry.id, { redoneAt: null });
    } else if (entry.undoneAt) {
      await this.restoreEntry(entry.id, { undoneAt: null });
    }
  }

}
