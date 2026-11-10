#!/usr/bin/env bash
# CON-22: the production run, in one go — run by a person, because it signs with exported keys.
#
#   scripts/con22-run.sh            # expects the keys in ~/.keys.json
#
# Opens the relay's created_at floor window (CON-13) and closes it again whatever happens,
# takes fresh exports (the plan's input, the memberships, the "before" snapshot), applies,
# verifies from a fresh export, and shreds the keys file on the way out.
set -euo pipefail
cd "$(dirname "$0")/.."
BOX=root@167.233.252.136
S=~/con22-scratch
KEYS=${CON22_KEYS:-~/.keys.json}
[ -f "$KEYS" ] || { echo "no $KEYS — export the keys first"; exit 1; }
set -a; . ~/.estiva-agent.env; set +a
mkdir -p "$S"

OPENED=0
# Restores only the backup this run took, and consumes it, so a later run never reverts .env to an old copy.
close() {
  if [ "$OPENED" = 1 ]; then
    ssh "$BOX" 'cd /opt/buzz && mv .env.bak-con22 .env && ./run.sh restart >/dev/null 2>&1; sleep 20; docker compose exec -T relay env | grep -c BUZZ_CREATED_AT_FLOOR_SECS || true' \
      | sed 's/^0$/floor window closed/'
  fi
  shred -u "$KEYS" 2>/dev/null && echo "keys shredded" || true
}
trap close EXIT

scripts/con20-export.sh > "$S/export.jsonl"
scripts/con20-export.sh scripts/con20-members.sql > "$S/members.jsonl"
scripts/con20-export.sh scripts/con20-snapshot.sql > "$S/before-run.jsonl"

# Refuses rather than guess when the window is already open: whoever opened it owns closing it.
ssh "$BOX" 'cd /opt/buzz && ! grep -q "^BUZZ_CREATED_AT_FLOOR_SECS=" .env && cp .env .env.bak-con22 && printf "BUZZ_CREATED_AT_FLOOR_SECS=4500000\nBUZZ_MAX_TIMESTAMP_DRIFT_SECS=4500000\n" >> .env' \
  || { echo "the floor window is already open in /opt/buzz/.env — close it first"; exit 1; }
OPENED=1
ssh "$BOX" 'cd /opt/buzz && ./run.sh restart >/dev/null 2>&1; sleep 20; docker compose exec -T relay env | grep BUZZ_CREATED_AT_FLOOR_SECS'

CON22_KEYS="$KEYS" npx tsx --tsconfig tsconfig.app.json scripts/con22-shr8-leftovers.ts apply 2>&1 | tee "$S/apply.log"

scripts/con20-export.sh > "$S/export.jsonl"
npx tsx --tsconfig tsconfig.app.json scripts/con22-shr8-leftovers.ts verify
