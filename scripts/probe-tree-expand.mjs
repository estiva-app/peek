/**
 * Does a Folder in the side tree open in one step (OPT-11)? Katerina, 7 Oct:
 * "just a few items appear and in a second, the whole list fully shows up,
 * making the tree jumping."
 *
 *   node scripts/probe-tree-expand.mjs --folder <id> [--as qa1] [--hover] [--for 4000] [--base …]
 *   node scripts/probe-tree-expand.mjs --list [--as qa1]
 *
 * One headless run (`probe.mjs`, so sign-in is every other probe's) turns the
 * column to Folders, stores `<id>` closed, reloads, lets the column settle and
 * then clicks the Folder's heading — or with `--hover` rests the pointer on it
 * first, so the hover read ahead (SID-2) has run. Then it closes the Folder and
 * opens it again (`warm`). For each open it samples every animation frame for
 * `--for` ms and prints:
 *
 * - **steps**: each change in what the fold draws — `rows` (`[data-file]`
 *   rows in it), `skeleton`, and the heading box's `bottom` — with ms from the
 *   click. The rows below it move exactly when `bottom` does;
 * - **rowCounts**: the row counts seen, in order. One step is `[0, n]`: a
 *   partial list is any count between;
 * - **moves**: separate runs of `bottom` changing — the panel's 150 ms height
 *   animation is one run. The Done-when is `moves <= 1`;
 * - **queries**: the `/query` POSTs the page started after the click.
 *
 * `--list` prints the column's Folders with their row count once each is
 * opened, for choosing one with at least 10 files.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : args[i + 1]
}
const flag = (name) => args.includes(`--${name}`)
const as = option('as', 'qa1')
const base = option('base', 'https://peek.estiva.app')
const folder = option('folder')
const span = Number(option('for', '4000'))
if (!folder && !flag('list')) {
  console.error('usage: probe-tree-expand.mjs --folder <id> [--as qa1] [--hover] [--for 4000] | --list')
  process.exit(2)
}

const group = (id) => `[data-nav-group="${id}"]`

// Folders view, the target stored closed, then a reload so the next open is the tab's first.
const setup = `(() => {
  localStorage.setItem('peek.tree.view', 'all')
  ${folder ? `localStorage.setItem('peek.tree.folder.${folder}', 'closed')` : ''}
  setTimeout(() => location.reload(), 0)
  return true
})()`

/** Clicks the heading (unless `click` is false) and samples every frame for `span` ms. */
const sample = (label) => `(async () => {
  const box = document.querySelector('${group(folder)}')
  const header = box.querySelector('button')
  const read = () => {
    const panel = document.getElementById(header.getAttribute('aria-controls'))
    return {
      open: header.getAttribute('aria-expanded') === 'true',
      rows: panel ? panel.querySelectorAll('[data-file]').length : 0,
      skeleton: !!panel?.querySelector('[data-loading]'),
      bottom: Math.round(box.getBoundingClientRect().bottom),
    }
  }
  const frames = []
  const started = performance.now()
  header.click()
  await new Promise((done) => {
    const tick = () => {
      frames.push({ t: Math.round(performance.now() - started), ...read() })
      if (performance.now() - started < ${span}) requestAnimationFrame(tick)
      else done()
    }
    requestAnimationFrame(tick)
  })
  const steps = []
  for (const frame of frames) {
    const last = steps[steps.length - 1]
    if (!last || last.rows !== frame.rows || last.skeleton !== frame.skeleton || last.bottom !== frame.bottom || last.open !== frame.open) steps.push(frame)
  }
  const rowCounts = [0]
  for (const frame of frames) if (frame.rows !== rowCounts[rowCounts.length - 1]) rowCounts.push(frame.rows)
  // A move is a run of frames in which the bottom changes; two still frames end it.
  let moves = 0
  let still = 2
  for (let i = 1; i < frames.length; i++) {
    if (frames[i].bottom !== frames[i - 1].bottom) {
      if (still >= 2) moves++
      still = 0
    } else still++
  }
  const queries = performance
    .getEntriesByType('resource')
    .filter((entry) => entry.startTime >= started && /\\/query$/.test(new URL(entry.name).pathname))
    .map((entry) => Math.round(entry.startTime - started) + '→' + Math.round(entry.responseEnd - started))
  return { label: '${label}', rowCounts, moves, queries, steps: steps.length > 40 ? [...steps.slice(0, 20), '…', ...steps.slice(-10)] : steps }
})()`

const close = `(() => { document.querySelector('${group(folder)}').querySelector('button').click(); return true })()`

// Every Folder opened at once, then the rows each one drew.
const list = `(async () => {
  const boxes = [...document.querySelectorAll('[data-nav-group]')]
  for (const box of boxes) {
    const header = box.querySelector('button')
    if (header.getAttribute('aria-expanded') !== 'true') header.click()
  }
  await new Promise((done) => setTimeout(done, 8000))
  return boxes.map((box) => {
    const header = box.querySelector('button')
    const panel = document.getElementById(header.getAttribute('aria-controls'))
    return { id: box.getAttribute('data-nav-group'), name: header.innerText.trim(), rows: panel ? panel.querySelectorAll('[data-file]').length : null }
  })
})()`

const probe = join(dirname(fileURLToPath(import.meta.url)), 'probe.mjs')
const steps = [
  ['--eval', setup],
  ['--wait', '2000'],
  ['--until', folder ? `document.querySelector('${group(folder)}')` : `document.querySelector('[data-nav-group]')`],
  // The column's own reads (Folders, every Folder's dots) settle before the click is timed.
  ['--wait', '5000'],
]
if (flag('list')) steps.push(['--eval', list])
else {
  if (flag('hover')) steps.push(['--hover', `${group(folder)} button`], ['--wait', '1500'])
  steps.push(['--eval', sample(flag('hover') ? 'hovered' : 'cold')], ['--eval', close], ['--wait', '1000'], ['--eval', sample('warm')])
}

const { stdout } = await promisify(execFile)(
  'node',
  [probe, '--as', as, '--base', base, '--url', '/app/folders', '--timeout', '60000', ...steps.flat()],
  { maxBuffer: 32 * 1024 * 1024 },
).catch((error) => ({ stdout: error.stdout ?? '', failed: error }))
let report
try {
  report = JSON.parse(stdout)
} catch {
  console.error(stdout.slice(0, 2000))
  process.exit(1)
}
const results = report.steps.filter((step) => 'eval' in step && step.result && typeof step.result === 'object').map((step) => step.result)
const failed = report.steps.find((step) => step.error)
console.log(JSON.stringify({ as, base, folder, results, failure: report.failure ?? failed?.error, errors: report.errors }, null, 2))
if (!flag('list')) {
  const bad = results.filter((result) => result.rowCounts.length > 2 || result.moves > 1)
  process.exit(report.failure || failed || bad.length ? 1 : 0)
}
