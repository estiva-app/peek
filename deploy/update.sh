#!/usr/bin/env bash
#
# Pull-based deploy. Runs on the box from a systemd timer; nothing connects in.
#
# Same shape as Estiva ID's update.sh, minus the migration step — a static
# bundle has no schema. The lessons encoded here were paid for once already
# over there, so they are kept rather than simplified away:
#
#   * compare image IDs, because `docker compose pull` is silent about whether
#     anything changed;
#   * `--force-recreate`, because compose compares the *service definition* and
#     a new image behind an unchanged `:main` tag does not change it;
#   * verify the running container is the image just pulled, because "healthy"
#     and "updated" are different claims and only one of them is being tested.

set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/estiva-peek}"
IMAGE="${IMAGE:-ghcr.io/estiva-app/peek:main}"
SERVICE="${SERVICE:-estiva-peek}"

cd "$DEPLOY_DIR"

log() { echo "[$(date -Is)] $*"; }

current_digest() {
  local id
  id="$(docker image inspect --format '{{.Id}}' "$IMAGE" 2>/dev/null | tail -n1)"
  [[ -n "$id" ]] && echo "$id" || echo 'none'
}

before="$(current_digest)"
docker compose pull --quiet "$SERVICE"
after="$(current_digest)"

if [[ "$before" == "$after" ]]; then
  exit 0
fi

log "new image: ${before:0:19} -> ${after:0:19}"

log 'restarting service'
docker compose up -d --force-recreate "$SERVICE"

container_health() {
  local id
  id="$(docker compose ps -q "$SERVICE" 2>/dev/null || true)"
  [[ -n "$id" ]] || { echo 'missing'; return; }
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id" 2>/dev/null || echo 'missing'
}

for _ in {1..30}; do
  case "$(container_health)" in
    healthy)
      running="$(docker inspect -f '{{.Image}}' "$(docker compose ps -q "$SERVICE")" 2>/dev/null || echo unknown)"
      if [[ "$running" != "$after" ]]; then
        log "FAILED: still running ${running:0:19}, expected ${after:0:19}"
        exit 1
      fi
      log "healthy on ${running:0:19}"
      docker image prune -f --filter 'until=168h' >/dev/null 2>&1 || true
      exit 0
      ;;
    unhealthy) break ;;
  esac
  sleep 2
done

log 'FAILED: service did not become healthy after deploy'
docker compose logs --tail 50 "$SERVICE"
exit 1
