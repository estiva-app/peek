/**
 * A read from the relay, or the same read from the copy on the device (PEE-2).
 *
 * Its own module rather than a `bridge` export so that a test which stands in
 * for `queryRelay` stands in for the relay half of this too.
 */
import type { SignedEvent } from '@estiva-app/protocol'
import { queryRelay } from './bridge'
import { decryptBlob } from './appData'
import { plaintextFromCopy, readFromCopy } from './deviceCopy'

/**
 * Where a read is answered from: the relay, the copy on the device, or the
 * relay for a read Desk loads before it is asked for — over the socket only,
 * after every click (`ahead`, PEE-5).
 */
export type ReadSource = 'relay' | 'copy' | 'ahead'

/**
 * {@link queryRelay}, or the same filters against the copy on the device. A
 * copy that has never seen the relay answer them is a failed read — the
 * caller waits for the relay, exactly as before there was a copy.
 */
export async function readFrom(
  source: ReadSource,
  relayUrl: string,
  filters: Record<string, unknown>[],
  token: string,
  pubkey?: string,
): Promise<{ ok: boolean; events: SignedEvent[]; reason?: string }> {
  if (source === 'relay') return queryRelay(relayUrl, filters, token, pubkey)
  if (source === 'ahead') return queryRelay(relayUrl, filters, token, pubkey, 'ahead')
  const events = await readFromCopy(relayUrl, filters, pubkey)
  return events ? { ok: true, events } : { ok: false, events: [], reason: 'not in the copy on this device' }
}

/**
 * `decryptBlob` for a read from the relay; for one from the copy, only the
 * plaintext the copy kept — a copy is there to draw before any round trip, so
 * it never asks for one.
 */
export async function decryptBlobFrom(source: ReadSource, ciphertext: string, token: string): Promise<string | undefined> {
  return source === 'copy' ? plaintextFromCopy(ciphertext) : decryptBlob(ciphertext, token)
}
