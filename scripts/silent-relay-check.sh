#!/usr/bin/env bash
# 5cd7579f's Done-when as QA-1, with the kit's silent relay (scripts/silent.js). Fills the copy (the Desk and the
# conversation with QA-2), reopens with the relay silent, reads the rail's dot at ~20 s and ~28 s, opens the
# conversation (saved messages, never "No messages"), then brings the relay back in the same tab and waits for the
# dot to clear. PROBE_SERVE=<dist> runs an unmerged build at the real origin; unset, it checks production.
#   bash scripts/silent-relay-check.sh <out dir>
set -euo pipefail
out=${1:?out dir}
mkdir -p "$out"
here=$(cd "$(dirname "$0")" && pwd)
dot="JSON.stringify({ t: Math.round(performance.now()), dot: document.querySelector('[data-freshness]')?.dataset.freshness ?? null, words: document.querySelector('[data-freshness]')?.getAttribute('aria-label') ?? null, silent: window.__silent })"
said="JSON.stringify({ t: Math.round(performance.now()), messages: (document.querySelector('main')?.innerText.match(/\\d{1,2}:\\d{2} (AM|PM)/g) ?? []).length, noMessages: /No messages/i.test(document.body.innerText) })"
messages="/\\d{1,2}:\\d{2} (AM|PM)/.test(document.querySelector('main')?.innerText ?? '')"
node "$here/probe.mjs" --as qa1 --init "$here/silent.js" --timeout 70000 \
  --url /app/desk --until "document.querySelector('main')?.innerText.includes('QA-2')" \
  --click "QA-2" --until "$messages" --wait 3000 \
  --eval "localStorage.setItem('probe.silent','on')" \
  --tab /app/desk --wait 20000 --eval "$dot" --wait 8000 --eval "$dot" --screenshot "$out/silent-28s.png" \
  --click "QA-2" --wait 10000 --eval "$said" --eval "$dot" --screenshot "$out/conversation.png" \
  --eval "localStorage.setItem('probe.silent','off')" \
  --until "!document.querySelector('[data-freshness]')" --eval "$dot" --eval "$said" --screenshot "$out/back.png" \
  > "$out/run.json"
