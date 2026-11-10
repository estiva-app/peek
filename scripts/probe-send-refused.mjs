/**
 * Whether a message the relay refuses is taken out, said so, and its text put back in its conversation's
 * composer (OPT-7), on production.
 *
 *   node scripts/probe-send-refused.mjs [--base https://peek.estiva.app] [--legs control,enter,button,typed,moved,dm] [--json out.json]
 *
 * As QA-1 in Switch probe A, each leg in a fresh browser. The relay refuses for real: `probe.mjs --refuse`
 * changes the content of the signed event carrying the leg's marker on its way out, so the relay answers that
 * the id does not match — a considered no, not retried, and nothing stored.
 *
 * - `control` — an unmarked message by Enter. It must stay, and no note may appear: the route lets it through.
 * - `enter`   — a marked message by Enter.
 * - `button`  — a marked message by the Send button.
 * - `typed`   — a marked message by Enter, the refusal held 3 s while "<marker>-since" is typed in the composer:
 *               the old text must come back above it.
 * - `moved`   — a marked message by Enter, the refusal held 4 s while QA-1 opens Switch probe B: B's composer is
 *               untouched, the note names A, and back in A the text is in the composer.
 * - `dm`      — a marked message by Enter in the DM with QA-2: the note says "your conversation with <name>".
 *
 * Each marked message must be drawn at once (OPT-6; the first send of a leg is the one an idle page makes),
 * then taken out, with one note: "Not sent — text restored in Switch probe A". Afterwards QA-2 opens A and finds
 * the control once and no marker. Exit 1 on any miss. `PROBE_SERVE=<dist>` runs an unmerged build (probe.mjs).
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const QA_FOLDER = 'a78e60b1-a41f-48c9-bcb0-6ceacdee8c69'
const A = '/topic/switch-probe-a-'
const B = '/topic/switch-probe-b-'
const QA2 = '3bb30d683788016b85c83604dd5660e4e172e95d46d4e3ebab623ff5847b1f71'
const NOTE = 'Not sent — text restored in Switch probe A'
const DM_NOTE = /^Not sent — text restored in your conversation with \S/
const BUDGET_MS = 100

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : args[i + 1]
}
const base = option('base', 'https://peek.estiva.app')
const legs = option('legs', 'control,enter,button,typed,moved,dm').split(',')
const jsonOut = option('json')
const stamp = Date.now().toString(36)
const marker = (leg) => `opt7-${leg}-${stamp}`

const here = dirname(fileURLToPath(import.meta.url))
const run = promisify(execFile)

async function probe(as, url, steps, extra = [], timeout = 180_000) {
  try {
    const { stdout } = await run(
      process.execPath,
      [join(here, 'probe.mjs'), '--as', as, '--base', base, '--url', url, '--timeout', String(timeout), ...extra, ...steps],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    )
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

// In the page: text outside any editor or toast is a drawn message.
const FIND = `
  const outside = (node) => { const el = node.parentElement; return el && !el.closest('.ProseMirror, [contenteditable=true], .fixed.bottom-4.left-4') }
  const findAll = (text) => {
    const hits = document.evaluate('//text()[contains(., "' + text + '")]', document.body, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)
    const out = []
    for (let i = 0; i < hits.snapshotLength; i++) if (outside(hits.snapshotItem(i))) out.push(hits.snapshotItem(i).parentElement)
    return out
  }
`

/** Watches the marker's row (drawn when, removed when) and every toast's text, from Enter on. */
const INSTRUMENT = (text) => `(() => {
  ${FIND}
  const w = (window.__refused = { text: ${JSON.stringify(text)}, sentAt: null, drawnMs: null, removedMs: null, el: null, toasts: [] })
  const sent = () => { if (w.sentAt === null) w.sentAt = performance.now() }
  addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) sent() }, true)
  addEventListener('mousedown', (e) => { if (e.target.closest?.('button[aria-label="Send"]')) sent() }, true)
  new MutationObserver(() => {
    const now = performance.now()
    const toasts = document.querySelector('.fixed.bottom-4.left-4')
    for (const t of toasts ? [...toasts.children] : []) {
      const label = t.textContent.trim()
      if (label && !w.toasts.some((x) => x.label === label)) w.toasts.push({ label, ms: w.sentAt === null ? null : Math.round(now - w.sentAt) })
    }
    if (w.sentAt === null) return
    if (!w.el) {
      const el = findAll(w.text)[0]
      if (el) { w.el = el; w.drawnMs = Math.round(now - w.sentAt) }
    } else if (!w.el.isConnected && w.removedMs === null && !findAll(w.text).length) w.removedMs = Math.round(now - w.sentAt)
  }).observe(document.body, { subtree: true, childList: true, characterData: true })
  return 'instrumented'
})()`

const editorOf = `[...document.querySelectorAll('.ProseMirror')].find((e) => e.editor)`
const insert = (text) => `(() => { const el = ${editorOf}; if (!el) return 'no composer'; el.editor.chain().focus('end').insertContent(${JSON.stringify(text)}).run(); return el.editor.getText() })()`
const COMPOSER = `(() => ${editorOf}?.editor.getText() ?? null)()`
const PRESS_SEND = `(() => {
  const b = document.querySelector('button[aria-label="Send"]')
  if (!b || b.disabled) return 'no Send button'
  b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
  b.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }))
  b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, detail: 1 }))
  return 'pressed'
})()`
const REPORT = `(() => { const w = window.__refused; return { drawnMs: w.drawnMs, removedMs: w.removedMs, shown: !!w.el?.isConnected, toasts: w.toasts, composer: ${COMPOSER}, path: location.pathname } })()`

const openLink = (prefix) => [
  '--until', `!!document.querySelector('a[href^="${prefix}"]')`,
  '--eval', `(() => { document.querySelector('a[href^="${prefix}"]').click(); return location.pathname })()`,
]
// The composer, and the conversation's list under it: a send before the list is read has nothing to be drawn in.
const EDITOR_READY = [
  '--until', `!!${editorOf} && document.querySelectorAll('[data-root]').length > 0`,
  '--wait', '3000',
]
const OPEN_A = [...openLink(A), ...EDITOR_READY]

const results = {}
let failed = false
const fail = (why) => {
  failed = true
  console.error(`FAIL ${why}`)
}

for (const leg of legs) {
  const text = marker(leg)
  const refuse = leg === 'control' ? [] : ['--refuse', text, '--refuse-hold', leg === 'typed' ? '3000' : leg === 'moved' ? '4000' : '0']
  const send = leg === 'button' ? ['--eval', PRESS_SEND] : ['--press', 'Enter']
  const during =
    leg === 'typed'
      ? ['--wait', '500', '--eval', insert(` ${text}-since`)]
      : leg === 'moved'
        ? ['--wait', '300', ...openLink(B), '--until', `location.pathname.startsWith(${JSON.stringify(B)}) && !!${editorOf}`]
        : []
  const after = leg === 'moved' ? ['--eval', REPORT, ...openLink(A), ...EDITOR_READY, '--eval', `(() => { ${FIND} return { composer: ${COMPOSER}, rows: findAll(${JSON.stringify(text)}).length } })()`] : []
  const [url, open] = leg === 'dm' ? [`/app/people/${QA2}`, EDITOR_READY] : [`/app/folders/${QA_FOLDER}`, OPEN_A]
  const report = await probe('qa1', url, [...open, '--eval', INSTRUMENT(text), '--eval', insert(text), ...send, ...during, '--wait', '7000', '--eval', REPORT, ...after], refuse)
  const out = evals(report)
  const stepError = (report.steps ?? []).find((s) => s.error)
  const measured = leg === 'moved' ? out.at(-3) : out.at(-1)
  const backInA = leg === 'moved' ? out.at(-1) : undefined
  results[leg] = { text, measured, backInA, refused: report.refused, failure: report.failure ?? stepError?.error }
  if (!measured || typeof measured !== 'object') {
    fail(`${leg}: no measurement (${results[leg].failure ?? JSON.stringify(out).slice(0, 300)})`)
    continue
  }
  const notes = measured.toasts.map((t) => t.label)
  if (measured.drawnMs === null || measured.drawnMs >= BUDGET_MS) fail(`${leg}: drawn after ${measured.drawnMs} ms`)
  if (leg === 'control') {
    if (!measured.shown) fail('control: the unrefused message is not shown')
    if (notes.length) fail(`control: a note appeared: ${notes.join(' | ')}`)
    if ((measured.composer ?? '').includes(text)) fail('control: its text came back to the composer')
  } else {
    const relay = report.refused ?? []
    if (relay.length !== 1) fail(`${leg}: the relay was asked ${relay.length} times (expected once: a considered no is not retried)`)
    else if (relay[0].status === 200 && !/"accepted":\s*false/.test(relay[0].body)) fail(`${leg}: the relay accepted it: ${relay[0].body}`)
    if (measured.shown || measured.removedMs === null) fail(`${leg}: the row was not taken out (shown ${measured.shown})`)
    if (notes.filter((n) => (leg === 'dm' ? DM_NOTE.test(n) : n.includes(NOTE))).length !== 1) fail(`${leg}: notes were ${JSON.stringify(notes)}`)
    // Leaving A takes its row away anyway, so in the moved leg the row is checked once back in A.
    if (leg === 'moved' && backInA?.rows !== 0) fail(`moved: back in A the message is shown ${backInA?.rows} times`)
    const inA = leg === 'moved' ? backInA?.composer : measured.composer
    if (!(inA ?? '').includes(text)) fail(`${leg}: A's composer reads ${JSON.stringify(inA)}`)
    if (leg === 'typed' && !(measured.composer.indexOf(text) < measured.composer.indexOf(`${text}-since`))) fail(`typed: not above what was typed since: ${JSON.stringify(measured.composer)}`)
    if (leg === 'moved' && (!measured.path.startsWith(B) || (measured.composer ?? '').includes(text))) fail(`moved: B's composer reads ${JSON.stringify(measured.composer)} on ${measured.path}`)
  }
  console.error(`${leg}: drawn ${measured.drawnMs} ms, removed ${measured.removedMs} ms, notes ${JSON.stringify(notes)}, relay ${JSON.stringify((report.refused ?? []).map((r) => `${r.status} ${r.body.slice(0, 80)}`))}`)
}

// QA-2 opens A: the control once, no marker. (The dm leg's relay answer, a refusal, is its check that nothing was stored.)
const inA = legs.filter((leg) => leg !== 'dm')
const texts = inA.map(marker)
const COUNT = `(() => { ${FIND} return Object.fromEntries(${JSON.stringify(texts)}.map((t) => [t, findAll(t).length])) })()`
const qa2 = await probe('qa2', `/app/folders/${QA_FOLDER}`, [...OPEN_A, '--wait', '3000', '--eval', COUNT])
const counts = evals(qa2).at(-1)
results.qa2 = counts ?? qa2.failure
for (const leg of inA) {
  const want = leg === 'control' ? 1 : 0
  if (!counts || counts[marker(leg)] !== want) fail(`QA-2 sees ${leg} ${counts?.[marker(leg)] ?? '?'} times, expected ${want}`)
}

if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ base, stamp, results }, null, 2))
console.log(JSON.stringify(results, null, 2).slice(0, 6000))
process.exit(failed ? 1 : 0)
