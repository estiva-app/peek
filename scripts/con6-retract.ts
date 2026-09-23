/**
 * CON-6: retract FOL-25's re-posted copies, now that CON-5 put a good one
 * beside each.
 *
 *   cd ~/peek-con6-work && set -a && . ~/.estiva-agent.env && set +a
 *   npx tsx --tsconfig tsconfig.app.json scripts/con6-retract.ts            # plan, read-only
 *   npx tsx --tsconfig tsconfig.app.json scripts/con6-retract.ts --apply --keys ~/.con6-keys.json
 *   npx tsx --tsconfig tsconfig.app.json scripts/con6-retract.ts verify
 *
 * **Plan is the default and sends nothing.** `--apply` sends one `kind:5` per
 * copy, signed by the copy's own author, and only for copies the plan marks
 * `retract`. It is not reversible: a retraction hides the event from every
 * reader of the relay, not just Peek. The event itself stays on the relay.
 *
 * ## The rule, and why `orig` alone is no longer it
 *
 * CON-3 said the marker is `orig`. That was true on 2026-09-22 and stopped
 * being true when CON-5 ran: `shr8-migrate.ts` writes `orig` too, naming the
 * *Convex row*, with `['migration', 'shr8-migrate']`. Measured 2026-09-23,
 * `probe-con3-discriminator.ts` counts 461 `orig` events, not 134, and 289 of
 * them are pointed at by a Convex row. **A rule of "carries `orig`" now
 * retracts the good copies.**
 *
 * So a copy is retracted only if all of these hold:
 *
 *   1. it carries `['migration', 'fol25-remigrate']`;
 *   2. its `orig` names a `kind:9` that a Convex row records as its
 *      `nostrEventId`, so the Convex row it stands for is known;
 *   3. the same file carries a `shr8-migrate` copy of that same row, dated
 *      to the row's true time. That copy is the one a reader keeps;
 *   4. no event other than another retraction candidate replies to it.
 *      Peek reads replies by `#e` on the root ids it has, so retracting a
 *      root that something else hangs off hides that reply too.
 *
 * A copy that fails any clause is printed and left alone. The pairing is
 * `shr8-migrate.ts`'s own {@link survey}, imported rather than restated, so a
 * copy is "done" here exactly when the migration decided it was done.
 */
import { buildDeletion } from '@estiva-app/protocol'
import type { SignedEvent } from '@estiva-app/protocol'
import { TEAMS } from './con4-discarded.js'
import {
  fileConversation,
  loadSigners,
  migrated,
  origOf,
  publish,
  queryFn,
  short,
  sleep,
  stamp,
  survey,
  tag,
  token,
  tokenSigner,
} from './shr8-migrate.js'
import type { Signer } from './shr8-migrate.js'

const REMIGRATE_MARK = 'fol25-remigrate'
const WRITE_GAP_MS = 6_000

const remigrated = (e: SignedEvent) => e.tags.some((x) => x[0] === 'migration' && x[1] === REMIGRATE_MARK)
/** Every event id this one threads under — NIP-22 `e`/`E`, and a legacy `e` reply. */
const parentsOf = (e: SignedEvent) => e.tags.filter((x) => (x[0] === 'e' || x[0] === 'E') && x[1]).map((x) => x[1]!)

type Verdict =
  | { kind: 'retract'; copy: SignedEvent; keep: SignedEvent; surface: string; rowId: string }
  | { kind: 'keep'; copy: SignedEvent; surface: string; why: string }

interface Plan {
  verdicts: Verdict[]
  /** FOL-25 copies in the team Folders that no surveyed file accounts for. */
  unaccounted: SignedEvent[]
  /** Every `fol25-remigrate` copy found by the independent sweep. */
  swept: number
}

/**
 * Every `fol25-remigrate` copy, found two ways and reconciled.
 *
 * The survey finds the ones on a file it knows. The team-Folder sweep finds
 * all of them, the way `probe-con3-discriminator.ts` does. A copy the sweep
 * sees and the survey does not is printed, never retracted: the survey has no
 * row for it, so it cannot tell whether the copy is a duplicate.
 */
async function buildPlan(query: ReturnType<typeof queryFn>, agent: string): Promise<Plan> {
  const surfaces = await survey(query, agent)

  const swept = new Map<string, SignedEvent>()
  for (const uuid of Object.values(TEAMS)) {
    for (const e of await query([{ kinds: [1111], '#h': [uuid], limit: 5000 }])) if (remigrated(e)) swept.set(e.id, e)
  }

  const verdicts: Verdict[] = []
  const seen = new Set<string>()
  for (const s of surfaces) {
    if (!s.address) continue
    const conversation = await fileConversation(query, s.address)
    const copies = conversation.filter(remigrated)
    if (!copies.length) continue
    const rowOfEvent = new Map<string, string>()
    for (const i of s.items) if (i.eventId) rowOfEvent.set(i.eventId, i.id)
    const itemById = new Map(s.items.map((i) => [i.id, i]))
    const shr8ByRow = new Map<string, SignedEvent>()
    for (const e of conversation) if (migrated(e) && origOf(e)) shr8ByRow.set(origOf(e)!, e)
    const candidateIds = new Set(copies.map((e) => e.id))

    for (const copy of copies) {
      seen.add(copy.id)
      const keep = (why: string) => verdicts.push({ kind: 'keep', copy, surface: s.title, why })
      const rowId = rowOfEvent.get(origOf(copy) ?? '')
      if (!rowId) {
        keep(`orig ${short(origOf(copy) ?? '?')} is no Convex row's nostrEventId`)
        continue
      }
      const twin = shr8ByRow.get(rowId)
      const dependents = conversation.filter((e) => !candidateIds.has(e.id) && parentsOf(e).includes(copy.id))
      if (!twin) {
        const files = itemById.get(rowId)!.attachments
        keep(`row ${rowId} has no shr8-migrate copy on this file — this is its only copy` +
          ` [${dependents.length} other repl${dependents.length === 1 ? 'y' : 'ies'}, ${files} attachment(s)]`)
        continue
      }
      const trueSecs = Math.floor(itemById.get(rowId)!.createdAt / 1000)
      if (twin.created_at !== trueSecs) {
        keep(`the shr8 copy ${short(twin.id)} is dated ${stamp(twin.created_at)}, the row ${stamp(trueSecs)}`)
        continue
      }
      if (dependents.length) {
        keep(`${dependents.length} event(s) reply to it: ${dependents.map((d) => short(d.id)).join(', ')}`)
        continue
      }
      verdicts.push({ kind: 'retract', copy, keep: twin, surface: s.title, rowId })
    }
  }
  const unaccounted = [...swept.values()].filter((e) => !seen.has(e.id))
  return { verdicts, unaccounted, swept: swept.size }
}

function printPlan(p: Plan, agent: string) {
  const retract = p.verdicts.filter((v): v is Extract<Verdict, { kind: 'retract' }> => v.kind === 'retract')
  const keep = p.verdicts.filter((v): v is Extract<Verdict, { kind: 'keep' }> => v.kind === 'keep')
  console.log(`fol25-remigrate copies in the team Folders:   ${p.swept}`)
  console.log(`  on a surveyed file:                         ${p.verdicts.length}`)
  console.log(`  unaccounted for (left alone):               ${p.unaccounted.length}`)
  console.log(`  → retract (a dated shr8 twin exists):       ${retract.length}`)
  console.log(`  → keep:                                     ${keep.length}`)

  const bySurface = new Map<string, number>()
  for (const v of retract) bySurface.set(v.surface, (bySurface.get(v.surface) ?? 0) + 1)
  console.log('\nretractions by file:')
  for (const [title, n] of [...bySurface].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${title}`)

  const byAuthor = new Map<string, number>()
  for (const v of retract) byAuthor.set(v.copy.pubkey, (byAuthor.get(v.copy.pubkey) ?? 0) + 1)
  console.log('\nsigners a retraction needs (only the author may send a kind:5):')
  for (const [pk, n] of byAuthor) console.log(`  ${String(n).padStart(4)}  ${pk}${pk === agent ? '  (the agent)' : ''}`)

  if (keep.length) {
    console.log('\nkept, with the reason:')
    for (const v of keep) console.log(`  ${short(v.copy.id)}  ${v.surface}  — ${v.why}`)
  }
  if (p.unaccounted.length) {
    console.log('\nunaccounted for:')
    for (const e of p.unaccounted) console.log(`  ${short(e.id)}  a=${tag(e, 'A') ?? tag(e, 'a') ?? '?'}  orig=${short(origOf(e) ?? '?')}`)
  }
}

async function apply(p: Plan, signers: Map<string, Signer>) {
  const retract = p.verdicts.filter((v): v is Extract<Verdict, { kind: 'retract' }> => v.kind === 'retract')
  const missing = [...new Set(retract.map((v) => v.copy.pubkey))].filter((pk) => !signers.has(pk))
  // Refuse up front rather than retract some authors' copies and not others.
  if (missing.length) throw new Error(`no signer for ${missing.map(short).join(', ')} — pass --keys or --as`)
  let ok = 0
  for (const v of retract) {
    const r = await publish(buildDeletion(v.copy.pubkey, Date.now(), { targetEventId: v.copy.id }), signers.get(v.copy.pubkey)!)
    if (r.ok) ok++
    else console.log(`  refused ${short(v.copy.id)} (${v.surface}): ${r.reason}`)
    await sleep(WRITE_GAP_MS)
  }
  console.log(`\nretracted ${ok} of ${retract.length}; run \`verify\` next`)
  process.exitCode = ok === retract.length ? 0 : 1
}

/**
 * What a reader sees now: no `fol25-remigrate` copy answers, and every row
 * that had one shows exactly one copy on its file, dated to the row.
 */
async function verify(query: ReturnType<typeof queryFn>, agent: string) {
  const surfaces = await survey(query, agent)
  let copiesLeft = 0
  let duplicated = 0
  let misdated = 0
  let rows = 0
  for (const s of surfaces) {
    if (!s.address) continue
    const conversation = await fileConversation(query, s.address)
    const rowOfEvent = new Map<string, string>()
    for (const i of s.items) if (i.eventId) rowOfEvent.set(i.eventId, i.id)
    const perRow = new Map<string, SignedEvent[]>()
    for (const e of conversation) {
      const o = origOf(e)
      if (!o) continue
      if (remigrated(e)) copiesLeft++
      const rowId = rowOfEvent.get(o) ?? o
      perRow.set(rowId, [...(perRow.get(rowId) ?? []), e])
    }
    for (const i of s.items) {
      const on = perRow.get(i.id)
      if (!on) continue
      rows++
      if (on.length > 1) {
        duplicated++
        console.log(`  ${s.title}: row ${short(i.id)} has ${on.length} copies (${on.map((e) => short(e.id)).join(', ')})`)
      }
      if (!on.some((e) => e.created_at === Math.floor(i.createdAt / 1000))) {
        misdated++
        console.log(`  ${s.title}: row ${short(i.id)} has no copy at its true time ${stamp(Math.floor(i.createdAt / 1000))}`)
      }
    }
  }
  console.log(`rows with a copy on their file: ${rows}`)
  console.log(`  fol25-remigrate copies still answering: ${copiesLeft}`)
  console.log(`  rows with more than one copy:           ${duplicated}`)
  console.log(`  rows with no copy at their true time:   ${misdated}`)
  process.exitCode = duplicated || misdated ? 1 : 0
}

async function main() {
  const t = await token()
  const agent = tokenSigner(t)
  const query = queryFn(agent)
  if (process.argv[2] === 'verify') return verify(query, t.pubkey)
  const p = await buildPlan(query, t.pubkey)
  printPlan(p, t.pubkey)
  if (!process.argv.includes('--apply')) {
    console.log('\nplan only — nothing sent. Re-run with --apply --keys <file> to retract.')
    return
  }
  const { signers } = loadSigners()
  if (!signers.has(t.pubkey)) signers.set(t.pubkey, agent)
  await apply(p, signers)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
