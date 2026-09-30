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
 * Steps run in argument order, so `--click`, `--fill`, `--press`, `--wait`,
 * `--until`, `--eval` and `--screenshot` can be repeated and interleaved.
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
 * The browser is the Chromium 1228 that `playwright-core 1.61.1` matches, the
 * same one `render-story.mjs` uses.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { chromium } from 'playwright-core'

const usage = `usage: probe.mjs --as <qa1|qa2|name> [--session file] [--base url] [--id url]
  [--url path] [--click label] [--fill label=text] [--press key] [--wait ms]
  [--until expr] [--timeout ms] [--eval expr] [--screenshot file]`

const STEPS = new Set(['--click', '--fill', '--press', '--wait', '--until', '--eval', '--screenshot'])
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

const browser = await chromium.launch({ executablePath })
try {
  const idOrigin = new URL(options.id)
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
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
  })
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

function fail(message) {
  console.error(message)
  process.exit(2)
}
