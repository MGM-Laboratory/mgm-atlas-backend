-- Workspace global chat — additive only.
-- ChatChannel.projectId becomes nullable (NULL = workspace-global channel,
-- mirroring VoiceChannel.projectId). No existing rows change. Global rows
-- (the workspace #general, lobby voice text threads) are lazy-ensured in
-- application code, never backfilled here.
--
-- Rollback path: the previous backend image never surfaces NULL-projectId
-- rows through its normal queries (channel lists, overview and search are
-- all project-scoped), so project chat keeps working unchanged. Direct
-- by-id reads of a global channel/message on the old image fail with a
-- Prisma P2032 (500 instead of 404) — only reachable from the new
-- frontend, so roll both repos back together.

-- AlterTable
ALTER TABLE "ChatChannel" ALTER COLUMN "projectId" DROP NOT NULL;

-- Postgres treats NULLs as distinct in ChatChannel_projectId_name_key, so
-- global channel names need their own uniqueness. Also makes the lazy
-- ensure-#general path concurrency-safe (P2002 on the loser). Prisma can't
-- model partial indexes so these are raw SQL (same pattern as
-- ChatChannel_one_general_per_project in 2_add_chat).
CREATE UNIQUE INDEX "ChatChannel_global_name_key"
  ON "ChatChannel" ("name") WHERE "projectId" IS NULL;

-- At most one workspace-global #general.
CREATE UNIQUE INDEX "ChatChannel_one_general_global"
  ON "ChatChannel" ("isGeneral") WHERE "isGeneral" = true AND "projectId" IS NULL;

-- At most one default lobby voice channel ("Voice Lobby"), making its lazy
-- ensure concurrency-safe too. Safe to add: createLobby has always written
-- isDefault = false, so no existing row can violate this.
CREATE UNIQUE INDEX "VoiceChannel_one_default_lobby"
  ON "VoiceChannel" ("isDefault") WHERE "projectId" IS NULL AND "isDefault" = true;
