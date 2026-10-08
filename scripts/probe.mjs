/**
 * Run Peek as an identity, headless, and print what it did as JSON (PER-23).
 *
 * Authenticated checks used to be a checklist handed to Miky. With a session
 * to act as (PER-22), the agent can run them itself from WSL, where Claude in
 * Chrome does not work.
 *
 *   SETTLED="__teamUnread().some((h) => h.frontierReady && h.lastLoad && h.lastLoad.outcome !== 'pending')"
 *   node scripts/probe.mjs --as qa1 --url /app/folders --until "$SETTLED" --eval "__teamUnread()"
 *   node scripts/probe.mjs --as qa2 --url /app/folders --timeout 180000 \
 *     --until "__teamUnread().some((h) => h.lit.includes('<folder>'))" --eval "__teamUnread('<folder>')"
 *   node scripts/probe.mjs --as qa2 --url /app/folders/<folder> --click "Follow this folder"
 *
 * `__teamUnread()` is `[]` until a `useTeamUnread` mounts, and only the
 * Folders page and a file page's tree mount one — not the Desk. Wait for the
 * hook to settle before reading it: a read straight after sign-in reports
 * `relayState: "connecting"` and no Folders.
 *
 * Steps run in argument order, so `--click`, `--fill`, `--press`, `--hover`,
 * `--drag`, `--wait`, `--until`, `--eval` and `--screenshot` can be repeated and
 * interleaved. `PROBE_TRACE=1` prints each step on stderr as it starts.
 *
 * `PROBE_SERVE=<dist dir>` runs an unmerged build at the real origin: the
 * probe's browser answers `--base`'s files from the local build, so sign-in,
 * the relay's CORS and NIP-98 behave as on production. Build it as the deploy
 * does first: `VITE_RELAY_URL=https://estiva.estiva.app npm run build`.
 *
 * `--hover <css>` puts the pointer over the first match, for a control drawn
 * only under it. `--drag "<from css> => <to css>"` drags the first match of one
 * selector onto the other with the real mouse — pointer down, moves, pointer up
 * — so an editor sees the browser's own dragstart and drop, not a selection
 * rewritten in script (MAN-12 passed that shortcut and broke on production).
 * It works against Storybook; against ship.estiva.app it hangs, and fails at
 * `--timeout` (RIC-18) — dispatch the drag events with `--eval` there.
 * Nothing is printed until the run ends, and then only one JSON object on
 * stdout. A step that fails stops the run; a failed `--click` or `--fill`
 * lists the controls that were on the page instead. A screenshot is written only when asked for, because a picture costs
 * many more tokens to read than the same state as text.
 *
 * ## Identities
 *
 * - `qa1`, `qa2` sign in with `POST <id>/auth/test-login`, reading
 *   `QA{n}_EMAIL` / `QA{n}_SECRET` from the environment, or from
 *   `~/.estiva-qa.env` when they are not set. **The default for anything that
 *   reads or moves read state.**
 * - any other name needs `--session <file>`: the JSON a delegated login saved
 *   (`cookie_name`, `session_token`, `pubkey`; see estiva-id#69). Acting as a
 *   real person moves their real read markers — opening a Folder advances
 *   them — so it is for inspecting and fixing that person's own state.
 *
 * The session is set as a cookie on the Estiva ID origin and Peek is loaded
 * signed out. Its silent boot (`/authorize?prompt=none`, a top-level
 * navigation, so the `SameSite=Lax` cookie goes with it) turns that into a
 * Peek token exactly as it does for a person, so the probe exercises the real
 * sign-in rather than planting a token beside it.
 *
 * `--base https://ship.estiva.app` runs Ship as the same identity — how a
 * Peek write is checked where the other app renders it (RIC-13).
 * `--base http://localhost:5173` runs against a dev server; `--id` names the
 * Estiva ID origin when that is not production.
 *
 * ## Read-state slot
 *
 * Every run is a fresh browser, and a fresh browser used to mint a new
 * read-state slot: QA-1 reached 141, and every tab then decrypted all of them
 * (Peek 23130326). Each identity now reuses one slot per app, derived from its
 * pubkey and planted in `localStorage` before the app loads. `--slot fresh`
 * leaves it out, for a check that needs a brand-new installation — and leaves
 * one more slot on the relay. Two runs as the same identity at the same time
 * share the slot and can overwrite each other's markers: give one of them
 * `--slot fresh`.
 *
 * The browser is the Chromium 1228 that `playwright-core 1.61.1` matches, the
 * same one `render-story.mjs` uses.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { chromium } from 'playwright-core'

const usage = `usage: probe.mjs --as <qa1|qa2|name> [--session file] [--base url] [--id url] [--slot pinned|fresh]
  [--url path] [--click label] [--fill label=text] [--press key] [--hover css] [--drag "from => to"]
  [--wait ms] [--until expr] [--timeout ms] [--eval expr] [--screenshot file] [--net file]`

const STEPS = new Set(['--click', '--fill', '--press', '--hover', '--drag', '--wait', '--until', '--eval', '--screenshot'])
const options = { base: 'https://peek.estiva.app', id: 'https://id.estiva.app', url: '/', timeout: '30000' }
const steps = []
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i += 2) {
  const [name, value] = [argv[i], argv[i + 1]]
  if (!name?.startsWith('--') || value === undefined) fail(`${name ?? ''} needs a value\n${usage}`)
  if (STEPS.has(name)) steps.push([name.slice(2), value])
  else options[name.slice(2)] = value
}
if (!options.as) fail(usage)
const timeout = Number(options.timeout)

const executablePath = join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome')
if (!existsSync(executablePath)) fail(`no chromium at ${executablePath} — see render-story.mjs`)

const session = await sessionFor(options.as)
const report = { as: options.as, pubkey: session.pubkey, base: options.base, steps: [], errors: [] }
// --net <file>: every request and socket frame, stamped with wall-clock ms, for
// a driver to split by its own windows (probe-switch.mjs).
const net = options.net ? [] : null

const browser = await chromium.launch({ executablePath })
try {
  const idOrigin = new URL(options.id)
  // A service worker would answer from production's cache, around the routes below.
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ...(process.env.PROBE_SERVE ? { serviceWorkers: 'block' } : {}),
  })
  await context.addCookies([
    {
      name: session.cookie_name,
      value: session.session_token,
      domain: idOrigin.hostname,
      path: '/',
      httpOnly: true,
      secure: idOrigin.protocol === 'https:',
      sameSite: 'Lax',
    },
  ])
  if (options.slot !== 'fresh') await context.addInitScript(pinReadStateSlot, pinnedSlots(session.pubkey, options.base))
  if (process.env.PROBE_SERVE) {
    const dist = process.env.PROBE_SERVE
    const origin = new URL(options.base).origin
    // A predicate, not a `${base}/**` glob: the glob misses `/?code=…`, and the
    // page then silently comes from production.
    await context.route(
      (url) => url.origin === origin,
      (route) => {
        const path = join(dist, new URL(route.request().url()).pathname)
        return route.fulfill({ path: existsSync(path) && !path.endsWith('/') ? path : join(dist, 'index.html') })
      },
    )
    // A redirect's later hops are never routed, and a fulfilled 302 is followed
    // inside the same chain, so Estiva ID's redirect back to the app becomes a
    // fresh navigation that the route above answers.
    await context.route(
      (url) => url.origin === idOrigin.origin,
      async (route) => {
        // Only the sign-in navigation needs this; `/sign` and the rest go straight
        // through, so a reset there is the page's to handle, not the probe's crash.
        if (!route.request().isNavigationRequest()) return route.continue()
        let response
        try {
          response = await route.fetch({ maxRedirects: 0 })
        } catch {
          return route.abort('connectionreset')
        }
        const location = response.headers()['location']
        if (response.status() >= 300 && response.status() < 400 && location && new URL(location, idOrigin).origin === origin) {
          const to = JSON.stringify(new URL(location, idOrigin).href)
          return route.fulfill({ status: 200, contentType: 'text/html', body: `<script>location.replace(${to})</script>` })
        }
        return route.fulfill({ response })
      },
    )
  }
  const page = await context.newPage()
  // Every WebSocket the tab opens, and whether it closed before the run ended:
  // "one relay connection per tab" is otherwise invisible from the page.
  report.sockets = []
  page.on('websocket', (ws) => {
    const socket = { url: ws.url(), closed: false }
    report.sockets.push(socket)
    ws.on('close', () => {
      socket.closed = true
    })
    if (net) {
      ws.on('framesent', (f) => net.push({ at: Date.now(), kind: 'ws-out', body: String(f.payload).slice(0, 300) }))
      ws.on('framereceived', (f) => {
        const text = String(f.payload)
        // Only what bears on cost and refusal: a CLOSED or NOTICE, or an OK that says no.
        if (/^\["(CLOSED|NOTICE)"/.test(text) || /^\["OK",[^,]+,false/.test(text)) net.push({ at: Date.now(), kind: 'ws-in', body: text.slice(0, 300) })
      })
    }
  })
  if (net) {
    page.on('request', (r) => {
      if (['image', 'font', 'stylesheet', 'script', 'document'].includes(r.resourceType())) return
      // Bodies only where they say what was read or written. Anything else may carry a secret: a /token
      // renewal's refresh token, a nip44 plaintext. The endpoint alone is enough for those.
      const body = /\/(query|events|sign)$/.test(new URL(r.url()).pathname) ? (r.postData() ?? '').slice(0, 300) : ''
      net.push({ at: Date.now(), kind: 'http', method: r.method(), url: r.url().slice(0, 160), body })
    })
    page.on('response', (r) => {
      if (r.status() === 429) net.push({ at: Date.now(), kind: 'http-429', url: r.url().slice(0, 160) })
    })
  }
  page.on('pageerror', (e) => {
    const frame = e.stack?.split('\n').find((line) => line.trim().startsWith('at '))?.trim()
    report.errors.push(`${String(e).slice(0, 300)} (on ${page.url().slice(0, 200)}${frame ? `, ${frame.slice(0, 200)}` : ''})`)
  })
  page.on('console', (m) => {
    if (m.type() === 'error') report.errors.push(`${m.text().slice(0, 300)} (${m.location().url.slice(0, 200) || 'no url'})`)
  })
  page.on('response', (r) => {
    if (r.status() >= 400) report.errors.push(`HTTP ${r.status()} ${r.request().method()} ${r.url().slice(0, 200)}`)
    // The SPA fallback answers a missing script with index.html and a 200.
    else if (r.request().resourceType() === 'script' && /text\/html/.test(r.headers()['content-type'] ?? ''))
      report.errors.push(`script served as HTML: ${r.url().slice(0, 200)}`)
  })

  await page.goto(new URL(options.url, options.base).href)
  report.signedIn = await signedIn(page)
  report.url = page.url()
  if (!report.signedIn) throw new Error(`not signed in; ended on ${report.url}`)

  for (const [step, value] of steps) {
    const entry = { [step]: value }
    report.steps.push(entry)
    // PROBE_TRACE=1: each step on stderr as it starts, so a run that hangs says where.
    if (process.env.PROBE_TRACE) console.error(`${new Date().toISOString()} ${step} ${String(value).slice(0, 80)}`)
    try {
      entry.result = await run(page, step, value)
    } catch (error) {
      entry.error = String(error.message ?? error).split('\n')[0]
      // What could have been clicked or filled instead — cheaper than a screenshot.
      if (step === 'click' || step === 'fill') entry.available = await controls(page).catch(() => [])
      break
    }
  }
  report.url = page.url()
} catch (error) {
  report.failure = String(error.message ?? error).split('\n')[0]
} finally {
  await browser.close()
}
if (net) {
  const { writeFileSync } = await import('node:fs')
  writeFileSync(options.net, JSON.stringify(net))
}
// A page that logs the same error on every render would otherwise drown the result.
report.errorCount = report.errors.length
report.errors = [...new Set(report.errors)].slice(0, 10)
console.log(JSON.stringify(report, null, 2))
process.exit(report.failure || report.steps.some((s) => s.error) ? 1 : 0)

async function run(page, step, value) {
  switch (step) {
    case 'eval':
      return page.evaluate(async (source) => {
        // Indirect eval: the expression sees the page's globals, not this function's scope.
        const result = await (0, eval)(source)
        return result === undefined ? null : JSON.parse(JSON.stringify(result))
      }, value)
    case 'until':
      await page.waitForFunction(
        (source) => {
          try {
            return Boolean((0, eval)(source))
          } catch {
            return false
          }
        },
        value,
        { timeout, polling: 500 },
      )
      return true
    case 'wait':
      await page.waitForTimeout(Number(value))
      return true
    case 'click': {
      const name = { name: value }
      await page
        .getByRole('button', name)
        .or(page.getByRole('link', name))
        .or(page.getByRole('tab', name))
        .or(page.getByRole('menuitem', name))
        .or(page.getByRole('option', name))
        .first()
        .click({ timeout })
      return page.url()
    }
    case 'fill': {
      const at = value.indexOf('=')
      if (at === -1) throw new Error('--fill takes label=text')
      const [label, text] = [value.slice(0, at), value.slice(at + 1)]
      await page
        .getByLabel(label)
        .or(page.getByPlaceholder(label))
        .or(page.getByRole('textbox', { name: label }))
        .first()
        .fill(text, { timeout })
      return true
    }
    case 'press':
      await page.keyboard.press(value)
      return true
    // The real pointer over the first match: what draws a control that exists only under the pointer.
    case 'hover':
      await page.locator(value).first().hover({ timeout })
      return true
    case 'drag': {
      const at = value.indexOf('=>')
      if (at === -1) throw new Error('--drag takes "<from css> => <to css>"')
      const [from, to] = [value.slice(0, at).trim(), value.slice(at + 2).trim()]
      // A person's drag: down on the source, ten moves to the target's lower edge, up — as the Storybook check that passed.
      // Against ship.estiva.app both this and dragTo hang at the first move after down (RIC-18, 5 October); there, dispatch
      // dragstart/dragover/drop with --eval instead (~/ric18-scratch/prod-drop.sh).
      const a = await page.locator(from).first().boundingBox({ timeout })
      const b = await page.locator(to).first().boundingBox({ timeout })
      if (!a || !b) throw new Error(`--drag: ${a ? to : from} is not on screen`)
      const [x, y] = [a.x + a.width / 2, a.y + a.height / 2]
      const drag = (async () => {
        await page.mouse.move(x, y)
        await page.mouse.down()
        for (let i = 1; i <= 10; i++) await page.mouse.move(x + 40 + i * 10, y + ((b.y + b.height - 3 - y) * i) / 10)
        await page.mouse.up()
      })()
      // The mouse takes no timeout, and a hung drag would otherwise hold the run — and its one JSON — for ever.
      let timer
      await Promise.race([drag, new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(`--drag did not finish in ${timeout}ms`)), timeout)))])
      clearTimeout(timer)
      return true
    }
    case 'screenshot':
      await page.screenshot({ path: value })
      return value
  }
}

/** The accessible names of the visible controls, as `--click` and `--fill` match them. */
function controls(page) {
  return page.evaluate(() => {
    const seen = new Set()
    for (const el of document.querySelectorAll('button, a[href], [role=tab], [role=menuitem], [role=option], textarea, input, [contenteditable=true]')) {
      if (!el.checkVisibility?.()) continue
      const name = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.textContent || '').trim().replace(/\s+/g, ' ')
      if (name) seen.add(`${el.matches('textarea, input, [contenteditable=true]') ? 'field' : 'control'}: ${name.slice(0, 60)}`)
    }
    return [...seen].slice(0, 60)
  })
}

/**
 * Wait for the silent boot to land back on the app holding a token. The keys
 * are the identity package's, under each app's own prefix: Peek's
 * `peek.estivaId` in `sessionStorage`, Ship's `ship.estiva-id` in
 * `localStorage` (Ship's `src/auth/estivaId.ts`). Knowing only Peek's made
 * `--base https://ship.estiva.app` report signed out and stop before its first
 * step, though Ship had signed in (RIC-13). Leaf repeated it with
 * `leaf.estiva-id`, so any `<app>.estiva-id` key in `localStorage` counts: it
 * is what `create-estiva-app` scaffolds, so the next app is covered too.
 */
async function signedIn(page) {
  const base = new URL(options.base).origin
  try {
    await page.waitForFunction(
      (origin) =>
        location.origin === origin &&
        location.pathname !== '/auth/callback' &&
        (Object.keys(sessionStorage).some((key) => key.startsWith('peek.estivaId') && /token/i.test(key)) ||
          Object.keys(localStorage).some((key) => /^[a-z0-9-]+\.estiva-id\b/.test(key) && /token/i.test(key))),
      base,
      { timeout, polling: 250 },
    )
    return true
  } catch {
    return false
  }
}

async function sessionFor(as) {
  if (options.session) return JSON.parse(readFileSync(options.session, 'utf8'))
  const qa = /^qa([12])$/.exec(as)
  if (!qa) fail(`--as ${as} needs --session <file>; only qa1 and qa2 sign in by themselves`)
  const envFile = join(homedir(), '.estiva-qa.env')
  if (!process.env[`QA${qa[1]}_EMAIL`] && existsSync(envFile)) process.loadEnvFile(envFile)
  const response = await fetch(new URL('/auth/test-login', options.id), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: process.env[`QA${qa[1]}_EMAIL`], secret: process.env[`QA${qa[1]}_SECRET`] }),
  })
  const body = await response.json().catch(() => ({}))
  if (response.status !== 200) fail(`test-login ${response.status}: ${JSON.stringify(body)}`)
  return body
}

/** One read-state slot per identity and app, the same every run (see "Read-state slot"). */
function pinnedSlots(pubkey, base) {
  const hex = (label) => createHash('sha256').update(`probe-read-state:${label}:${pubkey}`).digest('hex')
  return {
    origin: new URL(base).origin,
    slots: {
      'estiva-peek:read-state-slot': { slotId: hex('peek').slice(0, 32), clientId: `peek-${hex('peek-client').slice(0, 8)}` },
      'ship.readstate.slot': { slotId: hex('ship').slice(0, 32), clientId: `ship-${hex('ship-client').slice(0, 8)}` },
    },
  }
}

/** Runs in the page, before the app: plant the slots unless the app already holds one. */
function pinReadStateSlot({ origin, slots }) {
  if (location.origin !== origin) return
  for (const [key, identity] of Object.entries(slots)) {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(identity))
  }
}

function fail(message) {
  console.error(message)
  process.exit(2)
}
