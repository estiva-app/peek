#!/usr/bin/env bash
# CON-20: run a read-only SQL file against production's relay database and print its rows.
#   scripts/con20-export.sh [file.sql]   (default: scripts/con20-export.sql)
set -euo pipefail
sql="${1:-$(dirname "$0")/con20-export.sql}"
exec ssh root@167.233.252.136 'cd /opt/buzz && docker compose exec -T postgres psql -q -U buzz -d buzz' < "$sql"
