-- Chat pin note — additive nullable column.
--
-- Lets managers attach a short context note when pinning a message
-- (e.g. "decision recorded here", "shared with leadership"). Surfaces
-- in the pin panel under each entry.
--
-- Defaults to NULL so existing rows stay untouched; no backfill needed.
-- Safe to deploy against a populated production database.

ALTER TABLE "ChatPinned" ADD COLUMN "note" TEXT;
