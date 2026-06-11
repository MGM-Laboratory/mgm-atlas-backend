<!-- Title must follow Conventional Commits, e.g. `feat(chat): message threads` -->

## Summary

<!-- What does this PR do, and why? One or two sentences. -->

Closes #

## Type of change

- [ ] `feat` — new functionality
- [ ] `fix` / `hotfix` — bug fix
- [ ] `refactor` / `chore` — no behavior change
- [ ] `docs` — documentation only

## How was this tested?

<!-- Local steps, curl/Swagger calls, affected endpoints. -->

- [ ] Verified on staging (for risky changes)

## Screenshots / API samples

<!-- If relevant: Swagger screenshots, request/response samples. -->

## Checklist

- [ ] PR title follows Conventional Commits
- [ ] `pnpm lint` and `pnpm build` pass locally
- [ ] **No secrets, internal hostnames, or infrastructure details** in code, comments, or docs
- [ ] Database migrations are **additive and reversible** (production auto-runs `migrate deploy` on boot)
- [ ] Boots cleanly with `PMO_ENABLED=false`, `VOICE_ENABLED=false`, and optional integrations unset
- [ ] New env vars added to `.env.example` with safe defaults and comments
- [ ] README / docs updated if behavior changed
