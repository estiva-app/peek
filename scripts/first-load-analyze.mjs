// One phase of a probe-first-load.mjs run, in order: socket REQs (sent → EOSE, filter, events) and HTTP requests,
// ms from the phase's start.
//   node scripts/first-load-analyze.mjs <out.json> <qa1|qa2> <leg> <phase label> [document index] [ms window]
// Phase labels: `load` (each document's own), `desk→topics`, `Open work topic`, `Starred DM`, `Topics`, `desk`,
// `long topic`, `start`.
import { readFileSync } from 'node:fs'

const [file, as, legName, label, index = '0', windowMs = '5000'] = process.argv.slice(2)
if (!label) throw new Error('usage: first-load-analyze.mjs <out.json> <identity> <leg> <phase> [document] [ms]')
const leg = JSON.parse(readFileSync(file, 'utf8')).find((r) => r.as === as && r.leg === legName)
if (!leg) throw new Error(`no ${as} ${legName} in ${file}`)
const doc = leg.docs[Number(index)]
const phase = doc?.phases.find((p) => p.label === label)
if (!phase) throw new Error(`no phase ${label}: ${doc?.phases.map((p) => p.label).join(', ')}`)
const from = phase.at
const to = from + Number(windowMs)
const rows = [
  ...doc.subs.filter(([at]) => at >= from && at < to).map(([at, eose, n, what]) => [at - from, eose === null ? '–' : eose - from, `ws ${what} (${n})`]),
  ...doc.res.filter(([at]) => at >= from && at < to).map(([at, end, what, status]) => [at - from, end - from, `http ${what}${status && status !== 200 ? ` ${status}` : ''}`]),
].sort((a, b) => a[0] - b[0])
console.log(`${label}: marks ${JSON.stringify(Object.fromEntries(Object.entries(phase.marks).map(([m, t]) => [m, t - from])))}`)
for (const [at, end, what] of rows) console.log(`${String(at).padStart(5)} → ${String(end).padStart(5)}  ${what}`)
