/**
 * Whether a reaction, an edit and a delete show at once, and are undone with a note when the relay refuses
 * them (OPT-8), on production.
 *
 *   node scripts/probe-actions-refused.mjs [--base https://peek.estiva.app] [--legs react,edit,delete,react-refused,edit-refused,delete-refused,elsewhere] [--json out.json]
 *
 * As QA-1 in Switch probe A, each leg on a message of its own, seeded first by `post-as-qa.ts` and acted on
 * in a fresh browser. The relay refuses for real: `probe.mjs --refuse-e <id>` changes the signed event naming
 * the leg's message on its way out, so the relay answers that the id does not match — a considered no, not
 * retried, and nothing stored.
 *
 * - `react`, `edit`, `delete` — accepted: drawn within 100 ms of the click (or Enter), never undone, no note.
 * - `…-refused` — drawn within 100 ms, then undone, with one note: "Reaction not saved", "Edit not saved — text
 *   restored in its edit box in Switch probe A" (and the box holds the edited text), "Not deleted — the message
 *   is back in Switch probe A".
 * - `elsewhere` — the message open in this tab is edited by QA-1 from another (`post-as-qa.ts --edit`, the
 *   same person on the relay): the open card shows the new text.
 *
 * Afterwards QA-2 opens A and finds each accepted change and none of the refused ones. Exit 1 on any miss.
 * `PROBE_SERVE=<dist>` runs an unmerged build (probe.mjs).
 */
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { promisify } from 'node:util'
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const QA_FOLDER = 'a78e60b1-a41f-48c9-bcb0-6ceacdee8c69'
const A = '/topic/switch-probe-a-'
const A_ADDRESS = '30840:c562b90f36802f52e11bc6a3f2e7d9e59e86c76de212fe457dbc89bc273a9a25:109c1d82-c8a2-4ebd-93d9-b37b7d7df6ff'
const NOTES = {
  react: 'Reaction not saved',
  edit: 'Edit not saved — text restored in its edit box in Switch probe A',
  delete: 'Not deleted — the message is back in Switch probe A',
}
const BUDGET_MS = 100

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : args[i + 1]
}
const base = option('base', 'https://peek.estiva.app')
const legs = option('legs', 'react,edit,delete,react-refused,edit-refused,delete-refused,elsewhere').split(',')
const jsonOut = option('json')
const stamp = Date.now().toString(36)
const marker = (leg) => `opt8-${leg}-${stamp}`

const here = dirname(fileURLToPath(import.meta.url))
const run = promisify(execFile)

/** Post as QA-1 into A, or edit a message there; the new event's id. */
async function asQa1(body, edit) {
  const { stdout } = await run(
    process.execPath,
    [join(here, 'run-in-vite.mjs'), 'scripts/post-as-qa.ts', '--as', '1', '--topic', A_ADDRESS, '--body', body, ...(edit ? ['--edit', edit] : [])],
    { encoding: 'utf8', cwd: join(here, '..') },
  )
  const id = stdout.match(/^[0-9a-f]{64}$/m)?.[0]
  if (!id) throw new Error(`post-as-qa: ${stdout.slice(0, 300)}`)
  return id
}

// The other tab, for `elsewhere`: the page asks, node edits as QA-1.
const hook = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1')
  let answer
  try {
    answer = await asQa1(url.searchParams.get('text'), url.searchParams.get('edit'))
  } catch (error) {
    answer = `failed: ${String(error.message).slice(0, 300)}`
  }
  response.writeHead(200).end(answer)
})
await new Promise((done) => hook.listen(0, '127.0.0.1', done))
const HOOK = `http://127.0.0.1:${hook.address().port}/`

async function probe(as, url, steps, extra = [], env = {}, timeout = 180_000) {
  try {
    const { stdout } = await run(
      process.execPath,
      [join(here, 'probe.mjs'), '--as', as, '--base', base, '--url', url, '--timeout', String(timeout), ...extra, ...steps],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: { ...process.env, ...env } },
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

const card = (id) => `document.querySelector('[data-root="${id}"]')`
/** A pointer press, as a person's: Base UI opens menus on pointerdown. */
const PRESS = `const press = (el) => {
  if (!el) return false
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'])
    el.dispatchEvent(new (type.startsWith('pointer') ? PointerEvent : MouseEvent)(type, { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' }))
  return true
}`
const byText = (selector, text) => `[...document.querySelectorAll('${selector}')].find((el) => el.textContent.trim() === ${JSON.stringify(text)})`

/** What "changed" means per leg: a reaction pill, the edited text outside the editor, the row gone. */
const changed = (leg, id, text) =>
  leg === 'react'
    ? `[...(${card(id)}?.querySelectorAll('button[aria-label]') ?? [])].some((b) => /, \\d+$/.test(b.getAttribute('aria-label')))`
    : leg === 'edit'
      ? `(() => { const c = ${card(id)}; if (!c) return false; const t = [...c.querySelectorAll('*')].filter((el) => !el.closest('.ProseMirror')).some((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.includes(${JSON.stringify(`${text}-edited`)}))); return t })()`
      : `!${card(id)}`

/** Watches the change (drawn when, undone when) and every toast, from the action on. */
const INSTRUMENT = (leg, id, text) => `(() => {
  const w = (window.__act = { actAt: null, changedMs: null, revertedMs: null, toasts: [] })
  const state = () => ${changed(leg, id, text)}
  const tick = () => {
    const now = performance.now()
    const toasts = document.querySelector('.fixed.bottom-4.left-4')
    for (const t of toasts ? [...toasts.children] : []) {
      const label = t.textContent.trim()
      if (label && !w.toasts.some((x) => x.label === label)) w.toasts.push({ label, ms: w.actAt === null ? null : Math.round(now - w.actAt) })
    }
    if (w.actAt === null) return
    const on = state()
    if (on && w.changedMs === null) w.changedMs = Math.round(now - w.actAt)
    else if (!on && w.changedMs !== null && w.revertedMs === null) w.revertedMs = Math.round(now - w.actAt)
  }
  addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && e.target.closest?.('[data-root="${id}"]')) w.actAt ??= performance.now() }, true)
  new MutationObserver(tick).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true })
  return 'instrumented'
})()`

const REPORT = (id) => `(() => {
  const w = window.__act
  const editor = ${card(id)}?.querySelector('.ProseMirror')
  return { changedMs: w.changedMs, revertedMs: w.revertedMs, toasts: w.toasts, editor: editor?.editor?.getText() ?? null, shown: !!${card(id)} }
})()`

const hover = (id) => ['--hover', `[data-root="${id}"] > *`]
const ACT = {
  react: (id) => [
    ...hover(id),
    '--eval', `(() => { ${PRESS}; return press(${card(id)}?.querySelector('button[aria-label="React"]')) })()`,
    '--until', `!!document.querySelector('[aria-label="Reactions"] button')`,
    '--eval', `(() => { ${PRESS}; window.__act.actAt = performance.now(); return press(document.querySelector('[aria-label="Reactions"] button')) })()`,
  ],
  edit: (id, text) => [
    ...hover(id),
    '--eval', `(() => { ${PRESS}; return press(${card(id)}?.querySelector('button[aria-label="More actions"]')) })()`,
    '--until', `!!${byText('[role="menuitem"]', 'Edit message')}`,
    '--eval', `(() => { ${PRESS}; return press(${byText('[role="menuitem"]', 'Edit message')}) })()`,
    '--until', `!!${card(id)}?.querySelector('.ProseMirror')?.editor`,
    '--eval', `(() => { const e = ${card(id)}.querySelector('.ProseMirror').editor; e.commands.setContent(${JSON.stringify(`${text}-edited`)}); e.commands.focus('end'); return e.getText() })()`,
    '--press', 'Enter',
  ],
  delete: (id) => [
    ...hover(id),
    '--eval', `(() => { ${PRESS}; return press(${card(id)}?.querySelector('button[aria-label="More actions"]')) })()`,
    '--until', `!!${byText('[role="menuitem"]', 'Delete')}`,
    '--eval', `(() => { ${PRESS}; return press(${byText('[role="menuitem"]', 'Delete')}) })()`,
    '--until', `!!${byText('button', 'Delete message')}`,
    '--eval', `(() => { ${PRESS}; window.__act.actAt = performance.now(); return press(${byText('button', 'Delete message')}) })()`,
  ],
}

const openLink = (prefix) => [
  '--until', `!!document.querySelector('a[href^="${prefix}"]')`,
  '--eval', `(() => { document.querySelector('a[href^="${prefix}"]').click(); return location.pathname })()`,
]
const OPEN_A = (id) => [...openLink(A), '--until', `!!${card(id)}`, '--wait', '2000']

const results = {}
const seeded = {}
let failed = false
const fail = (why) => {
  failed = true
  console.error(`FAIL ${why}`)
}

for (const leg of legs) {
  const text = marker(leg)
  const id = await asQa1(text)
  seeded[leg] = id
  const [kind, refused] = leg === 'elsewhere' ? ['elsewhere', false] : [leg.replace('-refused', ''), leg.endsWith('-refused')]
  if (kind === 'elsewhere') {
    const report = await probe(
      'qa1',
      `/app/folders/${QA_FOLDER}`,
      [
        ...OPEN_A(id),
        '--eval', INSTRUMENT('edit', id, text),
        '--eval', `(async () => { window.__act.actAt = performance.now(); return await window.__probeHook(${JSON.stringify(`?edit=${id}&text=${encodeURIComponent(`${text}-edited`)}`)}) })()`,
        '--wait', '8000',
        '--eval', REPORT(id),
      ],
      [],
      { PROBE_HOOK: HOOK },
    )
    const measured = evals(report).at(-1)
    results[leg] = { id, measured, failure: report.failure ?? (report.steps ?? []).find((s) => s.error)?.error }
    if (!measured || measured.changedMs === null) fail(`elsewhere: the open card never showed the other tab's edit (${JSON.stringify(results[leg]).slice(0, 300)})`)
    else console.error(`elsewhere: shown ${measured.changedMs} ms after the other tab's edit was asked for`)
    continue
  }
  const report = await probe(
    'qa1',
    `/app/folders/${QA_FOLDER}`,
    [...OPEN_A(id), '--eval', INSTRUMENT(kind, id, text), ...ACT[kind](id, text), '--wait', '7000', '--eval', REPORT(id)],
    refused ? ['--refuse-e', id] : [],
  )
  const measured = evals(report).at(-1)
  const stepError = (report.steps ?? []).find((s) => s.error)
  results[leg] = { id, measured, refused: report.refused, failure: report.failure ?? stepError?.error }
  if (!measured || typeof measured !== 'object') {
    fail(`${leg}: no measurement (${results[leg].failure ?? JSON.stringify(evals(report)).slice(0, 300)})`)
    continue
  }
  const notes = measured.toasts.map((t) => t.label)
  if (measured.changedMs === null || measured.changedMs >= BUDGET_MS) fail(`${leg}: drawn after ${measured.changedMs} ms`)
  if (!refused) {
    if (measured.revertedMs !== null) fail(`${leg}: undone after ${measured.revertedMs} ms though the relay took it`)
    if (notes.length) fail(`${leg}: a note appeared: ${notes.join(' | ')}`)
  } else {
    const relay = report.refused ?? []
    if (relay.length !== 1) fail(`${leg}: the relay was asked ${relay.length} times (expected once: a considered no is not retried)`)
    else if (relay[0].status === 200 && !/"accepted":\s*false/.test(relay[0].body)) fail(`${leg}: the relay accepted it: ${relay[0].body}`)
    if (measured.revertedMs === null) fail(`${leg}: never undone`)
    if (notes.filter((n) => n === NOTES[kind]).length !== 1) fail(`${leg}: notes were ${JSON.stringify(notes)}`)
    if (kind === 'edit' && measured.editor !== `${text}-edited`) fail(`edit-refused: the edit box holds ${JSON.stringify(measured.editor)}`)
    if (kind === 'delete' && !measured.shown) fail('delete-refused: the message is not back')
  }
  console.error(
    `${leg}: drawn ${measured.changedMs} ms, undone ${measured.revertedMs} ms, notes ${JSON.stringify(notes)}, relay ${JSON.stringify((report.refused ?? []).map((r) => `${r.status} ${r.body.slice(0, 80)}`))}`,
  )
}
hook.close()

// QA-2 opens A: every accepted change, none of the refused ones.
const want = {
  react: ['react', true], 'react-refused': ['react', false],
  edit: ['edit', true], 'edit-refused': ['edit', false], elsewhere: ['edit', true],
  delete: ['delete', true], 'delete-refused': ['delete', false],
}
const checked = legs.filter((leg) => seeded[leg])
const COUNT = `(() => Object.fromEntries([${checked.map((leg) => `[${JSON.stringify(leg)}, ${changed(want[leg][0], seeded[leg], marker(leg))}]`).join(', ')}]))()`
const anyRoot = checked.find((leg) => !leg.startsWith('delete')) ?? checked[0]
const qa2 = await probe('qa2', `/app/folders/${QA_FOLDER}`, [...openLink(A), '--until', `!!${card(seeded[anyRoot])}`, '--wait', '4000', '--eval', COUNT])
const seen = evals(qa2).at(-1)
results.qa2 = seen ?? qa2.failure
for (const leg of checked) if (!seen || seen[leg] !== want[leg][1]) fail(`QA-2: ${leg} ${want[leg][1] ? 'not' : 'wrongly'} seen (${JSON.stringify(seen?.[leg])})`)

if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ base, stamp, seeded, results }, null, 2))
console.log(JSON.stringify(results, null, 2).slice(0, 6000))
process.exit(failed ? 1 : 0)
