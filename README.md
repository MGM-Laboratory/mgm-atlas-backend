# mgm-atlas-backend

NestJS API for **MGM Atlas** — the project portfolio dashboard for MGM Laboratory.
Production: `https://atlas.labmgm.org/api/v1`.

## Stack

| Concern        | Choice                                                                |
|----------------|-----------------------------------------------------------------------|
| Runtime        | Node 20, TypeScript 5                                                 |
| Framework      | NestJS 10                                                             |
| ORM / DB       | Prisma 5 / PostgreSQL (external host)                                 |
| Auth           | Keycloak OIDC — JWT validated against JWKS on every protected request |
| Storage        | AWS S3 (presigned PUT URLs, direct browser upload)                    |
| Email          | n8n → Mailtrap (backend fires webhooks; n8n composes & sends mail)    |
| Health checks  | `@nestjs/terminus` — DB + S3 probe, Gatus-friendly JSON               |
| Container      | Multi-stage Docker (Alpine, pnpm, tini)                               |
| CI/CD          | GitHub Actions, two environments (`dev` → staging, `main` → prod)     |

## Quick start

```bash
pnpm install
cp .env.example .env        # fill in real values
pnpm prisma:migrate:dev     # creates DB schema
pnpm prisma:seed            # seeds default tags + collaboration roles
pnpm start:dev              # http://localhost:3000/api/v1
```

Swagger UI is available at `http://localhost:3000/api/v1/docs` (development only).

## Project structure

```
src/
├─ main.ts                      bootstrap, global prefix /api/v1
├─ app.module.ts                wires all feature modules
├─ config/                      env validation + namespaced config
├─ common/                      decorators, guards, filters, DTOs
├─ prisma/                      PrismaService + PrismaModule
└─ modules/
   ├─ auth/                     JwtStrategy (Keycloak JWKS), guards
   ├─ users/                    GET /me, /me/dashboard, admin assignment
   ├─ tags/                     CRUD, grouped by category
   ├─ projects/                 CRUD, /discover (Netflix-style)
   ├─ media/                    S3 presign + register + reorder
   ├─ contributions/            request → approve / reject / withdraw
   ├─ team/                     invites, member roles
   ├─ notifications/            in-app inbox
   ├─ webhooks/                 n8n dispatch (HMAC-signed)
   ├─ mailer/                   Mailtrap fallback (system-internal only)
   ├─ admin/                    collaboration role config
   └─ health/                   GET /health for Gatus
```

## Environment variables

See `.env.example`. Highlights:

| Var                            | Notes                                                   |
|--------------------------------|---------------------------------------------------------|
| `DATABASE_URL`                 | External Postgres DSN, include `sslmode=require` in prod|
| `KEYCLOAK_ISSUER`              | `https://iam.labmgm.org/realms/mgm`                     |
| `KEYCLOAK_JWKS_URI`            | `…/protocol/openid-connect/certs`                       |
| `BOOTSTRAP_ADMIN_EMAIL`        | First admin auto-promoted on first login (default `admin@labmgm.org`) |
| `ADMIN_NOTIFICATION_EMAILS`    | Comma-separated; passed to n8n in webhook payloads       |
| `AWS_S3_BUCKET`                | Bucket holding all project media                        |
| `AWS_S3_PUBLIC_BASE_URL`       | CDN base (omit to fall back to virtual-hosted S3 URL)   |
| `N8N_WEBHOOK_SECRET`           | HMAC signs every webhook body in `x-atlas-signature`    |
| `INTERNAL_JWT_SECRET`          | Reserved for short-lived internal tokens                |

## API summary

All endpoints live under `/api/v1` and require `Authorization: Bearer <Keycloak JWT>`,
except `GET /health` which is public.

| Group         | Method  | Path                                          | Auth        |
|---------------|---------|-----------------------------------------------|-------------|
| Health        | GET     | `/health`                                     | public      |
| Auth          | GET     | `/auth/session`                               | any user    |
| Users         | GET/PATCH | `/users/me`                                 | any user    |
| Users         | GET     | `/users/me/dashboard`                         | any user    |
| Users         | GET/POST/DELETE | `/users/me/bookmarks/...`             | any user    |
| Users         | GET     | `/users` (q, page, pageSize)                  | any user    |
| Users         | PATCH   | `/users/:id/admin`                            | admin       |
| Tags          | GET     | `/tags` / `/tags/grouped`                     | any user    |
| Tags          | POST/PATCH/DELETE | `/tags[/...]`                       | admin or PM |
| Projects      | GET     | `/projects` (filter, search, paginate)        | any user    |
| Projects      | GET     | `/projects/discover`                          | any user    |
| Projects      | GET     | `/projects/featured`                          | any user    |
| Projects      | POST    | `/projects/featured`                          | admin       |
| Projects      | POST    | `/projects`                                   | any user    |
| Projects      | GET     | `/projects/:slug`                             | viewer/insider |
| Projects      | PATCH   | `/projects/:id`                               | PM/admin    |
| Projects      | POST    | `/projects/:id/archive` & `/unarchive`        | PM/admin    |
| Projects      | DELETE  | `/projects/:id`                               | PM/admin    |
| Media         | POST    | `/projects/:projectId/media/presign`          | PM/admin    |
| Media         | POST    | `/projects/:projectId/media`                  | PM/admin    |
| Media         | PATCH   | `/projects/:projectId/media/reorder`          | PM/admin    |
| Media         | DELETE  | `/projects/:projectId/media/:mediaId`         | PM/admin    |
| Contributions | POST    | `/projects/:slug/contribute`                  | any user    |
| Contributions | GET     | `/projects/:slug/contributions`               | PM/admin    |
| Contributions | GET     | `/contributions/mine`                         | any user    |
| Contributions | POST    | `/contributions/:id/withdraw`                 | applicant   |
| Contributions | POST    | `/contributions/:id/approve` & `/reject`      | PM/admin    |
| Team          | POST    | `/projects/:projectId/invites`                | PM/admin    |
| Team          | DELETE  | `/projects/:projectId/invites/:inviteId`      | PM/admin    |
| Team          | POST    | `/invites/:id/accept` & `/decline`            | invitee     |
| Team          | PATCH/DELETE | `/projects/:projectId/members/:memberId` | PM/admin    |
| Notifications | GET     | `/notifications`                              | any user    |
| Notifications | GET     | `/notifications/unread-count`                 | any user    |
| Notifications | PATCH   | `/notifications/:id/read`                     | any user    |
| Notifications | POST    | `/notifications/read-all`                     | any user    |
| Admin         | GET     | `/admin/collaboration-roles`                  | any user    |
| Admin         | POST/PATCH/DELETE | `/admin/collaboration-roles[/:id]`  | admin       |

## Webhooks → n8n

Every important domain event is dispatched to `${N8N_BASE_URL}${N8N_WEBHOOK_PATH}`
with these headers:

```
content-type: application/json
x-atlas-event:    <event name>
x-atlas-signature: hex(hmac-sha256(secret, body))
```

Body shape:

```json
{
  "event": "contribution.submitted",
  "timestamp": "2026-05-07T12:34:56.000Z",
  "source": "atlas",
  "data": { ... }
}
```

Events emitted:

| Event                    | Trigger                                |
|--------------------------|----------------------------------------|
| `contribution.submitted` | A user submits a contribution request  |
| `contribution.approved`  | A PM/admin approves                    |
| `contribution.rejected`  | A PM/admin rejects                     |
| `contribution.withdrawn` | The applicant withdraws                |
| `project.invited`        | A PM directly invites a user           |
| `project.member_removed` | A PM removes a member                  |

n8n is responsible for composing emails and sending via Mailtrap. The backend
itself only mails via SMTP for system-internal cases through `MailerService`
(currently unused in user flows — kept for future admin alerts).

## Health check

`GET /api/v1/health` returns Terminus' standard JSON:

```json
{
  "status": "ok",
  "info":  { "database": { "status": "up" }, "s3": { "status": "up" } },
  "error": {},
  "details": { "database": { "status": "up" }, "s3": { "status": "up" } }
}
```

A failing dependency flips `status` to `error` and HTTP 503 — perfect for Gatus
to alert on.

## Deploying

Deploys run automatically via GitHub Actions:

* Push to `dev` → `staging.yml` builds, pushes `labmgm/atlas-backend:staging-<sha>`
  and `…:staging`, then SSHes to the staging host and runs
  `docker compose pull && docker compose up -d`.
* Push to `main` → `production.yml` does the same with `…:latest`,
  `…:<sha>`, and a timestamp tag.

Each environment (`staging`, `production`) needs these GitHub Actions secrets:

| Secret                | Notes                                              |
|-----------------------|----------------------------------------------------|
| `DOCKERHUB_USERNAME`  | Docker Hub user with push access to `labmgm/*`     |
| `DOCKERHUB_TOKEN`     | Personal access token                              |
| `SSH_HOST`            | Deploy target hostname or IP                       |
| `SSH_USER`            | SSH login user                                     |
| `SSH_PRIVATE_KEY`     | OpenSSH-format private key (PEM)                   |
| `DEPLOY_PATH`         | Directory on the host where compose lives          |
| `ENV_FILE`            | Full contents of the `.env` file for the env       |

The compose file references `${IMAGE}` so the deploy step pins each release
to its immutable SHA tag.
