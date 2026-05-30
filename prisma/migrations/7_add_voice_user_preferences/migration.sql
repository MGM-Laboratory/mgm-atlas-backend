-- Voice chat Phase 3 — additive only.
-- Adds VoiceUserPreferences (1:1 with User) for per-user voice
-- settings (input mode, PTT, audio cleanup, devices, volumes,
-- keyboard shortcuts), plus the VoiceInputMode enum.
-- Rollback path: previous backend image still boots — the table is
-- untouched on writes/reads from older code.

-- CreateEnum
CREATE TYPE "VoiceInputMode" AS ENUM ('VOICE_ACTIVITY', 'PUSH_TO_TALK');

-- CreateTable
CREATE TABLE "VoiceUserPreferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "inputMode" "VoiceInputMode" NOT NULL DEFAULT 'VOICE_ACTIVITY',
    "pttKey" TEXT,
    "pttReleaseMs" INTEGER NOT NULL DEFAULT 150,
    "noiseSuppression" BOOLEAN NOT NULL DEFAULT true,
    "echoCancellation" BOOLEAN NOT NULL DEFAULT true,
    "autoGainControl" BOOLEAN NOT NULL DEFAULT true,
    "micDeviceId" TEXT,
    "cameraDeviceId" TEXT,
    "outputDeviceId" TEXT,
    "micVolume" INTEGER NOT NULL DEFAULT 100,
    "outputVolume" INTEGER NOT NULL DEFAULT 100,
    "shortcutMute" TEXT DEFAULT 'ctrl+shift+m',
    "shortcutDeafen" TEXT DEFAULT 'ctrl+shift+d',
    "shortcutDisconnect" TEXT DEFAULT 'ctrl+shift+h',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoiceUserPreferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VoiceUserPreferences_userId_key" ON "VoiceUserPreferences"("userId");

-- AddForeignKey
ALTER TABLE "VoiceUserPreferences" ADD CONSTRAINT "VoiceUserPreferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
