# PMO Feature — Handover & Continuation Guide

> **Read this first if you are picking up the PMO build in a fresh session.**
> It captures everything a new Claude Code session (or engineer) needs to
> continue Phases 7–11 without re-deriving context.

The PMO (Project Management Office) is a ClickUp/Asana-style layer added to
Atlas under each project: per-project **task lists**, each with **list /
kanban / gantt / team / files / notes / whiteboards / embed** views, plus
tasks with rich-text descriptions, threaded comments, @mentions, assignees,
dependencies, story points, and per-list custom statuses.

- **Plan file:** `/Users/mitdeveloper/.claude/plans/current-workdir-is-a-cached-haven.md` (full 12-phase design + locked decisions)
- **Auto-memory:** `~/.claude/projects/-Users-mitdeveloper-lab-atlas/memory/project_pmo_feature.md` (locked decisions, phase list) and `feedback_atlas_production_safety.md` (additive-only rules)

---

## 1. Phase status

| Phase | Scope | Status |
|---|---|---|
| 0 | Foundation: schema (14 tables), env, module scaffold, `PmoFeatureFlagGuard`, y-websocket sidecar | ✅ deployed |
| 1 | Task Lists CRUD, default status/tab seeding, project sidebar entry, local navbar, Overview tab | ✅ deployed |
| 2 | Tasks CRUD, List view, inline edits, per-list custom statuses, activity log | ✅ deployed |
| 3 | Task detail popup (parallel/intercepting routes), rich description, threaded comments, mentions, activity feed | ✅ deployed |
| 4 | Kanban board (@dnd-kit, fractional indexing) | ✅ deployed |
| 5 | Gantt timeline (gantt-task-react) + task dependencies | ✅ deployed |
| 6 | Team tab (role-grouped cards, task counts) | ✅ deployed |
| **7** | **Files tab — Drive-style folder tree on S3** | ⏳ **NOT STARTED (next)** |
| 8 | Notes — BlockNote + Yjs collaborative docs | ⏳ todo |
| 9 | Whiteboards — Excalidraw + Yjs + `.mgm` import/export | ⏳ todo |
| 10 | Website-integration EMBED tabs + tab add/customize | ⏳ todo |
| 11 | Polish: due-date cron, dashboard widget, bulk actions, keyboard shortcuts, real Overview widgets, profile drawer, Keycloak hydration | ⏳ todo |

> The plan has **12 phases (0–11)**. There is no phase 12–18. "Phases 7–18 undone" = Phases 7–11 remain.

The feature is **LIVE on production** (`atlas.labmgm.org`) behind kill switches that are currently **ON**. Phases 0–6 are usable today.

---

## 2. Architecture & conventions (must follow)

### Two repos
- `mgm-atlas-backend/` — NestJS 10 / Prisma / Postgres. PMO code under `src/modules/pmo/`.
- `mgm-atlas-frontend/` — Next.js 15 App Router. PMO code under `src/components/pmo/` + routes under `src/app/(authenticated)/projects/[slug]/lists/`.

### Backend module layout (`src/modules/pmo/`)
```
pmo.module.ts              # imports all submodules
guards/pmo-feature-flag.guard.ts   # 404s every PMO route when PMO_ENABLED=false
task-lists/                # Phase 1 (+ statuses bulk-update from Phase 2)
tasks/                     # Phase 2 (+ gantt/deps from Phase 5)
  task-activity.service.ts # audit log writer — call from every mutation
task-comments/             # Phase 3
mentions/                  # Phase 3 (@-search: kind=user|task)
team/                      # Phase 6
# files/ notes/ whiteboards/ yjs/  <- to be created in Phases 7,8,9
```

Each submodule = standard Nest `*.module.ts` + `*.controller.ts` + `*.service.ts` + `dto/`. Every controller:
- `@UseGuards(PmoFeatureFlagGuard)` at class level
- resolves access via `ProjectAccessService.resolve(slug, user)` then `assertInsider(access)` / `assertManager(access)` — **never inline membership queries**
- After `assertInsider`, narrow the level with the `asInsiderKind(access)` helper (copy from `tasks.controller.ts`) when the service needs `'admin'|'manager'|'contributor'`.

### Access model
`ProjectAccessService.resolve()` returns `{ projectId, access: { level, isInsider, isManager, membership } }`. `level` ∈ `admin|manager|contributor|viewer|guest`. Admins always pass. Private projects 404 to non-insiders.

### Permission matrix (from the plan)
- See PMO: insiders only (`access.isInsider`); subtree 404s for viewer/guest.
- Create/rename/delete list, statuses, tabs, embed tabs: manager+.
- Create task: insider, gated by `TaskList.contributorsCanCreateTasks` for contributors.
- Edit task: any insider. Delete task: creator or manager+.
- Upload file / create note / whiteboard: any insider.

### Schema (already migrated, all 14 tables exist in prod)
`TaskList, TaskStatus, Task, TaskAssignee, TaskDependency, TaskComment, TaskAttachment, TaskCommentAttachment, TaskActivity, TaskListTab, ProjectFile, ProjectNote, Whiteboard, YDocSnapshot`. Plus `Project.pmoSettings Json?` and 9 PMO `NotificationType` enum values. **`ProjectFile`, `ProjectNote`, `Whiteboard`, `YDocSnapshot` tables already exist** — Phases 7/8/9 only need services + UI, no migration unless you add columns.

### Frontend conventions
- `src/lib/types.ts` — mirror backend shapes. `IMPLEMENTED_TAB_KINDS` set gates which tabs are clickable; **add the new tab kind here when its phase ships** (this was missed for GANTT in Phase 5 and fixed in Phase 6 — don't repeat).
- `src/lib/api/paths.ts` → `apiPaths.pmo.*`; `src/lib/api/queries.ts` → `queryKeys.pmo.*`.
- Feature gate: `isPmoEnabled()` / `usePmoEnabled()` from `src/lib/hooks/use-pmo-enabled.ts`.
- Reusable PMO components already built: `lucide-icon`, `color-picker`, `icon-picker`, `status-pill`, `priority-chip`, `member-picker` (+ `AssigneeStack`), `date-picker-popover` (+ `formatDueDate`, `isOverdue`), `markdown-render`, `comment-composer/-item`, `comments-thread`, `activity-feed`, `task-modal`, `fractional-index`, `kanban-card`, views under `views/`.
- Task popup uses **parallel + intercepting routes**: `lists/[listId]/@modal/(.)tasks/[taskKey]/page.tsx` (overlay) + `lists/[listId]/tasks/[taskKey]/page.tsx` (full-page fallback). The `layout.tsx` renders a `modal` slot; `@modal/default.tsx` returns null.
- S3 upload flow to reuse: presign (`S3Service.presignPut`) → client PUTs to S3 → register row. Mirror `chat/services/chat-attachments.service.ts`.

---

## 3. The deploy workflow (exact steps, with all the gotchas)

Each phase = backend PR + frontend PR (or frontend-only). Process per repo:

1. **Worktree off latest main** (keeps chat-feature branches untouched):
   ```bash
   cd /Users/mitdeveloper/lab/atlas/mgm-atlas-backend
   git fetch origin --quiet
   git worktree add -b feat/pmo-phase-N-foo /tmp/pmo-N-backend-wt origin/main
   # symlink node_modules for typecheck:
   ln -s /Users/mitdeveloper/lab/atlas/mgm-atlas-backend/node_modules /tmp/pmo-N-backend-wt/node_modules
   ```
2. Write code. Typecheck: `./node_modules/.bin/tsc --noEmit [-p tsconfig.json]`.
3. Commit (HEREDOC msg, `-c commit.gpgsign=false`, Co-Authored-By Claude). Push `-u origin`.
4. **Open PR with the user's GitHub PAT** (the default `gh` account is not a collaborator):
   ```bash
   GH_TOKEN='<USER_GH_PAT>' gh pr create --base main --head feat/... --title "..." --body "..."
   ```
5. Watch CI (background until-loop), merge with `--merge --delete-branch` via `GH_TOKEN=...`.
6. CI build → watchtower auto-pulls within ~30s, OR pull manually on keikaku (below).
7. Smoke-test against `https://atlas.labmgm.org/api/v1` with a test session (below).
8. Clean up: `git worktree remove /tmp/... --force` + `git branch -D feat/...`.

### Credentials (provided by user this session — re-ask if rotated)
- GitHub PAT: used as `GH_TOKEN='<ghp_...>'` prefix for all `gh` PR/merge calls.
- Docker Hub PAT: `docker login -u labmgm --password-stdin` (only needed for the y-websocket sidecar image, which CI does NOT build).
- SSH: `ssh -F ~/.ssh/config_idham keikaku` (prod app host) and `... taisetsu` (DB host). Tailscale must be up. Passphrase `estella` if asked.

### Servers
- **keikaku** — prod app host. Stacks in `~/docker/{mgm-atlas-backend,mgm-atlas-frontend,watchtower}/`. Each has `compose.yml` + `.env`. `docker compose pull && docker compose up -d` to deploy.
- **taisetsu** — external Postgres (`mgm_atlas_production`), Postgres 18.3. Only touch the Atlas DB.

### Manual deploy on keikaku
```bash
ssh -F ~/.ssh/config_idham keikaku 'cd ~/docker/mgm-atlas-backend && docker compose pull atlas-backend && docker compose up -d atlas-backend'
ssh -F ~/.ssh/config_idham keikaku 'cd ~/docker/mgm-atlas-frontend && docker compose pull && docker compose up -d'
```

### Migrations (when a phase adds columns)
Prisma 5.22, prod is Postgres 18.3. Additive only (see production-safety memory). Generate SQL by diffing:
```bash
git show origin/main:prisma/schema.prisma > /tmp/old.prisma
./node_modules/.bin/prisma migrate diff --from-schema-datamodel /tmp/old.prisma \
  --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/<n>_name/migration.sql
# scan for DROP / RENAME / SET NOT NULL — there must be none
```
Apply on prod by `docker cp`-ing the new migration dir into the running `mgm-atlas-backend` container and running:
```bash
docker exec mgm-atlas-backend /app/node_modules/.bin/prisma migrate deploy --schema=/app/prisma/schema.prisma
```
(The container has the prisma binary at `/app/node_modules/.bin/prisma` and the correct `DATABASE_URL`. Local Node is 18 and can't run pnpm 10, so do DB work inside the container.)

---

## 4. CRITICAL gotchas discovered the hard way

1. **pnpm 10 needs Node ≥ 22; local machine has Node 18.** You CANNOT run `pnpm install` locally. When you add a frontend dep:
   - Add it to `package.json` manually.
   - Regenerate `pnpm-lock.yaml` via a Docker container on keikaku:
     ```bash
     # bundle package.json + pnpm-lock.yaml + .npmrc, scp to keikaku, then:
     docker run --rm -v $PWD:/app -w /app node:20-alpine sh -c \
       "corepack enable && corepack prepare pnpm@10.13.1 --activate && pnpm install --lockfile-only"
     # scp the regenerated pnpm-lock.yaml back into the worktree and commit it
     ```
   - CI runs `pnpm install --frozen-lockfile` → fails if the lockfile doesn't match `package.json`. This bit Phase 4.

2. **New `NEXT_PUBLIC_*` build-args must be declared in the frontend `Dockerfile`** (both `ARG` and `ENV` in the `build` stage). Docker silently drops undeclared `--build-arg`s. This is why the PMO button was invisible until fixed.

3. **BuildKit `cache-from type=gha` reuses `RUN pnpm build` even when ENV changes.** The Dockerfile's build RUN now echoes the public env values into the command string to bust the cache:
   `RUN echo "build inputs: ... pmo=$NEXT_PUBLIC_PMO_ENABLED ..." && pnpm build`. Keep new public flags in that echo.

4. **Next.js needs `NEXT_PUBLIC_*` at SSR runtime too, not just build time.** They must be in keikaku's `~/docker/mgm-atlas-frontend/.env` (loaded via `env_file:`). The build-arg only covers client-bundle inlining; SSR reads `process.env` at request time. A mismatch hides feature-flagged UI. `NEXT_PUBLIC_PMO_ENABLED=true` is now in that `.env`.

5. **Three independent kill switches** (all currently ON):
   - Frontend client bundle: GH Actions repo var `NEXT_PUBLIC_PMO_ENABLED` (build-arg).
   - Frontend SSR: keikaku `~/docker/mgm-atlas-frontend/.env` → `NEXT_PUBLIC_PMO_ENABLED`.
   - Backend routes: keikaku `~/docker/mgm-atlas-backend/.env` → `PMO_ENABLED`.

6. **The y-websocket sidecar image is built manually on keikaku**, not by CI. It runs `y-websocket@1.5.4` (NOT v2 — v2's export map broke `bin/utils`). Phase 8 needs to replace its stub `server.js` with the real auth-callback + snapshot variant, rebuild, and push to Docker Hub. Source at `mgm-atlas-backend/services/y-websocket/`.

7. Shell escaping with `node -e` over SSH is fragile — prefer `python3` or copy files out for grepping.

---

## 5. Testing on production

```bash
# Create a test session (bypasses Keycloak) directly in the DB via the container:
ssh -F ~/.ssh/config_idham keikaku 'docker exec mgm-atlas-backend node -e "
const { PrismaClient } = require(\"@prisma/client\"); const p = new PrismaClient();
const expiresAt = new Date(Date.now() + 30*60*1000);
p.session.create({ data: { userId: \"<USER_ID>\", accessToken: \"test\", refreshToken: \"x\", idToken: \"x\", expiresAt } })
  .then(s => { console.log(s.id); process.exit(0); });
"'
# then: curl -s -H "Authorization: Bearer <sessionId>" https://atlas.labmgm.org/api/v1/...
# ALWAYS delete the test session afterward (deleteMany where accessToken).
```

### Known test fixtures (left in place on prod for browser testing)
- Browser login: `megumi@labmgm.org` / `Megumicantik@321` (contributor on **Megumi AI**).
- Test project: **Megumi AI**, slug `megumi-ai-95s7cp`, id `d7af185c-0203-4f89-8b3a-1ffd8be4532c`.
  - Has a task list **"Phase 2 Smoke"** (id `8bd563ad-0b70-4ea5-aed4-0e955bf24054`, key `SMOKE`) with statuses Backlog→In Progress→In Review→Done→Blocked and tasks SMOKE-1…SMOKE-6, a dependency SMOKE-1→SMOKE-3, and two comments on SMOKE-1.
- Key user IDs: megumi `731edb41-e5e4-49ff-a4fb-f70a2ccf3b73`; admin (Lab MGM, owner) `1ea8bd59-8dfc-458e-be9c-020abb1f4d35`.
- Megumi is a **contributor** there, not a PM. For manager-only flows use an admin session.

---

## 6. Phase 7 (Files) — concrete next steps

Backend (`src/modules/pmo/files/`), all under `PmoFeatureFlagGuard` + insider:
- `GET /projects/:slug/files?folderId=` — immediate children of a folder (or root when omitted), folders first then files, `deletedAt: null`.
- `POST /projects/:slug/files/presign` — `{ filename, contentType, contentLength, parentFolderId? }` → reuse `S3Service.presignPut` with key `projects/{projectId}/files/{nanoid}/{filename}`. Enforce `PMO_FILE_MAX_BYTES` (config `pmo.fileMaxBytes`, default 50 MB) and `PMO_FILE_ALLOWED_MIME` (`pmo.fileAllowedMime`, default `*`).
- `POST /projects/:slug/files` — register the uploaded `ProjectFile` row (`{ name, s3Key, url, mime, bytes, parentFolderId? }`).
- `POST /projects/:slug/files/folder` — `{ name, parentFolderId? }` → `isFolder: true`.
- `PATCH /projects/:slug/files/:fileId` — rename / move (`parentFolderId`). Validate the target folder is in the same project and not a descendant of the moved folder (no cycles).
- `DELETE /projects/:slug/files/:fileId` — soft-delete (`deletedAt`). Folder delete blocked if non-empty unless `?force=1` (then recurse).

The `ProjectFile` model already exists (self-referential `parentFolderId`, `isFolder`, `url`, `s3Key`, `mime`, `bytes`, `uploadedById`, `deletedAt`). Add `FilesModule` to `pmo.module.ts`.

Frontend:
- `IMPLEMENTED_TAB_KINDS` += `'FILES'`.
- `apiPaths.pmo.files.*`, `queryKeys.pmo.files`.
- `src/components/pmo/views/files-view.tsx` — Drive-like grid/list, breadcrumb, drag-drop upload zone, folder double-click navigation, kebab (rename/move/download/delete). Reuse `client.ts` `uploadToPresigned` for the S3 PUT (raw XHR with progress — see `media/media-upload.tsx`).
- Route `lists/[listId]/files/page.tsx`.

---

## 7. Phases 8–11 — quick pointers (full detail in the plan file)

- **8 Notes:** BlockNote (`@blocknote/core`, `@blocknote/react`, `@blocknote/mantine`) + Yjs (`yjs`, `y-websocket` client provider). `ProjectNote` + `YDocSnapshot` tables exist. Needs: notes CRUD + tree, `yToken` minting (sign with `INTERNAL_JWT_SECRET`/`YJS_INTERNAL_AUTH_SECRET`), `POST /internal/yjs/authorize` + `/internal/yjs/snapshot` callbacks, and the **real y-websocket sidecar `server.js`** (replace the Phase-0 stub). Env already scaffolded: `YJS_PUBLIC_WS_URL`, `YJS_INTERNAL_AUTH_SECRET`, `NEXT_PUBLIC_YJS_WS_URL`. Set these on keikaku + the GH var when enabling. Degrade gracefully if Yjs is down (single-edit + warning toast).
- **9 Whiteboards:** `@excalidraw/excalidraw` (must be `dynamic(import, { ssr: false })`, ~600 KB) + Yjs. `Whiteboard` table exists. `.mgm` = versioned JSON wrapper over the Excalidraw scene (format in the plan). Mentions = text element + overlay (Excalidraw has no custom element type).
- **10 Embed tabs:** `TaskListTab` EMBED CRUD (`POST/DELETE .../tabs`), add-tab dialog (presets: Figma/Canva/Google Docs/Sheets/Slides/Loom/YouTube/Miro + custom URL), `<iframe sandbox>` view with "open in new tab" fallback when the site blocks framing. Built-in tab reorder already works (Phase 1).
- **11 Polish:** due-date cron (`@nestjs/schedule`, `TASK_DUE_SOON`/`TASK_OVERDUE` notifications), dashboard "My open tasks" widget, multi-select bulk actions, keyboard shortcuts, real Overview widgets, team profile drawer + Keycloak hydration, dependency-creation UI in the task modal right rail (endpoints exist from Phase 5).

---

## 8. Deferred items already noted in earlier phases (fold into Phase 11 or as needed)
- Tiptap `Mention`/`Youtube`/`Giphy`/`LinkPreview` nodes inside the task **description** editor (comments already have @-mentions via the chat `MentionSuggest`).
- Image/file attachments inside task descriptions & comments (S3 presign flow exists).
- Realtime Socket.io sync for kanban/list/gantt across users (currently 30 s stale + refetch-on-focus).
- Cross-list task dependencies (currently rejected; gantt is per-list).
- Team card → profile drawer + Keycloak phone/department.
