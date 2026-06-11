# Deterministic deploy convergence (one-time setup)

The production pipeline gates the `:latest` retag behind a manual approval, then
**converges** the running container to the new image. Convergence has two layers:

1. **Watchtower** (already running on the host) polls Docker Hub and pulls
   `:latest`. This is the fallback, but its update is **non-atomic** — on a slow
   Docker daemon it can stop the old container and fail to start the new one,
   stranding the service (this caused a ~10 min outage once).
2. **The `converge` job** (in `production.yml` / `rollback.yml`) deterministically
   runs `docker compose pull && docker compose up -d <service>` on the host right
   after the approved retag. Compose recreate is atomic per service, so there is
   no rename race.

`verify-deploy` then polls `GET /api/v1/version` until it reports the released
commit and smoke-tests the app, regardless of which layer converged it.

The `converge` job is **inert** until you complete the setup below
(`vars.DEPLOY_CONVERGE_ENABLED` is unset). Until then, if a deploy strands,
recover manually: `ssh <host>` → `cd /home/user/docker/mgm-atlas-backend` →
`docker compose up -d atlas-backend`.

## One-time setup

### 1. Tailscale OAuth client (lets the CI runner reach the tailnet)
- Tailscale admin → **Settings → OAuth clients → Generate**.
- Scope: `devices:write` (or the "auth keys" write scope), tag: `tag:ci`.
- Add `tag:ci` to your tailnet policy (ACL) as an `tagOwners` entry, and grant it
  SSH/network access to the deploy host, e.g.:
  ```jsonc
  "tagOwners": { "tag:ci": ["autogroup:admin"] },
  "acls": [
    { "action": "accept", "src": ["tag:ci"], "dst": ["keikaku:22"] }
  ]
  ```
- Save the client ID + secret as repo **secrets**: `TS_OAUTH_CLIENT_ID`,
  `TS_OAUTH_SECRET`.

### 2. Deploy SSH key (lets the runner log into the host)
```bash
ssh-keygen -t ed25519 -f atlas-deploy -C "atlas-ci-deploy" -N ""
# add the PUBLIC key on the host:
#   ssh <host> 'cat >> ~/.ssh/authorized_keys' < atlas-deploy.pub
```
- Save the **private** key as repo secret `DEPLOY_SSH_KEY`.
- Optionally restrict the key on the host with a `command=` / `from=` prefix in
  `authorized_keys` so it can only run docker compose for this project.

### 3. Repo variables
- `DEPLOY_HOST` = `keikaku.tailce5c0d.ts.net`
- `DEPLOY_USER` = `user`
- `DEPLOY_CONVERGE_ENABLED` = `true`  ← flips the job on

### 4. Verify
Trigger a deploy (`workflow_dispatch` on `production`, or merge to `main`),
approve the `production` gate, and confirm the `converge` job runs `compose up -d`
and `verify-deploy` reports the new `sha`.

## Rollback
`rollback.yml` (workflow_dispatch, input `image_tag = latest-<sha7>`) re-points
`:latest` and converges the same way.
