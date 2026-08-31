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
  type ReadStateBlob,
  buildReadStateEvent,
  parseReadStateBlob,
  readStateSlotFilter,
  serializeReadStateBlob,
} from './readState'

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
 * `undefined` means "could not find out", which the caller must not treat as an
 * empty blob for exactly that reason.
 */
export async function fetchOwnSlot(
  seam: RelaySeam,
  slotId: string,
): Promise<ReadStateBlob | undefined> {
  const { ok, events } = await queryRelay(
    seam.relayUrl,
    [readStateSlotFilter(seam.pubkey, slotId)],
    seam.accessToken,
    seam.pubkey,
  )
  if (!ok) return undefined
  const newest = events.sort((a, b) => b.created_at - a.created_at)[0]
  if (!newest) return undefined
  return parseReadStateBlob(await decryptBlob(newest.content, seam.accessToken))
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
