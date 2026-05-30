-- Voice chat Phase 0 — additive only.
-- Adds VoiceChannel / VoiceParticipant / VoiceSoundboardClip tables,
-- VoiceAudioQuality enum, and two new NotificationType enum values.
-- No drops, no NOT NULL on existing tables, no type changes. The previous
-- backend image continues to work against this schema (rollback path).

-- CreateEnum
CREATE TYPE "VoiceAudioQuality" AS ENUM ('LOW', 'STANDARD', 'HIGH');

-- AlterEnum (additive)
ALTER TYPE "NotificationType" ADD VALUE 'VOICE_PARTICIPANT_JOINED';
ALTER TYPE "NotificationType" ADD VALUE 'VOICE_MENTIONED';

-- CreateTable
CREATE TABLE "VoiceChannel" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "topic" TEXT,
    "userLimit" INTEGER,
    "audioQuality" "VoiceAudioQuality" NOT NULL DEFAULT 'STANDARD',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortIndex" INTEGER NOT NULL DEFAULT 0,
    "permissions" JSONB NOT NULL DEFAULT '{}',
    "textThreadId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "VoiceChannel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VoiceChannel_textThreadId_key" ON "VoiceChannel"("textThreadId");

-- CreateIndex
CREATE INDEX "VoiceChannel_projectId_archivedAt_idx" ON "VoiceChannel"("projectId", "archivedAt");

-- CreateIndex
CREATE INDEX "VoiceChannel_projectId_sortIndex_idx" ON "VoiceChannel"("projectId", "sortIndex");

-- AddForeignKey
ALTER TABLE "VoiceChannel" ADD CONSTRAINT "VoiceChannel_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceChannel" ADD CONSTRAINT "VoiceChannel_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceChannel" ADD CONSTRAINT "VoiceChannel_textThreadId_fkey" FOREIGN KEY ("textThreadId") REFERENCES "ChatChannel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "VoiceParticipant" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "livekitSid" TEXT,
    "mutedByMod" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "VoiceParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VoiceParticipant_channelId_leftAt_idx" ON "VoiceParticipant"("channelId", "leftAt");

-- CreateIndex
CREATE INDEX "VoiceParticipant_userId_leftAt_idx" ON "VoiceParticipant"("userId", "leftAt");

-- AddForeignKey
ALTER TABLE "VoiceParticipant" ADD CONSTRAINT "VoiceParticipant_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "VoiceChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceParticipant" ADD CONSTRAINT "VoiceParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "VoiceSoundboardClip" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoiceSoundboardClip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VoiceSoundboardClip_uploadedById_idx" ON "VoiceSoundboardClip"("uploadedById");

-- AddForeignKey
ALTER TABLE "VoiceSoundboardClip" ADD CONSTRAINT "VoiceSoundboardClip_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
