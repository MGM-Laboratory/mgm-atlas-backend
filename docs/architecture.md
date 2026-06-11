# Architecture deep-dive

Companion to the [README architecture overview](../README.md#-architecture) — this page covers the internals that don't fit a front page. Paths are relative to `src/`.

## Request lifecycle

Every HTTP request passes through, in order:

1. **Helmet + compression** — security headers (CSP off for API responses, cross-origin resource policy relaxed for media), gzip.
2. **CORS** — origins from `CORS_ORIGINS` (comma-separated).
3. **Throttler guard** (global) — `THROTTLE_LIMIT` requests per `THROTTLE_TTL` seconds (default 120/60 s).
4. **Auth guard** (global) — looks up the bearer session UUID in the `Session` table; `@Public()` routes opt out. See [Authentication](../README.md#-authentication) for the full flow.
5. **Validation pipe** (global) — `whitelist` + `forbidNonWhitelisted` + `transform`: unknown body fields are a `400`, not a silent drop.
6. Controller → service → Prisma. Exceptions are normalized by a global `HttpExceptionFilter`; a `LoggingInterceptor` times every request.

Environment variables are validated at boot (`config/`); a missing required variable fails fast instead of failing at first use.

## Access control layers

| Layer | Mechanism | Failure mode |
|---|---|---|
| Session | Global auth guard, `@Public()` opt-out | `401` |
| Project role | `ProjectRoleGuard` + `@RequireProjectRole(…)` — `PROJECT_MANAGER` vs `CONTRIBUTOR` | `403` |
| Visibility | `PUBLIC` projects readable by anyone signed in; `PRIVATE` members-only | `404`-style hiding |
| Admin | `isAdmin` flag checks on curation/config endpoints | `403` |
| Feature flags | `PmoFeatureFlagGuard` / `VoiceFeatureFlagGuard` consult `PMO_ENABLED` / `VOICE_ENABLED` | `503` while disabled |

The feature-flag guards are what make "dark shipping" possible: the modules load, migrations apply, but every route answers `503` until the deployment flips the flag.

## Chat internals

- **Gateway rooms** — clients join `project:{projectId}` (channel CRUD + unread fanout) and `channel:{channelId}` (message events). Handshake auth carries the session ID; invalid tokens are disconnected immediately.
- **Typing indicators** are TTL-based in-memory presence — deliberately not persisted.
- **Unread tracking** — `ChatChannelMember.lastReadAt` + `lastReadMessageId`, advanced by `POST …/read`.
- **Link previews** — `ChatLinkPreview` caches Open Graph scrapes keyed by `sha256(url)` with a TTL (`CHAT_LINK_PREVIEW_CACHE_TTL`, default 24 h).
- **Search** — a raw-SQL migration adds a `tsvector` column + GIN index over message markdown; `GET /chat/search` queries it with scope filters.
- **Mentions** — `@username` detection on message create produces `CHAT_MENTION` notifications (which support inline quick-reply from the push notification).
- **Edits & deletes** — edits allowed within `CHAT_EDIT_WINDOW_HOURS` (default 24); deletes are soft (`deletedAt`, `deletedActor` = `SELF` | `MODERATOR`).
- **Workspace-global channels** — `ChatChannel.projectId = NULL`; a partial unique index keeps one `#general` per scope.

## PMO internals

### Server-backed undo/redo

Mutations that support undo write an `UndoEntry` containing both a `forwardOp` and an `inverseOp` (JSON). `POST /pmo/undo` pops the actor's most recent entry with `undoneAt = NULL`, replays the `inverseOp` **through the normal services** (so activity logs, notifications, and sockets all fire), and stamps `undoneAt`. Redo flips polarity. Because the log is in PostgreSQL, undo survives reloads and works across devices.

### Revisions & pruning

Notes, whiteboards, and their Yjs binary states keep revision rows (`NoteRevision`, `WhiteboardRevision`, `YDocSnapshotRevision`). An hourly pruner keeps the **most recent 50 ad-hoc revisions** plus **one checkpoint per hour** indefinitely, bounding table growth without losing history shape.

### Scheduling

An hourly scanner emits `TASK_DUE_SOON` and `TASK_OVERDUE` notifications from `Task.dueDate`. Both this and the pruner are plain interval timers owned by their services — no external job queue to operate.

### Task keys

`Task.key` (`PROJ-42`) comes from `TaskList.taskCounter`, incremented with an atomic `UPDATE … RETURNING`, so concurrent creates can't collide.

## Yjs collaboration flow

```
Browser ⇄ y-websocket sidecar ⇄ backend (internal endpoints)
```

1. Browser connects to the y-websocket sidecar with a doc key (`note:<id>` / `whiteboard:<id>`).
2. The sidecar calls `POST /pmo/internal/yjs/authorize` (shared `YJS_INTERNAL_AUTH_SECRET`) to check the user may join that doc.
3. Edits sync CRDT-style between clients; the sidecar debounces (`YJS_SNAPSHOT_DEBOUNCE_MS`, default 30 s) and posts the binary state to `POST /pmo/internal/yjs/snapshot`, stored in `YDocSnapshot` with a version counter.
4. A JSON projection (`contentSnapshot` / `sceneSnapshot`) is kept alongside the binary state — it powers read-only rendering and acts as a recovery source if a Yjs doc ever comes back empty.

If the sidecar is unreachable, editors degrade to single-editor mode against the JSON projection — collaboration is an enhancement, not a dependency.

## Webhook delivery

Outbound events (contribution lifecycle, invites, member removal) are signed with HMAC-SHA256 in the `x-atlas-signature` header and posted to n8n, which owns email composition. Every attempt is a `WebhookDelivery` row (event, payload, status, response body, attempt counter, `succeeded`, `completedAt`) — failed deliveries are visible and retryable rather than silently lost.

Inbound, `POST /webhooks/livekit` receives LiveKit egress lifecycle events and updates `VoiceRecording` (status `PENDING → RUNNING → COMPLETED/FAILED`, S3 key, duration, retention date).

## Voice internals

- **Join** — `POST /voice/channels/:id/join` validates access + capacity, mints a LiveKit room JWT (TTL `VOICE_JWT_TTL_SECONDS`, default 4 h), and records a `VoiceParticipant` row. `leftAt = NULL` means "currently connected", which is how lobby occupancy and channel rosters are computed without polling the SFU.
- **Stage channels** — `kind = STAGE` channels default participants to `AUDIENCE`; `handRaisedAt` (indexed) forms the speaking queue; moderators promote to `SPEAKER`.
- **Moderation** — force-mute (`mutedByMod`), kick, and move are REST + gateway events; the client enforces against the SFU.
- **Recordings** — moderator-initiated composite egress to S3 with a retention window (`VOICE_RECORDING_RETENTION_DAYS`).
- **Text threads** — each voice channel can pair with a hidden `ChatChannel` (`isVoiceThread = true`) for side conversation.

## Notification fanout

One event, three deliveries, all best-effort independent:

1. **Database row** (`Notification`) — the source of truth the inbox paginates.
2. **Socket** — emitted to the `/notifications` namespace, room `user:{userId}` (multi-tab safe).
3. **Web push** — sent to every registered `PushSubscription` if VAPID keys are configured; per-user `NotificationPreference` (master switch + per-type toggles) is honored before any delivery.
