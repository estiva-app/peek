/**
 * The files a person follows, on the relay and owned by them (FOL-30, RFC 0.4 §4.6).
 *
 * **The unread dot exists only for what you follow.** Decided 2026-09-18,
 * replacing topic membership: a followed file's new messages light its row and
 * its team; an unfollowed file's never do, however new they are. Following is a
 * subscription, not a permission tier — everyone in a team can open every file
 * in it, and this list only says which ones the person tracks.
 *
 * ## The same shape as stars, one list over, and a different list
 *
 * RFC 0.4 §4.6 specifies this store for Folders and this widens it to any file:
 * `kind:30078`, NIP-44 encrypted to the person, holding what they follow. It is
 * `stars.ts`'s shape — parameterized-replaceable, whole-blob, last write wins —
 * for the same reasons, and it is deliberately *not* the stars blob (Miky,
 * 2026-09-21): a star is "keep this near", a hand-picked short list that also
 * holds people; a follow is "tell me when this moves", a wide set the defaults
 * fill (what you create, comment in, are mentioned in, are placed on). They
 * differ the first time a person follows something they would never pin.
 * Starring does not imply following.
 *
 * ## Suite-wide, not Peek's
 *
 * `d` is `estiva:followed:v1`, under the suite's client id rather than
 * `estiva-peek:` — renamed from the RFC's `estiva:folders-followed:v1` because
 * it now holds any file, and because the dot is not Peek's alone: Ship marks
 * the same address read, and it will read the same follow set. The `t` tag
 * follows suit, so a reader can still filter by `#t` without fetching every
 * `kind:30078` the person owns.
 *
 * ## What an entry is
 *
 * A **key**: a file's address (`30840:<pubkey>:<d>`, a `30850` project, a
 * `30851` issue), or a Folder's uuid — the one uuid that is its channel id, its
 * `h` and its `d` (`FolderSummary.id`). Following a Folder follows its general
 * stream, the messages in it that name no file; following a file follows that
 * file's stream. These are exactly the two grains the read-state judge already
 * distinguishes (`teamHasUnread`), so the gate is a set lookup per stream.
 *
 * The blob is capped with everything else on this kind at 65,535 bytes of
 * plaintext (`MAX_PLAINTEXT_BYTES`): around eight hundred addresses. A person
 * who follows more than that has a list nobody can read anyway; the writer
 * refuses rather than truncates, as stars does.
 */
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'
import { KIND } from '@estiva-app/protocol'
import { publishSigned, queryRelay, signViaEstivaId } from './bridge'
import { assertNotReadState, decryptBlob, encryptBlob } from './appData'
import type { RelaySeam } from './stars'

/** `estiva:followed:v1` — the suite's client id, SPEC §12.2's `<client_id>:<name>:v<n>`. */
export const FOLLOWS_D_TAG = 'estiva:followed:v1'

/** The single `t` tag, the suite-wide counterpart of Peek's `BLOB_TAG`. */
export const FOLLOWS_BLOB_TAG = 'estiva-appdata'

export interface FollowsBlob {
  /** Schema version. An unknown value is ignored, never guessed at. */
  v: 1
  /** Epoch ms, so a person reading their own export can tell when it was written. */
  updatedAt: number
  /** Followed keys — file addresses and Folder uuids. Sorted on serialize; a set in spirit. */
  keys: string[]
  /**
   * Keys the person unfollowed although the relay implies them — named in a
   * comment, placed on an issue (`impliedFollows.ts`) — each with **when**,
   * epoch ms. An implied follow is computed from the relay on every load, so
   * an unfollow of one has to be written down or it comes back; this is where.
   *
   * A mute covers what came before it and nothing after: being placed on the
   * issue again, or named in it again, after the unfollow is a new call for
   * attention and follows it again (found by FOL-30's test F, 2026-09-22 —
   * an issue unfollowed in one test and self-assigned in the next stayed
   * dark). So the judge compares the implying event's time with the mute's.
   *
   * Absent in a blob written before it existed, and read as empty. A blob
   * written while this was a plain list (peek#284, one day) reads each entry
   * as muted at the blob's own `updatedAt` — the latest it could have been.
   */
  muted: Record<string, number>
}

const EMPTY: FollowsBlob = { v: 1, updatedAt: 0, keys: [], muted: {} }

function mutedMap(raw: unknown, legacyAt: number): Record<string, number> {
  const out: Record<string, number> = {}
  if (Array.isArray(raw)) {
    for (const key of keySet(raw)) out[key] = legacyAt
    return out
  }
  if (typeof raw !== 'object' || raw === null) return out
  for (const [key, at] of Object.entries(raw as Record<string, unknown>)) {
    if (key.length > 0 && typeof at === 'number' && Number.isFinite(at)) out[key] = at
  }
  return out
}

function keySet(raw: unknown): string[] {
  const keys = new Set<string>()
  for (const key of Array.isArray(raw) ? raw : []) {
    if (typeof key === 'string' && key.length > 0) keys.add(key)
  }
  return [...keys]
}

/**
 * Parse a decrypted blob, tolerating everything except a shape it cannot trust
 * — `parseStarsBlob`'s rule. A person whose blob is unreadable follows nothing
 * rather than seeing a broken app, and the next toggle rewrites it. Entries are
 * filtered individually and de-duplicated, so one malformed row costs itself.
 */
export function parseFollowsBlob(plaintext: string | undefined): FollowsBlob {
  if (!plaintext) return EMPTY
  let raw: unknown
  try {
    raw = JSON.parse(plaintext)
  } catch {
    return EMPTY
  }
  if (typeof raw !== 'object' || raw === null) return EMPTY
  const blob = raw as Partial<FollowsBlob>
  if (blob.v !== 1) return EMPTY
  const updatedAt = typeof blob.updatedAt === 'number' && Number.isFinite(blob.updatedAt) ? blob.updatedAt : 0
  return {
    v: 1,
    updatedAt,
    keys: keySet(blob.keys),
    muted: mutedMap(blob.muted, updatedAt),
  }
}

/** Serialize for encryption. Sorted keys, so an unchanged set is an unchanged string. */
export function serializeFollowsBlob(blob: FollowsBlob): string {
  return JSON.stringify({
    v: blob.v,
    updatedAt: blob.updatedAt,
    keys: [...new Set(blob.keys)].sort(),
    muted: Object.fromEntries(Object.entries(blob.muted).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  })
}

/**
 * The unsigned `kind:30078` carrying a follows blob. `d` then `t`, and **no
 * `h` tag** — SPEC §12.2's MUST NOT, for the reason `buildStarsEvent` gives.
 */
export function buildFollowsEvent(pubkey: string, nowMs: number, ciphertext: string): UnsignedEvent {
  assertNotReadState(FOLLOWS_D_TAG)
  return {
    pubkey,
    created_at: Math.floor(nowMs / 1000),
    kind: KIND.APP_DATA,
    tags: [
      ['d', FOLLOWS_D_TAG],
      ['t', FOLLOWS_BLOB_TAG],
    ],
    content: ciphertext,
  }
}

/** The filter that finds this person's follows blob and nothing else. */
export function followsFilter(pubkey: string): Record<string, unknown> {
  return { kinds: [KIND.APP_DATA], authors: [pubkey], '#d': [FOLLOWS_D_TAG] }
}

/**
 * What the relay had to say — the three answers `StarsRead` keeps apart, for
 * the same reason: `absent` is an empty set to render and a coordinate to
 * write; `unreachable` is a publish that must not happen, because last-write-
 * wins would make a set written from a guess permanent. A decrypt failure is
 * `unreachable`: the blob is there, and what failed is this tab's key.
 */
export type FollowsRead =
  | { state: 'unreachable' }
  | { state: 'absent' }
  | { state: 'present'; blob: FollowsBlob }

export async function fetchFollows(seam: RelaySeam): Promise<FollowsRead> {
  const { ok, events } = await queryRelay(
    seam.relayUrl,
    [followsFilter(seam.pubkey)],
    seam.accessToken,
    seam.pubkey,
  )
  if (!ok) return { state: 'unreachable' }
  const newest = events.sort((a, b) => b.created_at - a.created_at)[0]
  if (!newest) return { state: 'absent' }
  const plaintext = await decryptBlob(newest.content, seam.accessToken)
  if (!plaintext) return { state: 'unreachable' }
  const blob = parseFollowsBlob(plaintext)
  // `updatedAt: 0` is the parse floor no real publish produces — `followsToPublish`
  // stamps a clock — so it means "decrypted and said nothing usable": absent.
  if (blob.updatedAt === 0) return { state: 'absent' }
  return { state: 'present', blob }
}

/** Encrypt, sign and publish a follows blob — whole-blob, as `publishStars`. */
export async function publishFollows(
  blob: FollowsBlob,
  seam: RelaySeam,
): Promise<{ ok: boolean; eventId?: string; reason?: string }> {
  const ciphertext = await encryptBlob(serializeFollowsBlob(blob), seam.accessToken)
  const unsigned = buildFollowsEvent(seam.pubkey, blob.updatedAt || Date.now(), ciphertext)
  let signed: SignedEvent
  try {
    signed = await signViaEstivaId(unsigned, seam.accessToken, seam.pubkey)
  } catch (error) {
    return { ok: false, reason: `could not sign kind:${KIND.APP_DATA}: ${(error as Error).message}` }
  }
  const result = await publishSigned(seam.relayUrl, signed, seam.accessToken, seam.pubkey)
  return { ok: result.ok, eventId: result.eventId, reason: result.reason }
}

/**
 * The blob to publish for a set of keys, or `undefined` when it would change
 * nothing. §12.3's concurrency choice is stars': **accept the loss** — last
 * write wins at one-second resolution, and a lost toggle is one click to redo.
 */
export function followsToPublish(
  next: { keys: Iterable<string>; muted: ReadonlyMap<string, number> | Record<string, number> },
  current: FollowsBlob | undefined,
  nowMs: number,
): FollowsBlob | undefined {
  const candidate: FollowsBlob = {
    v: 1,
    updatedAt: nowMs,
    keys: [...new Set(next.keys)],
    muted: next.muted instanceof Map ? Object.fromEntries(next.muted) : { ...(next.muted as Record<string, number>) },
  }
  if (current) {
    const same =
      serializeFollowsBlob({ ...candidate, updatedAt: 0 }) === serializeFollowsBlob({ ...current, updatedAt: 0 })
    if (same) return undefined
  }
  return candidate
}
