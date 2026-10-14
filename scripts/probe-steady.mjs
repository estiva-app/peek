/**
 * Does a Peek conversation stay still while its cards, chips and images load (OPT-10)?
 *
 *   node scripts/probe-steady.mjs [--as qa1] [--base https://peek.estiva.app] [--no-anchoring] [--no-live] [--json out.json]
 *
 * One headless run as QA-1 (`probe.mjs`, a fresh browser: nothing held, no copy on the device) opens the QA
 * Folder and, on "Widgets probe" (`seed-widgets-fixture.ts`: a compact card, two detailed cards, a chip and an
 * image on its last screen):
 *
 *   1. **open** — clicks it in the Folder: the first open, nothing resolved yet;
 *   2. **return** — goes to "Switch probe A", waits, and comes back: what this tab already holds;
 *   3. **live** — sits at the bottom while QA-2 sends a message with a detailed card (`--live` of the seed
 *      script, from node). The run deletes that message again afterwards (`--clean`).
 *
 * From the first frame with messages on screen until a second with nothing loading and nothing changing, it
 * samples every animation frame and prints, for each leg:
 * - **moves**: how often a message on screen moved while nobody scrolled (every message in view is watched,
 *   by its `data-root`, not one), the largest move, and which message; for **live**, counted from the frame the
 *   new message first shows, since its arrival is meant to move the others up;
 * - **jumps**: changes of the scroller's `scrollTop` over 40 px (probe-switch's measure);
 * - **fromBottom** at the first frame and once settled, and **loaded** — ms until no placeholder was left;
 * - what drew: chosen cards (`[data-card]`), chips, images, and placeholders by kind.
 *
 * The pass (OPT-10's Done when) is 0 moves and 0 jumps on every leg. Run on a quiet box: `/proc/loadavg` < 1.
 * Against an unmerged build, `PROBE_SERVE=dist` as for probe.mjs.
 */
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { promisify } from 'node:util'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The fixture topic's page: QA-1 has not joined it, so the Folder does not list it; it is opened by its URL. */
const W_PATH = '/topic/widgets-probe-ae45500e-dc23-4fdc-85b0-26457e153225'
const W = '/topic/widgets-probe-'
const A = '/topic/switch-probe-a-'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : args[i + 1]
}
const as = option('as', 'qa1')
const base = option('base', 'https://peek.estiva.app')
const live = !args.includes('--no-live')

/** Runs in the page. */
async function legs({ W, A, live, trace }) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()))
  // From before the app's first script: there may be no <main>, or no <body>, yet.
  const main = () => document.querySelector('main') ?? document.documentElement
  const waitFor = async (find, ms) => {
    const start = performance.now()
    while (performance.now() - start < ms) {
      const found = find()
      if (found) return found
      await sleep(30)
    }
    return null
  }
  // `[data-root]` is a marker with no box of its own; the message is its first child (as the scroll restore reads it).
  const ids = new WeakMap()
  const roots = () => [...main().querySelectorAll('[data-root]')].flatMap((marker) => {
    const el = marker.firstElementChild
    if (el) ids.set(el, marker.getAttribute('data-root'))
    return el ? [el] : []
  })
  const scroller = () => {
    let el = roots()[0]?.parentElement
    while (el && el !== document.body) {
      const style = getComputedStyle(el)
      if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight) return el
      el = el.parentElement
    }
    return null
  }
  const placeholders = () => {
    const kinds = []
    if (main().querySelector('.animate-skeleton-in')) kinds.push('card skeleton')
    if (main().querySelector('[aria-busy=true]')) kinds.push('image loading')
    if (main().querySelector('.animate-pulse:not([aria-busy])')) kinds.push('pulse')
    return kinds
  }
  const label = (el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)

  /** Samples until a second passes with nothing loading and nothing changing; `from` picks when moves count. */
  async function watch(name, { from = () => true, t0 = performance.now() } = {}) {
    const result = { leg: name, moves: 0, maxMove: 0, moved: [], jumps: 0, placeholders: [], firstPaint: null, loaded: null, trace: [] }
    const tops = new Map()
    let lastTop = null
    let quietSince = null
    let signature = ''
    while (performance.now() - t0 < 25000) {
      await frame()
      const now = performance.now()
      const box = scroller()
      // The fixture's own last messages, not the topic being left, which can stay drawn for a frame or two.
      if (!box || !roots().some((el) => /Message 4\d: /.test(el.textContent))) continue
      if (result.firstPaint === null) {
        result.firstPaint = Math.round(now - t0)
        result.fromBottomAtFirstPaint = Math.round(box.scrollHeight - box.scrollTop - box.clientHeight)
      }
      const busy = placeholders()
      for (const kind of busy) if (!result.placeholders.includes(kind)) result.placeholders.push(kind)
      if (!busy.length && result.loaded === null) result.loaded = Math.round(now - t0)
      if (busy.length) result.loaded = null
      const counting = from()
      if (counting && lastTop !== null && Math.abs(box.scrollTop - lastTop) > 40) result.jumps++
      lastTop = counting ? box.scrollTop : null
      /*
        Every message that was on screen last frame is compared, wherever it is now: one pushed out of view in a
        single frame is the biggest move there is. Only those on screen now are watched next frame.
      */
      const view = box.getBoundingClientRect()
      const next = new Map()
      for (const el of roots()) {
        const id = ids.get(el)
        const r = el.getBoundingClientRect()
        const before = tops.get(id)
        if (counting && before !== undefined && Math.abs(r.top - before) > 2) {
          result.moves++
          result.maxMove = Math.max(result.maxMove, Math.round(Math.abs(r.top - before)))
          if (result.moved.length < 6) result.moved.push(`${Math.round(now - t0)}ms ${Math.round(r.top - before)}px ${label(el)}`)
        }
        if (counting && r.bottom >= view.top && r.top <= view.bottom) next.set(id, r.top)
      }
      tops.clear()
      for (const [id, top] of next) tops.set(id, top)
      const sig = `${box.scrollTop}|${box.scrollHeight}|${busy.join()}|${roots().length}`
      // What changed, by frame: the scroller and where its last message is (`--trace`).
      if (trace && sig !== signature && result.trace.length < 40) {
        const last = roots().at(-1).getBoundingClientRect()
        result.trace.push(`${Math.round(now - t0)}ms top ${Math.round(box.scrollTop)} height ${box.scrollHeight} client ${box.clientHeight} last@${Math.round(last.top - view.top)} [${busy.join()}]`)
      }
      if (sig !== signature) {
        signature = sig
        quietSince = now
      } else if (!busy.length && counting && now - quietSince > 1000) break
    }
    const box = scroller()
    result.settled = Math.round(performance.now() - t0)
    result.fromBottom = box ? Math.round(box.scrollHeight - box.scrollTop - box.clientHeight) : null
    result.cards = [...main().querySelectorAll('[data-card]')].map((c) => c.getAttribute('data-card'))
    result.images = main().querySelectorAll('img[alt$=".png"], img[alt$=".jpg"]').length
    return result
  }

  const out = []
  const open = async (prefix) => {
    const link = await waitFor(() => document.querySelector(`a[href^="${prefix}"]`), 20000)
    if (!link) throw new Error(`no link to ${prefix}`)
    const t0 = performance.now()
    link.click()
    return t0
  }
  try {
    // From the navigation: performance.now() counts from it.
    out.push(await watch('open', { t0: 0 }))
    await sleep(3000)
    await open(A)
    await waitFor(() => location.pathname.startsWith(A) && roots().length, 20000)
    await sleep(8000)
    // Back the way a person goes back; the Folder tree does not list a topic QA-1 has not joined.
    const t0 = performance.now()
    history.back()
    out.push(await watch('return', { t0 }))
    if (live) {
      await sleep(3000)
      const text = `Live card ${new Date().toISOString()}`
      const t0 = performance.now()
      const posted = window.__probeHook(`?text=${encodeURIComponent(text)}`)
      const arrived = () => roots().some((el) => el.textContent.includes(text))
      const result = await watch('live', { from: arrived, t0 })
      result.post = await posted
      result.arrived = arrived()
      out.push(result)
    }
  } catch (error) {
    out.push({ error: error.message })
  }
  return out
}

const here = dirname(fileURLToPath(import.meta.url))
const runNode = promisify(execFile)
const seed = (...more) =>
  runNode(process.execPath, ['scripts/run-in-vite.mjs', 'scripts/seed-widgets-fixture.ts', ...more], { encoding: 'utf8', cwd: join(here, '..') })
    .then(({ stdout }) => stdout.trim().split('\n').pop())
    .catch((error) => `seed failed: ${(error.stderr || error.message).slice(0, 300)}`)

const server = createServer(async (request, response) => {
  const text = new URL(request.url, 'http://127.0.0.1').searchParams.get('text')
  response.writeHead(200).end(await seed('--live', text))
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

/*
  The legs start from an init script, before the app's own, so the open is watched from the navigation itself:
  a fresh tab with nothing held. The probe's page lands on Peek's `/auth/callback`, which routes to the topic
  without a reload, so it starts there: on Peek's origin (not Estiva ID's), and the watch waits for the topic.
*/
const initFile = join(mkdtempSync(join(tmpdir(), 'probe-steady-')), 'init.js')
/*
  `--no-anchoring`: a browser that does not keep the content in view still when something above it grows, as
  Chromium's scroll anchoring does — Safari has none. Chromium hides most of a jump; this measures what Safari shows.
*/
const noAnchoring = args.includes('--no-anchoring')
  ? `document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = '* { overflow-anchor: none !important }'; document.head.append(s) });`
  : ''
writeFileSync(
  initFile,
  `if (location.origin === ${JSON.stringify(new URL(base).origin)} && !window.__steady) { ${noAnchoring} window.__steady = (${legs.toString()})(${JSON.stringify({ W, A, live, trace: args.includes('--trace') })}) }`,
)
let report
try {
  const { stdout } = await runNode(
    process.execPath,
    [join(here, 'probe.mjs'), '--as', as, '--base', base, '--url', W_PATH, '--timeout', '150000', '--init', initFile,
      '--eval', 'window.__steady'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, PROBE_HOOK: `http://127.0.0.1:${server.address().port}/post` } },
  )
  report = JSON.parse(stdout)
} catch (error) {
  report = JSON.parse(error.stdout || '{}')
  console.error(`probe failed: ${report.failure ?? report.steps?.find((s) => s.error)?.error ?? error.message}`)
}
server.close()
if (live) console.log(`clean: ${await seed('--clean')}`)

const results = report.steps?.find((s) => 'eval' in s)?.result ?? []
const jsonOut = option('json')
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results, null, 2))
console.log(`probe-steady as ${as} on ${base}${process.env.PROBE_SERVE ? ` (serving ${process.env.PROBE_SERVE})` : ''}, ${new Date().toISOString()}`)
for (const r of results) {
  if (r.error) {
    console.log(`  error: ${r.error}`)
    continue
  }
  console.log(
    `  ${r.leg.padEnd(7)} moves ${r.moves} (max ${r.maxMove}px)  jumps ${r.jumps}  first paint ${r.firstPaint}ms  loaded ${r.loaded ?? '-'}ms  settled ${r.settled}ms  fromBottom ${r.fromBottomAtFirstPaint}→${r.fromBottom}px  cards [${r.cards.join(',')}]  images ${r.images}  placeholders [${r.placeholders.join(', ')}]${r.post ? `  post: ${r.post}` : ''}${r.arrived === false ? '  NOT ARRIVED' : ''}`,
  )
  for (const m of r.moved) console.log(`          ${m}`)
  for (const t of r.trace) console.log(`          · ${t}`)
}
const pass = results.length && results.every((r) => !r.error && r.moves === 0 && r.jumps === 0)
console.log(pass ? 'PASS: nothing on screen moved' : 'FAIL')
process.exit(pass ? 0 : 1)
