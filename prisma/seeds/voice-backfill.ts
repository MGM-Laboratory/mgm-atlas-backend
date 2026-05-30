/**
 * Idempotent backfill: ensures every existing Project has at least one
 * VoiceChannel (its "General Voice" default). Safe to re-run — skips any
 * project that already owns one or more voice channels.
 *
 * Manual run only (not wired into `pnpm prisma:seed`). Invoke once after
 * Phase 0 deploys and VOICE_ENABLED has been flipped on for the env:
 *
 *   pnpm ts-node --transpile-only prisma/seeds/voice-backfill.ts
 *
 * Re-running is harmless; this is intentional so it can be safely re-run
 * if a deploy is rolled back and rolled forward.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const projects = await prisma.project.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      slug: true,
      ownerId: true,
      voiceChannels: { select: { id: true }, take: 1 },
    },
  });

  let created = 0;
  for (const p of projects) {
    if (p.voiceChannels.length > 0) {
      continue;
    }
    await prisma.voiceChannel.create({
      data: {
        projectId: p.id,
        name: 'General Voice',
        isDefault: true,
        sortIndex: 0,
        createdById: p.ownerId,
      },
    });
    created++;
    console.log(`[voice-backfill] created default channel for ${p.slug}`);
  }

  console.log(`[voice-backfill] done. scanned=${projects.length} created=${created}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
