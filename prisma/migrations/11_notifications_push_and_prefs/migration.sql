-- Notifications Phase 1 — additive only.
-- Adds Web Push infrastructure and per-user notification preferences:
--   • PushSubscription — one row per (user, browser endpoint). Same
--     user can subscribe from multiple devices. Endpoint is globally
--     unique so the same browser re-subscribing collapses to one row.
--   • NotificationPreference — one row per user (lazily created on
--     first read with all-true defaults). Master pushEnabled switch
--     plus per-NotificationType toggles.
-- Rollback path: previous backend image ignores both tables. Production
-- behaviour is unchanged when VAPID_* env vars are empty (push
-- dispatch becomes a no-op; in-app notifications keep working).

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pushEnabled" BOOLEAN NOT NULL DEFAULT true,
    "contributionRequestEnabled" BOOLEAN NOT NULL DEFAULT true,
    "projectInvitedEnabled" BOOLEAN NOT NULL DEFAULT true,
    "projectRoleChangedEnabled" BOOLEAN NOT NULL DEFAULT true,
    "projectRemovedEnabled" BOOLEAN NOT NULL DEFAULT true,
    "chatMentionEnabled" BOOLEAN NOT NULL DEFAULT true,
    "taskAssignedEnabled" BOOLEAN NOT NULL DEFAULT true,
    "taskMentionedEnabled" BOOLEAN NOT NULL DEFAULT true,
    "taskDueSoonEnabled" BOOLEAN NOT NULL DEFAULT true,
    "taskOverdueEnabled" BOOLEAN NOT NULL DEFAULT true,
    "taskCommentReplyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "taskStatusChangedEnabled" BOOLEAN NOT NULL DEFAULT true,
    "taskDependencyBlockedEnabled" BOOLEAN NOT NULL DEFAULT true,
    "noteMentionedEnabled" BOOLEAN NOT NULL DEFAULT true,
    "whiteboardMentionedEnabled" BOOLEAN NOT NULL DEFAULT true,
    "voiceParticipantJoinedEnabled" BOOLEAN NOT NULL DEFAULT true,
    "voiceMentionedEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_key" ON "NotificationPreference"("userId");

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
