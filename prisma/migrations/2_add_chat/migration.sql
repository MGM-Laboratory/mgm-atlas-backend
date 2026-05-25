-- Atlas realtime chat — additive migration.
-- Hard rules: no ALTER on existing columns, no drops, no renames.
-- Everything in this file is new schema or new rows. Safe to deploy
-- against a populated production database.

-- Needed for gen_random_uuid() in the #general backfill on PG < 13.
-- No-op on PG >= 13 (the function is in core) and on environments
-- where the extension is already enabled.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── Enums ───────────────────────────────────────────────────────────────

CREATE TYPE "ChatMessageKind" AS ENUM (
  'TEXT',
  'SYSTEM_CHANNEL_CREATED',
  'SYSTEM_CHANNEL_RENAMED',
  'SYSTEM_PINNED'
);

CREATE TYPE "ChatAttachmentKind" AS ENUM ('IMAGE', 'VIDEO', 'AUDIO', 'FILE');

CREATE TYPE "ChatDeleteActor" AS ENUM ('SELF', 'MODERATOR');

-- Add the new value to the existing NotificationType enum. Postgres
-- allows ADD VALUE without rewriting the column.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CHAT_MENTION';

-- ─── ChatChannel ─────────────────────────────────────────────────────────

CREATE TABLE "ChatChannel" (
  "id"          TEXT NOT NULL,
  "projectId"   TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "slug"        TEXT NOT NULL,
  "topic"       TEXT,
  "isGeneral"   BOOLEAN NOT NULL DEFAULT false,
  "isArchived"  BOOLEAN NOT NULL DEFAULT false,
  "createdById" TEXT NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  "archivedAt"  TIMESTAMP(3),

  CONSTRAINT "ChatChannel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChatChannel_projectId_name_key"
  ON "ChatChannel" ("projectId", "name");

CREATE INDEX "ChatChannel_projectId_isArchived_idx"
  ON "ChatChannel" ("projectId", "isArchived");

-- Enforce one #general per project at the DB level. Prisma can't model
-- partial indexes so this is raw SQL.
CREATE UNIQUE INDEX "ChatChannel_one_general_per_project"
  ON "ChatChannel" ("projectId") WHERE "isGeneral" = true;

ALTER TABLE "ChatChannel"
  ADD CONSTRAINT "ChatChannel_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChatChannel"
  ADD CONSTRAINT "ChatChannel_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── ChatChannelMember (lazy-created per (channel, user)) ────────────────

CREATE TABLE "ChatChannelMember" (
  "id"                TEXT NOT NULL,
  "channelId"         TEXT NOT NULL,
  "userId"            TEXT NOT NULL,
  "lastReadAt"        TIMESTAMP(3),
  "lastReadMessageId" TEXT,
  "muted"             BOOLEAN NOT NULL DEFAULT false,
  "joinedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ChatChannelMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChatChannelMember_channelId_userId_key"
  ON "ChatChannelMember" ("channelId", "userId");

CREATE INDEX "ChatChannelMember_userId_channelId_idx"
  ON "ChatChannelMember" ("userId", "channelId");

ALTER TABLE "ChatChannelMember"
  ADD CONSTRAINT "ChatChannelMember_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "ChatChannel"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChatChannelMember"
  ADD CONSTRAINT "ChatChannelMember_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── ChatMessage ─────────────────────────────────────────────────────────

CREATE TABLE "ChatMessage" (
  "id"              TEXT NOT NULL,
  "channelId"       TEXT NOT NULL,
  "authorId"        TEXT NOT NULL,
  "kind"            "ChatMessageKind" NOT NULL DEFAULT 'TEXT',
  "markdown"        TEXT NOT NULL,
  "replyToId"       TEXT,
  "forwardedFromId" TEXT,
  "editedAt"        TIMESTAMP(3),
  "deletedAt"       TIMESTAMP(3),
  "deletedByUserId" TEXT,
  "deletedActor"    "ChatDeleteActor",
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChatMessage_channelId_createdAt_idx"
  ON "ChatMessage" ("channelId", "createdAt");

CREATE INDEX "ChatMessage_authorId_createdAt_idx"
  ON "ChatMessage" ("authorId", "createdAt");

ALTER TABLE "ChatMessage"
  ADD CONSTRAINT "ChatMessage_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "ChatChannel"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChatMessage"
  ADD CONSTRAINT "ChatMessage_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ChatMessage"
  ADD CONSTRAINT "ChatMessage_deletedByUserId_fkey"
  FOREIGN KEY ("deletedByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ChatMessage"
  ADD CONSTRAINT "ChatMessage_replyToId_fkey"
  FOREIGN KEY ("replyToId") REFERENCES "ChatMessage"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ChatMessage"
  ADD CONSTRAINT "ChatMessage_forwardedFromId_fkey"
  FOREIGN KEY ("forwardedFromId") REFERENCES "ChatMessage"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Postgres full-text search (tsvector + trigger + GIN) ────────────────
-- Stored generated column avoids drift and keeps writes simple; pg_trgm
-- isn't needed because we want phrase/token search, not fuzzy.

ALTER TABLE "ChatMessage"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce("markdown", ''))) STORED;

CREATE INDEX "ChatMessage_searchVector_idx"
  ON "ChatMessage" USING GIN ("searchVector");

-- ─── ChatAttachment ──────────────────────────────────────────────────────

CREATE TABLE "ChatAttachment" (
  "id"          TEXT NOT NULL,
  "messageId"   TEXT NOT NULL,
  "kind"        "ChatAttachmentKind" NOT NULL,
  "url"         TEXT NOT NULL,
  "s3Key"       TEXT NOT NULL,
  "mime"        TEXT NOT NULL,
  "bytes"       INTEGER NOT NULL,
  "width"       INTEGER,
  "height"      INTEGER,
  "durationSec" DOUBLE PRECISION,
  "posterUrl"   TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ChatAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChatAttachment_messageId_idx"
  ON "ChatAttachment" ("messageId");

ALTER TABLE "ChatAttachment"
  ADD CONSTRAINT "ChatAttachment_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── ChatReaction ────────────────────────────────────────────────────────

CREATE TABLE "ChatReaction" (
  "id"        TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "emoji"     TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ChatReaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChatReaction_messageId_userId_emoji_key"
  ON "ChatReaction" ("messageId", "userId", "emoji");

CREATE INDEX "ChatReaction_messageId_idx"
  ON "ChatReaction" ("messageId");

ALTER TABLE "ChatReaction"
  ADD CONSTRAINT "ChatReaction_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChatReaction"
  ADD CONSTRAINT "ChatReaction_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── ChatPinned ──────────────────────────────────────────────────────────

CREATE TABLE "ChatPinned" (
  "id"         TEXT NOT NULL,
  "channelId"  TEXT NOT NULL,
  "messageId"  TEXT NOT NULL,
  "pinnedById" TEXT NOT NULL,
  "position"   INTEGER NOT NULL DEFAULT 0,
  "pinnedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ChatPinned_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChatPinned_channelId_messageId_key"
  ON "ChatPinned" ("channelId", "messageId");

CREATE INDEX "ChatPinned_channelId_position_idx"
  ON "ChatPinned" ("channelId", "position");

ALTER TABLE "ChatPinned"
  ADD CONSTRAINT "ChatPinned_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "ChatChannel"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChatPinned"
  ADD CONSTRAINT "ChatPinned_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChatPinned"
  ADD CONSTRAINT "ChatPinned_pinnedById_fkey"
  FOREIGN KEY ("pinnedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── ChatLinkPreview (cached OG metadata, L2) ────────────────────────────

CREATE TABLE "ChatLinkPreview" (
  "id"          TEXT NOT NULL,
  "urlHash"     TEXT NOT NULL,
  "url"         TEXT NOT NULL,
  "title"       TEXT,
  "description" TEXT,
  "imageUrl"    TEXT,
  "siteName"    TEXT,
  "embedHtml"   TEXT,
  "kind"        TEXT NOT NULL DEFAULT 'link',
  "fetchedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ChatLinkPreview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChatLinkPreview_urlHash_key"
  ON "ChatLinkPreview" ("urlHash");

CREATE INDEX "ChatLinkPreview_expiresAt_idx"
  ON "ChatLinkPreview" ("expiresAt");

-- ─── StickerPack / Sticker (admin-managed) ───────────────────────────────

CREATE TABLE "StickerPack" (
  "id"          TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "slug"        TEXT NOT NULL,
  "description" TEXT,
  "isArchived"  BOOLEAN NOT NULL DEFAULT false,
  "createdById" TEXT NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "StickerPack_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StickerPack_slug_key" ON "StickerPack" ("slug");
CREATE INDEX "StickerPack_isArchived_idx" ON "StickerPack" ("isArchived");

ALTER TABLE "StickerPack"
  ADD CONSTRAINT "StickerPack_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "Sticker" (
  "id"        TEXT NOT NULL,
  "packId"    TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "keywords"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "s3Key"     TEXT NOT NULL,
  "url"       TEXT NOT NULL,
  "mime"      TEXT NOT NULL,
  "width"     INTEGER,
  "height"    INTEGER,
  "position"  INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Sticker_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Sticker_packId_position_idx" ON "Sticker" ("packId", "position");
CREATE INDEX "Sticker_keywords_idx" ON "Sticker" USING GIN ("keywords");

ALTER TABLE "Sticker"
  ADD CONSTRAINT "Sticker_packId_fkey"
  FOREIGN KEY ("packId") REFERENCES "StickerPack"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Backfill #general for every existing project ────────────────────────
-- Idempotent: re-running this migration (or its INSERT) skips any
-- project that already has a general channel. Uses the project owner
-- as the channel creator so the FK is satisfied without seed data.

INSERT INTO "ChatChannel" (
  "id", "projectId", "name", "slug", "isGeneral",
  "isArchived", "createdById", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  p."id",
  'general',
  'general',
  true,
  false,
  p."ownerId",
  NOW(),
  NOW()
FROM "Project" p
WHERE p."deletedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "ChatChannel" c
    WHERE c."projectId" = p."id" AND c."isGeneral" = true
  );
