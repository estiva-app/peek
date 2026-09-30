#!/usr/bin/env bash
# CON-20: the production run, in one go — run by a person, because it signs with exported keys.
#
#   scripts/con20-run.sh            # expects the keys in ~/.keys.json
#
# Opens the relay's created_at floor window (CON-13) and closes it again whatever happens,
# takes fresh exports (the plan's input, the memberships, the "before" snapshot), applies,
# and shreds the keys file on the way out.
set -euo pipefail
cd "$(dirname "$0")/.."
BOX=root@167.233.252.136
S=~/con20-scratch
KEYS=${CON20_KEYS:-~/.keys.json}
[ -f "$KEYS" ] || { echo "no $KEYS — export the keys first"; exit 1; }
set -a; . ~/.estiva-agent.env; set +a

close() {
  ssh "$BOX" 'cd /opt/buzz && [ -f .env.bak-con20 ] && cp .env.bak-con20 .env && ./run.sh restart >/dev/null 2>&1; sleep 20; docker compose exec -T relay env | grep -c BUZZ_CREATED_AT_FLOOR_SECS || true' \
    | sed 's/^0$/floor window closed/'
  shred -u "$KEYS" 2>/dev/null && echo "keys shredded" || true
}
trap close EXIT

scripts/con20-export.sh > "$S/export.jsonl"
scripts/con20-export.sh scripts/con20-members.sql > "$S/members.jsonl"
scripts/con20-export.sh scripts/con20-snapshot.sql > "$S/before.jsonl"

ssh "$BOX" 'cd /opt/buzz && grep -q "^BUZZ_CREATED_AT_FLOOR_SECS=" .env || { cp .env .env.bak-con20 && printf "BUZZ_CREATED_AT_FLOOR_SECS=4500000\nBUZZ_MAX_TIMESTAMP_DRIFT_SECS=4500000\n" >> .env; }; ./run.sh restart >/dev/null 2>&1; sleep 20; docker compose exec -T relay env | grep BUZZ_CREATED_AT_FLOOR_SECS'

CON20_KEYS="$KEYS" npx tsx --tsconfig tsconfig.app.json scripts/con20-kind9-to-1111.ts apply 2>&1 | tee "$S/apply.log"
