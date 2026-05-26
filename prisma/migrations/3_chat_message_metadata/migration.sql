-- Chat message metadata — additive nullable JSONB column.
--
-- Used to persist sender-side render metadata that doesn't fit the
-- core message shape:
--   { linkPreviews: Array<{ url, kind, title?, description?, imageUrl?,
--                           siteName?, embedHtml? }> }
--
-- Defaults to NULL so existing rows stay untouched; no backfill needed.
-- Safe to deploy against a populated production database.

ALTER TABLE "ChatMessage" ADD COLUMN "metadata" JSONB;
