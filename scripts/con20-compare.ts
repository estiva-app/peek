/**
 * CON-20: compare two dumps from `con20-read-peek.ts` or `read-ship.mts`, object
 * by object, with the migration's id changes undone.
 *
 *   npx tsx scripts/con20-compare.ts <a.json> <b.json> [--plan ~/con20-scratch/plan.json] [--only-both]
 *
 * With `--plan`, every new id in either dump is read as the id it replaced, and
 * the `kind` of a message is ignored (9 → 1111 is the point), so "the same" means
 * the same messages, authors, bodies, times, order, replies, edits, attachments,
 * reactions and resolutions. `--only-both` skips objects one side could not read
 * (the fidelity control: production as the agent reads 68 Folders).
 */
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const [aPath, bPath] = args
const planPath = args.includes('--plan') ? args[args.indexOf('--plan') + 1] : null
const onlyBoth = args.includes('--only-both')
if (!aPath || !bPath) throw new Error('usage: con20-compare.ts <a.json> <b.json> [--plan plan.json] [--only-both]')

/** New id → the id it replaced. */
const back = new Map<string, string>()
/** A `kind:9` deleted in favour of the SHR-8 copy that already stood for it → that copy. */
const dropped = new Map<string, string>()
if (planPath) {
  for (const row of JSON.parse(readFileSync(planPath, 'utf8')) as { old: { id: string }; next: { id: string } | null; copy?: string }[]) {
    if (row.next) back.set(row.next.id, row.old.id)
    if (row.copy) dropped.set(row.old.id, row.copy)
  }
}

/** Arrays concatenated, objects merged key by key: what was on a dropped duplicate lands on its copy. */
function merge(a: unknown, b: unknown): unknown {
  if (a === undefined) return b
  if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b]
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const out: Record<string, unknown> = { ...(a as Record<string, unknown>) }
    for (const [k, v] of Object.entries(b)) out[k] = merge(out[k], v)
    return out
  }
  return a
}

/**
 * Across the migration (`--plan`): ids undone; a message's `kind` and `ts`
 * ignored (9 → 1111 is the point; order is compared by position); a Ship
 * reply's own `about` ignored — `Conversation.about` is the union and is
 * compared; and each SHR-8 duplicate dropped, with whatever hung on it
 * (reactions, decorations) moved to its copy, which is what the run does.
 */
function normal(value: unknown): unknown {
  if (typeof value === 'string') return back.get(value) ?? value
  if (Array.isArray(value)) {
    return value.filter((v) => !(v && typeof v === 'object' && dropped.has((v as { id?: string }).id ?? ''))).map(normal)
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const isReply = typeof record.parentId === 'string' || typeof record.rootId === 'string'
    const out: Record<string, unknown> = {}
    const later: [string, unknown][] = []
    for (const key of Object.keys(record).sort()) {
      if (planPath && (key === 'kind' || key === 'ts' || (key === 'about' && isReply))) continue
      if (dropped.has(key)) later.push([dropped.get(key)!, normal(record[key])])
      else out[back.get(key) ?? key] = normal(record[key])
    }
    for (const [key, v] of later) out[key] = merge(out[key], v)
    return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)))
  }
  return value
}

function diff(a: unknown, b: unknown, path: string, out: string[]) {
  if (out.length > 12) return
  if (JSON.stringify(a) === JSON.stringify(b)) return
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) diff((a as never)[key], (b as never)[key], `${path}.${key}`, out)
    return
  }
  out.push(`${path}: ${JSON.stringify(a)?.slice(0, 90)} ≠ ${JSON.stringify(b)?.slice(0, 90)}`)
}

const A = normal(JSON.parse(readFileSync(aPath, 'utf8'))) as Record<string, unknown>
const B = normal(JSON.parse(readFileSync(bPath, 'utf8'))) as Record<string, unknown>
const unreadable = (v: unknown) => v === undefined || v === 'unresolved' || (typeof v === 'string' && v.startsWith('error'))
let same = 0
let skipped = 0
const differing: string[] = []
for (const address of [...new Set([...Object.keys(A), ...Object.keys(B)])].sort()) {
  if (onlyBoth && (unreadable(A[address]) || unreadable(B[address]))) {
    skipped++
    continue
  }
  const out: string[] = []
  diff(A[address], B[address], '', out)
  if (!out.length) same++
  else differing.push(`${address}\n    ${out.join('\n    ')}`)
}
console.log(`same: ${same}; differ: ${differing.length}${onlyBoth ? `; unreadable on one side: ${skipped}` : ''}`)
for (const d of differing) console.log(`  ${d}`)
process.exitCode = differing.length ? 1 : 0
