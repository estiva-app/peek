/**
 * CON-22: clean up what SHR-8 (CON-12) left beside its `kind:1111` copies —
 * run against production.
 *
 *   scripts/con20-export.sh > ~/con22-scratch/export.jsonl                        # read-only, the input
 *   npx tsx --tsconfig tsconfig.app.json scripts/con22-shr8-leftovers.ts plan      # read-only
 *   scripts/con22-run.sh                                                           # a person: signs with exported keys
 *   scripts/con20-export.sh > ~/con22-scratch/export.jsonl && \
 *     npx tsx --tsconfig tsconfig.app.json scripts/con22-shr8-leftovers.ts verify  # the done-when's first two legs
 *
 * `simulate <snapshot> <out>` applies the plan to a `con20-snapshot.sql` export
 * offline, for `con20-fake-relay.ts`, the two readers and `con20-compare.ts`.
 *
 * SHR-8 copied Peek's topic messages (Convex rows) to `kind:1111` comments on
 * the Folder's project and left the relay `kind:9` each row had been
 * published as. A copy's `orig` names that `kind:9` by relay id, or names its
 * Convex row by `_id` or `seedKey`; REM-8's snapshot ({@link CONVEX}) maps a
 * row to its `nostrEventId`. That is the only match used — never "the same
 * author, second and body", which misses an edited message.
 *
 * What changes:
 *
 * - **An original** — a live `kind:9` with a live copy — is deleted in favour
 *   of the copy. What pointed at it (reactions, resolutions, edits) is
 *   republished against the copy first, unless the copy already carries it.
 * - **A stray copy** — one whose parent is a `kind:9` SHR-8 did not copy, so
 *   the thread stayed chat — is deleted instead, and the original stays.
 * - **A misparented reply** — a `kind:1111` reply whose `A` is not its
 *   parent's (SHR-8 anchored some at the issue's project) or whose parent is
 *   an original — is republished with its parent's uppercase `A`/`E`/`I`/`K`/`P`
 *   (SPEC §6.4, *Replies*) and, under an original, naming the copy; then deleted.
 *
 * Every republished event keeps its author, `created_at`, body and every
 * other tag, and adds `['orig', …]` (unless it has one) and
 * `['migration', 'con22']`. Keeping `created_at` needs the relay's floor
 * window open (CON-13), which `con22-run.sh` opens and closes. The run is
 * deterministic: `plan` knows every new id before anything is signed, and
 * `apply` skips a copy the relay already holds, so a re-run is safe.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { buildAddMember, buildDeletion, computeEventId, decodeNevent, signEvent } from '@estiva-app/protocol'
import type { NostrTag, SignedEvent, UnsignedEvent } from '@estiva-app/protocol'
import { WRITE_GAP_MS, agentIdentity, loadExport, loadKeys, loadMembers, publish, readBack, signersFrom, sleep, valuesOf } from './relay-migration'
import type { Identity, Index } from './relay-migration'

const S = `${homedir()}/con22-scratch`
const EXPORT = process.env.CON22_EXPORT ?? `${S}/export.jsonl`
const MEMBERS = process.env.CON22_MEMBERS ?? `${S}/members.jsonl`
const PLAN_OUT = process.env.CON22_PLAN ?? `${S}/plan.json`
const KEYS = process.env.CON22_KEYS ?? `${homedir()}/.keys.json`
/** REM-8's final Convex export: the only record of which relay event a Convex row was published as. */
const CONVEX = process.env.CON22_CONVEX ?? `${homedir()}/estiva-backups/rem8-20260925/honorable-guineapig-592-final-20260925.zip`
const MIGRATION = 'con22'
const SHR8 = 'shr8-migrate'

const MESSAGE = 9
const COMMENT = 1111
const EDIT = 40003
const UPPER = ['A', 'E', 'I', 'K', 'P']
/**
 * Bodies that quote a deleted id by `nostr:nevent…` and are left as they are:
 * Miky's "testig message" (`kind:9`, 2026-09-12), a test of quoting; its quote
 * of `a49c0aef` will read as a deleted message.
 */
const STALE_QUOTES_ACCEPTED = new Set(['8b28e0df56a9f1bea11be958c186c80044f686cc69b775e2e65d6b24d4e5818c'])

const mode = process.argv[2]
if (!['plan', 'simulate', 'apply', 'verify'].includes(mode ?? '')) {
  throw new Error('usage: con22-shr8-leftovers.ts plan | simulate <snapshot.jsonl> <out.jsonl> | apply | verify')
}

// ---------------------------------------------------------------- the input

/** Convex `_id` and `seedKey` → the relay id the row was published as. */
function loadConvex(): Map<string, string> {
  const out = new Map<string, string>()
  for (const table of ['messages', 'replies']) {
    const rows = execFileSync('unzip', ['-p', CONVEX, `${table}/documents.jsonl`], { maxBuffer: 1 << 27 }).toString()
    for (const line of rows.split('\n')) {
      if (!line.startsWith('{')) continue
      const r = JSON.parse(line) as { _id: string; seedKey?: string; nostrEventId?: string }
      if (!r.nostrEventId) continue
      out.set(r._id, r.nostrEventId)
      if (r.seedKey) out.set(r.seedKey, r.nostrEventId)
    }
  }
  return out
}

/** Live `kind:9` id → the live SHR-8 copy of it, by the copy's `orig`. */
function copiesOf(index: Index, convex: ReadonlyMap<string, string>): Map<string, SignedEvent> {
  const out = new Map<string, SignedEvent>()
  for (const c of index.byId.values()) {
    if (c.kind !== COMMENT || !valuesOf(c, 'migration').includes(SHR8)) continue
    const orig = valuesOf(c, 'orig')[0] ?? ''
    const x = index.byId.get(index.byId.has(orig) ? orig : (convex.get(orig) ?? ''))
    if (x?.kind !== MESSAGE) continue
    if (out.has(x.id)) throw new Error(`${x.id}: two live SHR-8 copies (${out.get(x.id)!.id}, ${c.id}) — which one stands is not decidable`)
    if (x.pubkey !== c.pubkey || x.created_at !== c.created_at || valuesOf(x, 'h')[0] !== valuesOf(c, 'h')[0]) {
      throw new Error(`${x.id}: its copy ${c.id} has another author, second or Folder — not a copy`)
    }
    out.set(x.id, c)
  }
  return out
}

// ---------------------------------------------------------------- the plan

interface Row {
  /** The event being deleted. */
  old: SignedEvent
  /** Its replacement, unsigned; `id` is computed. Null when something already standing replaces it. */
  next: (UnsignedEvent & { id: string }) | null
  why: 'original' | 'stray copy' | 'reparent' | 'dependent'
  /** 0 for a root original, 1 for replies, 2+ for dependents: publish ascending, delete descending. */
  depth: number
  /** The object whose conversation this changes — what the before/after reads open. */
  about?: string
  /** A second object it changes: a reparented reply's old `A`. */
  alsoAbout?: string
  /** What stands for `old` once it is deleted, when that is not `next`. */
  copy?: string
}

interface Plan {
  rows: Row[]
  /** Live `kind:9` naming an original by `e` that have no copy: deleting the original would orphan them. */
  orphans: string[]
  /** Replies under a `kind:9` that is not an original, or under a deleted parent: left alone, and reported. */
  leftAlone: string[]
  /** Copies whose parent is not the copy of their original's parent. */
  mismatched: string[]
  staleQuotes: { id: string; kind: number; quotes: string[] }[]
  byId: Map<string, SignedEvent>
}

/** A copy of a copy keeps the `orig` that names the first original. */
const provenance = (old: SignedEvent): NostrTag[] => [
  ...(old.tags.some((t) => t[0] === 'orig') ? [] : [['orig', old.id, String(old.created_at), old.pubkey]]),
  ['migration', MIGRATION],
]
const finish = (next: UnsignedEvent): UnsignedEvent & { id: string } => ({ ...next, id: computeEventId(next) })
const upper = (e: Pick<SignedEvent, 'tags'>) => e.tags.filter((t) => UPPER.includes(t[0]))
const aOf = (e: Pick<SignedEvent, 'tags'>) => valuesOf(e, 'A')[0]
/** What an event says, less the id-bearing provenance: two events with the same key are the same statement. */
const statement = (e: Pick<SignedEvent, 'pubkey' | 'kind' | 'content' | 'tags'>) =>
  JSON.stringify([e.pubkey, e.kind, e.content, e.tags.filter((t) => t[0] !== 'orig' && t[0] !== 'migration')])

function buildPlan(index: Index, convex: ReadonlyMap<string, string>): Plan {
  const { byId } = index
  const copyOf = copiesOf(index, convex)
  const rows: Row[] = []
  /** Deleted id → the standing event that replaces it. */
  const standing = new Map<string, string>()
  /** Deleted id → its republished replacement. */
  const moved = new Map<string, string>()
  const nextOf = new Map<string, UnsignedEvent & { id: string }>()

  // What an event shows once its edits are folded: the newest edit, else itself (edits here carry their imeta whole).
  const editsOf = new Map<string, SignedEvent[]>()
  for (const e of byId.values()) {
    const target = e.kind === EDIT ? valuesOf(e, 'e').find((id) => /^[0-9a-f]{64}$/.test(id)) : undefined
    if (target) editsOf.set(target, [...(editsOf.get(target) ?? []), e].sort((a, b) => a.created_at - b.created_at))
  }
  const shown = (e: SignedEvent) => editsOf.get(e.id)?.at(-1) ?? e
  const imetaOf = (e: SignedEvent) => e.tags.filter((t) => t[0] === 'imeta')

  // Originals, and the copies that are strays.
  const strays = new Set<string>()
  for (const [xId, c] of copyOf) {
    const x = byId.get(xId)!
    const parent = byId.get(valuesOf(c, 'e')[0] ?? '')
    if (parent?.kind === MESSAGE && !copyOf.has(parent.id)) {
      strays.add(c.id)
      standing.set(c.id, x.id)
      rows.push({ old: c, next: null, why: 'stray copy', depth: 1, about: aOf(c), copy: x.id })
      continue
    }
    standing.set(x.id, c.id)
  }
  const mismatched: string[] = []
  for (const [xId, c] of copyOf) {
    const thread = valuesOf(byId.get(xId)!, 'e')[0]
    const want = thread && (copyOf.get(thread)?.id ?? thread)
    if ((want ?? null) !== (valuesOf(c, 'e')[0] ?? null)) mismatched.push(`${xId.slice(0, 8)}→${c.id.slice(0, 8)}: thread ${thread?.slice(0, 8) ?? '-'}, copy's parent ${valuesOf(c, 'e')[0]?.slice(0, 8) ?? '-'}`)
  }

  // Replies whose uppercase is not their parent's, or whose parent is an original.
  const leftAlone: string[] = []
  for (const r of byId.values()) {
    if (r.kind !== COMMENT || strays.has(r.id) || !valuesOf(r, 'e').length) continue
    const parentId = valuesOf(r, 'e')[0]
    const parent = byId.get(parentId)
    if (!parent) {
      leftAlone.push(`${r.id.slice(0, 8)}: parent ${parentId.slice(0, 8)} deleted`)
      continue
    }
    let target = parent
    if (parent.kind === MESSAGE) {
      const copy = standing.get(parent.id)
      if (!copy) {
        leftAlone.push(`${r.id.slice(0, 8)}: a kind:1111 under the chat message ${parentId.slice(0, 8)}`)
        continue
      }
      target = byId.get(copy)!
    } else if (parent.kind !== COMMENT) continue
    if (target === parent && JSON.stringify(upper(r)) === JSON.stringify(upper(parent))) continue
    const tags = r.tags
      .filter((t) => !UPPER.includes(t[0]))
      .map((t): NostrTag => {
        if (t[0] === 'e' && t[1] === parentId) return ['e', target.id, ...t.slice(2)]
        if (t[0] === 'k' && t[1] === String(parent.kind)) return ['k', String(target.kind)]
        return t
      })
    const next = finish({ pubkey: r.pubkey, created_at: r.created_at, kind: r.kind, content: r.content, tags: [...upper(target), ...tags, ...provenance(r)] })
    moved.set(r.id, next.id)
    nextOf.set(r.id, next)
    rows.push({ old: r, next, why: 'reparent', depth: 1, about: aOf(target), alsoAbout: aOf(r) !== aOf(target) ? aOf(r) : undefined })
  }

  // Each original, once its copy's final id is known (a copy can itself be reparented above).
  for (const [xId, c] of copyOf) {
    if (strays.has(c.id)) continue
    const x = byId.get(xId)!
    const final = moved.get(c.id) ?? c.id
    /*
      SHR-8 copied a Convex row's body and not its files, and CON-5 later gave
      the relay `kind:9` its screenshots (as `imeta`, mostly on an edit). The
      copy's body is the row's, so it stands; the original's files move onto
      it with an attachments-only edit — its content byte-identical to the
      copy's, so no reader marks it edited (RFC 0.4 §7.2.1) — dated as the
      original's own last change. The original's edits are then only deleted.
    */
    const files = imetaOf(shown(x))
    let next: Row['next'] = null
    if (files.length && JSON.stringify(files) !== JSON.stringify(imetaOf(shown(c)))) {
      const at = shown(x).created_at
      if ((editsOf.get(c.id)?.at(-1)?.created_at ?? -1) >= at) throw new Error(`${c.id}: the copy has an edit newer than its original's files`)
      next = finish({
        pubkey: c.pubkey,
        created_at: at,
        kind: EDIT,
        content: shown(c).content,
        tags: [['h', valuesOf(c, 'h')[0]], ['e', final], ...files, ...provenance(shown(x))],
      })
    }
    // Published after a reparented copy (depth 1), deleted after the original's own dependents.
    rows.push({ old: x, next, why: 'original', depth: valuesOf(x, 'e').length ? 1 : 0, about: aOf(nextOf.get(c.id) ?? c), copy: final })
  }

  // Dependents, to the end: whatever names a deleted id by `e` or `q`.
  const handled = (id: string) => moved.has(id) || standing.has(id)
  const dependents = new Map<string, SignedEvent>()
  const orphans: string[] = []
  for (let frontier = [...moved.keys(), ...standing.keys()]; frontier.length; ) {
    const found: string[] = []
    for (const id of frontier) {
      for (const e of index.pointing.get(id) ?? []) {
        if (handled(e.id) || dependents.has(e.id)) continue
        if (e.kind === MESSAGE) {
          orphans.push(`${e.id.slice(0, 8)} names ${id.slice(0, 8)}`)
          continue
        }
        dependents.set(e.id, e)
        found.push(e.id)
      }
    }
    frontier = found
  }
  const finalOf = (id: string): string | undefined => {
    const s = standing.get(id)
    return s ? (moved.get(s) ?? s) : moved.get(id)
  }
  const eventOf = (id: string): Pick<SignedEvent, 'kind' | 'content' | 'pubkey'> | undefined => nextOf.get(id) ?? byId.get(id)
  const unsettled = (id: string): boolean => (dependents.has(id) && !handled(id)) || (standing.has(id) && unsettled(standing.get(id)!))
  const refs = (e: SignedEvent) => e.tags.filter((t) => t[0] === 'e' || t[0] === 'q').map((t) => t[1])
  const said = new Map([...byId.values()].map((e) => [statement(e), e.id]))

  for (let depth = 2; [...dependents.keys()].some((id) => !handled(id)); depth += 1) {
    const ready = [...dependents.values()].filter((e) => !handled(e.id) && !refs(e).some(unsettled))
    if (!ready.length) throw new Error('dependents that name each other in a cycle')
    for (const old of ready) {
      let tags: NostrTag[]
      if (old.kind === EDIT) {
        // Exactly one `e`, the target's (CON-21).
        const target = valuesOf(old, 'e').find((id) => /^[0-9a-f]{64}$/.test(id))
        const to = target && finalOf(target)
        if (!to) throw new Error(`${old.id}: an edit whose target ${target} did not move, found by another e`)
        // An original's copy keeps its own body, and its files came across above; a stray copy's edit was of the copy's body, not the original's.
        if (copyOf.has(target) || strays.has(target)) {
          standing.set(old.id, to)
          rows.push({ old, next: null, why: 'dependent', depth, copy: to })
          continue
        }
        tags = [...old.tags.filter((t) => t[0] !== 'e'), ['e', to]]
      } else {
        const targets = old.tags.filter((t) => (t[0] === 'e' || t[0] === 'q') && finalOf(t[1]))
        tags = old.tags.map((t) => ((t[0] === 'e' || t[0] === 'q') && finalOf(t[1]) ? [t[0], finalOf(t[1])!, ...t.slice(2)] : t))
        // A reaction's `k` is its target's kind, which changes with it (9 ↔ 1111).
        if (targets.length === 1) {
          const [from, to] = [eventOf(targets[0][1])?.kind, eventOf(finalOf(targets[0][1])!)?.kind]
          if (from !== undefined && to !== undefined) tags = tags.map((t) => (t[0] === 'k' && t[1] === String(from) ? ['k', String(to)] : t))
        }
      }
      const candidate = { pubkey: old.pubkey, kind: old.kind, content: old.content, tags }
      const already = said.get(statement(candidate))
      if (already && !handled(already)) {
        // The copy already has this reaction or resolution: the original's is only deleted.
        standing.set(old.id, already)
        rows.push({ old, next: null, why: 'dependent', depth, copy: already })
        continue
      }
      const next = finish({ ...candidate, created_at: old.created_at, tags: [...tags, ...provenance(old)] })
      moved.set(old.id, next.id)
      nextOf.set(old.id, next)
      rows.push({ old, next, why: 'dependent', depth })
    }
  }

  // A body is copied verbatim, so a quote of a deleted id would dangle.
  const staleQuotes: Plan['staleQuotes'] = []
  for (const e of byId.values()) {
    const quotes: string[] = []
    for (const [, bech] of e.content.matchAll(/nostr:((?:nevent|note)1[02-9ac-hj-np-z]+)/g)) {
      try {
        // A `note1` is not decoded here (as in CON-20): reported, so a person decides.
        const id = bech.startsWith('note') ? null : decodeNevent(bech).id
        if (!id) quotes.push(`undecoded ${bech.slice(0, 16)}…`)
        else if (handled(id)) quotes.push(id)
      } catch {
        // prose
      }
    }
    if (quotes.length && !STALE_QUOTES_ACCEPTED.has(e.id)) staleQuotes.push({ id: e.id, kind: e.kind, quotes })
  }
  return { rows, orphans, leftAlone, mismatched, staleQuotes, byId }
}

function summarise(plan: Plan) {
  const count = (f: (r: Row) => string) => {
    const m = new Map<string, number>()
    for (const r of plan.rows) m.set(f(r), (m.get(f(r)) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')
  }
  console.log(`${plan.rows.filter((r) => r.next).length} to republish, then ${plan.rows.length} kind:5`)
  if (plan.rows.length) {
    console.log(`  by role:    ${count((r) => `${r.why}(${r.old.kind}→${r.next ? r.next.kind : r.copy ? 'kept ' + r.copy.slice(0, 8) : 'gone'})`.replace(/kept [0-9a-f]+/, 'standing'))}`)
    console.log(`  by author:  ${count((r) => r.old.pubkey.slice(0, 8))}`)
    const signed = new Map<string, number>()
    for (const r of plan.rows) for (const k of [...(r.next ? [r.next.kind] : []), 5]) signed.set(`${r.old.pubkey.slice(0, 8)} kind:${k}`, (signed.get(`${r.old.pubkey.slice(0, 8)} kind:${k}`) ?? 0) + 1)
    console.log(`  by signer:  ${[...signed].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`)
    console.log(`  by Folder:  ${count((r) => valuesOf(r.old, 'h')[0]?.slice(0, 8) ?? 'none')}`)
  }
  const list = (label: string, xs: string[]) => console.log(`${label}: ${xs.length}${xs.map((x) => `\n  ${x}`).join('')}`)
  list('kind:9 that would be orphaned', plan.orphans)
  list('replies left alone', plan.leftAlone)
  list("copies whose parent is not their original's thread's copy", plan.mismatched)
  list('bodies quoting a deleted id', plan.staleQuotes.map((q) => `${q.id} kind:${q.kind}: ${q.quotes.join(' ')}`))
}

// ---------------------------------------------------------------- the done-when, measured on its own

/** Leg 1 and 2 counted straight from an export, not from the plan: a plan that forgets a shape must not pass. */
function measure(index: Index, convex: ReadonlyMap<string, string>) {
  const originals = copiesOf(index, convex).size
  let wrongA = 0
  for (const r of index.byId.values()) {
    const parent = r.kind === COMMENT ? index.byId.get(valuesOf(r, 'e')[0] ?? '') : undefined
    if (parent && valuesOf(r, 'A').join() !== valuesOf(parent, 'A').join()) wrongA++
  }
  return { originals, wrongA }
}

// ---------------------------------------------------------------- the relay (apply only)

/** The Folder a row's event is written into: its own `h`, or for a reaction the `h` of what it names. */
function folderOf(r: Row, byId: Map<string, SignedEvent>, nextById: Map<string, UnsignedEvent>): string | undefined {
  const e = r.next ?? r.old
  const own = valuesOf(e, 'h')[0]
  if (own) return own
  const target = valuesOf(e, 'e').at(-1) ?? ''
  const t = nextById.get(target) ?? byId.get(target)
  return t ? valuesOf(t, 'h')[0] : undefined
}

async function apply(plan: Plan) {
  if (plan.orphans.length || plan.staleQuotes.length) throw new Error('orphans or stale quotes — decide what they should become before applying')
  const agent = await agentIdentity()
  const keys = loadKeys(KEYS)
  const signers = signersFrom(agent, keys)
  const missing = [...new Set(plan.rows.map((r) => r.old.pubkey))].filter((pk) => !signers.has(pk))
  if (missing.length) {
    throw new Error(`no key ${existsSync(KEYS) ? `in ${KEYS}` : `(${KEYS} does not exist — export the keys first)`} for: ${missing.join(', ')} — nothing published`)
  }

  // An author not in the Folder cannot write there; its owner adds them (as CON-20 did).
  const members = loadMembers(MEMBERS)
  const nextById = new Map(plan.rows.flatMap((r): [string, UnsignedEvent][] => (r.next ? [[r.next.id, r.next]] : [])))
  const joins = new Map<string, Set<string>>()
  for (const r of plan.rows.filter((row) => row.next)) {
    const h = folderOf(r, plan.byId, nextById)
    if (!h) throw new Error(`${r.old.id}: no Folder to write into`)
    if (!members.get(h)?.has(r.old.pubkey)) joins.set(h, new Set([...(joins.get(h) ?? []), r.old.pubkey]))
  }
  for (const [h, authors] of joins) {
    const admin = [...(members.get(h) ?? [])].find(([pk, role]) => (role === 'owner' || role === 'admin') && keys.has(pk))?.[0]
    if (!admin) throw new Error(`Folder ${h}: no key for an owner or admin to add ${[...authors].join(', ')} — nothing published`)
    const as: Identity = { pubkey: admin, sign: async (u) => signEvent(u, keys.get(admin)!) }
    for (const author of authors) {
      await publish(signEvent(buildAddMember(admin, Date.now(), { channelUuid: h, targetPubkey: author }), keys.get(admin)!), as)
      console.log(`+  ${author.slice(0, 8)} added to Folder ${h} by ${admin.slice(0, 8)}`)
      await sleep(WRITE_GAP_MS)
    }
  }

  const republished = plan.rows.filter((r): r is Row & { next: NonNullable<Row['next']> } => !!r.next)
  const already = await readBack(republished, (r) => r.next!.id, signers)
  let published = 0
  // An original's attachments edit names its copy, which may itself be a reparented reply (depth 1): after it.
  const order = (r: Row) => (r.why === 'original' ? 1.5 : r.depth)
  for (const r of [...republished].sort((a, b) => order(a) - order(b) || a.old.created_at - b.old.created_at)) {
    const label = `${r.why} ${r.old.id.slice(0, 8)}→${r.next.id.slice(0, 8)} kind:${r.next.kind} by ${r.old.pubkey.slice(0, 8)}`
    if (already.has(r.next.id)) {
      console.log(`·  ${label} — already on the relay`)
      continue
    }
    const author = signers.get(r.old.pubkey)!
    const { id: planned, ...unsigned } = r.next
    const signed = await author.sign(unsigned)
    if (signed.id !== planned) throw new Error(`${label}: signed id ${signed.id} is not the planned one — the signer changed the event`)
    await publish(signed, author)
    console.log(`✓  ${label}`)
    published++
    await sleep(WRITE_GAP_MS)
  }

  const back = await readBack(republished, (r) => r.next!.id, signers)
  const absent = republished.filter((r) => !back.has(r.next.id))
  if (absent.length) throw new Error(`${absent.length} republished events do not read back, so nothing is deleted: ${absent.map((r) => r.next.id).join(' ')}`)
  // Read as the row's author, who writes in that Folder.
  const standingRows = plan.rows.filter((r) => r.copy)
  const keptBack = await readBack(standingRows, (r) => r.copy!, signers)
  const kept = [...new Set(standingRows.map((r) => r.copy!))]
  const keptAbsent = kept.filter((id) => !keptBack.has(id))
  if (keptAbsent.length) throw new Error(`${keptAbsent.length} standing events do not read back, so nothing is deleted: ${keptAbsent.join(' ')}`)
  console.log(`\n${published} published; all ${republished.length} republished and ${kept.length} standing events read back. Deleting ${plan.rows.length}, dependents first.`)

  let deleted = 0
  for (const r of [...plan.rows].sort((a, b) => b.depth - a.depth || b.old.created_at - a.old.created_at)) {
    const author = signers.get(r.old.pubkey)!
    const unsigned = buildDeletion(r.old.pubkey, Date.now(), { targetEventId: r.old.id })
    unsigned.tags.push(['k', String(r.old.kind)])
    await publish(await author.sign(unsigned), author)
    deleted++
    await sleep(WRITE_GAP_MS)
  }
  const left = await readBack(plan.rows, (r) => r.old.id, signers)
  console.log(`${deleted} kind:5 published; deleted events still readable: ${left.size}`)
  if (left.size) process.exit(1)
}

// ---------------------------------------------------------------- main

async function main() {
  const index = loadExport(EXPORT)
  const convex = loadConvex()
  console.log(`export: ${index.byId.size} events, every id recomputed; ${convex.size} Convex ids mapped to relay events`)
  const before = measure(index, convex)
  console.log(`done-when now: ${before.originals} live kind:9 with a live SHR-8 copy; ${before.wrongA} kind:1111 replies whose A is not their parent's`)
  if (mode === 'verify') {
    if (before.originals || before.wrongA) process.exit(1)
    return
  }
  const plan = buildPlan(index, convex)
  summarise(plan)

  if (mode === 'plan') {
    const rows = plan.rows.map(({ why, depth, about, alsoAbout, copy, old, next }) => ({ why, depth, about, alsoAbout, copy, old, next }))
    writeFileSync(PLAN_OUT, JSON.stringify(rows, null, 1))
    console.log(`\nplan written to ${PLAN_OUT}`)
  } else if (mode === 'simulate') {
    const [snapshot, out] = process.argv.slice(3)
    if (!snapshot || !out) throw new Error('usage: con22-shr8-leftovers.ts simulate <snapshot.jsonl> <out.jsonl>')
    const gone = new Set(plan.rows.map((r) => r.old.id))
    const kept = readFileSync(snapshot, 'utf8').split('\n').filter((l) => l.startsWith('{') && !gone.has((JSON.parse(l) as SignedEvent).id))
    const added = plan.rows.flatMap((r) => (r.next ? [JSON.stringify({ ...r.next, sig: '0'.repeat(128) })] : []))
    writeFileSync(out, [...kept, ...added].join('\n') + '\n')
    const after = measure({ byId: new Map([...kept, ...added].map((l) => JSON.parse(l) as SignedEvent).map((e) => [e.id, e])), pointing: new Map() }, convex)
    console.log(`\nsimulated: ${kept.length} kept, ${gone.size} removed, ${added.length} added → ${out}`)
    console.log(`done-when after: ${after.originals} live kind:9 with a live SHR-8 copy; ${after.wrongA} kind:1111 replies whose A is not their parent's`)
  } else {
    await apply(plan)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
