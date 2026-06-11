# Deployment guide

How to run MGM Atlas's backend stack behind your own reverse proxy. This page is deliberately generic — substitute your own hosts, domains, and secrets.

## Topology

```
                    ┌────────────────────────── your host ──────────────────────────┐
Internet ──► reverse proxy ──► atlas-backend (:3000)      atlas-y-websocket (:1234)  │
   (TLS, routing)   │          atlas-livekit (:7880 + UDP/TCP media mux)             │
                    │          atlas-livekit-egress (no public port)                 │
                    └─────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
                          PostgreSQL (external, bring your own)
```

- **Images** are built by GitHub Actions: every PR builds `staging*` tags, every push to `main` builds `latest*` tags (docs-only changes skip builds). The host pulls and restarts containers (automated pullers like Watchtower work fine — tags are stable).
- **PostgreSQL is never part of compose.** Point `DATABASE_URL` at your own server; the backend runs `prisma migrate deploy` on boot, so schema upgrades are automatic and additive.
- Run `pnpm prisma:seed` once per environment to install the default tags and collaboration roles.

## Reverse proxy requirements

Three upstreams need WebSocket upgrades. Generic nginx shape:

```nginx
# REST + Socket.IO (chat, notifications, voice signaling events)
location /api/v1/ { proxy_pass http://backend:3000; }
location /socket.io/ {
    proxy_pass http://backend:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
}

# Yjs collaborative editing (notes + whiteboards)
location /yjs/ {
    proxy_pass http://y-websocket:1234/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
}

# LiveKit signaling (voice/video/screen share)
location /livekit/ {
    proxy_pass http://livekit:7880/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
}
```

**WebRTC media** does not go through the HTTP proxy. LiveKit uses a single **UDP-mux port** (compose maps `7882/udp` + `7882/tcp`): one port carries every room's media, so you only need to expose/forward that one port (plus its TCP fallback for UDP-hostile networks) through your firewall to the LiveKit container. Set the SFU's advertised external IP/hostname in `services/livekit/livekit.yaml`.

## Feature-flag matrix

The backend boots with everything optional turned off. Enable features per deployment:

| Feature | Flag(s) | Off behavior |
|---|---|---|
| PMO (tasks, notes, whiteboards, files) | `PMO_ENABLED=true` | All `/pmo/*` routes answer `503` |
| Voice/video | `VOICE_ENABLED=true` + `LIVEKIT_URL/API_KEY/API_SECRET/WEBHOOK_KEY` | All `/voice/*` routes answer `503` |
| Multi-instance sockets | `REDIS_URL` | In-process adapter (fine for one instance) |
| Live co-editing | `YJS_PUBLIC_WS_URL` + `YJS_INTERNAL_AUTH_SECRET` (+ sidecar) | Notes/whiteboards are single-editor |
| Browser push | `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | In-app notifications only |
| GIF picker | `TENOR_API_KEY` and/or `GIPHY_API_KEY` | GIF search hidden |
| Voice recordings | `atlas-livekit-egress` service running (needs ~1 GB RAM headroom for Chromium) | Recording start fails gracefully |

The frontend mirrors `PMO_ENABLED` / `VOICE_ENABLED` with `NEXT_PUBLIC_PMO_ENABLED` / `NEXT_PUBLIC_VOICE_ENABLED` — keep them in sync per environment.

## Health & monitoring

- `GET /api/v1/health` (public) probes PostgreSQL and S3 via Terminus; non-OK → `503`. The Dockerfile healthcheck and any uptime monitor can consume it directly.
- Containers log JSON to stdout (`json-file`, capped 10 MB × 5).

## Checklist for a fresh environment

1. PostgreSQL reachable; `DATABASE_URL` set.
2. S3 bucket + credentials; `AWS_*` and `AWS_S3_PUBLIC_BASE_URL` set; bucket CORS allows browser `PUT` from your app origin.
3. Keycloak realm + client; `KEYCLOAK_*` set; frontend gets the matching public client config.
4. `N8N_WEBHOOK_SECRET` shared with your n8n instance (or leave n8n unreachable — deliveries are logged and retried).
5. `cp .env.example .env`, fill secrets, `docker compose up -d`.
6. Seed once: `pnpm prisma:seed`.
7. Log in with the `BOOTSTRAP_ADMIN_EMAIL` account — it becomes the first admin.
8. Flip feature flags as the sidecars come online.
