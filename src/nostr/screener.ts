/**
 * The two Screener decisions a person authored, on the relay (SHR-10).
 *
 * `screenerItems` had seven fields and five of them were derived — `kind` and
 * `targetId` from the container a message is in, `preview` from the message,
 * `messageId` and `createdAt` from the same message. Only two things in that
 * table were ever *authored*: a snooze ("Later") and a dismissal, which was a
 * row deletion. Those two are all this blob stores, and everything else is
 * recomputed on load by `src/api/internal/screener.tsx`.
 *
 * `estiva-peek:screener:v1` — a SPEC §12 layer-2 store, the same shape of thing
 * `stars.ts` opened and `openWork.ts` made an ordered list of. Everything those
 * headers argue about app-local ids applies unchanged: only Peek reads this
 * blob, so a Peek topic id is a legitimate key rather than a compromise.
 *
 * ## Two maps, and why neither is read state
 *
 * - `snoozed` — container key → the unix second the row may come back. A live
 *   future instant; once it passes, the entry is dead weight and is dropped at
 *   the next write.
 * - `dismissed` — container key → a **watermark**: ignore this conversation up
 *   to this instant. That is precisely what the deletion meant, because later
 *   traffic re-created the row; the semantics are carried over rather than
 *   invented.
 *
 * **This is not NIP-RS and must never be merged into it.** Dismissing a row
 * does not mark the conversation read — the unread dot stays — so a dismissal
 * written into a read-state context id would clear a dot the person never
 * cleared. `assertNotReadState` is called on the `d` tag for that reason, the
 * same guard `openWork.ts` takes.
 *
 * ## The bound, and which map gives way first
 *
 * Unlike open work, this map is **machine-paced**: rows arrive because other
 * people sent messages, so a person who dismisses everything grows `dismissed`
 * without ever deciding to curate a list. So it is SHR-4's `capContextsToBytes`
 * (eviction) rather than `openWork.ts`'s refusal, and the order is fixed:
 *
 *   1. expired snoozes are dropped at write time — a snooze whose instant has
 *      passed has already done its whole job;
 *   2. `snoozed` is budgeted first, `dismissed` takes what is left.
 *
 * That order is asymmetric on purpose, and the asymmetry is the argument.
 * **An evicted dismissal can only make a stale row reappear**, and only for a
 * conversation with no traffic since — the person dismisses it again, which is
 * one click. **An evicted snooze is a live promise broken**: something the
 * person deliberately put off until Thursday comes back now. So the map whose
 * loss is recoverable gives way to the map whose loss is not.
 *
 * Within each map `capContextsToBytes` evicts the smallest value first, which
 * for both maps is the oldest instant — the least recently decided.
 */
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'
import { KIND } from '@estiva-app/protocol'
import { publishSigned, signViaEstivaId } from './bridge'
import { decryptBlobFrom, readFrom, type ReadSource } from './readFrom'
import { BLOB_TAG, MAX_PLAINTEXT_BYTES, assertNotReadState, blobAddress, encryptBlob } from './appData'
import { capContextsToBytes } from '@estiva-app/conversation'
import type { RelaySeam } from './openWork'

/** `estiva-peek:screener:v1` — SPEC §12.2's `<client_id>:<name>:v<n>`. */
export const SCREENER_D_TAG = blobAddress('screener')

/** Container key → unix **seconds**. Seconds, not ms: three bytes an entry
 *  cheaper across a map this one evicts from, and no decision here is finer
 *  grained than a second. */
export type InstantMap = Record<string, number>

export interface ScreenerBlob {
  /** Schema version. An unknown value is ignored, never guessed at. */
  v: 1
  /** Epoch ms, so a person reading their own export can tell when it was written. */
  updatedAt: number
  /** Container key → the second a snoozed row may return. */
  snoozed: InstantMap
  /** Container key → the watermark below which traffic is ignored. */
  dismissed: InstantMap
}

const EMPTY: ScreenerBlob = { v: 1, updatedAt: 0, snoozed: {}, dismissed: {} }

/**
 * The key for a container. Deliberately the same two prefixes `openWorkKey`
 * uses, because the PEE-6 de-duplication is an intersection of the two key
 * sets and a second spelling would make that comparison silently empty.
 */
export function screenerKey(kind: 'topic' | 'dm' | 'file', targetId: string): string {
  if (kind === 'file') return `file:${targetId}`
  return kind === 'dm' ? `dm:${targetId}` : `topic:${targetId}`
}

const toSeconds = (ms: number): number => Math.floor(ms / 1000)

/** Parse one map, dropping anything that is not a finite positive instant. */
function parseMap(raw: unknown): InstantMap {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const out: InstantMap = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key) continue
    // Not `> 0` for the sake of it: a zero or a negative would compare as "long
    // ago" against every message and silently dismiss a whole conversation for
    // ever, which is the one way a malformed entry here could lose data.
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue
    out[key] = Math.floor(value)
  }
  return out
}

/**
 * Parse a decrypted blob, tolerating everything except a shape it cannot trust.
 *
 * `parseOpenWorkBlob`'s rule: anything that will not parse costs the state it
 * held, never the read that asked for it, and entries are filtered individually
 * so one malformed pair does not discard the rest.
 */
export function parseScreenerBlob(plaintext: string | undefined): ScreenerBlob {
  if (!plaintext) return EMPTY
  let raw: unknown
  try {
    raw = JSON.parse(plaintext)
  } catch {
    return EMPTY
  }
  if (typeof raw !== 'object' || raw === null) return EMPTY
  const blob = raw as Partial<ScreenerBlob>
  // An unknown version is ignored rather than coerced — reading a v2 blob with
  // v1 rules would drop whatever v2 added, a third decision say.
  if (blob.v !== 1) return EMPTY
  return {
    v: 1,
    updatedAt: typeof blob.updatedAt === 'number' && Number.isFinite(blob.updatedAt) ? blob.updatedAt : 0,
    snoozed: parseMap(blob.snoozed),
    dismissed: parseMap(blob.dismissed),
  }
}

/** Serialize for encryption. Stable key order, so an unchanged blob compares equal. */
export function serializeScreenerBlob(blob: ScreenerBlob): string {
  const sorted = (map: InstantMap): InstantMap => {
    const out: InstantMap = {}
    for (const key of Object.keys(map).sort()) out[key] = map[key]
    return out
  }
  return JSON.stringify({
    v: blob.v,
    updatedAt: blob.updatedAt,
    snoozed: sorted(blob.snoozed),
    dismissed: sorted(blob.dismissed),
  })
}

/**
 * Everything `serializeScreenerBlob` writes that is not one of the two maps:
 * `{"v":1,"updatedAt":<ms>,"snoozed":,"dismissed":}` with both braces counted
 * by `capContextsToBytes` itself. Computed rather than written as a number so
 * it cannot drift from the serializer — the accounting bug this whole cap
 * exists to avoid is one where the budget and the writer disagree.
 */
function envelopeBytes(updatedAt: number): number {
  return new TextEncoder().encode(serializeScreenerBlob({ v: 1, updatedAt, snoozed: {}, dismissed: {} })).length - 4
}

export interface CappedScreener {
  blob: ScreenerBlob
  /** Keys dropped, for the log line. Never silent: an evicted snooze is a broken promise. */
  evictedSnoozed: string[]
  evictedDismissed: string[]
}

/**
 * Drop expired snoozes, then fit both maps inside the plaintext ceiling.
 *
 * `nowMs` is a parameter rather than `Date.now()` because this runs inside the
 * publish path a React effect drives: a clock read there is impure under the
 * React Compiler's rules, and it also makes the eviction untestable.
 */
export function capScreenerBlob(
  blob: ScreenerBlob,
  nowMs: number,
  budget: number = MAX_PLAINTEXT_BYTES,
): CappedScreener {
  const nowSec = toSeconds(nowMs)
  const live: InstantMap = {}
  for (const [key, until] of Object.entries(blob.snoozed)) {
    // An elapsed snooze has done its whole job; keeping it costs bytes that a
    // live one may need. This is the only place entries leave without eviction.
    if (until > nowSec) live[key] = until
  }

  const available = budget - envelopeBytes(blob.updatedAt)
  // Snoozed first — see the header. Whatever it does not spend, `dismissed`
  // gets, so the common case (few snoozes, many dismissals) still fills the blob.
  const snoozedFit = capContextsToBytes(live, available)
  const dismissedFit = capContextsToBytes(blob.dismissed, available - snoozedFit.bytes + 2)
  return {
    blob: { v: 1, updatedAt: blob.updatedAt, snoozed: snoozedFit.contexts, dismissed: dismissedFit.contexts },
    evictedSnoozed: snoozedFit.evicted,
    evictedDismissed: dismissedFit.evicted,
  }
}

/**
 * The unsigned `kind:30078` carrying a screener blob.
 *
 * **No `h` tag** — SPEC §12.2 makes that a MUST NOT, and the relay's read path
 * treats an explicit `h` as authoritative even though its write path classifies
 * the kind global-only.
 */
export function buildScreenerEvent(pubkey: string, nowMs: number, ciphertext: string): UnsignedEvent {
  assertNotReadState(SCREENER_D_TAG)
  return {
    pubkey,
    created_at: Math.floor(nowMs / 1000),
    kind: KIND.APP_DATA,
    tags: [
      ['d', SCREENER_D_TAG],
      ['t', BLOB_TAG],
    ],
    content: ciphertext,
  }
}

/** The filter that finds this person's screener blob and nothing else. */
export function screenerFilter(pubkey: string): Record<string, unknown> {
  return { kinds: [KIND.APP_DATA], authors: [pubkey], '#d': [SCREENER_D_TAG] }
}

/**
 * What the relay had to say about this person's screener decisions.
 *
 * The three answers `OpenWorkRead` keeps apart, for the same reason and with
 * one extra consequence here: `unknown` must not render either. A Screener
 * drawn before the blob arrives shows rows the person has already dismissed,
 * and dismissing them again is the one action that writes the wrong thing.
 */
export type ScreenerRead =
  | { state: 'unreachable' }
  | { state: 'absent' }
  | { state: 'present'; blob: ScreenerBlob }

export async function fetchScreener(seam: RelaySeam, source: ReadSource = 'relay'): Promise<ScreenerRead> {
  const { ok, events } = await readFrom(source, seam.relayUrl, [screenerFilter(seam.pubkey)], seam.accessToken, seam.pubkey)
  if (!ok) return { state: 'unreachable' }
  const newest = events.sort((a, b) => b.created_at - a.created_at)[0]
  if (!newest) return { state: 'absent' }
  const plaintext = await decryptBlobFrom(source, newest.content, seam.accessToken)
  // A decrypt failure is `unreachable`, never `absent`: the blob is intact as
  // far as anyone can tell and the thing that failed is this tab's key, so
  // republishing over it is the one move that could destroy it.
  if (!plaintext) return { state: 'unreachable' }
  const blob = parseScreenerBlob(plaintext)
  // `updatedAt: 0` is the floor no real publish can produce, because
  // `screenerToPublish` always stamps a clock. So a zero means the blob
  // decrypted and said nothing usable, which is `absent`.
  if (blob.updatedAt === 0) return { state: 'absent' }
  return { state: 'present', blob }
}

/** Encrypt, sign and publish. An over-cap blob has already been evicted down by
 *  `capScreenerBlob`, so `encryptBlob` throwing here is a real surprise. */
export async function publishScreener(
  blob: ScreenerBlob,
  seam: RelaySeam,
): Promise<{ ok: boolean; eventId?: string; reason?: string }> {
  let ciphertext: string
  try {
    ciphertext = await encryptBlob(serializeScreenerBlob(blob), seam.accessToken)
  } catch (error) {
    return { ok: false, reason: `could not encrypt screener decisions: ${(error as Error).message}` }
  }
  const unsigned = buildScreenerEvent(seam.pubkey, blob.updatedAt || Date.now(), ciphertext)
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
 * The blob to publish, or `undefined` when it would not change anything.
 *
 * Returning `undefined` for an unchanged blob is what stops a re-render
 * republishing. The comparison runs **after** capping, so a publish the cap
 * would reduce to what the relay already holds is correctly skipped.
 *
 * A snooze passing its instant *does* change the blob, so it costs exactly one
 * write — on the first load after it expires, after which the comparison is
 * stable again. That write is the point: it is what keeps the map from growing
 * on dead entries, and it is one publish per expiry rather than per load.
 */
export function screenerToPublish(
  next: { snoozed: InstantMap; dismissed: InstantMap },
  current: ScreenerBlob | undefined,
  nowMs: number,
): { blob: ScreenerBlob; evictedSnoozed: string[]; evictedDismissed: string[] } | undefined {
  const capped = capScreenerBlob({ v: 1, updatedAt: nowMs, ...next }, nowMs)
  if (current) {
    const same =
      serializeScreenerBlob({ ...capped.blob, updatedAt: 0 }) === serializeScreenerBlob({ ...current, updatedAt: 0 })
    if (same) return undefined
  }
  return { blob: capped.blob, evictedSnoozed: capped.evictedSnoozed, evictedDismissed: capped.evictedDismissed }
}
