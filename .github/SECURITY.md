# Security Policy

## Reporting a vulnerability

**Please do not report security vulnerabilities through public issues,
discussions, or pull requests.**

Instead, use one of these private channels:

1. **Preferred:** GitHub private vulnerability reporting — click
   **"Report a vulnerability"** on this repository's
   [Security tab](https://github.com/MGM-Laboratory/mgm-atlas-backend/security).
2. **Email:** [atlas@labmgm.org](mailto:atlas@labmgm.org) with the subject
   prefix `[SECURITY]`.

Include what you can: affected endpoint/component, reproduction steps, impact
assessment, and any proof-of-concept material.

### What to expect

| Stage | Commitment |
|---|---|
| Acknowledgement | within **72 hours** |
| Status update | within **14 days** |
| Fix & disclosure | coordinated with you after a fix ships |

## Supported versions

MGM Atlas deploys continuously — there are no maintained release lines.

| Branch / deployment | Supported |
|---|---|
| `main` (production, atlas.labmgm.org) | ✅ |
| `dev` (staging) | ⚠️ best effort |
| Anything else | ❌ |

## Scope

In scope:

- This codebase: the API, its auth/session handling, access-control guards,
  S3 presign flow, webhook signing, and the Socket.IO gateways
- The production deployment at `atlas.labmgm.org`

Out of scope:

- Vulnerabilities in upstream software (Keycloak, LiveKit, PostgreSQL, n8n) —
  please report those upstream
- Volumetric denial-of-service and rate-limit exhaustion findings
- Social engineering of lab members
- Findings that require a previously compromised account or device

## Safe harbor

We will not pursue action against good-faith research that respects user
privacy, avoids service disruption and data destruction, and gives us
reasonable time to remediate before any disclosure.
