/**
 * The value an `embed` tag carries for a reference, and back — SPEC §13.6.2.
 *
 * An `embed` names what an `a` or `q` would: an address, or a 64-hex event id.
 * A body names it by a `nostr:` reference or by an app link. One direction is
 * the package's since protocol 0.38 (`valueOfReference`, the one Ship reads
 * too); the way back, for a card whose body wrote only a URL, stays here.
 */
import { addressToPointer, encodeNaddr, encodeNevent } from '@estiva-app/protocol'

export { valueOfReference } from '@estiva-app/protocol'

const EVENT_ID = /^[0-9a-f]{64}$/

/** The `nostr:` reference for an `embed` value — how a card for a link is resolved, since the body wrote only the URL. */
export function referenceOfValue(value: string): string | undefined {
  if (EVENT_ID.test(value)) return `nostr:${encodeNevent({ id: value, relays: [] })}`
  try {
    return `nostr:${encodeNaddr(addressToPointer(value))}`
  } catch {
    return undefined
  }
}
