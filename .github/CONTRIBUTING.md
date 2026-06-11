# Contributing to MGM Atlas — Backend

Thanks for your interest in MGM Atlas! This page covers the backend API. The
frontend has its own guide in
[mgm-atlas-frontend](https://github.com/MGM-Laboratory/mgm-atlas-frontend/blob/main/.github/CONTRIBUTING.md).

> [!IMPORTANT]
> **Code contributions are limited to active MGM Laboratory members.** MGM
> Atlas is proprietary, source-visible software under the
> [ESDPL v1.0](../LICENSE) — the code is public to read and learn from, but
> only lab members may submit changes. **Everyone** is welcome to open
> [issues](https://github.com/MGM-Laboratory/mgm-atlas-backend/issues) and
> join [Discussions](https://github.com/MGM-Laboratory/mgm-atlas-frontend/discussions).
> Lab members get repository access via the lab coordinator.

## Ways to contribute

- 🐛 **Found a bug?** Open a [bug report](https://github.com/MGM-Laboratory/mgm-atlas-backend/issues/new/choose) — the form guides you.
- 💡 **Have an idea?** Start with [Discussions](https://github.com/MGM-Laboratory/mgm-atlas-frontend/discussions) or a feature request.
- 🔒 **Security problem?** Never open a public issue — see [SECURITY.md](SECURITY.md).
- 🔧 **Lab member shipping code?** Read on.

## Development setup

Prerequisites: Node ≥ 20.11, pnpm ≥ 9, a reachable PostgreSQL, an S3-compatible
bucket, and a Keycloak realm (ask the coordinator for dev realm credentials).

```bash
pnpm install
cp .env.example .env          # fill DATABASE_*, KEYCLOAK_*, AWS_*
pnpm prisma:migrate:dev
pnpm prisma:seed
pnpm start:dev                # http://localhost:3000/api/v1 · Swagger at /api/v1/docs
```

Pair with the [frontend](https://github.com/MGM-Laboratory/mgm-atlas-frontend)
running on `:3001` for end-to-end work.

## Branch model

| Branch | Meaning |
|---|---|
| `main` | Production — every push builds the production image |
| `dev` | Staging / integration |
| `feat/<scope>` · `fix/<scope>` · `hotfix/<scope>` | Working branches |

## Commits

We use [Conventional Commits](https://www.conventionalcommits.org). Real
examples from this repo's history:

```
feat(chat): workspace-global chat channels, lobby voice threads
fix(pmo): faster Yjs flush
hotfix(yjs-sidecar): skip flush on last client disconnect
```

Keep subjects imperative and scoped; the PR title follows the same convention.

## Code style & backend ground rules

- **Formatting** — Prettier (100-char lines, single quotes, trailing commas, LF). Run `pnpm format`.
- **Linting** — `pnpm lint` (ESLint with the repo config) must pass.
- **Migrations are additive and reversible.** Production runs
  `prisma migrate deploy` on boot against a live database — never edit an
  applied migration, never write a destructive one without a rollback plan.
- **Feature-flag-safe boot.** The API must start (and CI must pass) with
  `PMO_ENABLED=false`, `VOICE_ENABLED=false`, and every optional integration
  (`REDIS_URL`, `YJS_*`, `LIVEKIT_*`, VAPID keys) empty.
- **New env vars** go into `.env.example` with a safe default and a comment —
  in the same PR that introduces them.
- **No secrets or internal hostnames** in code, comments, or docs. Generic
  placeholders only ("your reverse proxy", "the deploy host").

## Pull request process

1. Branch from `dev` (`feat/...`), or from `main` only for `hotfix/...`.
2. Open a PR using the template. CI runs lint + build + tests — it must be green.
3. At least one maintainer review; see the checklist below.
4. Squash-or-merge per the maintainer's call; staging soaks on `dev`, and
   maintainers promote `dev → main` for release.

### What reviewers check

- Correctness and error paths (guards, validation, soft-delete semantics)
- Migration safety (additive, reversible, boot-time `migrate deploy` friendly)
- Feature-flag discipline (works with all flags off)
- Webhook/notification side effects fire through services, not ad-hoc
- No secrets, no internal hostnames, `.env.example` updated
- Conventional PR title; docs/README updated if behavior changed

## Questions?

Open a [Discussion](https://github.com/MGM-Laboratory/mgm-atlas-frontend/discussions)
or email [atlas@labmgm.org](mailto:atlas@labmgm.org).
