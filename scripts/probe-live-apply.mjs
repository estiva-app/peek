/**
 * Whether an open topic takes what is said in its Folder from the live connection, rather than reading again
 * (OPT-5), on production.
 *
 *   node scripts/probe-live-apply.mjs [--base https://peek.estiva.app] [--json out.json]
 *
 * QA-1 opens Switch probe A in the QA Folder and lets it settle. Then, through probe.mjs's PROBE_HOOK, QA-2
 * signs in in a second headless run and
 *
 * 1. posts in Switch probe B — the same Folder, another topic. QA-1 should read nothing for A.
 * 2. posts in A. QA-1 should draw it within a second of the event reaching the tab, again with no read.
 *
 * For each leg it prints QA-1's socket REQs and HTTP requests in that window, which of them name A (a
 * conversation read or catch-up), and when QA-2's event reached QA-1's socket (`ws-event`, the control that the
 * live path delivered at all: zero reads with no delivery proves nothing). Exit 1 when a leg read A, or A's post
 * was not drawn within a second of its delivery.
 *
 * Each run adds one message to A and one to B. QA-2's sign-in takes ~10 s per leg.
 */
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { promisify } from 'node:util'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const QA_FOLDER = 'a78e60b1-a41f-48c9-bcb0-6ceacdee8c69'
/** Switch probe A's `d`: what a read of A's conversation names (`#A`, `#a`, the file itself). */
const A_D = '109c1d82-c8a2-4ebd-93d9-b37b7d7df6ff'
const A = '/topic/switch-probe-a-'
const B = '/topic/switch-probe-b-'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : args[i + 1]
}
const base = option('base', 'https://peek.estiva.app')
const jsonOut = option('json')
const marker = `opt5-${Date.now().toString(36)}`

/** Runs in QA-1's page. */
async function run({ A, B, marker, quietMs, settleMs }) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const href = (prefix) => document.querySelector(`a[href^="${prefix}"]`)?.getAttribute('href')
  const paths = { A: href(A), B: href(B) }
  if (!paths.A || !paths.B) return { error: `no link to ${paths.A ? 'B' : 'A'}` }
  document.querySelector(`a[href^="${A}"]`).click()
  const until = Date.now() + 30000
  while (!document.body.innerText.includes('Switch probe A') || document.querySelectorAll('main .animate-pulse').length) {
    if (Date.now() > until) return { error: 'A never drew' }
    await sleep(100)
  }
  await sleep(settleMs)
  const post = (where, text, was, react) =>
    window
      .__probeHook(
        `?path=${encodeURIComponent(paths[where])}&text=${encodeURIComponent(text)}${was ? `&was=${encodeURIComponent(was)}` : ''}${react ? `&react=${encodeURIComponent(react)}` : ''}`,
      )
      .catch((e) => `hook failed: ${e.message}`)
  /** Whether the message showing `text` carries a reaction chip ("Makes sense, 1"). */
  const reactedOn = (text) =>
    [...document.querySelectorAll('div.relative.rounded-lg')]
      .filter((c) => c.innerText.includes(text))
      .some((c) => [...c.querySelectorAll('button[aria-label]')].some((b) => /, \d+$/.test(b.getAttribute('aria-label'))))
  /** Watches the open topic for `text` from now; resolves with when it showed, or null after 60 s. */
  const seen = (text) => {
    const from = Date.now()
    return (async () => {
      while (Date.now() - from < 60000) {
        if (document.querySelector('main')?.innerText.includes(text)) return Date.now()
        await sleep(20)
      }
      return null
    })()
  }

  const other = { from: Date.now(), text: `${marker} in B` }
  other.answer = await post('B', other.text)
  await sleep(quietMs)
  other.to = Date.now()

  const here = { from: Date.now(), text: `${marker} in A` }
  const shown = seen(here.text)
  here.answer = await post('A', here.text)
  await sleep(quietMs)
  here.seenAt = await shown
  here.to = Date.now()

  const edited = { from: Date.now(), text: `${marker} in A, edited` }
  const shownEdit = seen(edited.text)
  edited.answer = await post('A', edited.text, here.text)
  await sleep(quietMs)
  edited.seenAt = await shownEdit
  edited.to = Date.now()

  /*
    A reaction carries no `h`, so no live filter delivers it: the open topic's minute catch-up brings it (OPT-5,
    decided by Miky). Waits up to 70 s — a minute plus the catch-up's own time.
  */
  const reacted = { from: Date.now(), text: edited.text }
  reacted.answer = await post('A', edited.text, null, edited.text)
  const reactUntil = Date.now() + 70000
  while (!reactedOn(edited.text) && Date.now() < reactUntil) await sleep(200)
  reacted.seenAt = reactedOn(edited.text) ? Date.now() : null
  reacted.to = Date.now()
  return { paths, other, here, edited, reacted }
}

const runNode = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1')
  const text = url.searchParams.get('text')
  const was = url.searchParams.get('was')
  const react = url.searchParams.get('react')
  const steps = react
    ? // React to QA-2's message `react` with the picker's first option, from its own toolbar.
      ['--until', `document.querySelector('main')?.innerText.includes(${JSON.stringify(react)})`, '--wait', '1500',
        '--hover', `div.relative.rounded-lg:has-text(${JSON.stringify(react)})`,
        '--eval', `(async () => {
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
          const card = [...document.querySelectorAll('div.relative.rounded-lg')].filter((c) => c.innerText.includes(${JSON.stringify(react)})).at(-1)
          const button = card?.querySelector('button[aria-label="React"]')
          if (!button) return 'no React on the message'
          button.click()
          await sleep(500)
          const option = document.querySelector('[aria-label="Reactions"] button')
          if (!option) return 'no picker'
          option.click()
          return ${JSON.stringify(text)}
        })()`,
        '--wait', '4000']
    : was
    ? /*
        Edit QA-2's message `was` to `text`: hover its card, then its own More actions — `--click` would take the
        topic header's, which has the same name — Edit message, replace, Save.
      */
      ['--until', `document.querySelector('main')?.innerText.includes(${JSON.stringify(was)})`, '--wait', '1500',
        '--hover', `div.relative.rounded-lg:has-text(${JSON.stringify(was)})`,
        '--eval', `(async () => {
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
          const card = [...document.querySelectorAll('div.relative.rounded-lg')].filter((c) => c.innerText.includes(${JSON.stringify(was)})).at(-1)
          const more = card?.querySelector('button[aria-label="More actions"]')
          if (!more) return 'no More actions on the message'
          more.click()
          await sleep(400)
          const item = [...document.querySelectorAll('[role=menuitem]')].find((m) => m.textContent.includes('Edit message'))
          if (!item) return 'no Edit message'
          item.click()
          await sleep(600)
          const el = [...document.querySelectorAll('.ProseMirror')].find((e) => e.editor && e.editor.getText().includes(${JSON.stringify(was)}))
          if (!el) return 'no edit box'
          el.editor.commands.setContent(${JSON.stringify(text)})
          const save = [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Save')
          if (!save) return 'no Save'
          save.click()
          return el.editor.getText()
        })()`,
        '--wait', '4000']
    : ['--until', "[...document.querySelectorAll('.ProseMirror')].some((e) => e.editor)", '--wait', '2000',
        '--eval', `(() => { const el = [...document.querySelectorAll('.ProseMirror')].find((e) => e.editor); if (!el) return 'no composer'; el.editor.chain().focus().insertContent(${JSON.stringify(text)}).run(); return el.editor.getText() })()`,
        '--press', 'Enter', '--wait', '4000']
  let answer
  try {
    const { stdout } = await runNode(
      process.execPath,
      [join(here, 'probe.mjs'), '--as', 'qa2', '--base', base, '--url', url.searchParams.get('path'), '--timeout', '60000', ...steps],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    )
    const typed = JSON.parse(stdout).steps?.find((s) => 'eval' in s)?.result
    answer = typeof typed === 'string' && typed.includes(text) ? (react ? 'reacted' : was ? 'edited' : 'posted') : `not done: ${String(typed).slice(0, 200)}`
  } catch (error) {
    let failedStep
    try {
      const out = JSON.parse(error.stdout)
      failedStep = JSON.stringify(out.steps?.find((s) => s.error) ?? out.failure ?? out.steps?.at(-1))
    } catch {
      failedStep = error.stdout || error.message
    }
    answer = `QA-2 probe failed at ${String(failedStep).slice(0, 600)}`
  }
  response.writeHead(200).end(answer)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const hook = `http://127.0.0.1:${server.address().port}/post`

const netFile = join(mkdtempSync(join(tmpdir(), 'probe-live-apply-')), 'net.json')
const source = `(${run.toString()})(${JSON.stringify({ A, B, marker, quietMs: Number(option('quiet', 6000)), settleMs: Number(option('settle', 10000)) })})`
let report
try {
  const { stdout } = await runNode(
    process.execPath,
    [join(here, 'probe.mjs'), '--as', 'qa1', '--base', base, '--url', `/app/folders/${QA_FOLDER}`, '--timeout', '300000',
      '--net', netFile, '--until', `document.querySelector('a[href^="${A}"]')`, '--eval', source],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, PROBE_HOOK: hook, PROBE_WS_MATCH: marker } },
  )
  report = JSON.parse(stdout)
} catch (error) {
  report = JSON.parse(error.stdout || '{}')
  console.error(`probe failed: ${report.failure ?? error.message}`)
}
server.close()
const result = report.steps?.find((s) => 'eval' in s)?.result
if (!result || result.error) {
  console.error(`no result: ${result?.error ?? JSON.stringify(report).slice(0, 500)}`)
  process.exit(1)
}
const net = JSON.parse(readFileSync(netFile, 'utf8'))

const what = (entry) => {
  if (entry.kind === 'http') return `${new URL(entry.url).host.split('.')[0]}${new URL(entry.url).pathname.replace(/\/[0-9a-f]{16,}.*/, '/…')}`
  return `${entry.kind} ${entry.body.slice(2, entry.body.indexOf('"', 2))}`
}
let failed = false
for (const [name, leg] of [
  ['QA-2 posts in B (another topic, same Folder)', result.other],
  ['QA-2 posts in A (the open topic)', result.here],
  ['QA-2 edits that message', result.edited],
]) {
  const entries = net.filter((e) => e.at >= leg.from && e.at <= leg.to)
  const counts = {}
  for (const e of entries) counts[what(e)] = (counts[what(e)] ?? 0) + 1
  /*
    A read of A's conversation, or of a list's badges with A in it: asked by `#A`, or opening with the catch-up's
    first filter (Folder `#h`, edit kinds). Those that run on a clock whatever is written — the page's 30 s object and
    mentions tick, the open conversation's minute catch-up (OPT-5's decision) — land anywhere in a leg, so what fails
    the run is one in the 3 s after the delivery: a read the write caused.
  */
  const conversationOfA = new RegExp(`"#A":\\["[^"]*${A_D}|^\\["REQ","[^"]+",\\{"kinds":\\[9,40003`)
  const readsA = entries.filter((e) => (e.kind === 'ws-out' && /^\["REQ"/.test(e.body)) || /\/query$/.test(e.url ?? '')).filter((e) => conversationOfA.test(e.body ?? ''))
  const delivered = entries.find((e) => e.kind === 'ws-event' && e.body.includes(leg.text))
  const caused = delivered ? readsA.filter((e) => e.at >= delivered.at - 200 && e.at <= delivered.at + 3000) : readsA
  console.log(`\n${name}: ${leg.answer}`)
  console.log(`  requests: ${JSON.stringify(counts)}`)
  console.log(`  delivered on QA-1's socket: ${delivered ? `${delivered.at - leg.from} ms after the post began` : 'NO'}`)
  console.log(`  reads of A's conversation in the leg: ${readsA.length}${readsA.map((e) => `\n    +${e.at - leg.from} ms ${e.body.slice(0, 120)}`).join('')}`)
  console.log(`  of them in the 3 s after the delivery: ${caused.length}`)
  if (caused.length || !delivered) failed = true
  if (leg !== result.other) {
    // Node hears of a frame after the page does, so delivery-to-draw can read negative; `created_at` is the writer's
    // clock in whole seconds, so draw minus it is the true latency plus up to 1 s.
    const drawn = leg.seenAt && delivered ? leg.seenAt - delivered.at : null
    const createdAt = Number(delivered?.body.match(/"created_at":(\d+)/)?.[1])
    const sinceWritten = leg.seenAt && createdAt ? leg.seenAt - createdAt * 1000 : null
    console.log(`  drawn: ${leg.seenAt ? `${drawn ?? '?'} ms after node saw the frame, ${sinceWritten ?? '?'} ms after created_at` : 'NEVER'}`)
    if (!leg.seenAt || sinceWritten === null || sinceWritten > 2000) failed = true
  }
}
{
  const leg = result.reacted
  const shown = leg.seenAt ? `${((leg.seenAt - leg.from) / 1000).toFixed(1)} s after QA-2 began` : 'NOT within 70 s'
  console.log(`\nQA-2 reacts to it (no \`h\`: the minute catch-up brings it): ${leg.answer}\n  shown for QA-1: ${shown}`)
  if (!leg.seenAt) failed = true
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ result, net }, null, 2))
process.exit(failed ? 1 : 0)
