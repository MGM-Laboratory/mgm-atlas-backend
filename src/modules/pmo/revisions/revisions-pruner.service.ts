import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/prisma/prisma.service';

const PRUNE_INTERVAL_MS = 60 * 60 * 1000; // hourly
const FIRST_PRUNE_DELAY_MS = 5 * 60 * 1000; // 5 min after boot
const KEEP_RECENT = 50; // last N revisions kept regardless
const CHECKPOINT_INTERVAL_MS = 60 * 60 * 1000; // promote one revision/hour to isCheckpoint

/**
 * Hourly pruner for the three revision tables: NoteRevision,
 * WhiteboardRevision, YDocSnapshotRevision. Retention policy is:
 *   • Keep the most recent KEEP_RECENT (50) regardless of age.
 *   • Promote one revision per hour to `isCheckpoint = true` so a
 *     row survives the next prune even when it falls outside the
 *     KEEP_RECENT window. Checkpoints are retained indefinitely.
 *   • Delete everything that is neither recent nor a checkpoint.
 *
 * Runs as a dependency-free setInterval — same pattern as the
 * due-date scanner. Disabled when PMO is off; failures are logged,
 * never thrown.
 */
@Injectable()
export class RevisionsPrunerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RevisionsPrunerService.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (!this.config.get<boolean>('pmo.enabled')) return;
    setTimeout(() => void this.prune(), FIRST_PRUNE_DELAY_MS);
    this.timer = setInterval(() => void this.prune(), PRUNE_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async prune(): Promise<void> {
    try {
      const noteScopes = await this.prisma.noteRevision.findMany({
        distinct: ['noteId'],
        select: { noteId: true },
      });
      for (const { noteId } of noteScopes) {
        await this.pruneNote(noteId);
      }

      const wbScopes = await this.prisma.whiteboardRevision.findMany({
        distinct: ['whiteboardId'],
        select: { whiteboardId: true },
      });
      for (const { whiteboardId } of wbScopes) {
        await this.pruneWhiteboard(whiteboardId);
      }

      const ydocScopes = await this.prisma.yDocSnapshotRevision.findMany({
        distinct: ['docKey'],
        select: { docKey: true },
      });
      for (const { docKey } of ydocScopes) {
        await this.pruneYDoc(docKey);
      }
    } catch (err) {
      this.logger.warn(`prune failed: ${(err as Error).message}`);
    }
  }

  // ── per-scope helpers ─────────────────────────────────────────────

  private async pruneNote(noteId: string): Promise<void> {
    await this.promoteCheckpoints(noteId, 'note');
    const keep = await this.prisma.noteRevision.findMany({
      where: { noteId },
      orderBy: { createdAt: 'desc' },
      take: KEEP_RECENT,
      select: { id: true },
    });
    const keepIds = new Set(keep.map((r) => r.id));
    const result = await this.prisma.noteRevision.deleteMany({
      where: { noteId, isCheckpoint: false, id: { notIn: [...keepIds] } },
    });
    if (result.count > 0) {
      this.logger.debug(`pruned ${result.count} NoteRevision rows for ${noteId}`);
    }
  }

  private async pruneWhiteboard(whiteboardId: string): Promise<void> {
    await this.promoteCheckpoints(whiteboardId, 'whiteboard');
    const keep = await this.prisma.whiteboardRevision.findMany({
      where: { whiteboardId },
      orderBy: { createdAt: 'desc' },
      take: KEEP_RECENT,
      select: { id: true },
    });
    const keepIds = new Set(keep.map((r) => r.id));
    const result = await this.prisma.whiteboardRevision.deleteMany({
      where: { whiteboardId, isCheckpoint: false, id: { notIn: [...keepIds] } },
    });
    if (result.count > 0) {
      this.logger.debug(`pruned ${result.count} WhiteboardRevision rows for ${whiteboardId}`);
    }
  }

  private async pruneYDoc(docKey: string): Promise<void> {
    await this.promoteCheckpoints(docKey, 'ydoc');
    const keep = await this.prisma.yDocSnapshotRevision.findMany({
      where: { docKey },
      orderBy: { createdAt: 'desc' },
      take: KEEP_RECENT,
      select: { id: true },
    });
    const keepIds = new Set(keep.map((r) => r.id));
    const result = await this.prisma.yDocSnapshotRevision.deleteMany({
      where: { docKey, isCheckpoint: false, id: { notIn: [...keepIds] } },
    });
    if (result.count > 0) {
      this.logger.debug(`pruned ${result.count} YDocSnapshotRevision rows for ${docKey}`);
    }
  }

  /** Per-hour checkpoint promotion. For each hour bucket that has at
   *  least one revision, mark its earliest row as a checkpoint so it
   *  survives the next prune. Idempotent — running it twice is a no-op. */
  private async promoteCheckpoints(
    id: string,
    kind: 'note' | 'whiteboard' | 'ydoc',
  ): Promise<void> {
    const where =
      kind === 'note'
        ? { noteId: id, isCheckpoint: false }
        : kind === 'whiteboard'
          ? { whiteboardId: id, isCheckpoint: false }
          : { docKey: id, isCheckpoint: false };

    const rows: { id: string; createdAt: Date }[] =
      kind === 'note'
        ? await this.prisma.noteRevision.findMany({
            where: where as { noteId: string; isCheckpoint: boolean },
            select: { id: true, createdAt: true },
            orderBy: { createdAt: 'asc' },
          })
        : kind === 'whiteboard'
          ? await this.prisma.whiteboardRevision.findMany({
              where: where as { whiteboardId: string; isCheckpoint: boolean },
              select: { id: true, createdAt: true },
              orderBy: { createdAt: 'asc' },
            })
          : await this.prisma.yDocSnapshotRevision.findMany({
              where: where as { docKey: string; isCheckpoint: boolean },
              select: { id: true, createdAt: true },
              orderBy: { createdAt: 'asc' },
            });

    const buckets = new Map<number, string>(); // hour bucket → revision id
    for (const row of rows) {
      const bucket = Math.floor(row.createdAt.getTime() / CHECKPOINT_INTERVAL_MS);
      if (!buckets.has(bucket)) buckets.set(bucket, row.id);
    }
    if (buckets.size === 0) return;
    const ids = [...buckets.values()];

    if (kind === 'note') {
      await this.prisma.noteRevision.updateMany({
        where: { id: { in: ids } },
        data: { isCheckpoint: true },
      });
    } else if (kind === 'whiteboard') {
      await this.prisma.whiteboardRevision.updateMany({
        where: { id: { in: ids } },
        data: { isCheckpoint: true },
      });
    } else {
      await this.prisma.yDocSnapshotRevision.updateMany({
        where: { id: { in: ids } },
        data: { isCheckpoint: true },
      });
    }
  }
}
