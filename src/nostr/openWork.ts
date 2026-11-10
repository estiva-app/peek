/**
 * Open work, on the relay and owned by the person (SHR-9).
 *
 * `deskOpenWork` was the cleanest layer-2 case left in Peek: four fields, every
 * one of them authored by the person who put a conversation in front of
 * themselves, one index, and every access that index followed by a JS `.some()`.
 * It meets none of ADR 0001 §3's five, so it is not layer 3 — it is a SPEC §12
 * blob under `estiva-peek:open-work:v1`, the same shape of store `stars.ts`
 * opened (CRO-11) and SHR-6 made authoritative.
 *
 * Everything `stars.ts`'s header argues applies unchanged: layer 2 rather than a
 * NIP-51 set because Peek's Estiva ID ceiling does not grant `30000`/`30003`,
 * because two kinds would be needed for one idea, and because neither half has a
 * portable identifier today. And the portability problem dissolves the same way
 * — only Peek reads this blob, so app-local ids are legitimate rather than a
 * compromise, while the relay identity (`channelUuid`, `pubkey`) travels beside
 * each entry so promoting this later is a re-publish and not a second migration.
 *
 * ## One ordered list, not two sets — the one place this departs from `stars`
 *
 * SHR-9 specifies "the `stars` blob verbatim", which is two arrays, `topics` and
 * `people`. That shape cannot hold this one, and the reason is the product
 * rather than the encoding: **open work is an ordered list a person will be able
 * to reorder** (Miky, 2026-09-16 — "latest added go last, kind of like a tab in
 * a browser; similarly to a tab, you should in future be able to change the
 * order"). Stars are a set rendered alphabetically, so `serializeStarsBlob`
 * sorts and array order is free to be a detail. Here array order *is* the state:
 * a DM promoted from the Screener between two topics sits where it was put, and
 * two arrays can express recency within a kind but nothing across them.
 *
 * So one `entries` array, each entry tagged with its kind and carrying exactly
 * the fields its `stars` counterpart carries. Nothing is added — an `addedAt`
 * per entry would encode the order a second time, and a second encoding of an
 * order is a second thing to keep right once dragging arrives.
 *
 * The cost, paid knowingly: `serializeOpenWorkBlob` does **not** sort, so the
 * "nothing changed, publish nothing" check is an ordered comparison. Two tabs
 * that reorder the same list in the same second lose one ordering, on §12.3's
 * accept-the-loss rule — the same trade `stars.ts` takes, and cheaper here,
 * because a lost ordering is visible and a drag repeats it.
 *
 * ## The bound is a refusal, not an eviction
 *
 * `appData.ts` refuses a plaintext over 65,535 bytes. Measured, 554 entries fit,
 * and the app's own `WATCHABLE_LIMIT` is 32 — "a workspace can grow topics
 * indefinitely while a Desk cannot grow attention" (`convex/nostr/sync.ts`). So
 * the cap is unreachable in practice, and if it is ever reached the publish is
 * refused rather than trimmed: SHR-4's read-state eviction is right for slots
 * whose loss is invisible and wrong for a hand-curated list, where a silently
 * dropped entry is data loss and a refusal is actionable — close something.
 * SPEC §12.3 asks which an app took; this one takes accept-the-loss on ordering
 * and refuse-over-the-cap on size.
 */
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'
import { KIND } from '@estiva-app/protocol'
import { publishSigned, signViaEstivaId } from './bridge'
import { decryptBlobFrom, readFrom, type ReadSource } from './readFrom'
import { BLOB_TAG, assertNotReadState, blobAddress, encryptBlob } from './appData'

/** `estiva-peek:open-work:v1` — SPEC §12.2's `<client_id>:<name>:v<n>`. */
export const OPEN_WORK_D_TAG = blobAddress('open-work')

export interface OpenWorkTopicRef {
  kind: 'topic'
  /** Peek's own topic id — a `seedKey` or a Convex id. What renders the row. */
  id: string
  /** The relay identity, when the topic has a channel. Optional by schema. */
  channelUuid?: string
}

export interface OpenWorkPersonRef {
  kind: 'dm'
  /** Peek's person key for the DM partner — a `seedKey` or a Convex id (§2.4). */
  key: string
  /** The relay identity, when one has been minted. Optional by schema. */
  pubkey?: string
}

/**
 * A file — a bare-file topic, a Ship issue — by its relay address (FOL-34).
 *
 * The one entry that carries no app-local id, because a file has none: it never
 * entered Convex, so the address *is* its identity and there is nothing to
 * travel beside it. It is also the one entry with no Convex copy — the
 * `deskOpenWork` dual-write is keyed on Convex ids and cannot hold it, which is
 * fine, because the seed that table exists for predates files being openable.
 */
export interface OpenWorkFileRef {
  kind: 'file'
  /** `kind:pubkey:d`. */
  address: string
}

export type OpenWorkRef = OpenWorkTopicRef | OpenWorkPersonRef | OpenWorkFileRef

export interface OpenWorkBlob {
  /** Schema version. An unknown value is ignored, never guessed at. */
  v: 1
  /** Epoch ms, so a person reading their own export can tell when it was written. */
  updatedAt: number
  /** The list, in the order it renders: oldest first, newest appended. */
  entries: OpenWorkRef[]
}

const EMPTY: OpenWorkBlob = { v: 1, updatedAt: 0, entries: [] }

/** The overlay/dedup key for an entry. The three prefixes cannot shadow each other. */
export function openWorkKey(entry: OpenWorkRef): string {
  if (entry.kind === 'file') return `file:${entry.address}`
  return entry.kind === 'dm' ? `dm:${entry.key}` : `topic:${entry.id}`
}

/**
 * Parse a decrypted blob, tolerating everything except a shape it cannot trust.
 *
 * `parseStarsBlob`'s rule, for the same reason: anything that will not parse
 * costs the state it held, never the read that asked for it. Entries are
 * filtered individually, so one malformed row does not discard the rest — and
 * here that also means the *order* of the survivors is kept, which a
 * discard-everything reader would have thrown away along with them.
 */
export function parseOpenWorkBlob(plaintext: string | undefined): OpenWorkBlob {
  if (!plaintext) return EMPTY
  let raw: unknown
  try {
    raw = JSON.parse(plaintext)
  } catch {
    return EMPTY
  }
  if (typeof raw !== 'object' || raw === null) return EMPTY
  const blob = raw as Partial<OpenWorkBlob>
  // An unknown version is ignored rather than coerced. Reading a v2 blob with v1
  // rules would silently drop whatever v2 added — an ordering scheme, say.
  if (blob.v !== 1) return EMPTY

  const str = (value: unknown): string | undefined =>
    typeof value === 'string' && value.length > 0 ? value : undefined

  const seen = new Set<string>()
  const entries: OpenWorkRef[] = []
  // Not `Partial<OpenWorkRef>`: the two members disagree on `kind`, so an
  // intersection of them is `never` and every field read off it is an error.
  type LooseEntry = {
    kind?: unknown
    id?: unknown
    key?: unknown
    channelUuid?: unknown
    pubkey?: unknown
    address?: unknown
  }
  for (const item of Array.isArray(blob.entries) ? blob.entries : []) {
    const entry = item as LooseEntry | null
    let parsed: OpenWorkRef | undefined
    if (entry?.kind === 'file') {
      const address = str(entry.address)
      if (address) parsed = { kind: 'file', address }
    } else if (entry?.kind === 'dm') {
      const key = str(entry.key)
      const pubkey = str(entry.pubkey)
      if (key) parsed = { kind: 'dm', key, ...(pubkey ? { pubkey } : {}) }
    } else if (entry?.kind === 'topic') {
      const id = str(entry.id)
      const channelUuid = str(entry.channelUuid)
      if (id) parsed = { kind: 'topic', id, ...(channelUuid ? { channelUuid } : {}) }
    }
    if (!parsed) continue
    // First appearance wins, so a duplicate written by an older client keeps the
    // position the person put it in rather than the one a later write gave it.
    const key = openWorkKey(parsed)
    if (seen.has(key)) continue
    seen.add(key)
    entries.push(parsed)
  }
  return {
    v: 1,
    updatedAt: typeof blob.updatedAt === 'number' && Number.isFinite(blob.updatedAt) ? blob.updatedAt : 0,
    entries,
  }
}

/**
 * Serialize for encryption. Stable key order **and array order preserved**.
 *
 * `serializeStarsBlob` sorts because a set has no order to lose. This one must
 * not: the array is the person's list, so sorting it here would both destroy
 * what is being published and make "the same list, reordered" compare equal, so
 * a drag would publish nothing at all.
 */
export function serializeOpenWorkBlob(blob: OpenWorkBlob): string {
  return JSON.stringify({
    v: blob.v,
    updatedAt: blob.updatedAt,
    entries: blob.entries.map((e) =>
      e.kind === 'file'
        ? { kind: 'file', address: e.address }
        : e.kind === 'dm'
          ? { kind: 'dm', key: e.key, ...(e.pubkey ? { pubkey: e.pubkey } : {}) }
          : { kind: 'topic', id: e.id, ...(e.channelUuid ? { channelUuid: e.channelUuid } : {}) },
    ),
  })
}

/**
 * The unsigned `kind:30078` carrying an open-work blob.
 *
 * **No `h` tag** — SPEC §12.2 makes that a MUST NOT. The relay classifies the
 * kind global-only on write, but its read path treats an explicit `h` as
 * authoritative, so a stray one would not scope the event and *would* make it
 * answer `#h` queries.
 */
export function buildOpenWorkEvent(pubkey: string, nowMs: number, ciphertext: string): UnsignedEvent {
  assertNotReadState(OPEN_WORK_D_TAG)
  return {
    pubkey,
    created_at: Math.floor(nowMs / 1000),
    kind: KIND.APP_DATA,
    tags: [
      ['d', OPEN_WORK_D_TAG],
      ['t', BLOB_TAG],
    ],
    content: ciphertext,
  }
}

/** The filter that finds this person's open-work blob and nothing else. */
export function openWorkFilter(pubkey: string): Record<string, unknown> {
  return { kinds: [KIND.APP_DATA], authors: [pubkey], '#d': [OPEN_WORK_D_TAG] }
}

export interface RelaySeam {
  relayUrl: string
  accessToken: string
  pubkey: string
}

/**
 * What the relay had to say about this person's open work.
 *
 * Three answers, kept apart for the reason `StarsRead` spells out: "you have no
 * open work" and "we could not find out" have opposite consequences. The first
 * is an empty list to render and a coordinate to seed from Convex; the second is
 * a publish that must not happen, because last-write-wins makes a list written
 * from a guess permanent.
 *
 * `absent` covers an event that is there and carries nothing this version can
 * read, for the same reason: there is no usable list either way, and Convex
 * still holds every row. A *decrypt* failure is `unreachable`, never `absent` —
 * the blob is intact as far as anyone can tell and the thing that failed is this
 * tab's key, so republishing over it is the one move that could destroy it.
 */
export type OpenWorkRead =
  | { state: 'unreachable' }
  | { state: 'absent' }
  | { state: 'present'; blob: OpenWorkBlob }

export async function fetchOpenWork(seam: RelaySeam, source: ReadSource = 'relay'): Promise<OpenWorkRead> {
  const { ok, events } = await readFrom(source, seam.relayUrl, [openWorkFilter(seam.pubkey)], seam.accessToken, seam.pubkey)
  if (!ok) return { state: 'unreachable' }
  // Parameterized-replaceable, so the relay serves at most one per coordinate.
  // Newest wins if a relay ever hands back more.
  const newest = events.sort((a, b) => b.created_at - a.created_at)[0]
  if (!newest) return { state: 'absent' }
  const plaintext = await decryptBlobFrom(source, newest.content, seam.accessToken)
  if (!plaintext) return { state: 'unreachable' }
  const blob = parseOpenWorkBlob(plaintext)
  // `parseOpenWorkBlob` never throws and never reports: bad JSON, a `v` it does
  // not know and a non-object all land on the same floor, and `updatedAt: 0` is
  // the part of that floor no real publish can produce — `openWorkToPublish`
  // stamps a clock. So a zero here means the blob decrypted and said nothing
  // usable, which is `absent`. Pinned by a test, because it is an invariant
  // between two functions rather than a property of either.
  if (blob.updatedAt === 0) return { state: 'absent' }
  return { state: 'present', blob }
}

/**
 * Encrypt, sign and publish an open-work blob.
 *
 * Whole-blob write: §12.3's parameterized-replaceable semantics mean the
 * coordinate is replaced, so the whole list is rewritten to add one row. That is
 * the accepted cost of layer 2, and the reason this is a list rather than a table.
 *
 * An over-cap blob fails inside `encryptBlob`, which throws rather than
 * truncating. Caught here so the reason reaches the log intact — it is the one
 * failure a person can act on.
 */
export async function publishOpenWork(
  blob: OpenWorkBlob,
  seam: RelaySeam,
): Promise<{ ok: boolean; eventId?: string; reason?: string }> {
  let ciphertext: string
  try {
    ciphertext = await encryptBlob(serializeOpenWorkBlob(blob), seam.accessToken)
  } catch (error) {
    return { ok: false, reason: `could not encrypt open work: ${(error as Error).message}` }
  }
  const unsigned = buildOpenWorkEvent(seam.pubkey, blob.updatedAt || Date.now(), ciphertext)
  let signed: SignedEvent
  try {
    signed = await signViaEstivaId(unsigned, seam.accessToken, seam.pubkey)
  } catch (error) {
    // `kind_not_allowed` here is the ceiling failing at the last step, after
    // everything else agreed — the shape the Estiva ID seed comments warn about
    // three times. Say which kind, so the next reader does not have to guess.
    return { ok: false, reason: `could not sign kind:${KIND.APP_DATA}: ${(error as Error).message}` }
  }
  const result = await publishSigned(seam.relayUrl, signed, seam.accessToken, seam.pubkey)
  return { ok: result.ok, eventId: result.eventId, reason: result.reason }
}

/**
 * The blob to publish for a list, or `undefined` when it would not change anything.
 *
 * Returning `undefined` for an unchanged list is what stops a re-render
 * republishing. The comparison is ordered, which is the whole point: a list with
 * the same members in a different order *is* a change here, where for stars it
 * was not.
 */
export function openWorkToPublish(
  entries: OpenWorkRef[],
  current: OpenWorkBlob | undefined,
  nowMs: number,
): OpenWorkBlob | undefined {
  const candidate: OpenWorkBlob = { v: 1, updatedAt: nowMs, entries }
  if (current) {
    const same =
      serializeOpenWorkBlob({ ...candidate, updatedAt: 0 }) ===
      serializeOpenWorkBlob({ ...current, updatedAt: 0 })
    if (same) return undefined
  }
  return candidate
}
