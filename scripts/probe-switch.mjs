/**
 * How long switching between conversations takes in Peek on production, and
 * what each switch costs (Optimistic updates & caching for Peek, milestone 1).
 *
 *   node scripts/probe-switch.mjs [--as qa1] [--base https://peek.estiva.app] [--gap 20000] [--json out.json]
 *   node scripts/probe-switch.mjs --hammer 60 [--every 400] [--settle 8000]
 *
 * `--hammer <s>` is the other measurement (OPT-2): it clicks through A, B,
 * Desk, People and the DM every `--every` ms without waiting for anything to
 * load, and exits 1 on any refusal — an HTTP 429 or a socket `rate-limited`.
 *
 * One headless run as QA-1 (`probe.mjs`, so sign-in and the read-state slot
 * are the same as every other probe) opens the QA Folder and clicks, the way a
 * person would:
 *
 *   Switch probe A → Switch probe B → A → Desk → A → Desk → A → People → the DM with QA-2 → A → the DM
 *
 * The second Desk is the return OPT-4 is about: a Desk step is drawn when QA-1's Open work (A, B) and Starred
 * (QA-2) rows are on screen with nothing pulsing, and each step also prints its **first frame** (two animation
 * frames after the click: drawn or not, how much pulses) and its **own** requests — those up to a second after
 * it settled, with ms from the click, so Desk's 30 s refresh tick and the minute catch-up can be told apart.
 *
 * `--qa2-post` (OPT-3): while QA-1 is in B, QA-2 signs in in a second headless run and posts in A, and the
 * B → A step says whether A shows that message on return. Each run adds one message to A.
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
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { promisify } from 'node:util'
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
async function runSwitches({ steps, gapMs, hook }) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const main = () => document.querySelector('main') ?? document.body
  // The Folder tree sits inside <main> with no selector of its own, so its placeholders count too; it draws
  // one only on a cold load, which makes "open A" the only step it can inflate.
  const skeletons = () => main().querySelectorAll('.animate-pulse,[aria-busy=true]').length
  // Which placeholder (OPT-9): the file's resolve draws a list skeleton, the conversation's read a card one.
  const skeletonKind = () =>
    main().querySelector('[data-loading="foreign-conversation"]')
      ? 'file skeleton'
      : main().querySelector('.animate-skeleton-in')
        ? 'conversation skeleton'
        : 'skeleton'
  const composer = () => Boolean(main().querySelector('[contenteditable=true]'))
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
    rail: (name) => () => [...document.querySelectorAll('a')].find((a) => a.getAttribute('aria-label') === name || a.textContent.trim() === name),
    exact: (text) => () => [...document.querySelectorAll('main *, nav *, aside *')].find((e) => e.children.length === 0 && e.textContent.trim() === text),
  }
  const readies = {
    topic: (title, path) => (text) => location.pathname.startsWith(path) && text.includes(`in ${title}`),
    // A page with no message text of its own is drawn once it has changed and nothing pulses.
    path: (path) => (text, busy, before) => location.pathname === path && busy === 0 && text !== before,
    // Desk is drawn when its lists' rows are (OPT-4): QA-1 keeps A and B in Open work and QA-2 in Starred.
    desk: (rows) => (text, busy) => location.pathname === '/app/desk' && busy === 0 && rows.every((row) => text.includes(row)),
    dm: () => (text, busy, before) =>
      /^\/app\/people\/.+/.test(location.pathname) && busy === 0 && text !== before && Boolean(main().querySelector('[contenteditable=true]')),
  }

  const left = {}
  const leftView = {}
  const paths = {}
  const results = []
  let posted = null
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
    let firstFrame = null
    // Any sample before the messages with no composer on screen (OPT-9: it is there from the first frame).
    let composerMissing = false
    let watched = null
    let moves = 0
    let maxMove = 0
    found = null
    // The first frame React paints after the click: what a person sees before anything could have been fetched.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const text = main().textContent
        firstFrame = {
          ms: Math.round(performance.now() - t0),
          busy: skeletons(),
          ready: ready(text, skeletons(), before),
          composer: composer(),
          text: text.slice(0, 400),
        }
      }),
    )
    while (performance.now() - t0 < 20000) {
      const now = performance.now()
      const text = main().textContent
      const busy = skeletons()
      // Before the messages, a pulse is the conversation's skeleton; after them, a widget still loading.
      // Durations are measured between samples, which are often much more than 30 ms apart on a long topic.
      if (visible === null && !composer()) composerMissing = true
      if (busy && visible === null) {
        note(skeletonKind())
        skeletonMs += now - previousSample
        maxSkeletons = Math.max(maxSkeletons, busy)
      } else if (busy) note('loading widgets')
      previousSample = now
      for (const word of text.match(/Loading|Connecting|Nothing here|Nothing yet|No messages/g) ?? []) note(word)
      const box = scroller()
      if (visible !== null && box) {
        if (lastTop !== null && Math.abs(box.scrollTop - lastTop) > 40) jumps++
        lastTop = box.scrollTop
        /*
          What a person sees move (OPT-9): a message on screen shifting while nobody scrolls — a widget filling in
          above it with the offset unchanged, or the offset changing under it. One message near the bottom of the
          view is watched; it is picked again when it leaves the page.
        */
        if (!watched?.el.isConnected) {
          const r = box.getBoundingClientRect()
          let el = document.elementFromPoint(r.left + r.width / 2, r.bottom - 80)
          while (el && el !== box && !el.matches('[data-root] > *') && (el.textContent?.length ?? 0) < 30) el = el.parentElement
          watched = el && el !== box ? { el, top: el.getBoundingClientRect().top } : null
        } else {
          const top = watched.el.getBoundingClientRect().top
          const moved = Math.abs(top - watched.top)
          if (moved > 4) {
            moves++
            maxMove = Math.max(maxMove, Math.round(moved))
          }
          watched.top = top
        }
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
      firstFrame,
      settled: Math.round(lastChange - t0),
      placeholders: seen,
      skeletonMs: Math.round(skeletonMs),
      maxSkeletons,
      fromBottom: box ? Math.round(box.scrollHeight - box.scrollTop - box.clientHeight) : null,
      jumps,
      moves,
      maxMove,
      composerMissing,
    }
    if (step.key) paths[step.key] = location.pathname
    // QA-2's message, posted while QA-1 was elsewhere: is it in the conversation QA-1 came back to?
    if (posted && step.key === posted.key && step.seesPost) result.sawPost = main().textContent.includes(posted.text)
    if (step.key && box) {
      // The message 120px below the scroller's top, by its text: "the same spot" as a person sees it, whatever
      // moved the offset (a reaction row that left the horizon, a card that grew above).
      const inView = () => {
        const r = box.getBoundingClientRect()
        let el = document.elementFromPoint(r.left + r.width / 2, r.top + 120)
        while (el && el !== box && (el.textContent?.length ?? 0) < 30) el = el.parentElement
        return (el?.textContent ?? '').slice(0, 80)
      }
      if (left[step.key] !== undefined) {
        result.sameMessage = inView() === leftView[step.key]
        // The same message at the same height is the restore; the offset moves when something above changed height.
        result.restored = result.sameMessage || Math.abs(box.scrollTop - left[step.key]) <= 40
        if (!result.sameMessage) result.inView = { left: leftView[step.key], back: inView() }
      }
      if (step.leaveAtMiddle) {
        box.scrollTop = Math.round((box.scrollHeight - box.clientHeight) / 2)
        await sleep(300)
        left[step.key] = box.scrollTop
        leftView[step.key] = inView()
        result.leftAt = Math.round(box.scrollTop)
      }
    }
    results.push(result)
    if (step.postIn && hook) {
      // The node side signs in as QA-2 and posts in that conversation; it answers once the relay took it.
      const text = `Switch probe live ${new Date().toISOString()}`
      const answer = await window
        .__probeHook(`?path=${encodeURIComponent(paths[step.postIn])}&text=${encodeURIComponent(text)}`)
        .catch((error) => `hook failed: ${error.message}`)
      result.post = answer
      posted = { key: step.postIn, text }
    }
    await sleep(gapMs)
  }
  return results
}

/**
 * Runs in the page. Clicks through topics, people and Desk every `everyMs` for `seconds`, never waiting for
 * anything to load — the OPT-2 Done-when. A target that is not on screen yet is skipped, as a person would.
 *
 * It starts `settleMs` after the QA Folder shows, from a page done booting, as somebody mid-session would. Started
 * straight after boot, a topic left 400 ms after its click had not resolved yet, so it never became the nav's
 * last-topic link and the cycle skipped every topic after that.
 */
async function hammer({ targets, seconds, everyMs, settleMs }) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  await sleep(settleMs)
  const find = ([how, what]) =>
    how === 'link'
      ? document.querySelector(`a[href^="${what}"]`)
      : how === 'rail'
        ? [...document.querySelectorAll('a')].find((a) => a.getAttribute('aria-label') === what || a.textContent.trim() === what)
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
  const socket = window.__socketReads?.(2) ?? null
  if (socket) delete socket.recent
  return { start, end: Date.now(), clicks, skipped, reads: window.__relayReads?.(2) ?? null, socket }
}

const A = '/topic/switch-probe-a-'
const B = '/topic/switch-probe-b-'
// QA-1's Desk: A and B in Open work, QA-2 starred (added from Peek's own menus, 2026-10-08).
// `--desk-also "Urgent,Screener"` requires more: an unread urgent DM from QA-2 puts a row in both, until the
// run's DM step reads it.
const DESK_ROWS = ['Switch probe A', 'Switch probe B', QA2_NAME, ...(option('desk-also', '') ? option('desk-also').split(',') : [])]
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
    // With --qa2-post, QA-2 posts in A now, while QA-1 is in B.
    postIn: 'A',
  },
  {
    label: 'B → A',
    target: ['link', A],
    ready: ['topic', 'Switch probe A', A],
    key: 'A',
    seesPost: true,
    leaveAtMiddle: true,
  },
  {
    label: 'A → Desk',
    target: ['link', '/app/desk'],
    ready: ['desk', DESK_ROWS],
  },
  {
    // On Desk the Topics nav link is the last topic open, so this is one click.
    label: 'Desk → A',
    target: ['link', A],
    ready: ['topic', 'Switch probe A', A],
    key: 'A',
  },
  {
    // OPT-4: the return to Desk, which should draw its lists on the first frame with no placeholder.
    label: 'A → Desk again',
    target: ['link', '/app/desk'],
    ready: ['desk', DESK_ROWS],
  },
  { label: 'Desk → A again', target: ['link', A], ready: ['topic', 'Switch probe A', A], key: 'A' },
  {
    label: 'A → People',
    target: ['link', '/app/people'],
    ready: ['path', '/app/people'],
  },
  { label: 'People → DM QA-2', target: ['exact', QA2_NAME], ready: ['dm'], key: 'DM', leaveAtMiddle: true },
  // The DM leg of OPT-3: the rail's Topics is the last topic, and People reopens the last DM.
  { label: 'DM → A', target: ['link', A], ready: ['topic', 'Switch probe A', A], key: 'A' },
  { label: 'A → DM', target: ['rail', 'People'], ready: ['dm'], key: 'DM' },
]

const here = dirname(fileURLToPath(import.meta.url))
const netFile = join(mkdtempSync(join(tmpdir(), 'probe-switch-')), 'net.json')
const hammerSeconds = option('hammer') === undefined ? null : Number(option('hammer'))
// Each target is on the page the one before leads to, whatever has loaded, so the cycle never stalls on a
// missing link — a run that skips clicks asks less of the relay and measures nothing. A topic page lists A and B
// in its tree. From Desk, People or a DM the rail's Topics goes back to the last topic, or, when none resolved
// before it was left, to the Folder list, where the QA Folder (then A) is.
const hammerTargets = [
  ['link', A],
  ['link', B],
  ['link', '/app/desk'],
  ['rail', 'Topics'],
  ['link', `/app/folders/${QA_FOLDER}`],
  ['link', A],
  ['link', '/app/people'],
  ['exact', QA2_NAME],
  ['rail', 'Topics'],
  ['link', `/app/folders/${QA_FOLDER}`],
]
/*
  `--qa2-post`: a step with `postIn` asks this process, through probe.mjs's PROBE_HOOK (`window.__probeHook`),
  to sign in as QA-2 and post in that conversation, and the run waits for the answer. execFile is async so the
  hook can answer while the QA-1 probe runs.
*/
const runNode = promisify(execFile)
let hook = null
let server = null
if (args.includes('--qa2-post')) {
  server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    const text = url.searchParams.get('text')
    const insert = `(() => { const el = [...document.querySelectorAll('.ProseMirror')].find((e) => e.editor); if (!el) return 'no composer'; el.editor.chain().focus().insertContent(${JSON.stringify(text)}).run(); return el.editor.getText() })()`
    let answer
    try {
      const { stdout } = await runNode(
        process.execPath,
        [join(here, 'probe.mjs'), '--as', 'qa2', '--base', base, '--url', url.searchParams.get('path'), '--timeout', '60000',
          '--until', "[...document.querySelectorAll('.ProseMirror')].some((e) => e.editor)", '--wait', '2000',
          '--eval', insert, '--press', 'Enter', '--wait', '4000'],
        { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
      )
      const typed = JSON.parse(stdout).steps?.find((s) => 'eval' in s)?.result
      answer = typeof typed === 'string' && typed.includes(text) ? 'posted' : `not posted: ${stdout.slice(0, 300)}`
    } catch (error) {
      answer = `QA-2 probe failed: ${(error.stdout || error.message).slice(0, 300)}`
    }
    response.writeHead(200).end(answer)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  hook = `http://127.0.0.1:${server.address().port}/post`
}
const source =
  hammerSeconds === null
    ? `(${runSwitches.toString()})(${JSON.stringify({ steps, gapMs: Number(option('gap', 20000)), hook })})`
    : `(${hammer.toString()})(${JSON.stringify({ targets: hammerTargets, seconds: hammerSeconds, everyMs: Number(option('every', 400)), settleMs: Number(option('settle', 8000)) })})`
let report
try {
  const { stdout: out, stderr } = await runNode(
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
      String(Math.max(60000, ((hammerSeconds ?? 0) + 30) * 1000 + Number(option('settle', 8000)))),
      '--net',
      netFile,
      '--until',
      `document.querySelector('a[href^="${A}"]')`,
      '--eval',
      source,
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: hook ? { ...process.env, PROBE_HOOK: hook } : process.env },
  )
  if (stderr) process.stderr.write(stderr)
  report = JSON.parse(out)
} catch (error) {
  if (error.stderr) process.stderr.write(error.stderr)
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
  if (run.socket) {
    const ms = (w) => `p50 ${w.p50} / p90 ${w.p90} / max ${w.max} ms`
    console.log(`socket reader (__socketReads, 2 min): ${run.socket.reads} reads, ${run.socket.reqs} REQs; ${JSON.stringify(run.socket.byVia)}`)
    console.log(`  waited for a slot ${ms(run.socket.pacerWaitMs)}; for the socket ${ms(run.socket.liveWaitMs)}; answer ${ms(run.socket.answerMs)}`)
  }
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
    r.moves ? `moved ${r.moves}× (max ${r.maxMove}px)` : '',
    r.restored === undefined ? '' : r.restored ? 'restored' : 'NOT restored',
    r.sameMessage === undefined ? '' : r.sameMessage ? 'same message' : 'OTHER message',
    r.post ? `QA-2 ${r.post}` : '',
    r.sawPost === undefined ? '' : r.sawPost ? "QA-2's post shown" : "QA-2's post MISSING",
  ]
    .filter(Boolean)
    .join(', ')
  const placeholders = r.placeholders.join(' → ')
  console.log(
    `${pad(r.label, 18)}${pad(r.visible === null ? 'never' : `${r.visible} ms`, 9)}${pad(`${r.settled} ms`, 9)}${pad(r.requests.http, 6)}${pad(r.requests.sign, 7)}${pad(r.requests.req, 5)}${pad(scroll, 40)}${placeholders}${r.skeletonMs ? ` (skeleton ${r.skeletonMs} ms)` : ''}`,
  )
}
console.log('\nrequests per step (whole step, then the ones up to a second after it settled, with ms from the click):')
for (const r of rows.filter((r) => r.requests)) {
  console.log(
    `  ${pad(r.label, 18)}${Object.entries(r.requests.counts)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')}`,
  )
  // Desk's refresh tick and the channel store's catch-up land inside a step's gap; these are the return's own.
  const own = net.filter((e) => e.at >= r.start && e.at <= r.start + r.settled + 1000 && e.kind !== 'ws-in')
  console.log(`  ${pad('', 18)}first frame ${r.firstFrame ? `${r.firstFrame.ms} ms, ${r.firstFrame.ready ? 'drawn' : 'not drawn'}, ${r.firstFrame.busy} pulsing, ${r.firstFrame.composer ? 'composer' : 'no composer'}` : '–'}${r.composerMissing ? ' (composer missing before the messages)' : ''}; own ${own.length}: ${own.map((e) => `+${e.at - r.start} ${classify(e)}`).join(', ')}`)
}
if (report.errors?.length) console.log(`\npage errors: ${report.errors.join(' | ')}`)
server?.close()
process.exit(report.failure || rows.some((r) => r.error || r.visible === null || r.sawPost === false) ? 1 : 0)
