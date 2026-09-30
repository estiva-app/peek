/**
 * CON-20: republish every comment-shaped `kind:9` as a `kind:1111`, so a
 * `kind:9` is only ever chat — run against production.
 *
 *   scripts/con20-export.sh > ~/con20-scratch/export.jsonl                        # read-only, the input
 *   npx tsx --tsconfig tsconfig.app.json scripts/con20-kind9-to-1111.ts plan      # read-only
 *   set -a; . ~/.estiva-agent.env; set +a
 *   CON20_KEYS=~/.keys.json npx tsx --tsconfig tsconfig.app.json \
 *     scripts/con20-kind9-to-1111.ts apply                                        # publish, then delete
 *   scripts/con20-export.sh > ~/con20-scratch/export.jsonl && \
 *     npx tsx --tsconfig tsconfig.app.json scripts/con20-kind9-to-1111.ts verify  # the done-when's first leg
 *
 * `simulate <snapshot> <out>` applies the plan to a `con20-snapshot.sql` export
 * offline, so `con20-fake-relay.ts` and the two readers can show what Ship and
 * Peek will draw before anything is published; `con20-compare.ts` diffs it.
 *
 * **The input is the database, not the relay.** The agent reads 68 of
 * production's Folders, which holds 107 of the 126 legacy roots; a comment can
 * be in any Folder. `con20-export.sql` writes every live `kind:9` and
 * `kind:1111` and everything that names one by `e` or `q`, and this script
 * recomputes every id from those fields before trusting a row.
 *
 * What moves (SPEC §6.4, *Replies*):
 *
 * - **A legacy comment root** — a `kind:9` with no `e` and an `a` its body does
 *   not name (the strengths table's fourth row) — becomes a top-level
 *   `kind:1111` on that address: `A`/`K`/`P` and the same `a`/`k`/`p`, which
 *   is what Ship and Peek publish today.
 * - **A `kind:9` reply** under such a root or under a `kind:1111` comment
 *   becomes a flat `kind:1111` reply: uppercase copied from the thread's
 *   top-level comment, lowercase `e`/`k`/`p` naming that comment.
 * - **Whatever points at a moved event** by `e` or `q` — reactions,
 *   resolutions, the edit, `kind:1111` replies to a legacy root — is
 *   republished against the new id, and whatever points at *those*, to the
 *   end. An edit names exactly one `e` (CON-21, buzz#20), so it carries only
 *   the new target's.
 * - **The originals are deleted** with one `kind:5` each (buzz takes exactly
 *   one target), dependents before what they point at.
 *
 * Every copy keeps its author, `created_at`, body and every other tag (`h`,
 * `ts`, `imeta`, `block`, mention `p`/`a`/`q`), and adds
 * `['orig', <id>, <created_at>, <pubkey>]` and `['migration', 'con20']`, as
 * the FOL-25 and SHR-8 copies do. Keeping `created_at` needs the relay's floor
 * window open (`BUZZ_CREATED_AT_FLOOR_SECS` and `BUZZ_MAX_TIMESTAMP_DRIFT_SECS`
 * in `/opt/buzz/.env`, CON-13) for the length of `apply`, and closed after.
 *
 * **Deterministic, so a re-run is safe.** A new event's id is the hash of what
 * is copied from stored data, so `plan` knows every new id before anything is
 * signed, and `apply` skips a copy the relay already holds. A run that stopped
 * between copying and deleting finds the same copies on the next run, from a
 * fresh export.
 *
 * Who signs: the agent's events through Estiva ID's `/sign` (which reproduces
 * the planned id with the old `created_at` — `plan` checks); everyone else's
 * with their own key from {@link KEYS}, a JSON map of pubkey to secret hex
 * exported per `memory: exporting-a-custodied-signing-key`. Each secret is
 * checked against its pubkey before anything is signed, and nothing prints it.
 * Reads during `apply` go as each copy's author, who can read their own Folder.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { buildAddMember, buildDeletion, computeEventId, decodeNaddr, decodeNevent, findNaddrs, pointerToAddress, signEvent } from '@estiva-app/protocol'
import type { NostrTag, SignedEvent, UnsignedEvent } from '@estiva-app/protocol'
import {
  WRITE_GAP_MS,
  agentIdentity,
  hasE,
  loadExport as loadExportFrom,
  loadKeys as loadKeysFrom,
  loadMembers as loadMembersFrom,
  publish,
  readBack,
  signersFrom,
  sleep,
  valuesOf,
} from './relay-migration'
import type { Identity, Index } from './relay-migration'

const CLIENT_ID = process.env.ESTIVA_ID_CLIENT_ID ?? ''
const KEYS = process.env.CON20_KEYS ?? `${homedir()}/.keys.json`
const EXPORT = process.env.CON20_EXPORT ?? `${homedir()}/con20-scratch/export.jsonl`
const MEMBERS = process.env.CON20_MEMBERS ?? `${homedir()}/con20-scratch/members.jsonl`
const PLAN_OUT = process.env.CON20_PLAN ?? `${homedir()}/con20-scratch/plan.json`
/** Only the threads in this Folder — the rehearsal in QA (`a78e60b1-…`) before the real run. */
const ONLY_H = process.env.CON20_ONLY_H
const MIGRATION = 'con20'

const MESSAGE = 9
const COMMENT = 1111
const EDIT = 40003

const mode = process.argv[2]
if (!['plan', 'simulate', 'apply', 'verify'].includes(mode ?? '')) {
  throw new Error('usage: con20-kind9-to-1111.ts plan | simulate <snapshot.jsonl> <out.jsonl> | apply | verify')
}

// ---------------------------------------------------------------- the input

const loadExport = (): Index => loadExportFrom(EXPORT)

// ---------------------------------------------------------------- the shapes

/** The addresses a body names by `nostr:naddr…`; a pointer that will not decode is prose. Peek's `namedInBody`. */
function namedInBody(body: string): Set<string> {
  const out = new Set<string>()
  for (const naddr of findNaddrs(body)) {
    try {
      out.add(pointerToAddress(decodeNaddr(naddr)))
    } catch {
      // prose
    }
  }
  return out
}

/**
 * A `kind:9` root's comment anchor: the `a` its body does not name (SPEC §6.4,
 * fourth row), or null for chat and for a mention. A body that names the
 * address by a pasted app link names it too (FOL-38 indexes those as `a`): the
 * address's `d` appears in the body.
 */
function legacyAnchorOf(e: SignedEvent): string | null {
  if (e.kind !== MESSAGE || hasE(e)) return null
  const named = namedInBody(e.content)
  const anchors = valuesOf(e, 'a').filter((a) => !named.has(a) && !e.content.includes(a.split(':').slice(2).join(':')))
  if (anchors.length > 1) throw new Error(`${e.id}: ${anchors.length} unnamed a tags — which one is the comment's object is not decidable`)
  return anchors[0] ?? null
}

/** The thread a `kind:9` reply is in: its `root`-marked `e`, else its `reply`-marked one, else its first. */
function threadOf(e: Pick<SignedEvent, 'tags'>): string | null {
  const es = e.tags.filter((t) => t[0] === 'e' && t[1])
  if (es.length === 0) return null
  return (es.find((t) => t[3] === 'root') ?? es.find((t) => t[3] === 'reply') ?? es[0])[1]
}

const addrParts = (address: string) => {
  const [kind, pubkey] = address.split(':')
  return { kind, pubkey }
}

// ---------------------------------------------------------------- the plan

interface Copy {
  /** The event being replaced. */
  old: SignedEvent
  /** Its replacement, unsigned; `id` is computed. Null when a copy already stands and the original is only deleted. */
  next: (UnsignedEvent & { id: string }) | null
  why: 'root' | 'reply' | 'dependent' | 'copied before'
  /** 0 for roots, 1 for replies, 2+ for dependents: publish ascending, delete descending. */
  depth: number
  /** The object the thread is about — what the before/after reads open. Absent on a dependent. */
  about?: string
  /** For `copied before`: the standing copy the original is deleted in favour of. */
  copy?: string
}

interface Plan {
  copies: Copy[]
  /** Events outside the moved set whose body quotes a moved id — left as they are, and reported. */
  staleQuotes: { id: string; kind: number; author: string; quotes: string[] }[]
  mentionsKept: string[]
  /** The export, for what a copy names that is not itself moving. */
  byId: Map<string, SignedEvent>
}

/** A copy of a copy keeps the `orig` that names the first original. */
const provenance = (old: SignedEvent): NostrTag[] => [
  ...(old.tags.some((t) => t[0] === 'orig') ? [] : [['orig', old.id, String(old.created_at), old.pubkey]]),
  ['migration', MIGRATION],
]

const finish = (next: UnsignedEvent): UnsignedEvent & { id: string } => ({ ...next, id: computeEventId(next) })

/** The moved ids a body quotes by `nostr:nevent…`/`nostr:note…`. */
function quotedIn(body: string, moved: ReadonlyMap<string, string>): string[] {
  const out: string[] = []
  for (const [, bech] of body.matchAll(/nostr:((?:nevent|note)1[02-9ac-hj-np-z]+)/g)) {
    try {
      const id = bech.startsWith('note') ? null : decodeNevent(bech).id
      if (id && moved.has(id)) out.push(id)
      if (!id) out.push(`undecoded ${bech.slice(0, 16)}…`)
    } catch {
      // prose
    }
  }
  return out
}

function buildPlan(index: Index): Plan {
  const messages = [...index.byId.values()].filter((e) => e.kind === MESSAGE && (!ONLY_H || valuesOf(e, 'h')[0] === ONLY_H))
  const moved = new Map<string, string>()
  const nextOf = new Map<string, UnsignedEvent & { id: string }>()
  const copies: Copy[] = []

  // Roots.
  const roots = new Map<string, { event: SignedEvent; anchor: string }>()
  const mentionsKept: string[] = []
  for (const e of messages) {
    const anchor = legacyAnchorOf(e)
    if (anchor) roots.set(e.id, { event: e, anchor })
    else if (!hasE(e) && valuesOf(e, 'a').length) mentionsKept.push(e.id)
  }
  for (const { event: old, anchor } of roots.values()) {
    const { kind, pubkey } = addrParts(anchor)
    const h = valuesOf(old, 'h')[0]
    if (!h) throw new Error(`${old.id}: legacy root has no h`)
    const rest = old.tags.filter((t) => !(t[0] === 'h' || t[0] === 'ts' || (t[0] === 'a' && t[1] === anchor)))
    const next = finish({
      pubkey: old.pubkey,
      created_at: old.created_at,
      kind: COMMENT,
      content: old.content,
      tags: [
        ['A', anchor], ['K', kind], ['P', pubkey], ['a', anchor], ['k', kind], ['p', pubkey], ['h', h],
        ...old.tags.filter((t) => t[0] === 'ts'), ...rest, ...provenance(old),
      ],
    })
    moved.set(old.id, next.id)
    nextOf.set(old.id, next)
    copies.push({ old, next, why: 'root', depth: 0, about: anchor })
  }

  /*
    SHR-8 copied some kind:9 replies to kind:1111 and left the original live.
    The copy is the reply; the original is only deleted, or a reader would
    show a third one. What pointed at the original — reactions the copy never
    got — follows it to the copy. A copy is found by its `orig` when that names
    the relay event, and otherwise by being the same message: a migration-tagged
    `kind:1111` with the same author, second and body (SHR-8's `orig` names a
    Convex row — memory: orig-has-two-spellings).
  */
  const sameMessage = (e: Pick<SignedEvent, 'pubkey' | 'created_at' | 'content'>) => `${e.pubkey}|${e.created_at}|${e.content}`
  const migrated = new Map<string, SignedEvent>()
  // This run's own copies are not "copied before": a resumed run plans the same ids and skips them.
  for (const e of index.byId.values()) {
    if (e.kind === COMMENT && e.tags.some((t) => t[0] === 'migration' && t[1] !== MIGRATION)) migrated.set(sameMessage(e), e)
  }
  const copiedAs = new Map<string, SignedEvent>()
  for (const e of index.byId.values()) {
    const ours = valuesOf(e, 'migration').includes(MIGRATION)
    const orig = e.kind === COMMENT && !ours ? index.byId.get(valuesOf(e, 'orig')[0] ?? '') : undefined
    if (orig?.kind === MESSAGE && orig.content === e.content) copiedAs.set(orig.id, e)
  }
  for (const m of messages) {
    const copy = migrated.get(sameMessage(m))
    // The same message only in the same thread: the copy's parent is the original's thread.
    const thread = threadOf(m)
    if (copy && thread && valuesOf(copy, 'e').includes(thread) && !copiedAs.has(m.id)) copiedAs.set(m.id, copy)
  }
  for (const id of roots.keys()) if (copiedAs.has(id)) throw new Error(`${id}: a legacy root that was copied before — not handled`)
  const standing = new Map<string, string>()

  // Replies: flat, under the thread's top-level comment.
  for (const old of messages.filter(hasE)) {
    const thread = threadOf(old)!
    let top: { id: string; uppercase: NostrTag[]; author: string } | null = null
    const legacy = roots.get(thread)
    if (legacy) {
      const { kind, pubkey } = addrParts(legacy.anchor)
      top = { id: moved.get(thread)!, uppercase: [['A', legacy.anchor], ['K', kind], ['P', pubkey]], author: legacy.event.pubkey }
    } else {
      let c = index.byId.get(thread)
      // A 1111 reply names its top-level comment by `e` (one level, SPEC §6.4); walk up to it.
      if (c?.kind === COMMENT && hasE(c) && !c.tags.some((t) => t[0] === 'E')) c = index.byId.get(valuesOf(c, 'e')[0])
      if (c?.kind === COMMENT) top = { id: c.id, uppercase: c.tags.filter((t) => ['A', 'E', 'I', 'K', 'P'].includes(t[0])), author: c.pubkey }
    }
    if (!top) continue // chat
    const copy = copiedAs.get(old.id)
    if (copy) {
      standing.set(old.id, copy.id)
      copies.push({ old, next: null, why: 'copied before', depth: 1, about: top.uppercase.find((t) => t[0] === 'A')?.[1], copy: copy.id })
      continue
    }
    const h = valuesOf(old, 'h')[0]
    if (!h) throw new Error(`${old.id}: reply has no h`)
    const rest = old.tags.filter((t) => !(t[0] === 'h' || t[0] === 'ts' || t[0] === 'e'))
    const next = finish({
      pubkey: old.pubkey,
      created_at: old.created_at,
      kind: COMMENT,
      content: old.content,
      tags: [
        ...top.uppercase, ['e', top.id], ['k', String(COMMENT)], ['p', top.author], ['h', h],
        ...old.tags.filter((t) => t[0] === 'ts'), ...rest, ...provenance(old),
      ],
    })
    moved.set(old.id, next.id)
    nextOf.set(old.id, next)
    copies.push({ old, next, why: 'reply', depth: 1, about: top.uppercase.find((t) => t[0] === 'A')?.[1] })
  }

  // Dependents, to the end: whatever names a moved or deleted id by `e` or `q`.
  const dependents = new Map<string, SignedEvent>()
  for (let frontier = [...moved.keys(), ...standing.keys()]; frontier.length; ) {
    const found: string[] = []
    for (const id of frontier) {
      for (const e of index.pointing.get(id) ?? []) {
        if (moved.has(e.id) || standing.has(e.id) || dependents.has(e.id)) continue
        dependents.set(e.id, e)
        found.push(e.id)
      }
    }
    frontier = found
  }
  // Where an id ends up; undefined for one that stays. A standing copy may itself be re-pointed.
  const finalOf = (id: string): string | undefined => {
    const copy = standing.get(id)
    return copy ? (moved.get(copy) ?? copy) : moved.get(id)
  }
  // Not final yet: a dependent not yet rebuilt, or an original whose standing copy is one.
  const unsettled = (id: string): boolean => (dependents.has(id) && !moved.has(id)) || (standing.has(id) && unsettled(standing.get(id)!))
  const refs = (e: SignedEvent) => e.tags.filter((t) => t[0] === 'e' || t[0] === 'q').map((t) => t[1])

  // Rebuilt in rounds, each once everything it names is final.
  for (let depth = 2; [...dependents.keys()].some((id) => !moved.has(id)); depth += 1) {
    const ready = [...dependents.values()].filter((e) => !moved.has(e.id) && !refs(e).some(unsettled))
    if (!ready.length) throw new Error('dependents that name each other in a cycle')
    for (const old of ready) {
      let tags: NostrTag[]
      if (old.kind === EDIT) {
        // Exactly one `e`, the target's (CON-21).
        const target = valuesOf(old, 'e').find((id) => /^[0-9a-f]{64}$/.test(id))
        const to = target && finalOf(target)
        if (!to) throw new Error(`${old.id}: an edit whose target ${target} did not move, found by another e`)
        tags = [...old.tags.filter((t) => t[0] !== 'e'), ['e', to]]
      } else {
        tags = old.tags.map((t) => ((t[0] === 'e' || t[0] === 'q') && finalOf(t[1]) ? [t[0], finalOf(t[1])!, ...t.slice(2)] : t))
        // A reply to a legacy root says its parent's kind: `9` becomes `1111` with the parent.
        tags = tags.map((t) => (t[0] === 'k' && t[1] === String(MESSAGE) ? ['k', String(COMMENT)] : t))
        /*
          A reply's uppercase is its top-level comment's (SPEC §6.4, *Replies*).
          SHR-8 anchored some at the issue's project instead (16 on 2026-09-29),
          which Peek draws as a reference and Ship unions into the thread's
          `about`; one being republished anyway takes its parent's.
        */
        const parent = old.kind === COMMENT ? nextOf.get(valuesOf(old, 'e')[0] ?? '') : undefined
        if (parent?.kind === COMMENT) {
          const upper = parent.tags.filter((t) => ['A', 'E', 'I', 'K', 'P'].includes(t[0]))
          tags = [...upper, ...tags.filter((t) => !['A', 'E', 'I', 'K', 'P'].includes(t[0]))]
        }
      }
      const next = finish({ pubkey: old.pubkey, created_at: old.created_at, kind: old.kind, content: old.content, tags: [...tags, ...provenance(old)] })
      moved.set(old.id, next.id)
      nextOf.set(old.id, next)
      copies.push({ old, next, why: 'dependent', depth })
    }
  }

  // A body is copied verbatim, so a quote of a moved id would dangle — in a copy or outside the set.
  const staleQuotes: Plan['staleQuotes'] = []
  const gone = new Map([...moved, ...[...standing.keys()].map((id): [string, string] => [id, finalOf(id)!])])
  for (const e of index.byId.values()) {
    const quotes = quotedIn(e.content, gone)
    if (quotes.length) staleQuotes.push({ id: e.id, kind: e.kind, author: e.pubkey, quotes })
  }
  return { copies, staleQuotes, mentionsKept, byId: index.byId }
}

function summarise(plan: Plan) {
  const count = (f: (c: Copy) => string) => {
    const m = new Map<string, number>()
    for (const c of plan.copies) m.set(f(c), (m.get(f(c)) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')
  }
  const publishing = plan.copies.filter((c) => c.next).length
  console.log(`${publishing} to republish, then ${plan.copies.length} kind:5`)
  if (!plan.copies.length) return
  console.log(`  by role:    ${count((c) => `${c.why}(${c.old.kind}→${c.next?.kind ?? 'deleted'})`)}`)
  console.log(`  by author:  ${count((c) => c.old.pubkey.slice(0, 8))}`)
  console.log(`  by depth:   ${count((c) => `d${c.depth}`)}`)
  console.log(`  by object:  ${count((c) => (!c.next || c.why === 'dependent' ? c.why : (valuesOf(c.next, 'A')[0] ?? valuesOf(c.next, 'E')[0] ?? '?').split(':')[0]))}`)
  const at = (s: number) => new Date(s * 1000).toISOString()
  console.log(`  created_at: ${at(Math.min(...plan.copies.map((c) => c.old.created_at)))} … ${at(Math.max(...plan.copies.map((c) => c.old.created_at)))}`)
  console.log(`kind:9 roots with an a, kept as mentions: ${plan.mentionsKept.length}`)
  console.log(`bodies quoting a moved id: ${plan.staleQuotes.length}${plan.staleQuotes.map((q) => `\n  ${q.id} kind:${q.kind} by ${q.author.slice(0, 8)}: ${q.quotes.join(' ')}`).join('')}`)
}

// ---------------------------------------------------------------- the relay (apply only)

const loadKeys = () => loadKeysFrom(KEYS)
const loadMembers = () => loadMembersFrom(MEMBERS)


/**
 * The Folder each copy is written into: its own `h`, or for a reaction (which
 * has none) the `h` of what it names — buzz files a reaction under its target's
 * channel.
 */
function folderOfCopy(c: Copy, byNewId: Map<string, Copy>, byOldId: Map<string, Copy>, byId: Map<string, SignedEvent>): string | undefined {
  const own = valuesOf(c.next ?? c.old, 'h')[0]
  if (own) return own
  const target = valuesOf(c.next ?? c.old, 'e').at(-1) ?? ''
  const t = byNewId.get(target) ?? byOldId.get(target)
  if (t) return valuesOf(t.next ?? t.old, 'h')[0]
  const standing = byId.get(target)
  return standing ? valuesOf(standing, 'h')[0] : undefined
}

/** Folder → the authors who must be added to it before their copies can be written there. */
function joinsNeeded(plan: Plan, members: Map<string, Map<string, string>>): Map<string, Set<string>> {
  const byNewId = new Map(plan.copies.flatMap((c): [string, Copy][] => (c.next ? [[c.next.id, c]] : [])))
  const byOldId = new Map(plan.copies.map((c): [string, Copy] => [c.old.id, c]))
  const joins = new Map<string, Set<string>>()
  for (const c of plan.copies) {
    const h = folderOfCopy(c, byNewId, byOldId, plan.byId)
    if (!h) throw new Error(`${c.old.id}: no Folder to write into`)
    if (!members.get(h)?.has(c.old.pubkey)) joins.set(h, new Set([...(joins.get(h) ?? []), c.old.pubkey]))
  }
  return joins
}

async function apply(plan: Plan) {
  const agent = await agentIdentity()
  const keys = loadKeys()
  const signers = signersFrom(agent, keys)
  const missing = [...new Set(plan.copies.map((c) => c.old.pubkey))].filter((pk) => !signers.has(pk))
  if (missing.length) {
    throw new Error(`no key ${existsSync(KEYS) ? `in ${KEYS}` : `(${KEYS} does not exist — export the keys first)`} for: ${missing.join(', ')} — nothing published`)
  }

  /*
    Buzz refuses a write from a non-member ("restricted: not a channel member"),
    and 110 of the originals were written before it did — the agent into ten
    Folders, Miky into three, Katerina into one, none of which they ever joined.
    Each Folder's owner adds them first with a kind:9000, and they stay members
    (Miky, 2026-09-30). A raw key signs it: the agent's app may not sign 9000
    through Estiva ID, so an agent that owns a Folder needs its key exported too.
  */
  const members = loadMembers()
  const joins = joinsNeeded(plan, members)
  const adders = new Map<string, string>()
  for (const h of joins.keys()) {
    const admin = [...(members.get(h) ?? [])].find(([pk, role]) => (role === 'owner' || role === 'admin') && keys.has(pk))
    if (!admin) {
      const admins = [...(members.get(h) ?? [])].filter(([, role]) => role === 'owner' || role === 'admin').map(([pk]) => pk)
      throw new Error(`Folder ${h}: no key for an owner or admin (${admins.join(', ') || 'none'}) to add ${[...joins.get(h)!].join(', ')} — nothing published`)
    }
    adders.set(h, admin[0])
  }
  for (const [h, authors] of joins) {
    const admin = adders.get(h)!
    const as: Identity = { pubkey: admin, sign: async (u) => signEvent(u, keys.get(admin)!) }
    for (const author of authors) {
      await publish(signEvent(buildAddMember(admin, Date.now(), { channelUuid: h, targetPubkey: author }), keys.get(admin)!), as)
      console.log(`+  ${author.slice(0, 8)} added to Folder ${h} by ${admin.slice(0, 8)}`)
      await sleep(WRITE_GAP_MS)
    }
  }

  const copies = plan.copies.filter((c): c is Copy & { next: NonNullable<Copy['next']> } => !!c.next)
  const already = await readBack(copies, (c) => c.next!.id, signers)
  const ordered = [...copies].sort((a, b) => a.depth - b.depth || a.old.created_at - b.old.created_at)
  let published = 0
  for (const c of ordered) {
    const label = `${c.why} ${c.old.id.slice(0, 8)}→${c.next.id.slice(0, 8)} kind:${c.next.kind} by ${c.old.pubkey.slice(0, 8)}`
    if (already.has(c.next.id)) {
      console.log(`·  ${label} — already on the relay`)
      continue
    }
    const author = signers.get(c.old.pubkey)!
    const { id: planned, ...unsigned } = c.next
    const signed = await author.sign(unsigned)
    if (signed.id !== planned) throw new Error(`${label}: signed id ${signed.id} is not the planned one — the signer changed the event`)
    await publish(signed, author)
    console.log(`✓  ${label}`)
    published++
    await sleep(WRITE_GAP_MS)
  }

  const back = await readBack(copies, (c) => c.next!.id, signers)
  const absent = copies.filter((c) => !back.has(c.next.id))
  if (absent.length) throw new Error(`${absent.length} copies do not read back, so no original is deleted: ${absent.map((c) => c.next.id).join(' ')}`)
  console.log(`\n${published} published; all ${copies.length} copies read back. Deleting ${plan.copies.length} originals, dependents first.`)

  let deleted = 0
  for (const c of [...plan.copies].sort((a, b) => b.depth - a.depth || b.old.created_at - a.old.created_at)) {
    const author = signers.get(c.old.pubkey)!
    const unsigned = buildDeletion(c.old.pubkey, Date.now(), { targetEventId: c.old.id })
    unsigned.tags.push(['k', String(c.old.kind)])
    await publish(await author.sign(unsigned), author)
    deleted++
    await sleep(WRITE_GAP_MS)
  }
  const left = await readBack(plan.copies, (c) => c.old.id, signers)
  console.log(`${deleted} kind:5 published; originals still readable: ${left.size}`)
  if (left.size) process.exit(1)
}

// ---------------------------------------------------------------- main

async function main() {
  const index = loadExport()
  console.log(`export: ${index.byId.size} events, every id recomputed`)
  const plan = buildPlan(index)
  summarise(plan)

  if (mode === 'plan') {
    writeFileSync(PLAN_OUT, JSON.stringify(plan.copies.map((c) => ({ why: c.why, depth: c.depth, about: c.about, copy: c.copy, old: c.old, next: c.next })), null, 1))
    console.log(`\nplan written to ${PLAN_OUT}`)
    if (existsSync(MEMBERS)) {
      const members = loadMembers()
      for (const [h, authors] of joinsNeeded(plan, members)) {
        const admins = [...(members.get(h) ?? [])].filter(([, role]) => role === 'owner' || role === 'admin').map(([pk, role]) => `${pk.slice(0, 8)}:${role}`)
        console.log(`join: ${[...authors].map((a) => a.slice(0, 8)).join(', ')} into ${h}, added by ${admins.join(' / ') || 'NOBODY'}`)
      }
    }
    // /sign must reproduce the planned id with the old created_at, or apply cannot sign the agent's copies.
    if (CLIENT_ID) {
      const agent = await agentIdentity()
      const own = plan.copies.find((c) => c.old.pubkey === agent.pubkey && c.next)
      if (own?.next) {
        const { id, ...unsigned } = own.next
        const signed = await agent.sign(unsigned)
        console.log(`/sign of a planned agent copy (not published): ${signed.id === id ? 'same id' : `DIFFERENT id ${signed.id}`}`)
      }
    }
  } else if (mode === 'simulate') {
    // The run, on a `con20-snapshot.sql` export instead of the relay: copies in (unsigned), originals out.
    const [snapshot, out] = process.argv.slice(3)
    if (!snapshot || !out) throw new Error('usage: con20-kind9-to-1111.ts simulate <snapshot.jsonl> <out.jsonl>')
    const gone = new Set(plan.copies.map((c) => c.old.id))
    const kept = readFileSync(snapshot, 'utf8').split('\n').filter((l) => l.startsWith('{') && !gone.has((JSON.parse(l) as SignedEvent).id))
    const added = plan.copies.flatMap((c) => (c.next ? [JSON.stringify({ ...c.next, sig: '0'.repeat(128) })] : []))
    writeFileSync(out, [...kept, ...added].join('\n') + '\n')
    console.log(`\nsimulated: ${kept.length} kept, ${gone.size} removed, ${added.length} added → ${out}`)
  } else if (mode === 'apply') {
    if (plan.staleQuotes.length) throw new Error('a body quotes a moved id — decide what it should say before applying')
    await apply(plan)
  } else {
    console.log(plan.copies.length === 0 ? 'verify: 0 comment-shaped kind:9, and nothing names one' : `verify: FAILED, ${plan.copies.length} still to move`)
    if (plan.copies.length) process.exit(1)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
