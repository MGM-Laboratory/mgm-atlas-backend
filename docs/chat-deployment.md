# Chat realtime — deployment notes

Project chat ships in two layers. The REST API (P1) works on any
reverse proxy; the WebSocket gateway (P2) needs a few additional
proxy settings to upgrade HTTP connections.

## Required environment

| Variable | Required | Default | Effect |
|---|---|---|---|
| `REDIS_URL` | optional | _(unset)_ | If unset, chat is REST-only — gateway accepts no connections, presence/typing fall back to in-memory, multi-instance fanout is disabled. Set to `redis://host:6379/0` to enable. |
| `CHAT_SOCKET_PATH` | optional | `/socket.io` | Reverse-proxy this path through to the backend container. |
| `CHAT_EDIT_WINDOW_HOURS` | optional | `24` | How long after posting a message can be edited by its author. |
| `CHAT_MAX_ATTACHMENTS_PER_MESSAGE` | optional | `10` | |
| `CHAT_MAX_ATTACHMENT_BYTES` | optional | `52428800` (50MB) | Per-attachment size cap; tighter than the global S3 cap. |

All chat env vars are `@IsOptional()` with the defaults above —
existing deploys boot without changes.

## Reverse proxy

socket.io needs the standard HTTP/1.1 `Upgrade: websocket` headers and
a long read timeout (it keeps the connection open as long as the
client is connected).

### nginx

```nginx
location /socket.io/ {
    proxy_pass         http://atlas-backend:3000;
    proxy_http_version 1.1;
    proxy_set_header   Upgrade $http_upgrade;
    proxy_set_header   Connection "upgrade";
    proxy_set_header   Host $host;
    proxy_set_header   X-Real-IP $remote_addr;
    proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}

# The REST API stays on the existing /api/v1 location.
location /api/ {
    proxy_pass http://atlas-backend:3000;
    # ... existing settings
}
```

### Caddy

```caddyfile
atlas.labmgm.org {
    reverse_proxy /socket.io/* atlas-backend:3000 {
        transport http {
            keepalive 1h
        }
    }
    reverse_proxy /api/* atlas-backend:3000
    reverse_proxy /* atlas-frontend:3001
}
```

Caddy enables WebSocket upgrade by default; the `keepalive 1h` keeps
idle sockets from being dropped at the proxy.

### Traefik (labels)

```yaml
labels:
  - traefik.enable=true
  - traefik.http.routers.atlas-ws.rule=Host(`atlas.labmgm.org`) && PathPrefix(`/socket.io`)
  - traefik.http.services.atlas-ws.loadbalancer.server.port=3000
  - traefik.http.middlewares.atlas-ws-headers.headers.customrequestheaders.X-Forwarded-Proto=https
  - traefik.http.routers.atlas-ws.middlewares=atlas-ws-headers
```

## Sticky sessions

**Not required** — the backend ships with `@socket.io/redis-adapter`
wired through Redis pub/sub, so a client can hit any backend
instance for any room. If you scale horizontally without configuring
Redis, you _will_ need sticky sessions (`ip_hash` in nginx).

## Health check

`GET /api/v1/health` now reports a `redis` key in the JSON body:

```json
{
  "status": "ok",
  "info": {
    "database": { "status": "up" },
    "s3":       { "status": "up" },
    "redis":    { "status": "up" }
  }
}
```

Possible `redis.status` values:
- `up` — Redis is reachable and `PING` returns `PONG`.
- `up` with `mode: "disabled"` — `REDIS_URL` is unset. The container
  is healthy; chat realtime is intentionally turned off.
- `down` — `REDIS_URL` is configured but the connection failed. The
  container still returns 200 so Watchtower and orchestrators don't
  restart-loop; chat features just degrade.

Gatus probes that already key on `info.database.status == up` and
`info.s3.status == up` continue to work — the `redis` field is purely
additive.

## Frontend env

The frontend reads `NEXT_PUBLIC_SOCKET_URL` at build time (it's baked
into the image — see the frontend Dockerfile). When unset, the
runtime derives the origin from `NEXT_PUBLIC_API_URL` by stripping
`/api/vN`, so existing prod builds work without rebuilding.

Override only if WebSocket traffic terminates on a different origin
than the REST API (e.g. a dedicated `ws.atlas.labmgm.org`).

## Verifying

After deploying with `REDIS_URL` set, you can confirm the gateway
is live from inside the backend container:

```sh
# Should print "ws-pub" connection details and "ws-sub" reading
docker exec atlas-backend redis-cli -u "$REDIS_URL" client list | grep socket.io
```

Or from the host:

```sh
# WebSocket upgrade through the proxy
curl -sI -H "Connection: Upgrade" -H "Upgrade: websocket" \
     https://atlas.labmgm.org/socket.io/?EIO=4&transport=websocket | head -5
# Expect: HTTP/1.1 101 Switching Protocols
```
