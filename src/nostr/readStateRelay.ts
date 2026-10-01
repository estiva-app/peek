/**
 * The relay half of read state (CRO-4).
 *
 * Split from `readState.ts` so the grammar stays free of the browser: this file
 * reaches `/sign`, `/nip44/*` and the bridge, and importing any of that from a
 * Node script fails on `import.meta.env` before it fails on anything real.
 */
import type { SignedEvent } from '@estiva-app/protocol'
import { KIND } from '@estiva-app/protocol'
import { publishSigned, queryRelay, signViaEstivaId } from './bridge'
import { decryptBlob, encryptBlob } from './appData'
import type { RelaySeam } from './stars'
import {
  type OwnSlotVerdict,
  type ReadStateBlob,
  READ_STATE_D_PREFIX,
  type SlotBlob,
  type SlotIdentity,
  allSlotsFilter,
  buildReadStateEvent,
  classifyOwnSlots,
  mergeSlots,
  parseReadStateBlob,
  serializeReadStateBlob,
} from '@estiva-app/conversation'
import { PEEK_HORIZON_DAYS, readStateSlotFilter } from './readState'

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
  return { reachable: true, blob: parseReadStateBlob(await decryptBlob(newest.content, seam.accessToken)) }
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

/**
 * Every read-state slot this person owns, within the horizon (CRO-5).
 *
 * Each blob is decrypted individually and a failure is **skipped quietly**: the
 * realistic cause is a blob written under a rotated key, and surfacing it would
 * turn "one old installation is unreadable" into an error on a path whose whole
 * job is to be a best-effort hint. A blob that decrypts but does not validate is
 * dropped by `parseReadStateBlob` for the same reason.
 *
 * Returns `undefined` — distinct from an empty list — when the relay could not
 * be asked. The caller needs that apart from "you have read nothing", or a
 * transient failure renders as every conversation being unread.
 */
export async function fetchAllSlots(
  seam: RelaySeam,
  nowMs: number = Date.now(),
  horizonDays: number = PEEK_HORIZON_DAYS,
): Promise<SlotBlob[] | undefined> {
  const { ok, events } = await queryRelay(
    seam.relayUrl,
    [allSlotsFilter(seam.pubkey, nowMs, horizonDays)],
    seam.accessToken,
    seam.pubkey,
  )
  if (!ok) return undefined
  const slots: SlotBlob[] = []
  for (const event of events) {
    const dTag = event.tags.find((t) => t[0] === 'd')?.[1]
    // A read-state slot is exactly the §11.6 shape. Anything else answering this
    // filter is somebody's ordinary kind:30078 that happens to carry the tag.
    if (!dTag?.startsWith(READ_STATE_D_PREFIX)) continue
    const blob = parseReadStateBlob(await decryptBlob(event.content, seam.accessToken))
    if (!blob) continue
    slots.push({ dTag, eventId: event.id, createdAt: event.created_at, blob })
  }
  return slots
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
  const slots = await fetchAllSlots(seam, nowMs, horizonDays ?? PEEK_HORIZON_DAYS)
  if (!slots) return undefined
  return {
    merged: mergeSlots(slots),
    verdict: classifyOwnSlots(slots, identity),
  }
}
