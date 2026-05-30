# Atlas voice chat — deployment topology

This doc is the single source of truth for how LiveKit + WebRTC media
flows from a user's browser to the Atlas SFU. Read it before changing
any voice infra. The chat / PMO deploy docs are siblings.

## Network reality (the non-obvious bit)

`keikaku` (the Atlas app host) has **no public IP**. Everything sits
behind Tailscale. Public traffic enters via a subnet-router VPS
(public IP **103.196.153.62**, runs nginx). Cloudflare orange-clouds
the main hostname, so HTTPS traffic actually flows:

```
Browser → Cloudflare → VPS (nginx) → Tailscale → keikaku
```

UDP traffic for WebRTC media cannot ride Cloudflare's free proxy. It
goes direct to the VPS public IP (DNS-only, no Cloudflare):

```
Browser → VPS (nginx stream{}) → Tailscale → keikaku
```

## Why UDP Mux (not the standard 50000–50100 range)

The standard LiveKit deploy publishes a UDP port range (typically
50000–50100). That doesn't fit our topology because:

1. The VPS firewall would need to open ~100 UDP ports.
2. Each port would need its own `nginx stream` rule.
3. Tailscale would carry ~100 UDP flows per concurrent participant.

LiveKit's **UDP Mux** consolidates all WebRTC media onto a single UDP
port. Atlas uses port **7882**, opened on the VPS firewall, with
exactly one `nginx stream` rule and one Tailscale flow per
participant. The mux'ing is a LiveKit application-layer feature.

The same port also serves TCP fallback — when a client can't open
UDP (corporate firewall), LiveKit falls back to TCP on 7882. So one
port handles both protocols and the VPS firewall only needs one rule.

## Components & where they run

| Component | Where | What it does |
|---|---|---|
| Backend (NestJS) | keikaku (`mgm-atlas-backend`) | Mints LiveKit JWTs (signed locally, no network call), serves `/voice/*` REST routes. |
| LiveKit SFU | keikaku (`mgm-atlas-livekit`) | WebRTC SFU. Signaling on 7880, media on 7882 (UDP+TCP). |
| nginx (subnet router) | VPS, public IP 103.196.153.62 | Terminates TLS, proxies signaling (http /livekit/) and media (stream :7882). |
| Cloudflare | proxies `atlas.labmgm.org` | Front of the HTTPS path. Not in the media path. |

## Config files

- **LiveKit:** `services/livekit/livekit.yaml`
  - `rtc.udp_port: 7882` + `rtc.tcp_port: 7882` (UDP Mux + TCP fallback on same port).
  - `rtc.use_external_ip: false` + `rtc.node_ip: 103.196.153.62` — STUN is wrong here (would discover keikaku's egress IP); we hard-set the VPS public IP so LiveKit advertises it in ICE candidates.
  - No `keys:` block — keys come from `LIVEKIT_KEYS="apikey: apisecret"` env var.
  - No `turn:` block — deferred to Phase 7.

- **Backend env (`.env` on keikaku, NOT in repo):**
  ```
  VOICE_ENABLED=false           # ship dark; flip in Phase 1
  LIVEKIT_URL=                  # leave empty until Phase 1 (so feature reports unavailable)
  LIVEKIT_API_KEY=API_xxxx      # generated on keikaku
  LIVEKIT_API_SECRET=base64...  # generated on keikaku
  LIVEKIT_WEBHOOK_KEY=base64... # same as API_SECRET for our single-key setup
  ```

- **Frontend env (build-time, GH variables):**
  ```
  NEXT_PUBLIC_VOICE_ENABLED=false
  NEXT_PUBLIC_LIVEKIT_URL=wss://atlas.labmgm.org/livekit
  ```

- **VPS nginx (`~/lab/atlas/nginx.conf`, applied manually on VPS):**
  - In the `stream {}` block: `upstream atlas_livekit_media { server keikaku.tailce5c0d.ts.net:7882; }` plus two `server` blocks (`listen 7882 udp` and `listen 7882`).
  - In the `http {}` block: `upstream atlas_labmgm_org_livekit { server keikaku.tailce5c0d.ts.net:7880; }` and a `location /livekit/` inside the `atlas.labmgm.org` server (WSS proxy).

## Phase 0 deploy gates (what the user has to do)

1. **VPS firewall:** open UDP **and** TCP 7882 inbound. (Already done — user opened 7882.)
2. **VPS nginx:** apply the diff in `~/lab/atlas/nginx.conf` (stream block additions + http `/livekit/` location). `nginx -t && nginx -s reload`.
3. **DNS:** not needed for Phase 0. `atlas.labmgm.org` already exists.

Phase 1 needs nothing extra (Cloudflare can keep orange-clouding the HTTPS path; signaling rides Cloudflare WebSockets just fine). Phase 7's TURN-TLS-on-443 will need a separate DNS-only subdomain and is documented separately.

## Phase 7 backlog (NOT in Phase 0 scope)

- TURN-TLS on 443 for corporate-firewall traversal (clients that can't open *any* UDP). Needs `turn.atlas.labmgm.org` DNS-only + nginx stream SNI demux + LiveKit `turn:` block.
- Egress (recording) container for MP4-to-S3.
- `net.core.rmem_max=2500000` sysctl tuning on keikaku (LiveKit logs a warning at startup about the receive buffer being too small; not load-bearing for Phase 0).

## Verification

Backend → DB:
```
docker exec -w /app mgm-atlas-backend node -e \
  "const{PrismaClient}=require('/app/node_modules/@prisma/client');\
   const p=new PrismaClient();\
   p.voiceChannel.count().then(c=>console.log('VoiceChannel:',c))\
   .finally(()=>p.\$disconnect())"
```

Public health:
```
curl -sS -o/dev/null -w '%{http_code}\n' https://atlas.labmgm.org/api/v1/health        # 200
curl -sS -o/dev/null -w '%{http_code}\n' https://atlas.labmgm.org/api/v1/voice/lobby/channels  # 404 (flag off)
```

LiveKit (internal, via Tailscale):
```
curl -sS http://keikaku.tailce5c0d.ts.net:7880/ -m 3      # WebSocket upgrade required (HTTP 426 or empty)
```

LiveKit (public, via VPS nginx) — once Phase 1 wires the route in:
```
wscat -c wss://atlas.labmgm.org/livekit/rtc?access_token=$JWT
```

Media (public, via VPS stream) — once a Phase 1 client joins:
```
nc -u -zv 103.196.153.62 7882
```
