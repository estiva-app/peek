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
 * `--drag`, `--wait`, `--until`, `--eval`, `--screenshot` and `--tab` can be
 * repeated and interleaved. `PROBE_TRACE=1` prints each step on stderr as it starts.
 * `--init <file>` runs a script in every page before the app's own, and `--tab
 * <path>` reopens Peek in a new tab of the same browser (probe-first-load.mjs).
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
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { chromium } from 'playwright-core'

const usage = `usage: probe.mjs --as <qa1|qa2|name> [--session file] [--base url] [--id url] [--slot pinned|fresh]
  [--tapped-ago s] [--last-used-ago s] [--relogin -] [--start signed-out]
  [--url path] [--click label] [--fill label=text] [--press key] [--hover css] [--drag "from => to"]
  [--wait ms] [--until expr] [--timeout ms] [--eval expr] [--screenshot file] [--cpu start|file] [--net file]
  [--init file] [--tab path] [--also path] [--window path] [--switch -]
  [--refuse text[|text…]] [--refuse-e id[|id…]] [--refuse-kind kind[|kind…]] [--refuse-hold ms]`

const STEPS = new Set(['--click', '--fill', '--press', '--hover', '--drag', '--wait', '--until', '--eval', '--screenshot', '--cpu', '--tab', '--also', '--window', '--switch', '--relogin'])
const options = { base: 'https://peek.estiva.app', id: 'https://id.estiva.app', url: '/', timeout: '30000' }
/** The page's DevTools session, opened by the first `--cpu` step. */
let cdp = null
/** Set once the browser exists: `--relogin`. */
let relogin = null
const steps = []
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i += 2) {
  const [name, value] = [argv[i], argv[i + 1]]
  if (!name?.startsWith('--') || value === undefined) fail(`${name ?? ''} needs a value\n${usage}`)
  if (STEPS.has(name)) steps.push([name.slice(2), value])
  else options[name.slice(2)] = value
}
if (!options.as) fail(usage)
for (const age of ['tapped-ago', 'last-used-ago'])
  if (options[age] !== undefined && !/^\d+$/.test(options[age])) fail(`--${age} takes whole seconds, not ${options[age]}`)
const timeout = Number(options.timeout)

const executablePath = join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome')
if (!existsSync(executablePath)) fail(`no chromium at ${executablePath} — see render-story.mjs`)

const session = await sessionFor(options.as)
// `tokenCalls`: every POST to Estiva ID's `/token`, from any tab, so "one renewal across two tabs" can be counted.
const report = { as: options.as, pubkey: session.pubkey, base: options.base, steps: [], errors: [], tokenCalls: [] }
// --net <file>: every request and socket frame, stamped with wall-clock ms, for
// a driver to split by its own windows (probe-switch.mjs).
const net = options.net ? [] : null

const browser = await chromium.launch({ executablePath })
// PROBE_CHROME_TRACE=<file>: a Chrome performance trace of every tab for the whole run, for a page's first bytes,
// which a `--cpu` step started from the page cannot see — open it in DevTools' Performance panel.
if (process.env.PROBE_CHROME_TRACE)
  await browser.startTracing(undefined, { path: process.env.PROBE_CHROME_TRACE, categories: ['devtools.timeline', 'v8.execute', 'disabled-by-default-devtools.timeline', 'disabled-by-default-v8.cpu_profiler', 'blink.user_timing', 'loading', 'v8', 'disabled-by-default-v8.compile'] })
try {
  const idOrigin = new URL(options.id)
  // A service worker would answer from production's cache, around the routes below.
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ...(process.env.PROBE_SERVE ? { serviceWorkers: 'block' } : {}),
  })
  const signInCookie = (signedIn) => ({
    name: signedIn.cookie_name,
    value: signedIn.session_token,
    domain: idOrigin.hostname,
    path: '/',
    httpOnly: true,
    secure: idOrigin.protocol === 'https:',
    sameSite: 'Lax',
  })
  await context.addCookies([signInCookie(session)])
  // `--relogin -`: a new Estiva ID sign-in for the same identity, as now — what a passkey tap leaves behind, for a
  // sign-in the run started older and let end (AUT-4). The next `--click "Continue with passkey"` then comes back
  // signed in, as the tap would.
  relogin = async () => {
    if (options.session) throw new Error('--relogin needs a QA sign-in; a --session file holds the old one')
    delete options['tapped-ago']
    delete options['last-used-ago']
    await context.addCookies([signInCookie(await sessionFor(options.as))])
    return true
  }
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
        return route.fulfill({ path: existsSync(path) && statSync(path).isFile() ? path : join(dist, 'index.html') })
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
  // --init <file>: a script run in every page before the app's own, on each load — a recorder that must see a
  // reload from its first frame (first-load measurements).
  if (options.init) await context.addInitScript({ path: options.init })
  /*
    Every page any tab or window loads, redirects included: a silent sign-in is Peek → Estiva ID `/authorize` →
    a 302 back, and the `/authorize` hop never commits, so only its request shows it. Origin and path only — the
    query carries the PKCE state. `report.pages` lists them per tab, a window the page opened among them.
  */
  const loaded = new Map()
  report.pages = []
  const loadedBy = (p) => {
    if (!loaded.has(p)) {
      loaded.set(p, [])
      report.pages.push(loaded.get(p))
    }
    return loaded.get(p)
  }
  // On the context, not the page: a window the page opens starts loading before its `page` event.
  const tokenUrl = new URL('/token', options.id).href
  context.on('request', (r) => {
    // The endpoint and the tab only: the body is a refresh token.
    if (r.method() === 'POST' && r.url().split(/[?#]/)[0] === tokenUrl)
      report.tokenCalls.push({ at: Date.now(), tab: (() => { try { return context.pages().indexOf(r.frame().page()) } catch { return null } })() })
    if (!r.isNavigationRequest()) return
    try {
      const frame = r.frame()
      if (frame === frame.page().mainFrame()) loadedBy(frame.page()).push(r.url().split(/[?#]/)[0])
    } catch (error) {
      // A frame already gone by the time its request is seen: nothing to attribute it to.
      report.errors.push(`navigation not attributed: ${String(error.message ?? error).slice(0, 120)}`)
    }
  })
  let page = await context.newPage()
  /** The tab `--also` left open, which `--switch` returns to. */
  let other = null
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
      // Long enough for a catch-up REQ's filters to name the conversation they read (OPT-5).
      ws.on('framesent', (f) => net.push({ at: Date.now(), kind: 'ws-out', body: String(f.payload).slice(0, 3000) }))
      ws.on('framereceived', (f) => {
        const text = String(f.payload)
        // Only what bears on cost and refusal: a CLOSED or NOTICE, or an OK that says no.
        if (/^\["(CLOSED|NOTICE)"/.test(text) || /^\["OK",[^,]+,false/.test(text)) net.push({ at: Date.now(), kind: 'ws-in', body: text.slice(0, 300) })
        // PROBE_WS_MATCH=<text>[|<text>…]: also an incoming frame that contains any of them — when a live event
        // reached the tab (OPT-5).
        else if (process.env.PROBE_WS_MATCH?.split('|').some((match) => text.includes(match))) net.push({ at: Date.now(), kind: 'ws-event', body: text.slice(0, 3000) })
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
  // A tab's errors: this one's, and each one `--tab` opens.
  const watchErrors = (page) => {
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
  }
  watchErrors(page)

  /*
    --refuse <text>[|<text>…]: the relay refuses a write whose content holds any of them (OPT-7). The signed
    event is published with a character added to its content, so its id no longer matches and the real relay
    answers with its own refusal — a considered no, which Peek does not retry. Nothing is faked, and nothing
    carrying the text is stored. `--refuse-hold <ms>` holds each such write that long first, for a run that
    acts while the send is still in flight. What the relay answered is in `report.refused`.
  */
  /*
    A reaction or a delete has no content of the person's to mark (OPT-8), so two more matchers pick it out:
    `--refuse-e <id>[|<id>…]`, any write with an `e` tag naming one of them — a reaction to, an edit of or a
    delete of that message — and `--refuse-kind <kind>[|<kind>…]`. A write matching any one matcher is refused.
  */
  if (options.refuse || options['refuse-e'] || options['refuse-kind']) {
    const needles = options.refuse ? options.refuse.split('|') : []
    const targets = new Set(options['refuse-e'] ? options['refuse-e'].split('|') : [])
    const kinds = new Set(options['refuse-kind'] ? options['refuse-kind'].split('|').map(Number) : [])
    const matches = (event) =>
      (typeof event.content === 'string' && needles.some((needle) => event.content.includes(needle))) ||
      kinds.has(event.kind) ||
      (Array.isArray(event.tags) && event.tags.some((tag) => tag[0] === 'e' && targets.has(tag[1])))
    const hold = Number(options['refuse-hold'] ?? 0)
    report.refused = []
    await context.route(
      (url) => url.pathname.endsWith('/events'),
      async (route) => {
        const request = route.request()
        let event = null
        try {
          event = request.method() === 'POST' ? JSON.parse(request.postData() ?? '') : null
        } catch {}
        if (!event || !matches(event)) return route.continue()
        const at = Date.now()
        if (hold) await new Promise((done) => setTimeout(done, hold))
        const response = await route.fetch({ postData: JSON.stringify({ ...event, content: `${event.content}.` }) })
        const body = await response.text()
        report.refused.push({ at, kind: event.kind, id: event.id, status: response.status(), body: body.slice(0, 300) })
        return route.fulfill({ response, body })
      },
    )
  }

  // PROBE_HOOK=<url>: `window.__probeHook(query)` GETs `<url><query>` from node and returns the text, for a run
  // that needs another process mid-way (probe-switch's QA-2 post). A page fetch of 127.0.0.1 is blocked by Chromium.
  if (process.env.PROBE_HOOK) await page.exposeFunction('__probeHook', (query) => fetch(`${process.env.PROBE_HOOK}${query}`).then((r) => r.text()))
  // `await __probeIdDown(true)` in an `--eval`: every page's fetches to Estiva ID fail as with no network, until
  // `__probeIdDown(false)` (AUT-3's offline open). `/sign` goes with it, so the relay cannot be read either.
  // Navigations still pass, so a page that leaves for Estiva ID shows in `pages`.
  let idDown = false
  await context.exposeBinding('__probeIdDown', (_source, on) => {
    idDown = Boolean(on)
    return idDown
  })
  await context.route(
    (url) => url.origin === idOrigin.origin,
    (route) => (idDown && !route.request().isNavigationRequest() ? route.abort('internetdisconnected') : route.fallback()),
  )
  await page.goto(new URL(options.url, options.base).href)
  report.signedIn = await signedIn(page)
  report.url = page.url()
  // `--start signed-out`: a sign-in the run started already ended (`--last-used-ago`) lands on the sign-in screen,
  // and that screen is what the steps check.
  if (!report.signedIn && options.start !== 'signed-out') throw new Error(`not signed in; ended on ${report.url}`)

  for (const [step, value] of steps) {
    const entry = { [step]: value }
    report.steps.push(entry)
    // PROBE_TRACE=1: each step on stderr as it starts, so a run that hangs says where.
    if (process.env.PROBE_TRACE) console.error(`${new Date().toISOString()} ${step} ${String(value).slice(0, 80)}`)
    try {
      // --tab <path>: close this tab and open Peek at <path> in a new one, in the same browser — what is kept on
      // the device survives, and a per-tab session does not. Later steps act in the new tab. Only its errors are
      // watched: `report.sockets`, `--net` and a `--cpu` session stay with the first tab.
      // --also <path>: the same, but the first tab stays open; --switch <any> acts in the other one again. Both
      // record `documents`, every page the new tab loaded on its way in — an Estiva ID `/authorize` among them is a
      // sign-in the tab had to do (PEE-3), by origin and path only, since the query carries the PKCE state.
      // --window <path>: like --also, but the page opens it — `window.open` with `noopener`, so it starts with no
      // copy of this tab's sessionStorage, as a window the person opens does. Its first page is not in `documents`:
      // that request is issued before its frame exists.
      if (step === 'tab' || step === 'also' || step === 'window') {
        const opened = step === 'window' ? context.waitForEvent('page') : null
        if (opened) await page.evaluate((path) => void window.open(path, '_blank', 'noopener,popup,width=1280,height=800'), value)
        const next = opened ? await opened : await context.newPage()
        watchErrors(next)
        const documents = loadedBy(next)
        if (step === 'tab') await page.close()
        else other = page
        page = next
        if (!opened) await page.goto(new URL(value, options.base).href)
        entry.result = await signedIn(page)
        // Copied when the tab is signed in: what it loaded on the way in, not what a later step makes it load.
        entry.documents = [...documents]
        if (!entry.result) throw new Error(`not signed in; ended on ${page.url()}`)
      } else if (step === 'switch') {
        if (!other) throw new Error('--switch needs a tab opened with --also')
        ;[page, other] = [other, page]
        await page.bringToFront()
        entry.result = page.url()
      } else entry.result = await run(page, step, value)
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
  if (process.env.PROBE_CHROME_TRACE) await browser.stopTracing()
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
    case 'relogin':
      return relogin()
    case 'screenshot':
      await page.screenshot({ path: value })
      return value
    // `--cpu start` starts the page's CPU profiler; `--cpu <file>` stops it and writes a .cpuprofile there (OPT-6).
    case 'cpu': {
      cdp ??= await page.context().newCDPSession(page)
      if (value === 'start') {
        await cdp.send('Profiler.enable')
        await cdp.send('Profiler.setSamplingInterval', { interval: 100 })
        await cdp.send('Profiler.start')
        return 'started'
      }
      const { profile } = await cdp.send('Profiler.stop')
      const { writeFileSync } = await import('node:fs')
      writeFileSync(value, JSON.stringify(profile))
      return value
    }
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
        // Peek's session moved from sessionStorage to localStorage with PEE-3; either counts, so the probe reads
        // a build from before it as well.
        [sessionStorage, localStorage].some((store) =>
          Object.keys(store).some((key) => /^[a-z0-9-]+\.estiva-?id\b/i.test(key) && /token/i.test(key)),
        ),
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
    // `--tapped-ago` / `--last-used-ago` <seconds> start the sign-in that much older (estiva-id#84), for the 7- and
    // 14-day ends: a sign-in whose end is a minute away, then a wait, is an ended one the app still holds.
    body: JSON.stringify({
      email: process.env[`QA${qa[1]}_EMAIL`],
      secret: process.env[`QA${qa[1]}_SECRET`],
      ...(options['tapped-ago'] ? { tapped_ago_seconds: Number(options['tapped-ago']) } : {}),
      ...(options['last-used-ago'] ? { last_used_ago_seconds: Number(options['last-used-ago']) } : {}),
    }),
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
