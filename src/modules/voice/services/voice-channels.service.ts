import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';

/**
 * Voice-channel CRUD service. Phase 0 only exposes the helpers needed by
 * ProjectsService (auto-create default channel on project creation) and
 * the backfill seed. Full CRUD surface lands in Phase 1.
 */
@Injectable()
export class VoiceChannelsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create the default voice channel for a project, inside an existing
   * Prisma transaction. Idempotent at the application layer: the caller
   * is expected to only invoke this once per project. The DB doesn't
   * enforce uniqueness on "default" because future phases may allow
   * additional defaults (e.g. an AFK channel).
   */
  async createDefaultForProject(
    tx: Prisma.TransactionClient | PrismaClient,
    args: { projectId: string; createdById: string; name?: string },
  ) {
    return tx.voiceChannel.create({
      data: {
        projectId: args.projectId,
        name: args.name ?? 'General Voice',
        isDefault: true,
        sortIndex: 0,
        createdById: args.createdById,
      },
    });
  }

  /**
   * Idempotent backfill helper used by `prisma/seeds/voice-backfill.ts`.
   * Skips projects that already have at least one voice channel.
   */
  async ensureDefaultForExistingProjects(args: { systemUserId: string }) {
    const projects = await this.prisma.project.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        ownerId: true,
        voiceChannels: { select: { id: true }, take: 1 },
      },
    });
    let created = 0;
    for (const p of projects) {
      if (p.voiceChannels.length > 0) continue;
      await this.prisma.voiceChannel.create({
        data: {
          projectId: p.id,
          name: 'General Voice',
          isDefault: true,
          sortIndex: 0,
          // Prefer the project owner; fall back to the system user when
          // owner is missing (shouldn't happen but keeps the script safe).
          createdById: p.ownerId ?? args.systemUserId,
        },
      });
      created++;
    }
    return { scanned: projects.length, created };
  }
}
