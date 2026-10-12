#!/usr/bin/env bash
# OPT-12's archived leg, and where Desk's writes leave the person, as QA-1:
#
#   PROBE_SERVE=dist scripts/probe-opt12-archived.sh "<Desk row title>"
#
# On Desk, opens the row, starts a throwaway topic inside it from the ⋮ menu
# (it must open in Desk's pane), adds it to Open work, archives it, reads the
# header and the archived notice (`probe-opt12-one-view.sh`'s HEADER), goes to
# its page in-app and reads the same, comes back to Desk, deletes it from the ⋮
# menu (the pane must close and the URL stay /app/desk). Prints probe.mjs's JSON.
set -euo pipefail
cd "$(dirname "$0")/.."
ROW="$1"; shift
THROWAWAY="OPT-12 throwaway $(date +%s)"

js() { printf '%s' "$1" | node -e 'process.stdout.write(JSON.stringify(require("fs").readFileSync(0,"utf8")))'; }
FIND_ROW="[...document.querySelectorAll('main *')].find((e) => e.children.length === 0 && e.textContent.trim() === $(js "$ROW"))"
# The ⋮ menu's item by its exact text: opened from the keyboard, clicked by script (a substring --click can hit another control).
menu() {
  printf '%s\0' --eval "document.querySelector('[aria-label=\"File actions\"] [aria-label=\"More actions\"]').focus(), true" \
    --press Enter --wait 400 \
    --eval "(() => { const item = [...document.querySelectorAll('[role=menuitem]')].find((m) => m.textContent.trim() === $(js "$1")); if (!item) return { missing: $(js "$1"), menu: [...document.querySelectorAll('[role=menuitem]')].map((m) => m.textContent.trim()) }; item.click(); return true })()"
}
# A button in the open dialog by its text; lists the dialog's buttons when there is none.
dialog_button() {
  # A toast is a dialog too ("Undo"): wait for the one holding the button.
  local find="[...document.querySelectorAll('[role=dialog] button,[role=alertdialog] button')].find((b) => b.textContent.trim() === $(js "$1"))"
  printf '%s\0' --until "!!$find" --eval "($find).click(), true"
}

# --delete <address>: open it on Desk and delete it there; the pane must close and Desk stay.
if [ "$ROW" = "--delete" ]; then
  ADDRESS="$1"; shift
  args=(--as qa1 --timeout 60000 --url "/app/desk?open=$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$ADDRESS")"
    --until "!!document.querySelector('[aria-label=\"File actions\"] [aria-label=\"More actions\"]')")
  while IFS= read -r -d '' a; do args+=("$a"); done < <(menu "Delete")
  while IFS= read -r -d '' a; do args+=("$a"); done < <(dialog_button "Delete")
  args+=(--wait 8000
    --eval "({ afterDelete: location.pathname + location.search, paneOpen: !!document.querySelector('[aria-label=\"File actions\"]'), toasts: [...document.querySelectorAll('[role=status],[role=alert],[role=dialog]')].map((t) => t.textContent.trim().slice(0, 200)).filter(Boolean) })")
  exec node scripts/probe.mjs "$@" "${args[@]}"
fi
HEADER=$(sed -n "/^HEADER='/,/^})()'/p" scripts/probe-opt12-one-view.sh | sed "1s/^HEADER='//; \$s/'\$//")
STRIP="!!document.querySelector('[aria-label=\"File actions\"]')"
PANE_IS_NEW="decodeURIComponent(location.search).includes(':') && document.querySelector('p.text-body-2-strong')?.textContent === $(js "$THROWAWAY")"

args=(--as qa1 --timeout 60000 --url /app/desk
  --until "!!$FIND_ROW" --eval "($FIND_ROW).closest('.cursor-pointer').click(), true"
  --until "$STRIP && !!document.querySelector('[aria-label=\"File actions\"] [aria-label=\"More actions\"]')")
while IFS= read -r -d '' a; do args+=("$a"); done < <(menu "New topic inside")
args+=(--until "!!document.querySelector('[role=dialog] input')"
  --eval "(() => { const i = document.querySelector('[role=dialog] input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, $(js "$THROWAWAY")); i.dispatchEvent(new Event('input', { bubbles: true })); return true })()"
  --press Enter
  --until "$PANE_IS_NEW"
  --eval "({ startedInDesk: location.pathname === '/app/desk', open: new URLSearchParams(location.search).get('open') })"
  --wait 1500)
while IFS= read -r -d '' a; do args+=("$a"); done < <(menu "Add to Open work")
args+=(--wait 1500)
while IFS= read -r -d '' a; do args+=("$a"); done < <(menu "Archive…")
while IFS= read -r -d '' a; do args+=("$a"); done < <(dialog_button "Archive topic")
args+=(--until "[...document.querySelectorAll('main *')].some((e) => e.children.length === 0 && /^Archived by /.test(e.textContent))"
  --eval "$HEADER"
  --eval "(() => { const a = new URLSearchParams(location.search).get('open'); sessionStorage.setItem('opt12', a); history.pushState({}, '', '/topic/' + a); dispatchEvent(new PopStateEvent('popstate')); return true })()"
  --until "$STRIP && [...document.querySelectorAll('main *')].some((e) => e.children.length === 0 && /^Archived by /.test(e.textContent))"
  --eval "$HEADER"
  --eval "(() => { history.pushState({}, '', '/app/desk?open=' + encodeURIComponent(sessionStorage.getItem('opt12'))); dispatchEvent(new PopStateEvent('popstate')); return true })()"
  --until "$STRIP && document.querySelector('p.text-body-2-strong')?.textContent === $(js "$THROWAWAY")")
while IFS= read -r -d '' a; do args+=("$a"); done < <(menu "Delete")
while IFS= read -r -d '' a; do args+=("$a"); done < <(dialog_button "Delete")
# Deleting reads the Folder and then writes: allow it the time.
args+=(--wait 8000
  --eval "({ afterDelete: location.pathname + location.search, paneTitle: document.querySelector('[aria-label=\"File actions\"]') ? document.querySelector('p.text-body-2-strong')?.textContent : null })")

node scripts/probe.mjs "$@" "${args[@]}"
