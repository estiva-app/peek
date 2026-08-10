# Deploying Estiva Peek

Target: `https://peek.estiva.app`, through the `estiva-prod` Cloudflare Tunnel.

## Two halves, one deploy

Peek is a Convex backend plus a static bundle that talks to it, and they must
ship together.

```
push to main → CI: lint, test
                     ↓
             npx convex deploy --cmd 'npm run build'
             (pushes the backend AND injects the matching
              VITE_CONVEX_URL into the frontend build)
                     ↓
             build image → ghcr.io/estiva-app/peek:main
                     ↓
   systemd timer on the box, every 2 min → update.sh → pull → restart
```

`convex deploy --cmd` is the whole point of the ordering: it deploys the backend
and builds the frontend against *that* deployment in one step, so the two cannot
drift. It also removes the footgun documented in `HOW-TO-RUN.md` — "backend
changes additionally need `npx convex deploy` once per change" — because nobody
has to remember any more.

The Dockerfile therefore does **not** build. It copies `dist/`. Building the
image without a prior `convex deploy` produces a bundle pointed at nothing.

## Why its own subdomain

Peek's Vite build emits absolute asset paths (`/assets/index-<hash>.js`), so it
cannot be served under a path prefix the way Estiva Ship is. That is fine here:
unlike Ship, Peek reaches the relay **server-side from Convex**, so there is no
browser-to-relay CORS problem to solve by sharing an origin.

## First deploy, by hand

### 1. Add the tunnel hostname

https://one.dash.cloudflare.com → **Networks** → **Tunnels** → **estiva-prod** →
**Published application routes**:

| Field | Value |
| -- | -- |
| Subdomain | `peek` |
| Domain | `estiva.app` |
| Path | *(empty)* |
| Type | `HTTP` |
| URL | `localhost:8082` |

Adding it creates the DNS record automatically.

### 2. Set the Convex production environment

In the Convex dashboard, production deployment — **not** GitHub secrets. These
are read by Convex-side code at runtime, so they belong to the deployment rather
than the build:

* `NOSTR_RELAY_URL` = `https://estiva.estiva.app`
* `NOSTR_KEY_ENCRYPTION_SECRET` — required by `convex/nostr/keys.ts`

**Until `NOSTR_RELAY_URL` is set, `convex/nostr/publish.ts` no-ops silently by
design.** Peek will appear to work perfectly while nothing reaches the relay.

### 3. Add the GitHub secret

`CONVEX_DEPLOY_KEY`, from the Convex dashboard. It is the only secret this
pipeline needs — no `DEPLOY_SSH_KEY`, no `DEPLOY_HOST`.

### 4. Make the image pullable

GitHub → `estiva-app` → **Packages** → `peek` → **Package settings** →
**Change visibility** → Public. Otherwise the box cannot pull it without
credentials.

### 5. Lay out the deploy directory

```bash
ssh root@167.233.252.136 'mkdir -p /opt/estiva-peek'
scp deploy/docker-compose.yml deploy/update.sh \
    deploy/estiva-peek-update.service deploy/estiva-peek-update.timer \
    root@167.233.252.136:/opt/estiva-peek/
ssh root@167.233.252.136 'chmod +x /opt/estiva-peek/update.sh'
```

### 6. Start it and turn on automatic deploys

```bash
cd /opt/estiva-peek && docker compose pull && docker compose up -d
cp estiva-peek-update.service estiva-peek-update.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now estiva-peek-update.timer
```

### 7. Verify

```bash
curl -I https://peek.estiva.app/
curl -I https://peek.estiva.app/some/deep/route   # 200 — SPA fallback
```

## A failure mode worth knowing about

With `BUZZ_REQUIRE_RELAY_MEMBERSHIP=true`, Peek's writes to the relay are
rejected exactly as a stranger's would be. `convex/nostr/keys.ts` mints its
**own** per-user keypairs server-side, unrelated to any browser key, and the
relay has never seen them. Combined with `publish.ts` no-opping quietly, the
symptom is *Peek working perfectly while nothing reaches the relay*.

Per PEEK-55 this is deliberately not solved here — a dedicated identity service
is its own project. Until then, either admit Peek's pubkeys manually as they
appear, or accept that Peek→relay mirroring is off.

## Operating it

**Watch a deploy:** `journalctl -u estiva-peek-update -f`

**Deploy now:** `systemctl start estiva-peek-update`

**Roll back:** stop the timer first, or it pulls `main` over the rollback within
two minutes.

```bash
systemctl stop estiva-peek-update.timer
ESTIVA_PEEK_IMAGE=ghcr.io/estiva-app/peek:<sha> docker compose up -d --force-recreate
```

Note that a frontend rollback does **not** roll back the Convex backend, which
`convex deploy` has already updated. If a deploy breaks the backend, fix it
forward in Convex rather than expecting the image tag to help.
