/**
 * Starred containers, on the relay and owned by the person (CRO-11).
 *
 * The first real case of SPEC §12: app-private, user-owned storage on
 * `kind:30078`. Before this, a person's stars lived only in a Convex deployment
 * they could not read, export or take with them — a relay-wide export by author
 * did not include them and NIP-09 could not delete them. "You own your data"
 * held for content and quietly failed here.
 *
 * ## Why layer 2 and not a standard kind
 *
 * CRO-11 preferred a NIP-51 set, and that would have been layer 1 — readable by
 * any Nostr client. Three things decided against it, and the first is the one
 * that would have failed at the last step:
 *
 * 1. **Peek cannot sign it.** Its Estiva ID ceiling is
 *    `[9, 7, 5, 9007, 27235, 1851, 9101, 9002, 9008, 1111, 30078, 41010, 41011,
 *    41012, 22242]`. `30078` is granted (CRO-2); `30000` and `30003` are not.
 *    Adding them is a seed line, a production re-seed and a deploy — and the
 *    seed's own comments record three separate features that shipped, worked
 *    everywhere they were checked, and failed at `/sign` because a ceiling
 *    arrived after the code.
 * 2. **It needs two kinds, not one.** NIP-51 bookmark sets (`30003`) carry
 *    `e`/`a`/`t`/`r`; starred *people* are a follow set (`30000`) with `p` tags.
 * 3. **Neither half has a portable identifier today.** `personKey` is
 *    `seedKey ?? _id`, `users.nostrPubkey` is optional, and
 *    `topics.channelUuid` is optional. A standard kind full of Convex ids is a
 *    standard kind nobody else can read anyway.
 *
 * And §12.1's own two-question test, applied honestly, gives layer 2: no other
 * app has asked to see Peek's stars, so question 1 is no; the person should own
 * and export them, so question 2 is yes.
 *
 * **The portability problem dissolves at layer 2.** Only Peek reads this blob,
 * so app-local ids are legitimate rather than a compromise. What the person
 * gains is real — the state is on the relay, exportable by author, deletable by
 * them, and it survives Peek's database. What they do not gain is a third party
 * being able to interpret it, which is exactly the trade §12.1 describes.
 *
 * ## The portable identity travels anyway
 *
 * Each entry carries the app-local id *and* the relay identity when one exists —
 * a channel uuid for a topic, a pubkey for a person. Neither is needed to render
 * a star. They are here so that promoting this to a NIP-51 set later is a
 * re-publish rather than a second migration, and so an exported blob means
 * something to a reader who is not Peek.
 */
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'
import { KIND } from '@estiva-app/protocol'
import { publishSigned, queryRelay, signViaEstivaId } from './bridge'
import { BLOB_TAG, assertNotReadState, blobAddress, decryptBlob, encryptBlob } from './appData'

/** `estiva-peek:stars:v1` — SPEC §12.2's `<client_id>:<name>:v<n>`. */
export const STARS_D_TAG = blobAddress('stars')

export interface StarredTopicRef {
  /** Peek's own topic id — a `seedKey` or a Convex id. What renders the star. */
  id: string
  /** The relay identity, when the topic has a channel. Optional by schema. */
  channelUuid?: string
}

export interface StarredPersonRef {
  /** Peek's person key — a `seedKey` or a Convex id. */
  key: string
  /** The relay identity, when one has been minted. Optional by schema. */
  pubkey?: string
}

export interface StarsBlob {
  /** Schema version. An unknown value is ignored, never guessed at. */
  v: 1
  /** Epoch ms, so a person reading their own export can tell when it was written. */
  updatedAt: number
  topics: StarredTopicRef[]
  people: StarredPersonRef[]
}

const EMPTY: StarsBlob = { v: 1, updatedAt: 0, topics: [], people: [] }

/**
 * Parse a decrypted blob, tolerating everything except a shape it cannot trust.
 *
 * Follows `parseProfile`'s rule: anything that will not parse costs the state it
 * held, never the read that asked for it. A person whose blob is unreadable sees
 * no stars rather than a broken app, and the next toggle rewrites it.
 *
 * Entries are filtered individually, so one malformed row does not discard the
 * rest — the same choice NIP-RS makes for a context entry with a bad timestamp.
 */
export function parseStarsBlob(plaintext: string | undefined): StarsBlob {
  if (!plaintext) return EMPTY
  let raw: unknown
  try {
    raw = JSON.parse(plaintext)
  } catch {
    return EMPTY
  }
  if (typeof raw !== 'object' || raw === null) return EMPTY
  const blob = raw as Partial<StarsBlob>
  // An unknown version is ignored rather than coerced. Reading a v2 blob with v1
  // rules would silently drop whatever v2 added.
  if (blob.v !== 1) return EMPTY

  const str = (value: unknown): string | undefined =>
    typeof value === 'string' && value.length > 0 ? value : undefined

  return {
    v: 1,
    updatedAt: typeof blob.updatedAt === 'number' && Number.isFinite(blob.updatedAt) ? blob.updatedAt : 0,
    topics: (Array.isArray(blob.topics) ? blob.topics : [])
      .map((t) => {
        const entry = t as Partial<StarredTopicRef>
        const id = str(entry?.id)
        return id ? { id, ...(str(entry.channelUuid) ? { channelUuid: entry.channelUuid! } : {}) } : undefined
      })
      .filter((t): t is StarredTopicRef => t !== undefined),
    people: (Array.isArray(blob.people) ? blob.people : [])
      .map((p) => {
        const entry = p as Partial<StarredPersonRef>
        const key = str(entry?.key)
        return key ? { key, ...(str(entry.pubkey) ? { pubkey: entry.pubkey! } : {}) } : undefined
      })
      .filter((p): p is StarredPersonRef => p !== undefined),
  }
}

/** Serialize for encryption. Stable key order, so an unchanged set is an unchanged string. */
export function serializeStarsBlob(blob: StarsBlob): string {
  const byTopic = (a: StarredTopicRef, b: StarredTopicRef) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const byPerson = (a: StarredPersonRef, b: StarredPersonRef) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  return JSON.stringify({
    v: blob.v,
    updatedAt: blob.updatedAt,
    topics: [...blob.topics].sort(byTopic),
    people: [...blob.people].sort(byPerson),
  })
}

/**
 * The unsigned `kind:30078` carrying a stars blob.
 *
 * Tag order is `d` then `t`. This kind is not one the relay's id preimage cares
 * about beyond the usual NIP-01 rule, but a fixed order means an unchanged set
 * produces an unchanged event, which is what makes the "nothing to publish"
 * check below cheap and honest.
 *
 * **No `h` tag** — SPEC §12.2 makes that a MUST NOT. The relay classifies the
 * kind global-only on write, but its read path treats an explicit `h` as
 * authoritative, so a stray one would not scope the event and *would* make it
 * answer `#h` queries.
 */
export function buildStarsEvent(pubkey: string, nowMs: number, ciphertext: string): UnsignedEvent {
  assertNotReadState(STARS_D_TAG)
  return {
    pubkey,
    created_at: Math.floor(nowMs / 1000),
    kind: KIND.APP_DATA,
    tags: [
      ['d', STARS_D_TAG],
      ['t', BLOB_TAG],
    ],
    content: ciphertext,
  }
}

/** The filter that finds this person's stars blob and nothing else. */
export function starsFilter(pubkey: string): Record<string, unknown> {
  return { kinds: [KIND.APP_DATA], authors: [pubkey], '#d': [STARS_D_TAG] }
}

export interface RelaySeam {
  relayUrl: string
  accessToken: string
  pubkey: string
}

/**
 * What the relay had to say about this person's stars.
 *
 * Three answers, and the caller needs all three kept apart. That mattered
 * mildly while Convex was the set and this was its backup; it decides the
 * behaviour now that the blob *is* the set (SHR-6), because "you have no
 * stars" and "we could not find out" have opposite consequences — the first is
 * an empty set to render and a coordinate to seed, the second is a publish
 * that must not happen, since last-write-wins would make a set written from a
 * guess permanent.
 *
 * `absent` therefore covers one case beyond "no event": an event that is there
 * and carries nothing this version can read. There is no usable set either
 * way, and the caller's fallback rewrites it from Convex, which still holds
 * every star (`desk.toggleStar` writes both). Reporting it as an empty
 * `present` would instead render the person's stars as gone and then publish
 * that.
 *
 * A *decrypt* failure is `unreachable`, not `absent`: the blob is there and
 * intact as far as anyone can tell, and the thing that failed is this tab's
 * key. Republishing over it is the one move that could destroy something.
 */
export type StarsRead =
  | { state: 'unreachable' }
  | { state: 'absent' }
  | { state: 'present'; blob: StarsBlob }

export async function fetchStars(seam: RelaySeam): Promise<StarsRead> {
  const { ok, events } = await queryRelay(
    seam.relayUrl,
    [starsFilter(seam.pubkey)],
    seam.accessToken,
    seam.pubkey,
  )
  if (!ok) return { state: 'unreachable' }
  // Parameterized-replaceable, so the relay serves at most one per coordinate.
  // Newest wins if a relay ever hands back more.
  const newest = events.sort((a, b) => b.created_at - a.created_at)[0]
  if (!newest) return { state: 'absent' }
  const plaintext = await decryptBlob(newest.content, seam.accessToken)
  if (!plaintext) return { state: 'unreachable' }
  const blob = parseStarsBlob(plaintext)
  // `parseStarsBlob` never throws and never reports: bad JSON, a `v` it does
  // not know, or a non-object all land on the same floor, and `updatedAt: 0`
  // is the part of that floor no real publish can produce — `starsToPublish`
  // stamps a clock. So a zero here means the blob decrypted and said nothing
  // usable, which is `absent`. Pinned by a test, because it is an invariant
  // between two functions rather than a property of either.
  if (blob.updatedAt === 0) return { state: 'absent' }
  return { state: 'present', blob }
}

/**
 * Encrypt, sign and publish a stars blob.
 *
 * Whole-blob write: §12.3's parameterized-replaceable semantics mean the
 * coordinate is replaced, so a hundred stars are rewritten to add one. That is
 * the accepted cost of layer 2, and the reason this is stars rather than a table.
 */
export async function publishStars(
  blob: StarsBlob,
  seam: RelaySeam,
): Promise<{ ok: boolean; eventId?: string; reason?: string }> {
  const ciphertext = await encryptBlob(serializeStarsBlob(blob), seam.accessToken)
  const unsigned = buildStarsEvent(seam.pubkey, blob.updatedAt || Date.now(), ciphertext)
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
 * The blob to publish for a set of stars, or `undefined` when it would not change
 * anything.
 *
 * §12.3 requires an app to declare its concurrency choice, and Peek's is
 * **accept the loss**: last write wins at one-second resolution, so two tabs
 * toggling in the same second can lose one. The cost is one star, recoverable by
 * clicking again — unlike a read marker, whose loss is invisible, which is why
 * NIP-RS pays for per-installation slots and this does not.
 *
 * Returning `undefined` for an unchanged set is what stops a re-render
 * republishing, and it is why `serializeStarsBlob` sorts.
 */
export function starsToPublish(
  next: Omit<StarsBlob, 'v' | 'updatedAt'>,
  current: StarsBlob | undefined,
  nowMs: number,
): StarsBlob | undefined {
  const candidate: StarsBlob = { v: 1, updatedAt: nowMs, topics: next.topics, people: next.people }
  if (current) {
    const same =
      serializeStarsBlob({ ...candidate, updatedAt: 0 }) ===
      serializeStarsBlob({ ...current, updatedAt: 0 })
    if (same) return undefined
  }
  return candidate
}
