-- Voice chat Phase 8 — additive only.
-- Adds stage channel support:
--   • VoiceChannelKind enum (STANDARD default for back-compat).
--   • VoiceChannel.kind column — STANDARD or STAGE.
--   • VoiceParticipantRole enum (SPEAKER default).
--   • VoiceParticipant.role column — SPEAKER for STANDARD channels;
--     AUDIENCE for non-mods joining STAGE channels.
--   • VoiceParticipant.handRaisedAt column + index — for the queue
--     query in stage moderation.
-- Rollback path: previous backend image ignores all new fields.

-- CreateEnum
CREATE TYPE "VoiceChannelKind" AS ENUM ('STANDARD', 'STAGE');

-- CreateEnum
CREATE TYPE "VoiceParticipantRole" AS ENUM ('SPEAKER', 'AUDIENCE');

-- AlterTable
ALTER TABLE "VoiceChannel" ADD COLUMN "kind" "VoiceChannelKind" NOT NULL DEFAULT 'STANDARD';

-- AlterTable
ALTER TABLE "VoiceParticipant" ADD COLUMN "role" "VoiceParticipantRole" NOT NULL DEFAULT 'SPEAKER',
ADD COLUMN "handRaisedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "VoiceParticipant_channelId_handRaisedAt_idx" ON "VoiceParticipant"("channelId", "handRaisedAt");
