import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateNoteDto } from './dto/create-note.dto';
import { UpdateNoteDto } from './dto/update-note.dto';

const MAX_DEPTH = 5;

const treeItemSelect = {
  id: true,
  projectId: true,
  parentNoteId: true,
  title: true,
  iconName: true,
  order: true,
  createdById: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProjectNoteSelect;

@Injectable()
export class NotesService {
  private readonly maxNotes: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.maxNotes = config.get<number>('pmo.maxNotesPerProject') ?? 500;
  }

  /** Flat list of note metadata (no content) — the frontend nests it into a tree. */
  async list(projectId: string) {
    const notes = await this.prisma.projectNote.findMany({
      where: { projectId, deletedAt: null },
      select: treeItemSelect,
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    return { notes };
  }

  /** Full note including the BlockNote contentSnapshot (initial render / SSR fallback). */
  async get(projectId: string, noteId: string) {
    const note = await this.prisma.projectNote.findFirst({
      where: { id: noteId, projectId, deletedAt: null },
    });
    if (!note) throw new NotFoundException('Note not found.');
    return note;
  }

  async create(userId: string, projectId: string, dto: CreateNoteDto) {
    const count = await this.prisma.projectNote.count({ where: { projectId, deletedAt: null } });
    if (count >= this.maxNotes) {
      throw new BadRequestException(`A project can have at most ${this.maxNotes} notes.`);
    }
    if (dto.parentNoteId) {
      await this.assertNote(projectId, dto.parentNoteId);
      await this.assertParentDepth(projectId, dto.parentNoteId);
    }

    const id = randomUUID();
    const yDocKey = `note:${id}`;
    const last = await this.prisma.projectNote.findFirst({
      where: { projectId, parentNoteId: dto.parentNoteId ?? null, deletedAt: null },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    const order = (last?.order ?? -1) + 1;

    return this.prisma.$transaction(async (tx) => {
      const note = await tx.projectNote.create({
        data: {
          id,
          projectId,
          parentNoteId: dto.parentNoteId ?? null,
          title: dto.title?.trim() || 'Untitled',
          iconName: dto.iconName ?? null,
          yDocKey,
          createdById: userId,
          order,
        },
      });
      // Empty CRDT doc so the sidecar has a row to load/persist against.
      await tx.yDocSnapshot.create({
        data: { docKey: yDocKey, state: Buffer.alloc(0), size: 0 },
      });
      return note;
    });
  }

  async update(projectId: string, noteId: string, dto: UpdateNoteDto, actorId?: string) {
    await this.get(projectId, noteId);
    const data: Prisma.ProjectNoteUncheckedUpdateInput = {};

    if (dto.title !== undefined) data.title = dto.title.trim() || 'Untitled';
    if (dto.iconName !== undefined) data.iconName = dto.iconName;
    if (dto.order !== undefined) data.order = dto.order;
    if (dto.contentSnapshot !== undefined) {
      data.contentSnapshot = dto.contentSnapshot as Prisma.InputJsonValue;
    }

    if (dto.parentNoteId !== undefined) {
      if (dto.parentNoteId === null) {
        data.parentNoteId = null;
      } else if (dto.parentNoteId === noteId) {
        throw new BadRequestException('A note cannot be its own parent.');
      } else {
        await this.assertNote(projectId, dto.parentNoteId);
        if (await this.isDescendant(projectId, noteId, dto.parentNoteId)) {
          throw new BadRequestException('A note cannot be moved into its own descendant.');
        }
        await this.assertParentDepth(projectId, dto.parentNoteId);
        data.parentNoteId = dto.parentNoteId;
      }
    }

    // For content edits we also write a NoteRevision row inside the
    // same transaction so the History drawer can show the change.
    // Other field updates (title, parent, order, icon) aren't versioned.
    if (dto.contentSnapshot !== undefined) {
      const snapshot = dto.contentSnapshot as Prisma.InputJsonValue;
      const size = Buffer.byteLength(JSON.stringify(snapshot ?? null));
      return this.prisma.$transaction(async (tx) => {
        const updated = await tx.projectNote.update({ where: { id: noteId }, data });
        await tx.noteRevision.create({
          data: {
            noteId,
            contentSnapshot: snapshot,
            size,
            authorId: actorId ?? null,
          },
        });
        return updated;
      });
    }

    return this.prisma.projectNote.update({ where: { id: noteId }, data });
  }

  /** History tab listing — newest first, with author name when known. */
  async listRevisions(projectId: string, noteId: string, take = 100) {
    await this.get(projectId, noteId);
    return this.prisma.noteRevision.findMany({
      where: { noteId },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        createdAt: true,
        size: true,
        isCheckpoint: true,
        author: { select: { id: true, name: true, avatarUrl: true } },
      },
    });
  }

  async getRevision(projectId: string, noteId: string, revisionId: string) {
    await this.get(projectId, noteId);
    const rev = await this.prisma.noteRevision.findFirst({
      where: { id: revisionId, noteId },
    });
    if (!rev) throw new NotFoundException('Revision not found.');
    return rev;
  }

  /** Roll the live contentSnapshot back to a chosen revision. Records a
   *  NEW revision so the rollback itself is undoable via "restore the
   *  most recent pre-rollback revision". Note: this writes the JSON
   *  projection only — collaborative Yjs state continues from wherever
   *  it is, which for single-user notes converges immediately and for
   *  multi-user notes converges on next snapshot. */
  async restoreRevision(
    projectId: string,
    noteId: string,
    revisionId: string,
    actorId: string,
  ) {
    const rev = await this.getRevision(projectId, noteId, revisionId);
    const size = Buffer.byteLength(JSON.stringify(rev.contentSnapshot ?? null));
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.projectNote.update({
        where: { id: noteId },
        data: { contentSnapshot: rev.contentSnapshot as Prisma.InputJsonValue },
      });
      await tx.noteRevision.create({
        data: {
          noteId,
          contentSnapshot: rev.contentSnapshot as Prisma.InputJsonValue,
          size,
          authorId: actorId,
        },
      });
      return updated;
    });
  }

  /** Soft-delete a note and its whole live descendant subtree. */
  async remove(projectId: string, noteId: string) {
    await this.get(projectId, noteId);
    const subtree = await this.collectSubtree(projectId, noteId);
    await this.prisma.projectNote.updateMany({
      where: { id: { in: subtree }, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return { deleted: true, count: subtree.length };
  }

  // ── helpers ──────────────────────────────────────────────────────────

  private async assertNote(projectId: string, noteId: string): Promise<void> {
    const note = await this.prisma.projectNote.findFirst({
      where: { id: noteId, projectId, deletedAt: null },
      select: { id: true },
    });
    if (!note) throw new NotFoundException('Parent note not found.');
  }

  /** Walk up from candidate; true if folderId/noteId is encountered (would form a cycle). */
  private async isDescendant(
    projectId: string,
    noteId: string,
    candidateId: string,
  ): Promise<boolean> {
    let current: string | null = candidateId;
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      if (current === noteId) return true;
      seen.add(current);
      const parent: { parentNoteId: string | null } | null =
        await this.prisma.projectNote.findFirst({
          where: { id: current, projectId },
          select: { parentNoteId: true },
        });
      current = parent?.parentNoteId ?? null;
    }
    return false;
  }

  private async assertParentDepth(projectId: string, parentId: string): Promise<void> {
    let depth = 1; // the new/moved note sits one below the parent
    let current: string | null = parentId;
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      depth += 1;
      seen.add(current);
      const parent: { parentNoteId: string | null } | null =
        await this.prisma.projectNote.findFirst({
          where: { id: current, projectId },
          select: { parentNoteId: true },
        });
      current = parent?.parentNoteId ?? null;
    }
    if (depth > MAX_DEPTH) {
      throw new BadRequestException(`Notes can be nested at most ${MAX_DEPTH} levels deep.`);
    }
  }

  private async collectSubtree(projectId: string, rootId: string): Promise<string[]> {
    const ids = [rootId];
    let parents = [rootId];
    const seen = new Set<string>([rootId]);
    while (parents.length) {
      const children = await this.prisma.projectNote.findMany({
        where: { projectId, parentNoteId: { in: parents }, deletedAt: null },
        select: { id: true },
      });
      const next: string[] = [];
      for (const child of children) {
        if (seen.has(child.id)) continue;
        seen.add(child.id);
        ids.push(child.id);
        next.push(child.id);
      }
      parents = next;
    }
    return ids;
  }
}
