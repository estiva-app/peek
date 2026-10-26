/**
 * How long Leaf, Ship and the Estiva agent take to show a page, on production — the measure every issue in "Apps
 * read only what they show" proves its Done when with (APP-1). Run it before and after a change, the same way.
 *
 *   node scripts/app-speed.mjs [--legs weekly,weekly-from-peek,ship-project,ship-issue,agent] [--runs 3]
 *     [--json /tmp/before.json] [--agent <estiva-agent dir>]
 *   node scripts/app-speed.mjs --table /tmp/before.json
 *   node scripts/app-speed.mjs --compare /tmp/before.json /tmp/after.json
 *
 * Keep the JSON out of this repository: it holds lines of Weekly Plans, a private Estiva HQ page.
 *
 * Each browser leg is one headless browser with nothing stored, signed in as QA-1 (scripts/probe.mjs), with
 * scripts/app-speed-recorder.js running in every page from its first byte:
 *
 * - `weekly`: Miky's Weekly Plans (Estiva HQ) opened in Leaf at its own link.
 * - `weekly-from-peek`: the same page from Peek — its conversation, then "Open ↗", which opens Leaf in a new tab.
 * - `ship-project`, `ship-issue`: a Ship project ("Ship: Feedback & Bugs", its Overview) and one of its issues.
 * - `agent`: the agent's `ship_get_issue` on "Peek opens instantly" and `peek_read_topic` on "Planning and
 *   sequencing", each through a fresh MCP server (the pinned runtime, `~/.estiva-agent-runtime`, what Claude
 *   sessions run; `--agent <dir>` for a worktree with a fix), signed in as the agent's own key.
 *
 * Per browser leg: when every awaited text was on screen ("text") and when the page also had no placeholder
 * outside the sidebar ("ready"), both from the first document of the app's sign-in, so the bounce through Estiva ID
 * is in ("never": not within 150 s in Leaf, 60 s in Ship); then, once no relay read has run for 5 s (at most 180 s
 * from the page's start), the whole load: relay reads, MB they answered,
 * and anything the relay refused. Per agent call: ms to answer, relay reads, MB read, and the bytes handed to Claude.
 *
 * The awaited texts: Weekly Plans' title and its last plain heading, read through the agent before the Leaf legs,
 * because Miky rewrites the page every week; Ship's are below. A leg that prints "never" waited on a text that is no
 * longer on that page: change it here.
 */
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const run = promisify(execFile)
const args = process.argv.slice(2)
const option = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback)
const PROBE = new URL('./probe.mjs', import.meta.url).pathname
const RECORDER = new URL('./app-speed-recorder.js', import.meta.url).pathname
const FETCHLOG = new URL('./app-speed-fetchlog.mjs', import.meta.url).href
const AGENT = option('agent', `${homedir()}/.estiva-agent-runtime`)
const ENV_FILE = `${homedir()}/.estiva-agent.env`
/** The CLI that reads Weekly Plans' text: the checkout the `ship` and `peek` wrappers run, at origin/main. */
const CLI = process.env.ESTIVA_AGENT_DIR ?? `${homedir()}/estiva/estiva-agent-main`

const WEEKLY = {
  address: '30842:f3a38fa646debd4162125e0aed87b6d2393fb1ed9702b6875dcbc0c6529d64d1:52a3269d-afc9-4476-a058-9c71c3d92ee9',
  path: '/document/weekly-plans-52a3269d-afc9-4476-a058-9c71c3d92ee9',
}
const SHIP_PROJECT = '/project/cf23dbca-64fb-4802-a804-e0119b0d8584'
const SHIP_ISSUE = '/issue/4fbbf7db-3007-4d38-ae7c-817bd9988480'
/** [host, path, texts] per page: the project's Overview counts its issues once they are loaded. */
const SHIP_AWAIT = [
  ['^ship\\.', '^/project/', ['The inbox for bugs and feedback on Ship', { re: 'of \\d+ done' }]],
  ['^ship\\.', '^/issue/', ["Ship's address for a file opens it only when one author holds its d", 'Who, when']],
]
const AGENT_CALLS = [
  ['ship_get_issue', { ref: 'Peek opens instantly' }],
  ['peek_read_topic', { topic: 'Planning and sequencing' }],
]

const agentEnv = () => {
  const env = { ...process.env, ESTIVA_AGENT_SOURCE: 'pinned' }
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)=(.*)$/.exec(line)
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
  return env
}

/** Weekly Plans' title and its last heading that draws as plain words (no link, chip or mark). */
async function weeklyTexts() {
  const { stdout } = await run('npx', ['tsx', 'scripts/agent.ts', 'file', 'show', WEEKLY.address], { cwd: CLI, env: agentEnv(), maxBuffer: 1 << 26 })
  const file = JSON.parse(stdout)
  const headings = file.text.split('\n').map((l) => /^#{1,3} (.+)$/.exec(l)?.[1]).filter((h) => h && !/[[\]()<>:*_`]/.test(h))
  if (!headings.length) throw new Error('Weekly Plans has no plain heading to wait for')
  return [file.title, headings.at(-1)]
}

const settle = (ms) => ['--until', `'allNoPlaceholder' in __sp.marks || performance.now() > ${ms}`]
const whole = ['--wait', '1000', '--until', '__sp.quiet() > 5000 || performance.now() > 180000']
const report = (label) => ['--eval', `__sp.report(${JSON.stringify(label)})`]

const LEGS = {
  weekly: () => ['--base', 'https://leaf.estiva.app', '--url', WEEKLY.path, ...settle(150000), ...whole, ...report('weekly')],
  'weekly-from-peek': () => ['--base', 'https://peek.estiva.app', '--url', `/topic/${WEEKLY.address}`,
    '--until', `!!document.querySelector('a[href^="https://leaf.estiva.app/"]')`,
    '--follow', `document.querySelector('a[href^="https://leaf.estiva.app/"]').click()`,
    ...settle(150000), ...whole, ...report('weekly-from-peek')],
  'ship-project': () => ['--base', 'https://ship.estiva.app', '--url', SHIP_PROJECT, ...settle(60000), ...whole, ...report('ship-project')],
  'ship-issue': () => ['--base', 'https://ship.estiva.app', '--url', SHIP_ISSUE, ...settle(60000), ...whole, ...report('ship-issue')],
}

async function browserLeg(leg, awaitFile) {
  let stdout
  try {
    ;({ stdout } = await run('node', [PROBE, '--as', 'qa1', '--init', awaitFile, '--timeout', '200000', ...LEGS[leg]()], { maxBuffer: 1 << 26, timeout: 600000 }))
  } catch (error) {
    stdout = error.stdout
  }
  let out = {}
  try { out = JSON.parse(stdout) } catch {}
  const step = (out.steps ?? []).find((s) => 'eval' in s && typeof s.result === 'string' && s.result.startsWith('{"label"'))
  const failure = out.failure ?? (out.steps ?? []).filter((s) => s.error).map((s) => s.error).join('; ')
  return step ? { ...JSON.parse(step.result), failure: failure || undefined } : { label: leg, failure: failure || 'no report' }
}

/** One MCP tool call on a fresh server: what it read from the relay and what it handed back. */
async function agentCall(name, callArgs) {
  // Its own process group, so the kill below reaches the node process npx starts, not only npx.
  const server = spawn('npx', ['tsx', 'scripts/mcp-server.ts'], { cwd: AGENT, env: { ...agentEnv(), NODE_OPTIONS: `--import ${FETCHLOG}` }, stdio: ['pipe', 'pipe', 'pipe'], detached: true })
  let exited = null
  const gone = new Promise((resolve) => server.on('exit', (code, signal) => resolve((exited = { error: { message: `the MCP server exited (${signal ?? code})` } }))))
  const fetches = []
  let err = ''
  server.stderr.on('data', (d) => {
    err += d
    let i
    while ((i = err.indexOf('\n')) >= 0) {
      const line = err.slice(0, i)
      err = err.slice(i + 1)
      if (line.startsWith('FETCH ')) fetches.push(JSON.parse(line.slice(6)))
    }
  })
  let buf = ''
  const waiting = new Map()
  server.stdout.on('data', (d) => {
    buf += d
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i)
      buf = buf.slice(i + 1)
      try {
        const msg = JSON.parse(line)
        waiting.get(msg.id)?.(msg)
      } catch {}
    }
  })
  let id = 0
  // An answer, the server's exit, or 5 minutes — whichever comes first, so one hung call cannot hold the run.
  const rpc = (method, params) => {
    if (exited) return Promise.resolve(exited)
    const n = ++id
    const answer = new Promise((resolve) => waiting.set(n, resolve))
    server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n')
    let timer
    const late = new Promise((resolve) => (timer = setTimeout(() => resolve({ error: { message: `no answer to ${method} in 300 s` } }), 300000)))
    return Promise.race([answer, gone, late]).finally(() => clearTimeout(timer))
  }
  try {
    await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'app-speed', version: '0' } })
    server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
    // Start-up's own reads log a moment after they answer: let them land before counting the call's.
    await new Promise((r) => setTimeout(r, 1500))
    fetches.length = 0
    const started = Date.now()
    const answer = await rpc('tools/call', { name, arguments: callArgs })
    const ms = Date.now() - started
    await new Promise((r) => setTimeout(r, 1500))
    const text = (answer.result?.content ?? []).map((c) => c.text ?? '').join('')
    const relay = fetches.filter((f) => /estiva\.estiva\.app/.test(f.host))
    return {
      label: name, ms, reads: relay.length, mb: relay.reduce((n, f) => n + (f.bytes ?? 0), 0) / 1e6,
      refusals: relay.filter((f) => f.status === 429).length, toClaude: text.length,
      failure: answer.error?.message ?? (answer.result?.isError ? text.slice(0, 200) : undefined),
    }
  } finally {
    try { process.kill(-server.pid) } catch {}
  }
}

// --- the table ----------------------------------------------------------------------------------------------------

const median = (xs) => {
  const got = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b)
  return got.length ? got[got.length >> 1] : null
}
const range = (xs) => {
  const got = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b)
  return got.length > 1 ? [got[0], got.at(-1)] : null
}
const sec = (ms) => (ms === null ? 'never' : `${(ms / 1000).toFixed(1)} s`)
const mbs = (mb) => (mb === null ? '–' : `${mb.toFixed(1)} MB`)
const kb = (b) => (b === null ? '–' : b >= 1e6 ? `${(b / 1e6).toFixed(2)} MB` : `${Math.round(b / 1000)} KB`)

/** One row's numbers from a leg's runs: medians, and how many runs never showed the text. */
function summary(runs) {
  const browser = runs.some((r) => 'marks' in r)
  const at = (r, mark) => (r.marks?.[mark] === undefined ? null : r.marks[mark] + r.bounceMs)
  return browser
    ? {
        runs: runs.length, never: runs.filter((r) => at(r, 'allTexts') === null).length,
        text: median(runs.map((r) => at(r, 'allTexts'))), textRange: range(runs.map((r) => at(r, 'allTexts'))),
        ready: median(runs.map((r) => at(r, 'allNoPlaceholder'))),
        reads: median(runs.map((r) => r.reads)), mb: median(runs.map((r) => r.mb)),
        refusals: runs.reduce((n, r) => n + (r.refusals?.length ?? 0), 0),
        failures: runs.filter((r) => r.failure).map((r) => r.failure),
      }
    : {
        runs: runs.length, never: runs.filter((r) => r.failure).length,
        text: median(runs.map((r) => r.ms)), textRange: range(runs.map((r) => r.ms)), ready: null,
        reads: median(runs.map((r) => r.reads)), mb: median(runs.map((r) => r.mb)), toClaude: median(runs.map((r) => r.toClaude)),
        refusals: runs.reduce((n, r) => n + (r.refusals ?? 0), 0),
        failures: runs.filter((r) => r.failure).map((r) => r.failure),
      }
}
const cell = (s) => `${sec(s.text)}${s.textRange ? ` (${sec(s.textRange[0])}–${sec(s.textRange[1])})` : ''}${s.never ? `, ${s.never} never` : ''}`

function table(result) {
  const lines = [
    '| Leg | Runs | Text on screen / answer (median, range) | Page ready | Relay reads | MB read | Handed to Claude | Refused |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ]
  for (const [label, runs] of Object.entries(result.rows)) {
    const s = summary(runs)
    lines.push(`| ${label} | ${s.runs} | ${cell(s)} | ${s.ready === null ? '–' : sec(s.ready)} | ${s.reads ?? '–'} | ${mbs(s.mb)} | ${s.toClaude === undefined ? '–' : kb(s.toClaude)} | ${s.refusals} |`)
  }
  const builds = [...new Set(Object.values(result.rows).flat().map((r) => r.build && `${new URL(r.href).host}${r.build}`).filter(Boolean))]
  lines.push('', `Measured ${result.at} as QA-1 (agent: its own key, ${result.agent}). Builds: ${builds.join(', ') || '–'}.`)
  for (const [label, runs] of Object.entries(result.rows)) for (const f of summary(runs).failures) lines.push(`- ${label} failed: ${String(f).slice(0, 200)}`)
  return lines.join('\n')
}

function compare(before, after) {
  const lines = [
    '| Leg | Text on screen / answer | Relay reads | MB read | Handed to Claude | Refused |',
    '| --- | --- | --- | --- | --- | --- |',
  ]
  for (const label of new Set([...Object.keys(before.rows), ...Object.keys(after.rows)])) {
    const b = before.rows[label] ? summary(before.rows[label]) : null
    const a = after.rows[label] ? summary(after.rows[label]) : null
    const pair = (f) => `${b ? f(b) : '–'} → ${a ? f(a) : '–'}`
    lines.push(`| ${label} | ${pair((s) => sec(s.text))} | ${pair((s) => s.reads ?? '–')} | ${pair((s) => mbs(s.mb))} | ${pair((s) => (s.toClaude === undefined ? '–' : kb(s.toClaude)))} | ${pair((s) => s.refusals)} |`)
  }
  lines.push('', `Medians. Before: ${before.at}, ${Object.values(before.rows)[0]?.length ?? 0} runs. After: ${after.at}, ${Object.values(after.rows)[0]?.length ?? 0} runs.`)
  return lines.join('\n')
}

// --- main ---------------------------------------------------------------------------------------------------------

if (args.includes('--compare')) {
  const [before, after] = args.slice(args.indexOf('--compare') + 1).map((f) => JSON.parse(readFileSync(f, 'utf8')))
  console.log(compare(before, after))
} else if (args.includes('--table')) {
  console.log(table(JSON.parse(readFileSync(option('table'), 'utf8'))))
} else {
  const legs = option('legs', 'weekly,weekly-from-peek,ship-project,ship-issue,agent').split(',')
  for (const leg of legs) if (leg !== 'agent' && !LEGS[leg]) throw new Error(`--legs: ${[...Object.keys(LEGS), 'agent'].join(',')}`)
  const runs = Number(option('runs', '3'))
  const scratch = mkdtempSync(join(tmpdir(), 'app-speed-'))
  const out = option('json', join(scratch, 'app-speed.json'))
  const { stdout: agentRev } = await run('git', ['-C', AGENT, 'log', '-1', '--format=%h %cs']).catch(() => ({ stdout: AGENT }))
  const result = { at: new Date().toISOString(), agent: agentRev.trim(), rows: {} }
  const awaitList = [...SHIP_AWAIT]
  if (legs.some((l) => l.startsWith('weekly'))) {
    const texts = await weeklyTexts()
    console.error(`Weekly Plans: waiting for ${JSON.stringify(texts)}`)
    awaitList.push(['^leaf\\.', '^/(document|f)/', texts])
  }
  const awaitFile = join(scratch, 'recorder.js')
  writeFileSync(awaitFile, `window.__spAwait = ${JSON.stringify(awaitList)};\n${readFileSync(RECORDER, 'utf8')}`)
  for (let n = 1; n <= runs; n++) {
    for (const leg of legs) {
      const reports = []
      if (leg === 'agent') for (const [name, a] of AGENT_CALLS) reports.push(await agentCall(name, a))
      else reports.push(await browserLeg(leg, awaitFile))
      for (const r of reports) {
        ;(result.rows[r.label] ??= []).push(r)
        console.error(`run ${n} ${r.label}: ${r.marks ? `text ${sec(r.marks.allTexts === undefined ? null : r.marks.allTexts + r.bounceMs)}` : `answer ${sec(r.ms)}`}, ${r.reads} reads, ${mbs(r.mb)}${r.failure ? `, FAILED: ${String(r.failure).slice(0, 160)}` : ''}`)
      }
      writeFileSync(out, JSON.stringify(result))
    }
  }
  console.log(table(result))
  console.error(`\nRaw runs: ${out}`)
}
