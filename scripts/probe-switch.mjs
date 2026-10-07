/**
 * How long switching between conversations takes in Peek on production, and
 * what each switch costs (Optimistic updates & caching for Peek, milestone 1).
 *
 *   node scripts/probe-switch.mjs [--as qa1] [--base https://peek.estiva.app] [--gap 20000] [--json out.json]
 *   node scripts/probe-switch.mjs --hammer 60 [--every 400]
 *
 * `--hammer <s>` is the other measurement (OPT-2): it clicks through A, B,
 * Desk, People and the DM every `--every` ms without waiting for anything to
 * load, and exits 1 on any refusal — an HTTP 429 or a socket `rate-limited`.
 *
 * One headless run as QA-1 (`probe.mjs`, so sign-in and the read-state slot
 * are the same as every other probe) opens the QA Folder and clicks, the way a
 * person would:
 *
 *   Switch probe A → Switch probe B → A → Desk → A → People → the DM with QA-2
 *
 * For each click it prints:
 * - **visible**: ms from the click to the conversation's messages on screen,
 *   and **settled**: to the last change before a second of quiet;
 * - **placeholders**: what stood in for the content meanwhile — the skeleton
 *   (and for how long), "Loading…", "Nothing…" — in the order seen;
 * - **scroll**: px from the bottom once settled, the jumps after the messages
 *   showed, and on a return to A whether it came back where it was left (before
 *   leaving A the probe scrolls it to the middle);
 * - **requests**: HTTP by endpoint (Estiva ID `/sign` counted on its own) and
 *   socket frames sent (REQ, CLOSE), plus any 429 or refusal.
 *
 * The two topics are seeded by `scripts/seed-switch-fixture.ts`: 200 messages
 * each from QA-1 and QA-2, with replies, reactions, an edit, a deletion and
 * widgets. The DM is QA-1's existing one with QA-2.
 *
 * QA-1 has 300 HTTP requests per 60 s like anyone, and a switch costs ~55, so
 * the steps are `--gap` ms apart (default 20000) and a run takes ~3 minutes —
 * otherwise the probe's own 429s would be what it measures. Any 429 is still
 * printed. Leave a few minutes between a run and other QA-1 probes.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const QA_FOLDER = 'a78e60b1-a41f-48c9-bcb0-6ceacdee8c69'
const QA2_NAME = 'QA-2'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : args[i + 1]
}
const as = option('as', 'qa1')
const base = option('base', 'https://peek.estiva.app')
const jsonOut = option('json')

/** Runs in the page. Clicks each step's target, then samples every 30 ms until it has been quiet for a second. */
async function runSwitches({ steps, gapMs }) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const main = () => document.querySelector('main') ?? document.body
  // The Folder tree sits inside <main> with no selector of its own, so its placeholders count too; it draws
  // one only on a cold load, which makes "open A" the only step it can inflate.
  const skeletons = () => main().querySelectorAll('.animate-pulse,[aria-busy=true]').length
  /*
    The conversation's scroller is the tallest scrollable element in the pane. Finding it walks the whole
    pane with getComputedStyle, which on a 200-message topic takes longer than a sample, so it is looked
    up again only when the one found has left the page, or at most every 250 ms while there is none.
  */
  let found = null
  let lookedAt = 0
  const scroller = () => {
    if (found?.isConnected) return found
    if (performance.now() - lookedAt < 250) return null
    lookedAt = performance.now()
    found =
      [...main().querySelectorAll('*')]
        .filter((e) => e.scrollHeight > e.clientHeight + 20 && /auto|scroll/.test(getComputedStyle(e).overflowY))
        .sort((a, b) => b.scrollHeight - a.scrollHeight)[0] ?? null
    return found
  }
  const waitFor = async (find, ms) => {
    const start = performance.now()
    while (performance.now() - start < ms) {
      const found = find()
      if (found) return found
      await sleep(30)
    }
    return null
  }
  const targets = {
    link: (prefix) => () => document.querySelector(`a[href^="${prefix}"]`),
    exact: (text) => () => [...document.querySelectorAll('main *, nav *, aside *')].find((e) => e.children.length === 0 && e.textContent.trim() === text),
  }
  const readies = {
    topic: (title, path) => (text) => location.pathname.startsWith(path) && text.includes(`in ${title}`),
    // A page with no message text of its own is drawn once it has changed and nothing pulses.
    path: (path) => (text, busy, before) => location.pathname === path && busy === 0 && text !== before,
    dm: () => (text, busy, before) =>
      /^\/app\/people\/.+/.test(location.pathname) && busy === 0 && text !== before && Boolean(main().querySelector('[contenteditable=true]')),
  }

  const left = {}
  const results = []
  for (const step of steps) {
    const target = await waitFor(targets[step.target[0]](step.target[1]), 20000)
    if (!target) {
      results.push({
        label: step.label,
        error: `nothing to click for ${step.target.join(' ')}`,
      })
      break
    }
    const ready = readies[step.ready[0]](...step.ready.slice(1))
    // textContent, not innerText: innerText forces a layout of the whole pane on every sample and slows the page being timed.
    const before = main().textContent
    const start = Date.now()
    const t0 = performance.now()
    target.click()

    const seen = []
    const note = (what) => seen[seen.length - 1] !== what && seen.push(what)
    let visible = null
    let lastChange = t0
    let signature = ''
    let skeletonMs = 0
    let maxSkeletons = 0
    let jumps = 0
    let lastTop = null
    let previousSample = t0
    found = null
    while (performance.now() - t0 < 20000) {
      const now = performance.now()
      const text = main().textContent
      const busy = skeletons()
      // Before the messages, a pulse is the conversation's skeleton; after them, a widget still loading.
      // Durations are measured between samples, which are often much more than 30 ms apart on a long topic.
      if (busy && visible === null) {
        note('skeleton')
        skeletonMs += now - previousSample
        maxSkeletons = Math.max(maxSkeletons, busy)
      } else if (busy) note('loading widgets')
      previousSample = now
      for (const word of text.match(/Loading|Connecting|Nothing here|Nothing yet|No messages/g) ?? []) note(word)
      const box = scroller()
      if (visible !== null && box) {
        if (lastTop !== null && Math.abs(box.scrollTop - lastTop) > 40) jumps++
        lastTop = box.scrollTop
      }
      const sig = `${location.pathname}|${busy}|${Math.round(text.length / 20)}|${box ? Math.round(box.scrollTop) : '-'}/${box?.scrollHeight ?? '-'}`
      if (sig !== signature) {
        signature = sig
        lastChange = now
      }
      if (visible === null && ready(text, busy, before)) {
        visible = Math.round(now - t0)
        note('messages')
        // Before the messages the tallest scroller may be the Folder tree; look again now.
        found = null
        lookedAt = 0
      }
      if (visible !== null && now - lastChange > 1000) break
      await sleep(30)
    }
    const box = scroller()
    const result = {
      label: step.label,
      start,
      end: Date.now(),
      path: location.pathname,
      visible,
      settled: Math.round(lastChange - t0),
      placeholders: seen,
      skeletonMs: Math.round(skeletonMs),
      maxSkeletons,
      fromBottom: box ? Math.round(box.scrollHeight - box.scrollTop - box.clientHeight) : null,
      jumps,
    }
    if (step.key && box) {
      if (left[step.key] !== undefined) result.restored = Math.abs(box.scrollTop - left[step.key]) <= 40
      if (step.leaveAtMiddle) {
        box.scrollTop = Math.round((box.scrollHeight - box.clientHeight) / 2)
        await sleep(300)
        left[step.key] = box.scrollTop
        result.leftAt = Math.round(box.scrollTop)
      }
    }
    results.push(result)
    await sleep(gapMs)
  }
  return results
}

/**
 * Runs in the page. Clicks through topics, people and Desk every `everyMs` for `seconds`, never waiting for
 * anything to load — the OPT-2 Done-when. A target that is not on screen yet is skipped, as a person would.
 */
async function hammer({ targets, seconds, everyMs }) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const find = ([how, what]) =>
    how === 'link'
      ? document.querySelector(`a[href^="${what}"]`)
      : [...document.querySelectorAll('main *, nav *, aside *')].find((e) => e.children.length === 0 && e.textContent.trim() === what)
  const start = Date.now()
  const clicks = []
  const skipped = []
  let i = 0
  while (Date.now() - start < seconds * 1000) {
    const target = targets[i++ % targets.length]
    const el = find(target)
    if (el) {
      el.click()
      clicks.push({ at: Date.now(), target: target[1] })
    } else skipped.push({ at: Date.now(), target: target[1], on: location.pathname })
    await sleep(everyMs)
  }
  // Reads started by the last clicks still land, and a refusal for them counts too.
  await sleep(8000)
  return { start, end: Date.now(), clicks, skipped, reads: window.__relayReads?.(2) ?? null }
}

const A = '/topic/switch-probe-a-'
const B = '/topic/switch-probe-b-'
const steps = [
  {
    label: 'open A',
    target: ['link', A],
    ready: ['topic', 'Switch probe A', A],
    key: 'A',
    leaveAtMiddle: true,
  },
  {
    label: 'A → B',
    target: ['link', B],
    ready: ['topic', 'Switch probe B', B],
  },
  {
    label: 'B → A',
    target: ['link', A],
    ready: ['topic', 'Switch probe A', A],
    key: 'A',
    leaveAtMiddle: true,
  },
  {
    label: 'A → Desk',
    target: ['link', '/app/desk'],
    ready: ['path', '/app/desk'],
  },
  {
    // On Desk the Topics nav link is the last topic open, so this is one click.
    label: 'Desk → A',
    target: ['link', A],
    ready: ['topic', 'Switch probe A', A],
    key: 'A',
  },
  {
    label: 'A → People',
    target: ['link', '/app/people'],
    ready: ['path', '/app/people'],
  },
  { label: 'People → DM QA-2', target: ['exact', QA2_NAME], ready: ['dm'] },
]

const here = dirname(fileURLToPath(import.meta.url))
const netFile = join(mkdtempSync(join(tmpdir(), 'probe-switch-')), 'net.json')
const hammerSeconds = option('hammer') === undefined ? null : Number(option('hammer'))
// Each target is on the page the one before leads to, whatever has loaded: a topic page lists A and B in its
// tree, and Desk, People and a DM have only the nav's last-topic link (`/topic/`), so the cycle never stalls on
// a missing link — a run that skips clicks asks less of the relay and measures nothing.
const hammerTargets = [
  ['link', A],
  ['link', B],
  ['link', '/app/desk'],
  ['link', '/topic/'],
  ['link', A],
  ['link', '/app/people'],
  ['exact', QA2_NAME],
  ['link', '/topic/'],
]
const source =
  hammerSeconds === null
    ? `(${runSwitches.toString()})(${JSON.stringify({ steps, gapMs: Number(option('gap', 20000)) })})`
    : `(${hammer.toString()})(${JSON.stringify({ targets: hammerTargets, seconds: hammerSeconds, everyMs: Number(option('every', 400)) })})`
let report
try {
  const out = execFileSync(
    process.execPath,
    [
      join(here, 'probe.mjs'),
      '--as',
      as,
      '--base',
      base,
      '--url',
      `/app/folders/${QA_FOLDER}`,
      '--timeout',
      String(Math.max(60000, ((hammerSeconds ?? 0) + 30) * 1000)),
      '--net',
      netFile,
      '--until',
      `document.querySelector('a[href^="${A}"]')`,
      '--eval',
      source,
    ],
    {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  )
  report = JSON.parse(out)
} catch (error) {
  report = JSON.parse(error.stdout || '{}')
  console.error(`probe failed: ${report.failure ?? report.steps?.find((s) => s.error)?.error ?? error.message}`)
  if (!report.steps) process.exit(1)
}
const evaluated = report.steps?.find((s) => 'eval' in s)?.result
const results = hammerSeconds === null ? (evaluated ?? []) : []
const net = JSON.parse(readFileSync(netFile, 'utf8'))

/** What a logged request was, by endpoint: `/sign` apart from the rest, since every relay read pays one. */
function classify(entry) {
  if (entry.kind === 'http-429') return '429'
  // The socket's quota refusal: a CLOSED for a REQ, a NOTICE for an EVENT (buzz `send_admission_result`).
  if (entry.kind === 'ws-in' && /rate-limited/.test(entry.body)) return 'ws rate-limited'
  if (entry.kind === 'ws-in') return /^\["OK"/.test(entry.body) ? 'ws refused' : `ws ${entry.body.slice(2, entry.body.indexOf('"', 2))}`
  if (entry.kind === 'ws-out') return `ws ${entry.body.slice(2, entry.body.indexOf('"', 2))}`
  const url = new URL(entry.url)
  return `${url.host.split('.')[0]}${url.pathname.replace(/\/[0-9a-f]{16,}.*/, '/…')}`
}
const summarize = (from, to) => {
  const counts = {}
  for (const entry of net.filter((e) => e.at >= from && e.at <= to)) {
    const key = classify(entry)
    counts[key] = (counts[key] ?? 0) + 1
  }
  const http = Object.entries(counts)
    .filter(([k]) => !k.startsWith('ws') && k !== '429')
    .reduce((n, [, v]) => n + v, 0)
  return {
    http,
    sign: counts['id/sign'] ?? 0,
    req: counts['ws REQ'] ?? 0,
    refused: (counts['429'] ?? 0) + (counts['ws rate-limited'] ?? 0),
    counts,
  }
}

if (hammerSeconds !== null) {
  const run = evaluated ?? { clicks: [], start: 0, end: 0 }
  const total = run.start ? summarize(run.start, run.end) : null
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ as, base, run, total, net }, null, 2))
  console.log(`probe-switch --hammer ${hammerSeconds} as ${as} on ${base}, ${new Date().toISOString()}`)
  if (!total) {
    console.log(`the run did not start${report.failure ? `: ${report.failure}` : ''}`)
    process.exit(1)
  }
  console.log(
    `${run.clicks.length} clicks in ${hammerSeconds} s (${run.skipped?.length ?? 0} skipped: target not on screen), then 8 s for the last reads to land`,
  )
  console.log(`HTTP ${total.http} (${total.sign} /sign), socket REQ ${total.req}, refused ${total.refused}`)
  console.log(
    `  ${Object.entries(total.counts)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')}`,
  )
  if (run.reads) console.log(`page's own count (__relayReads, 2 min): ${run.reads.total} reads, ${run.reads.rateLimited} rate-limited`)
  if (report.errors?.length) console.log(`\npage errors: ${report.errors.join(' | ')}`)
  process.exit(report.failure || total.refused > 0 || run.reads?.rateLimited > 0 ? 1 : 0)
}

// A step owns everything from its click to the next click, so late widget resolves and catch-up reads count too.
const rows = results.map((r, i) => ({
  ...r,
  requests: r.start ? summarize(r.start, results[i + 1]?.start ?? Infinity) : null,
}))
const boot = net.length ? summarize(net[0].at, results[0]?.start ?? Infinity) : null
const summary = {
  as,
  base,
  when: new Date().toISOString(),
  boot,
  steps: rows,
  errors: report.errors,
  failure: report.failure,
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ ...summary, net }, null, 2))

const pad = (s, n) => String(s ?? '–').padEnd(n)
console.log(`probe-switch as ${as} on ${base}, ${summary.when}`)
if (boot) console.log(`boot to the QA Folder: ${boot.http} HTTP (${boot.sign} /sign)`)
console.log(`${pad('step', 18)}${pad('visible', 9)}${pad('settled', 9)}${pad('HTTP', 6)}${pad('/sign', 7)}${pad('REQ', 5)}${pad('scroll', 40)}placeholders`)
for (const r of rows) {
  if (r.error) {
    console.log(`${pad(r.label, 18)}${r.error}`)
    continue
  }
  const scroll = [
    r.fromBottom === null ? 'no scroller' : `${r.fromBottom}px from bottom`,
    r.jumps ? `${r.jumps} jump${r.jumps === 1 ? '' : 's'}` : '',
    r.restored === undefined ? '' : r.restored ? 'restored' : 'NOT restored',
  ]
    .filter(Boolean)
    .join(', ')
  const placeholders = r.placeholders.join(' → ')
  console.log(
    `${pad(r.label, 18)}${pad(r.visible === null ? 'never' : `${r.visible} ms`, 9)}${pad(`${r.settled} ms`, 9)}${pad(r.requests.http, 6)}${pad(r.requests.sign, 7)}${pad(r.requests.req, 5)}${pad(scroll, 40)}${placeholders}${r.skeletonMs ? ` (skeleton ${r.skeletonMs} ms)` : ''}`,
  )
}
console.log('\nrequests per step:')
for (const r of rows.filter((r) => r.requests)) {
  console.log(
    `  ${pad(r.label, 18)}${Object.entries(r.requests.counts)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')}`,
  )
}
if (report.errors?.length) console.log(`\npage errors: ${report.errors.join(' | ')}`)
process.exit(report.failure || rows.some((r) => r.error || r.visible === null) ? 1 : 0)
