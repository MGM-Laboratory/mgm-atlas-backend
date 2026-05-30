-- Voice chat Phase 7 — additive only.
--
-- Adds:
--   • VoiceUserPreferences.soundsEnabled (defaults true) for the
--     join/leave/mute chimes.
--   • VoiceRecordingStatus enum.
--   • VoiceRecording table — one row per egress request, lifecycle
--     driven by LiveKit's egress_started / egress_ended webhooks.
--
-- Rollback path: the previous backend image ignores the new column
-- and the new table — nothing breaks if we roll back.

-- AlterTable
ALTER TABLE "VoiceUserPreferences" ADD COLUMN "soundsEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateEnum
CREATE TYPE "VoiceRecordingStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "VoiceRecording" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "startedByUserId" TEXT NOT NULL,
    "egressId" TEXT NOT NULL,
    "status" "VoiceRecordingStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "s3Key" TEXT,
    "durationSec" INTEGER,
    "sizeBytes" BIGINT,
    "retentionUntil" TIMESTAMP(3),
    "errorMessage" TEXT,

    CONSTRAINT "VoiceRecording_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VoiceRecording_egressId_key" ON "VoiceRecording"("egressId");

-- CreateIndex
CREATE INDEX "VoiceRecording_channelId_startedAt_idx" ON "VoiceRecording"("channelId", "startedAt");

-- CreateIndex
CREATE INDEX "VoiceRecording_status_idx" ON "VoiceRecording"("status");

-- CreateIndex
CREATE INDEX "VoiceRecording_retentionUntil_idx" ON "VoiceRecording"("retentionUntil");

-- AddForeignKey
ALTER TABLE "VoiceRecording" ADD CONSTRAINT "VoiceRecording_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "VoiceChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceRecording" ADD CONSTRAINT "VoiceRecording_startedByUserId_fkey" FOREIGN KEY ("startedByUserId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
