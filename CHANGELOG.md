# Changelog

All notable changes to the MGM Atlas backend are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Pre-1.0, minor versions may contain breaking changes.

## [0.1.1](https://github.com/MGM-Laboratory/mgm-atlas-backend/compare/v0.1.0...v0.1.1) (2026-06-11)


### Features

* built-in feature flags (Phase 5, backend) ([4381ed7](https://github.com/MGM-Laboratory/mgm-atlas-backend/commit/4381ed7edcdb87fa7d81bb6d501f56c760589532))
* **feature-flags:** DB-backed runtime flags + admin CRUD + public eval ([9fcd1d4](https://github.com/MGM-Laboratory/mgm-atlas-backend/commit/9fcd1d41346a44d1a9a0f0b9c5ef835b021691b2))
* observability — Prometheus metrics + Sentry/GlitchTip (Phase 7, backend) ([448164e](https://github.com/MGM-Laboratory/mgm-atlas-backend/commit/448164eb4ad1af1b7c65fbaf916a7df1ed9eced9))
* **observability:** Prometheus metrics + Sentry/GlitchTip SDK (ships dark) ([71fef10](https://github.com/MGM-Laboratory/mgm-atlas-backend/commit/71fef10610704857315912fc71b584efdaf11715))


### Bug Fixes

* **auth:** verify Keycloak tokens on login (P0 — stop trusting client-supplied identity) ([3285683](https://github.com/MGM-Laboratory/mgm-atlas-backend/commit/3285683e32cfa6e9ee5a05ebaa1b053fb70a0d9a))
* **auth:** verify Keycloak tokens on login instead of trusting client claims ([dc3eccc](https://github.com/MGM-Laboratory/mgm-atlas-backend/commit/dc3eccc46886b95b3a3d1de7c3cea5d841b6fb8f))

## [Unreleased]

## [0.1.0] - 2026-06-11

First tracked release — everything currently powering [atlas.labmgm.org](https://atlas.labmgm.org).

### Added

- **Portfolio & discovery** — project CRUD with slugs, phases, visibility, tech
  stacks, internal links; Netflix-style discovery and featured curation;
  bookmarks and a personal dashboard (managing / contributing / pending / saved).
- **Auth & sessions** — Keycloak OIDC login exchange (`POST /auth/login`) with
  DB-backed opaque sessions; bootstrap admin promotion via
  `BOOTSTRAP_ADMIN_EMAIL`; project role guards and admin gates.
- **Media** — S3 presigned direct uploads with MIME/size allowlists,
  thumbnail ordering, and fractional-index reordering.
- **Contributions & team** — request-to-join workflow with approval notes,
  invites, role management against 12 seeded collaboration roles.
- **Chat** — project channels + workspace-global channels, reactions, pins,
  forwarding, 24-hour edit window, soft deletes, attachments via S3, GIF search
  (Tenor/Giphy), admin sticker packs, cached link previews, Postgres full-text
  search, @mention notifications, Socket.IO `/chat` gateway with optional
  Redis adapter.
- **PMO** *(feature-flagged via `PMO_ENABLED`)* — task lists with custom
  statuses, priorities, story points, dependencies, fractional kanban ordering,
  auto-numbered task keys; comments with mentions; hierarchical files;
  collaborative notes (BlockNote) and whiteboards (Excalidraw) over Yjs with
  snapshot persistence, revision history + hourly pruning; server-backed
  durable undo/redo; hourly due-date scanner.
- **Voice** *(feature-flagged via `VOICE_ENABLED`)* — LiveKit-backed channels
  (standard + stage with hand-raise), token minting, participant presence,
  moderation, soundboard clips, persisted user preferences, composite egress
  recordings to S3 with retention.
- **Notifications** — in-app inbox, unread counts, per-type preferences,
  web push (VAPID) with inline quick reply, `/notifications` realtime gateway.
- **Integrations** — HMAC-signed webhooks to n8n with delivery log and retries;
  LiveKit egress callbacks; Terminus health endpoint (DB + S3 probes).
- **Operations** — global throttling, Helmet, strict validation, env validation
  at boot, multi-stage Docker image that auto-runs `prisma migrate deploy`,
  seeds for 30 tags and 12 collaboration roles.

[Unreleased]: https://github.com/MGM-Laboratory/mgm-atlas-backend/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/MGM-Laboratory/mgm-atlas-backend/releases/tag/v0.1.0
