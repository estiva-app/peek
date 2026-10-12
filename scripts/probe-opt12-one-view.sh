#!/usr/bin/env bash
# OPT-12: a topic opened from Desk's Open work is the same view as its page.
#
#   scripts/probe-opt12-one-view.sh "<Desk row title>" [extra probe.mjs args, e.g. --as qa2]
#
# As QA-1 (default): opens the row on Desk and reads the middle column's header
# (title, chip, the controls in it, the ⋮ menu's items, the archived notice, and
# whether an "Open full page" link exists); then goes to the file's own page
# in-app, the way a link inside Peek does (no reload), and reads the same —
# plus whether a placeholder showed on arrival and how many relay reads the
# page asked for (the held copy: OPT-3). Prints probe.mjs's JSON; compare the
# two `header` results. PROBE_SERVE=<dist> runs an unmerged build.
set -euo pipefail
cd "$(dirname "$0")/.."
ROW="$1"; shift

# The middle column's header, read off the "File actions" strip: one shape for both places.
HEADER='(async () => {
  const strip = document.querySelector("[aria-label=\"File actions\"]")
  let head = strip
  for (let i = 0; head && i < 6 && !head.querySelector("p.text-body-2-strong"); i++) head = head.parentElement
  const controls = head ? [...head.querySelectorAll("button, a")].map((b) => b.getAttribute("aria-label") || b.textContent.trim()) : []
  const notice = [...document.querySelectorAll("main *")].find((e) => e.children.length === 0 && /^Archived (with its .* )?by /.test(e.textContent))
  return {
    path: location.pathname + location.search,
    title: head?.querySelector("p.text-body-2-strong")?.textContent ?? null,
    chip: head?.querySelector("p.text-body-2-strong")?.nextElementSibling?.textContent ?? null,
    controls,
    archivedNotice: notice?.textContent ?? null,
    openFullPage: !!document.querySelector("[aria-label=\"Open full page\"]"),
  }
})()'

# The ⋮ menu's items, opened from the keyboard; no ⋮ → an empty list, not a failed run.
MENU=(
  --eval "(() => { const m = document.querySelector('[aria-label=\"File actions\"] [aria-label=\"More actions\"]'); if (!m) return { menu: 'no ⋮ button' }; m.focus(); return true })()"
  --press Enter
  --wait 500
  --eval "({ menu: [...document.querySelectorAll('[role=menuitem]')].map((m) => m.textContent.trim()) })"
  --press Escape
)

# To the file page in-app: what any link inside Peek does. Watches for a placeholder for 1.5 s.
GO_TO_PAGE='(async () => {
  const address = new URLSearchParams(location.search).get("open")
  const before = window.__relayReads?.(2)?.total ?? null
  // The conversation column only: the Folder tree on the page draws placeholders of its own on a cold mount.
  const strip = () => document.querySelector("[aria-label=\"File actions\"]")
  // The middle column: the highest ancestor of the header strip that starts where the header does, so not the tree beside it.
  const column = () => {
    let c = strip(); if (!c) return null
    let head = c; for (let i = 0; head && i < 6 && !head.querySelector("p.text-body-2-strong"); i++) head = head.parentElement
    const left = (head ?? c).getBoundingClientRect().left - 2
    while (c.parentElement && c.parentElement !== document.body && c.parentElement.getBoundingClientRect().left >= left) c = c.parentElement
    return c
  }
  // OPT-9: the conversation read draws `.animate-skeleton-in` cards; any other pulse in the column is counted apart.
  const skeleton = () => column()?.querySelectorAll(".animate-skeleton-in").length ?? 0
  const pulses = () => column()?.querySelectorAll(".animate-pulse, [aria-busy=true]").length ?? 0
  history.pushState({}, "", "/topic/" + address)
  dispatchEvent(new PopStateEvent("popstate"))
  let skeletonFrames = 0, pulseMax = 0, frames = 0, firstFrameWithStrip = null
  const until = Date.now() + 1500
  while (Date.now() < until) {
    frames++
    if (firstFrameWithStrip === null && strip()) firstFrameWithStrip = frames
    if (skeleton() > 0) skeletonFrames++
    pulseMax = Math.max(pulseMax, pulses())
    await new Promise((r) => requestAnimationFrame(r))
  }
  const c = column()
  return {
    address, frames, firstFrameWithHeader: firstFrameWithStrip, conversationSkeletonFrames: skeletonFrames, otherPulseMax: pulseMax,
    column: c ? c.tagName + "." + String(c.className).slice(0, 50) : null,
    readsBefore: before, readsAfter: window.__relayReads?.(2)?.total ?? null,
  }
})()'

# Desk's rows are clickable divs, which `--click` does not list as controls.
ROW_JSON=$(printf '%s' "$ROW" | node -e 'process.stdout.write(JSON.stringify(require("fs").readFileSync(0,"utf8")))')
FIND_ROW="[...document.querySelectorAll('main *')].find((e) => e.children.length === 0 && e.textContent.trim() === $ROW_JSON)"

node scripts/probe.mjs --as qa1 "$@" --url /app/desk \
  --until "!!$FIND_ROW" \
  --eval "($FIND_ROW).closest('.cursor-pointer').click(), true" \
  --until "!!document.querySelector('[aria-label=\"File actions\"]') && !document.querySelector('main .animate-skeleton-in')" \
  --wait 1500 \
  --eval "$HEADER" \
  "${MENU[@]}" \
  --eval "$GO_TO_PAGE" \
  --until "!!document.querySelector('[aria-label=\"File actions\"]')" \
  --wait 1500 \
  --eval "$HEADER" \
  "${MENU[@]}"
