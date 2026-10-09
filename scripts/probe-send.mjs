/**
 * Whether a message you send is on screen the moment you press Enter, and stays the same row when the relay
 * accepts it (OPT-6), on production.
 *
 *   node scripts/probe-send.mjs [--base https://peek.estiva.app] [--legs topic,thread,dm,desk] [--runs 3] [--json out.json]
 *
 * As QA-1, for each leg, it presses Enter `--runs` times and times Enter → the row in the DOM (a MutationObserver
 * in the page, outside every editor) and → the next frame. It keeps the row's element and reports whether it was
 * ever removed or replaced, and whether it moved, by the time the relay had answered (5 s later):
 *
 * - `topic`  — Switch probe A in the QA Folder, opened from the Folder page.
 * - `thread` — a reply under the topic leg's first message, in the thread panel; also when the parent's reply row
 *              changed (its count).
 * - `dm`     — the DM with QA-2.
 * - `desk`   — Switch probe A opened from QA-1's Desk, in Desk's frame.
 *
 * Then QA-1 reloads each place and counts each message (once), and QA-2 opens each and finds them. Exit 1 when a
 * send took 100 ms or more to draw, a row was removed or replaced, a message is missing or shown twice.
 *
 * Each run adds `runs` messages to A (topic and desk legs), `runs` replies, and `runs` DMs to QA-2.
 * `PROBE_SERVE=<dist>` runs an unmerged build (see probe.mjs).
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const QA_FOLDER = 'a78e60b1-a41f-48c9-bcb0-6ceacdee8c69'
const QA1 = 'c562b90f36802f52e11bc6a3f2e7d9e59e86c76de212fe457dbc89bc273a9a25'
const QA2 = '3bb30d683788016b85c83604dd5660e4e172e95d46d4e3ebab623ff5847b1f71'
const A = '/topic/switch-probe-a-'
const BUDGET_MS = 100

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : args[i + 1]
}
const base = option('base', 'https://peek.estiva.app')
const legs = option('legs', 'topic,thread,dm,desk').split(',')
const runs = Number(option('runs', '3'))
const jsonOut = option('json')
const stamp = Date.now().toString(36)
const markers = Object.fromEntries(legs.map((leg) => [leg, Array.from({ length: runs }, (_, i) => `opt6-${leg}-${stamp}-${i}`)]))

const here = dirname(fileURLToPath(import.meta.url))
const run = promisify(execFile)

async function probe(as, url, steps, timeout = 180_000) {
  try {
    const { stdout } = await run(process.execPath, [join(here, 'probe.mjs'), '--as', as, '--base', base, '--url', url, '--timeout', String(timeout), ...steps], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    })
    return JSON.parse(stdout)
  } catch (error) {
    try {
      return JSON.parse(error.stdout)
    } catch {
      return { failure: String(error.stderr || error.message).slice(0, 500) }
    }
  }
}

const evals = (report) => (report.steps ?? []).filter((s) => 'eval' in s).map((s) => s.result)

// In the page: text outside any editor, toast or status line is a drawn message.
const FIND = `
  const outside = (node) => { const el = node.parentElement; return el && !el.closest('.ProseMirror, [contenteditable=true], [role=status], [role=alert], [data-sonner-toast]') }
  const findAll = (text) => {
    const hits = document.evaluate('//text()[contains(., "' + text + '")]', document.body, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)
    const out = []
    for (let i = 0; i < hits.snapshotLength; i++) if (outside(hits.snapshotItem(i))) out.push(hits.snapshotItem(i).parentElement)
    return out
  }
  const cardOf = (text) => findAll(text)[0]?.closest('div.relative.rounded-lg') ?? null
`

const INSTRUMENT = `(() => {
  if (window.__send) return 'already'
  ${FIND}
  const s = (window.__send = { watch: [], findAll, cardOf })
  addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return
    const now = performance.now()
    const prev = s.watch.at(-2)
    if (prev && prev.el && prev.topBefore === undefined) prev.topBefore = prev.el.getBoundingClientRect().top
    const w = s.watch.at(-1)
    if (w && w.enterAt === null) { w.enterAt = now; if (w.parent) w.parentBefore = w.parent.textContent }
  }, true)
  const check = () => {
    const now = performance.now()
    for (const w of s.watch) {
      if (w.enterAt === null) continue
      if (w.parent && w.replyMs === undefined && w.parent.isConnected && w.parent.textContent !== w.parentBefore) w.replyMs = Math.round(now - w.enterAt)
      if (w.el && w.el.isConnected) continue
      const els = findAll(w.text)
      w.maxCount = Math.max(w.maxCount, els.length)
      if (!w.el) {
        if (!els.length) continue
        w.el = els[0]
        w.drawnMs = Math.round(now - w.enterAt)
        requestAnimationFrame(() => { w.paintMs = Math.round(performance.now() - w.enterAt); w.top = w.el?.getBoundingClientRect().top })
      } else {
        // The row we saw is gone: removed, or replaced by another element.
        w.removed += 1
        w.el = els[0] ?? null
        if (w.el) w.replaced += 1
      }
    }
  }
  new MutationObserver(check).observe(document.body, { subtree: true, childList: true, characterData: true })
  return 'instrumented'
})()`

/** Put `text` in the composer (`which`: 'first' editor, or 'last' — the thread panel's) and watch for it. */
const insert = (text, which, parentText) => `(() => {
  const editors = [...document.querySelectorAll('.ProseMirror')].filter((e) => e.editor)
  const el = ${which === 'last' ? 'editors.at(-1)' : 'editors[0]'}
  if (!el) return 'no composer'
  window.__send.watch.push({ text: ${JSON.stringify(text)}, enterAt: null, el: null, removed: 0, replaced: 0, maxCount: 0,
    parent: ${parentText ? `window.__send.cardOf(${JSON.stringify(parentText)})` : 'null'} })
  el.editor.chain().focus().insertContent(${JSON.stringify(text)}).run()
  return el.editor.getText()
})()`

const REPORT = `(() => window.__send.watch.map((w) => ({
  text: w.text, drawnMs: w.drawnMs ?? null, paintMs: w.paintMs ?? null, removed: w.removed, replaced: w.replaced,
  maxCount: w.maxCount, connected: !!w.el?.isConnected,
  moved: w.top === undefined || !w.el ? null : Math.round((w.topBefore ?? w.el.getBoundingClientRect().top) - w.top),
  replyMs: w.parent === null ? undefined : (w.replyMs ?? null),
  // Performance marks the page set after this Enter (named 'opt6:…'), in ms from it: where the time went.
  marks: performance.getEntriesByType('mark').filter((m) => m.name.startsWith('opt6:') && m.startTime >= w.enterAt)
    .slice(0, 8).map((m) => m.name.slice(5) + ' ' + Math.round(m.startTime - w.enterAt)).join(', ') || undefined,
})))()`

const clickLeaf = (pattern) => `(() => {
  const re = ${pattern}
  const hit = [...document.querySelectorAll('main *, aside *, nav *')].find((e) => e.children.length === 0 && re.test(e.textContent.trim()))
  if (!hit) return 'not found: ' + re
  ;(hit.closest('a, button, [role=button], [role=link], [role=row]') ?? hit).click()
  return 'clicked'
})()`

const OPEN_A = [
  '--until', `[...document.querySelectorAll('a')].some((a) => a.getAttribute('href')?.startsWith(${JSON.stringify(A)}))`,
  '--eval', `(() => { [...document.querySelectorAll('a')].find((a) => a.getAttribute('href')?.startsWith(${JSON.stringify(A)})).click(); return location.pathname })()`,
]
// The composer, and the conversation's list under it: a send before the list is read has nothing to be drawn in.
const EDITOR_READY = [
  '--until', "[...document.querySelectorAll('.ProseMirror')].some((e) => e.editor) && document.querySelectorAll('[data-root]').length > 0",
  '--wait', '3000',
]

/** Hover the parent's card and press its Reply, opening the thread panel. */
const openThread = (parentText) => [
  '--until', `(() => { ${FIND} return !!cardOf(${JSON.stringify(parentText)}) })()`,
  '--eval', `(() => { ${FIND} const card = cardOf(${JSON.stringify(parentText)}); card.scrollIntoView({ block: 'center' }); return 'ok' })()`,
  '--hover', `div.relative.rounded-lg:has-text("${parentText}")`,
  '--eval', `(() => { ${FIND} const b = cardOf(${JSON.stringify(parentText)})?.querySelector('button[aria-label="Reply"]'); if (!b) return 'no Reply'; b.click(); return 'opened' })()`,
  '--wait', '2500',
]

/** Where each leg is, as steps from its start URL to a ready composer. */
const place = {
  topic: () => ({ url: `/app/folders/${QA_FOLDER}`, steps: [...OPEN_A, ...EDITOR_READY], which: 'first' }),
  thread: () => ({ url: `/app/folders/${QA_FOLDER}`, steps: [...OPEN_A, ...EDITOR_READY, ...openThread(parentOfThread())], which: 'last' }),
  dm: () => ({ url: `/app/people/${QA2}`, steps: EDITOR_READY, which: 'first' }),
  desk: () => ({
    url: '/app/desk',
    steps: ['--until', `(() => { ${FIND} return findAll('Switch probe A').length > 0 })()`, '--eval', clickLeaf('/^Switch probe A$/'), ...EDITOR_READY],
    which: 'first',
  }),
}
const parentOfThread = () => option('parent', markers.topic?.[0] ?? null) ?? (() => { throw new Error('--legs thread alone needs --parent <text of a message in A>') })()

const results = {}
let failed = false
const fail = (why) => {
  failed = true
  console.error(`FAIL ${why}`)
}

for (const leg of legs) {
  const { url, steps, which } = place[leg]()
  // `--cpu <dir>`: a CPU profile of each send, from just before Enter to 1.5 s after it, as <leg>-<n>.cpuprofile.
  const cpu = option('cpu')
  const sends = markers[leg].flatMap((text, i) => [
    '--eval', insert(text, which, leg === 'thread' ? parentOfThread() : null),
    ...(cpu ? ['--cpu', 'start'] : []),
    '--press', 'Enter',
    ...(cpu ? ['--wait', '1500', '--cpu', join(cpu, `${leg}-${i}.cpuprofile`), '--wait', '3500'] : ['--wait', '5000']),
  ])
  const report = await probe('qa1', url, [...steps, '--eval', INSTRUMENT, ...sends, '--eval', REPORT])
  const measured = evals(report).at(-1)
  const stepError = (report.steps ?? []).find((s) => s.error)
  results[leg] = { measured, failure: report.failure ?? stepError?.error, evals: evals(report).slice(0, -1).map((r) => String(r).slice(0, 120)) }
  if (!Array.isArray(measured)) {
    fail(`${leg}: no measurement (${results[leg].failure ?? JSON.stringify(results[leg].evals)})`)
    continue
  }
  for (const m of measured) {
    if (m.drawnMs === null || m.drawnMs >= BUDGET_MS) fail(`${leg} ${m.text}: drawn after ${m.drawnMs} ms`)
    if (m.removed || m.replaced || !m.connected) fail(`${leg} ${m.text}: row removed ${m.removed}, replaced ${m.replaced}, connected ${m.connected}`)
    if (m.moved) fail(`${leg} ${m.text}: moved ${m.moved}px before the next send`)
    if (m.replyMs === null || m.replyMs >= BUDGET_MS) fail(`${leg} ${m.text}: parent reply row changed after ${m.replyMs} ms`)
  }
  console.error(`${leg}: ${measured.map((m) => `${m.drawnMs}/${m.paintMs} ms${m.marks ? ` (${m.marks})` : ''}`).join('; ')}`)
}

// `--sends-only`: skip the reload and QA-2 checks, for timing work.
if (args.includes('--sends-only')) {
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ base, stamp, results }, null, 2))
  process.exit(failed ? 1 : 0)
}

// After a reload: QA-1 sees each message once; QA-2 sees each.
const COUNT = (texts) => `(() => { ${FIND} return Object.fromEntries(${JSON.stringify(texts)}.map((t) => [t, findAll(t).length])) })()`
for (const as of ['qa1', 'qa2']) {
  for (const leg of legs) {
    // QA-2 reads the DM from its side, and the Desk leg's messages in A itself (A is not on QA-2's Desk).
    const at =
      leg === 'dm'
        ? { url: `/app/people/${as === 'qa1' ? QA2 : QA1}`, steps: EDITOR_READY }
        : as === 'qa2' && leg === 'desk'
          ? place.topic()
          : place[leg]()
    const texts = markers[leg]
    const report = await probe(as, at.url, [...at.steps, '--wait', '3000', '--eval', COUNT(texts)])
    const counts = evals(report).at(-1)
    results[`${leg}:${as}`] = counts ?? report.failure
    for (const t of texts) if (!counts || counts[t] !== 1) fail(`${as} after reload, ${leg} ${t}: shown ${counts?.[t] ?? '?'} times`)
  }
}

if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ base, stamp, results }, null, 2))
console.log(JSON.stringify(results, null, 2).slice(0, 6000))
process.exit(failed ? 1 : 0)
