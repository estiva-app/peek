# Deploying Estiva Peek

Target: `https://peek.estiva.app`, through the `estiva-prod` Cloudflare Tunnel.

## One deploy

Peek is a static bundle that talks to the relay from the browser. There has
been no backend of its own since REM-7 deleted `convex/`.

```
push to main → CI: typecheck, test, gate
                     ↓
             npm run build   (VITE_RELAY_URL set on the step)
                     ↓
             build image → ghcr.io/estiva-app/peek:main
                     ↓
   systemd timer on the box, every 2 min → update.sh → pull → restart
```

The Dockerfile does **not** build. It copies `dist/`, which CI built.

**Without `VITE_RELAY_URL` the build runs in mock mode for every relay path** —
nothing reaches the relay, and nothing says so. It is set on the build step in
`.github/workflows/deploy.yml` (`https://estiva.estiva.app`).

## Why its own subdomain

Peek's Vite build emits absolute asset paths (`/assets/index-<hash>.js`), so it
cannot be served under a path prefix the way Estiva Ship is. The relay allows
the origin by `BUZZ_CORS_ORIGINS`.

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

### 2. Secrets

None beyond the `GITHUB_TOKEN` every workflow gets — no `DEPLOY_SSH_KEY`, no
`DEPLOY_HOST`, and since REM-7 no `CONVEX_DEPLOY_KEY`.

### 3. Make the image pullable

GitHub → `estiva-app` → **Packages** → `peek` → **Package settings** →
**Change visibility** → Public. Otherwise the box cannot pull it without
credentials.

### 4. Lay out the deploy directory

```bash
ssh root@167.233.252.136 'mkdir -p /opt/estiva-peek'
scp deploy/docker-compose.yml deploy/update.sh \
    deploy/estiva-peek-update.service deploy/estiva-peek-update.timer \
    root@167.233.252.136:/opt/estiva-peek/
ssh root@167.233.252.136 'chmod +x /opt/estiva-peek/update.sh'
```

### 5. Start it and turn on automatic deploys

```bash
cd /opt/estiva-peek && docker compose pull && docker compose up -d
cp estiva-peek-update.service estiva-peek-update.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now estiva-peek-update.timer
```

### 6. Verify

```bash
curl -I https://peek.estiva.app/
curl -I https://peek.estiva.app/some/deep/route   # 200 — SPA fallback
```

## Operating it

**Watch a deploy:** `journalctl -u estiva-peek-update -f`

**Deploy now:** `systemctl start estiva-peek-update`

**Roll back:** stop the timer first, or it pulls `main` over the rollback within
two minutes.

```bash
systemctl stop estiva-peek-update.timer
ESTIVA_PEEK_IMAGE=ghcr.io/estiva-app/peek:<sha> docker compose up -d --force-recreate
```

Rolling back to an image from before REM-7 brings back a bundle that talks to
Convex, and works only while the Convex deployment is still up.
