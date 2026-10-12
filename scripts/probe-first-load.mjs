/**
 * How fast Peek opens, on production, as QA-1 and QA-2 — the measure every issue in "Peek opens instantly" proves
 * its Done when with. Run it before and after a change, the same way.
 *
 *   node scripts/probe-first-load.mjs [--as qa1,qa2] [--legs open,first,long,new] [--runs 1] [--json out.json]
 *
 * Each leg is one headless browser (scripts/probe.mjs), with scripts/first-load-recorder.js running in every page
 * from its first byte (`--init`):
 *
 * - `open`: a browser with nothing stored opens Desk; then reload → Desk; Topics, then reload → Topics; then a new
 *   tab → Desk, in the same browser — the reloads and the new tab are what a copy on the device speeds up, the
 *   first open is what it cannot.
 * - `first`: a browser with nothing stored opens Desk, waits 10 s, then opens for the first time an Open work topic,
 *   a Starred DM and Topics, back to Desk between each — what loading ahead from Desk speeds up.
 * - `long`: Topics, then a 200-message topic never opened in this browser: when its messages show, and how many
 *   times the list jumped while nobody scrolled.
 * - `new`: New topic in the QA Folder, Start → a composer in the new topic; then the topic is deleted again.
 *
 * Every leg prints the socket REQs sent in the 5 s after each action (the relay allows 50 per 5 s per connection),
 * the most in any 5 s, and anything the relay refused: a CLOSED, a NOTICE, an OK false or an HTTP 429.
 * `node scripts/first-load-analyze.mjs out.json <identity> <leg> <phase>` prints one phase's requests in order.
 *
 * Times are ms from the action (a click, a reload, the tab opening) to the moment its rows were on screen with no
 * placeholder left. "new tab" and "fresh" include the sign-in bounce through Estiva ID before Peek's own page.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const run = promisify(execFile)
const args = process.argv.slice(2)
const option = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback)
const PROBE = new URL('./probe.mjs', import.meta.url).pathname
const RECORDER = new URL('./first-load-recorder.js', import.meta.url).pathname
const scratch = mkdtempSync(join(tmpdir(), 'first-load-'))

/**
 * What each identity's workspace holds. Desk's rows are its Open work and Starred; the topics are the QA Folder's
 * 200-message "Switch probe" fixtures, whose newest message reads "Message 200 of 200 in <title>.". If `first` finds
 * nothing to click for the Open work topic, put it back: Desk → Screener → Open on its row, as that identity.
 */
const WORKSPACES = {
  qa1: { desk: ['Switch probe A', 'Switch probe B', 'QA-2'], openWork: 'Switch probe A', dm: 'QA-2', long: 'Switch probe B' },
  qa2: { desk: ['Switch probe B', 'QA-1'], openWork: 'Switch probe B', dm: 'QA-1', long: 'Switch probe A' },
}
const TREE = ['Switch probe A', 'Switch probe B']
const newest = (title) => `200 of 200 in ${title}`

// Steps, as probe.mjs arguments.
const settled = (mark = 'allTextsNoPulse', ms = 20000) => ['--until', `(() => { const p = __fl.phases.at(-1); return !!p.marks[${JSON.stringify(mark)}] || performance.now() - p.at > ${ms} })()`]
const leaf = (text) => `[...document.querySelectorAll('main *')].find((e) => e.children.length === 0 && e.textContent.trim() === ${JSON.stringify(text)})`
const act = (label, texts, find, path = null) =>
  ['--eval', `(() => { const el = ${find}; if (!el) throw new Error('nothing to click for ${label}'); __fl.phase(${JSON.stringify(label)}, ${JSON.stringify(texts)}, ${JSON.stringify(path)}); el.click(); return 'clicked' })()`]
// The row under one of Desk's headings: QA-2's "QA-1" is in the Screener as well as in Starred.
const under = (heading, text) =>
  `[...document.querySelectorAll('main *')].find((e) => e.children.length === 0 && e.textContent.trim() === ${JSON.stringify(text)} && ${leaf(heading)}?.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING)`
const topicsLink = `document.querySelector('a[href="/app/folders"]')`
// A reload is no sign-in bounce: the next document starts the count again (the recorder's `fl.first`).
const reload = (texts) => ['--eval', `(() => { sessionStorage.setItem('fl.texts', ${JSON.stringify(JSON.stringify(texts))}); sessionStorage.removeItem('fl.first'); setTimeout(() => location.reload(), 20); return 'reloading' })()`, '--wait', '1500']
const report = ['--eval', '__fl.report()']

const legs = {
  open: (w) => ({
    url: '/app/desk',
    first: w.desk,
    steps: [
      ...settled('allTextsNoPulse', 30000), '--wait', '3000', ...report,
      ...reload(w.desk), ...settled(), '--wait', '3000', ...report,
      ...act('desk→topics', TREE, topicsLink, '/app/folders'), ...settled(), '--wait', '3000',
      ...reload(TREE), ...settled(), '--wait', '3000', ...report,
      // A new tab has an empty sessionStorage: the recorder's texts are Desk's again, from __flDefault.
      '--tab', '/app/desk', ...settled('allTextsNoPulse', 30000), '--wait', '3000', ...report,
    ],
    phases: [['fresh → Desk', 0, 'load'], ['reload → Desk', 1, 'load'], ['reload → Topics', 2, 'load'], ['new tab → Desk', 3, 'load']],
  }),
  first: (w) => ({
    url: '/app/desk',
    first: w.desk,
    steps: [
      ...settled('allTextsNoPulse', 30000), '--wait', '10000',
      // Desk's rows open in Desk's own pane since OPT-12, and stay on screen beside it.
      ...act('Open work topic', [newest(w.openWork)], under('Open work', w.openWork)), ...settled(), '--wait', '3000',
      ...act('Starred DM', [w.dm], under('Starred', w.dm)), ...settled('composer'), '--wait', '3000',
      ...act('Topics', TREE, topicsLink, '/app/folders'), ...settled(), '--wait', '3000',
      ...report,
    ],
    phases: [['Open work topic, first open', 0, 'Open work topic'], ['Starred DM, first open', 0, 'Starred DM'], ['Topics, first open', 0, 'Topics']],
  }),
  long: (w) => ({
    url: '/app/folders',
    first: TREE,
    steps: [
      ...settled('allTextsNoPulse', 30000), '--wait', '3000',
      ...act('long topic', [newest(w.long)], leaf(w.long)), ...settled(), '--wait', '5000',
      ...report,
    ],
    phases: [['200-message topic, first open', 0, 'long topic']],
  }),
  new: (w, title) => ({
    url: '/app/folders',
    first: TREE,
    steps: [
      ...settled('allTextsNoPulse', 30000), '--wait', '3000',
      '--click', 'New topic', '--wait', '600',
      // probe's --fill times out on this dialog's field; set it the way React expects instead.
      '--eval', `(() => { const el = document.querySelector('input[aria-label="Topic title"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(title)}); el.dispatchEvent(new Event('input', { bubbles: true })); return el.value })()`,
      '--wait', '300',
      '--eval', `(() => { document.querySelector('[role=combobox][aria-label=Folder]').click(); return 'open' })()`,
      '--wait', '600',
      '--eval', `(() => { const o = [...document.querySelectorAll('[role=option]')].find((e) => e.textContent.trim() === 'QA'); if (!o) throw new Error('no QA Folder to start a topic in'); o.click(); return 'QA' })()`,
      '--wait', '600',
      '--eval', `(() => { const f = document.querySelector('[role=combobox][aria-label=Folder]').textContent.replace('▼', '').trim(); if (f !== 'QA') throw new Error('Folder is ' + f); return f })()`,
      '--eval', `(() => { __fl.phase('start', [${JSON.stringify(title)}]); document.querySelector('button[type=submit][form]').click(); return 'started' })()`,
      '--until', `(() => { const p = __fl.phases.at(-1); return (p.marks.allTextsNoPulse && p.marks.composer && performance.now() - p.at > 6000) || performance.now() - p.at > 20000 })()`,
      ...report,
    ],
    phases: [['New topic, Start → composer', 0, 'start', 'composer']],
  }),
}

const identities = option('as', 'qa1,qa2').split(',')
const chosen = option('legs', 'open,first,long,new').split(',')
const runs = Number(option('runs', '1'))
const results = []
let failed = false
for (const as of identities) if (!WORKSPACES[as]) throw new Error(`no workspace described for ${as}: add it to WORKSPACES`)
// Identities take turns, leg by leg: about three runs in a row as one identity trip Estiva ID's /nip44/decrypt
// limit, and a Desk whose lists cannot be decrypted is not a number worth keeping.
for (const name of chosen) {
  for (let i = 0; i < runs; i++) {
    for (const as of identities) {
      const w = WORKSPACES[as]
      const title = name === 'new' ? `First-load probe ${as} ${new Date().toISOString().slice(0, 19)}` : null
      const leg = legs[name](w, title)
      const init = join(scratch, `${as}-${name}.js`)
      writeFileSync(init, `window.__flDefault = ${JSON.stringify(leg.first)};\n${readFileSync(RECORDER, 'utf8')}`)
      const { stdout } = await run(process.execPath, [PROBE, '--as', as, '--url', leg.url, '--init', init, '--timeout', '45000', ...leg.steps], { maxBuffer: 64 << 20 }).catch((e) => ({ stdout: e.stdout }))
      const probe = JSON.parse(stdout)
      const docs = probe.steps.filter((s) => s.eval === '__fl.report()' && s.result).map((s) => JSON.parse(s.result))
      const http429 = [...new Set(docs.flatMap((d) => d.res.filter(([, , , status]) => status === 429).map(([, , what]) => what)))]
      const result = { as, leg: name, run: i + 1, docs, http429, errors: probe.errors }
      results.push(result)
      if (probe.failure || probe.steps.some((s) => s.error)) {
        failed = true
        console.log(`${as} ${name}: failed — ${probe.failure ?? ''} ${JSON.stringify(probe.steps.filter((s) => s.error).map((s) => s.error))}`)
      }
      print(result, leg.phases)
      if (title && docs.length) await deleteTopic(as, title)
    }
  }
}
if (option('json')) writeFileSync(option('json'), JSON.stringify(results))
process.exit(failed ? 1 : 0)

function print({ as, leg, run, docs, http429 }, phases) {
  console.log(`\n${as} · ${leg}${runs > 1 ? ` · run ${run}` : ''}`)
  for (const [label, index, phaseLabel, markName = 'allTextsNoPulse'] of phases) {
    const doc = docs[index]
    const phase = doc?.phases.find((p) => p.label === phaseLabel)
    if (!phase) {
      console.log(`  ${label.padEnd(32)} not measured`)
      continue
    }
    // A document's own load starts at its navigation; a tab's first document also waited for the sign-in bounce.
    const before = phaseLabel === 'load' ? doc.beforeThisDoc : 0
    const at = phase.marks[markName] ?? phase.marks.allTexts
    const took = at === undefined ? 'never' : `${before + at - phase.at} ms${phase.marks[markName] === undefined ? ' (placeholders left)' : ''}`
    const extra = []
    if (before) extra.push(`sign-in bounce ${before} ms`)
    if (phase.marks.composer !== undefined && markName !== 'composer') extra.push(`composer ${phase.marks.composer - phase.at} ms`)
    if (phase.marks.messages !== undefined) extra.push(`first message ${phase.marks.messages - phase.at} ms`)
    if (phase.jumps.length) extra.push(`jumps ${JSON.stringify(phase.jumps.map(([t, what]) => [t - phase.at, what]))}`)
    if ((phase.editors ?? []).filter(([, e]) => e === 'composer').length > 1) extra.push(`composer mounted ${phase.editors.filter(([, e]) => e === 'composer').length}×`)
    if ((phase.paths ?? []).length > 1) extra.push(`paths ${phase.paths.length}`)
    const next = doc.phases[doc.phases.indexOf(phase) + 1]?.at ?? Infinity
    const reqs = doc.subs.filter(([t]) => t >= phase.at && t < Math.min(next, phase.at + 5000)).length
    const http = doc.res.filter(([t]) => t >= phase.at && t < Math.min(next, phase.at + 5000)).length
    console.log(`  ${label.padEnd(32)} ${took.padEnd(12)} | REQ ${String(reqs).padStart(2)} in 5 s, http ${http}${extra.length ? ` | ${extra.join(', ')}` : ''}`)
  }
  const refusals = docs.flatMap((d) => d.refusals)
  const most = Math.max(0, ...docs.map((d) => mostIn5s(d.subs.map(([t]) => t))))
  const statuses = docs.flatMap((d) => d.res.filter(([, , , status]) => status === 429))
  console.log(`  socket: most REQs in any 5 s ${most} (relay allows 50) · refused ${refusals.length}${refusals.length ? ` ${JSON.stringify(refusals.slice(0, 3))}` : ''} · HTTP 429 ${statuses.length}${http429.length ? ` on ${http429.join(', ')}` : ''}`)
  if (http429.some((what) => what.includes('/nip44/'))) {
    failed = true
    console.log('  ↑ not a valid measure: Estiva ID refused decrypts, so lists may be missing. Wait ~4 min and run it again.')
  }
}

function mostIn5s(times) {
  let most = 0
  for (let i = 0, j = 0; i < times.length; i++) {
    while (times[i] - times[j] >= 5000) j++
    most = Math.max(most, i - j + 1)
  }
  return most
}

/** Deletes the topic `new` created, from its row's menu in Topics, and says whether it is gone. */
async function deleteTopic(as, title) {
  const steps = [
    '--until', `!!${leaf(title)}`,
    '--eval', `(() => { let el = ${leaf(title)}; while (el && !el.querySelector('button[aria-label^="More options"]')) el = el.parentElement; const b = el?.querySelector('button[aria-label^="More options"]'); if (!b) throw new Error('no row menu'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); b.click(); return 'menu' })()`,
    '--wait', '600', '--click', 'Delete', '--wait', '800',
    '--eval', `(() => { const d = document.querySelector('[role=dialog],[role=alertdialog]'); const b = d && [...d.querySelectorAll('button')].find((x) => /^Delete/.test(x.textContent.trim())); if (!b) throw new Error('no confirm'); b.click(); return 'confirmed' })()`,
    '--wait', '3000',
    '--eval', `${leaf(title)} ? 'still listed' : 'gone'`,
  ]
  const { stdout } = await run(process.execPath, [PROBE, '--as', as, '--url', '/app/folders', '--timeout', '45000', ...steps], { maxBuffer: 16 << 20 }).catch((e) => ({ stdout: e.stdout }))
  const probe = JSON.parse(stdout)
  const outcome = probe.steps.at(-1)?.result ?? probe.failure ?? probe.steps.find((s) => s.error)?.error
  console.log(`  deleted "${title}": ${outcome}`)
  if (outcome !== 'gone') failed = true
}
