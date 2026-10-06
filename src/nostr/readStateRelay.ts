/**
 * The relay half of read state (CRO-4): Peek's bridge, `/sign` and `/nip44/*`
 * plugged into `@estiva-app/conversation`'s grammar. Kept apart from
 * `readState.ts` because importing the bridge from a Node script fails on
 * `import.meta.env` before it fails on anything real.
 */
import type { SignedEvent } from '@estiva-app/protocol'
import { KIND } from '@estiva-app/protocol'
import { publishSigned, queryRelay, signViaEstivaId } from './bridge'
import { decryptBlob, decryptBlobUnlessRefused, encryptBlob } from './appData'
import type { RelaySeam } from './stars'
import {
  type OwnSlotVerdict,
  type QueryFn,
  type ReadStateBlob,
  type SlotCache,
  type SlotIdentity,
  buildReadStateEvent,
  classifyOwnSlots,
  createSlotCache,
  fetchReadState,
  parseReadStateBlob,
  readStateDTag,
  serializeReadStateBlob,
} from '@estiva-app/conversation'
import { PEEK_HORIZON_DAYS, readStateSlotFilter } from './readState'

/**
 * What every slot last decrypted to, for the life of the tab (Peek 23130326).
 * Without it each 30 s refresh decrypted every slot again — 314 calls a
 * minute for an identity with 141 slots, against a limit of 120 — and each
 * refused slot dropped its markers from the merge. Resets on a new pubkey.
 */
let slotCache: SlotCache = createSlotCache()

/** Test seam: forget every decrypted slot. */
export function resetSlotCacheForTests(): void {
  slotCache = createSlotCache()
}

/** What the relay could tell us about one slot. */
export interface OwnSlotResult {
  /** False only when the relay could not be asked at all. */
  reachable: boolean
  /** The blob at this coordinate. Absent when the coordinate is genuinely empty. */
  blob?: ReadStateBlob
}

/**
 * Read this installation's own slot back off the relay.
 *
 * Distinct from CRO-5's merge, and needed before the first publish for a reason
 * that is easy to miss: the blob is a **replaceable snapshot, not a delta**.
 * Publishing without hydrating first would replace the coordinate with whatever
 * this session happens to have seen, silently dropping every context recorded
 * before it — and because the merge across slots is grow-only, the loss is
 * invisible until this is the only slot left.
 *
 * **`reachable` is separate from `blob` on purpose.** An empty coordinate and an
 * unreachable relay are the same absence and must not be the same answer: the
 * caller refuses to publish when it cannot find out, so collapsing them means a
 * brand-new installation — whose coordinate is legitimately empty — never
 * publishes at all, and never says why.
 */
export async function fetchOwnSlot(seam: RelaySeam, slotId: string): Promise<OwnSlotResult> {
  const { ok, events } = await queryRelay(
    seam.relayUrl,
    [readStateSlotFilter(seam.pubkey, slotId)],
    seam.accessToken,
    seam.pubkey,
  )
  if (!ok) return { reachable: false }
  const newest = events.sort((a, b) => b.created_at - a.created_at)[0]
  if (!newest) return { reachable: true }
  // The same ciphertext the merge already decrypted is the same blob.
  const cached = slotCache.pubkey === seam.pubkey ? slotCache.slots.get(readStateDTag(slotId)) : undefined
  if (cached?.content === newest.content) return { reachable: true, blob: cached.slot.blob }
  // A coordinate that holds a blob we cannot read (typically a 429 from
  // `/nip44/decrypt`) is not an empty one: answering "empty" would let the next
  // publish replace every marker in it with this session's few.
  const blob = parseReadStateBlob(await decryptBlob(newest.content, seam.accessToken))
  return blob ? { reachable: true, blob } : { reachable: false }
}

/** Encrypt, sign and publish one slot's blob. */
export async function publishReadState(
  blob: ReadStateBlob,
  slotId: string,
  seam: RelaySeam,
  nowMs: number = Date.now(),
): Promise<{ ok: boolean; eventId?: string; reason?: string }> {
  const ciphertext = await encryptBlob(serializeReadStateBlob(blob), seam.accessToken)
  const unsigned = buildReadStateEvent(seam.pubkey, nowMs, slotId, ciphertext)
  let signed: SignedEvent
  try {
    signed = await signViaEstivaId(unsigned, seam.accessToken, seam.pubkey)
  } catch (error) {
    return { ok: false, reason: `could not sign kind:${KIND.APP_DATA}: ${(error as Error).message}` }
  }
  const result = await publishSigned(seam.relayUrl, signed, seam.accessToken, seam.pubkey)
  return { ok: result.ok, eventId: result.eventId, reason: result.reason }
}

/** Everything the read path needs: the frontier, and what the slots say about us. */
export interface MergedReadState {
  /** context id → unix seconds, maximum across every slot (CRO-5). */
  merged: Record<string, number>
  verdict: OwnSlotVerdict
}

/**
 * Fetch every slot, merge them, and say what they imply about our own.
 *
 * Read-only and idempotent — re-running it changes nothing on the relay and
 * nothing locally. Acting on `verdict` is the caller's, deliberately: rotating a
 * slot and deleting a duplicate are writes, and a read path that quietly
 * performed them would make the merge unsafe to repeat.
 *
 * `undefined` means the relay could not be asked, which the caller must keep
 * apart from "you have read nothing" — collapsing them renders every
 * conversation unread on a transient failure.
 */
export async function loadMergedReadState(
  seam: RelaySeam,
  identity: SlotIdentity,
  nowMs: number = Date.now(),
  horizonDays?: number,
): Promise<MergedReadState | undefined> {
  // The package reads, decrypts only the slots that changed, one at a time
  // (`/nip44/decrypt` answers a burst with 429), and merges; Peek supplies the
  // relay, the decrypt seam and the cache.
  const query: QueryFn = async (filters) => {
    const { ok, events } = await queryRelay(seam.relayUrl, filters, seam.accessToken, seam.pubkey)
    if (!ok) throw new Error('relay unreachable')
    return events
  }
  const decrypt = (ciphertext: string) => decryptBlobUnlessRefused(ciphertext, seam.accessToken)
  const state = await fetchReadState(query, seam.pubkey, { decrypt }, identity, nowMs, horizonDays ?? PEEK_HORIZON_DAYS, slotCache)
  if (!state.reachable) return undefined
  return { merged: state.merged, verdict: classifyOwnSlots(state.slots, identity) }
}
