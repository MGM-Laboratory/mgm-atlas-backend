-- Voice chat Phase 4 — additive only.
-- Adds the isVoiceThread flag to ChatChannel so voice-channel-paired
-- text threads can be hidden from the regular project text-channel
-- list while reusing the entire ChatChannel/ChatMessage/etc stack.
-- Rollback path: the previous backend image ignores the flag and
-- continues to work; new rows from the new code default to false.

-- AlterTable
ALTER TABLE "ChatChannel" ADD COLUMN "isVoiceThread" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "ChatChannel_projectId_isVoiceThread_idx" ON "ChatChannel"("projectId", "isVoiceThread");
