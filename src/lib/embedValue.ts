/**
 * The value an `embed` tag carries for a reference, and back — SPEC §13.6.2.
 *
 * An `embed` names what an `a` or `q` would: an address, or a 64-hex event id.
 * A body names it by a `nostr:` reference or by an app link. The reader and
 * the composer both need the two directions, so they live here once. Ship has
 * the same `valueOfReference` (on the Widgets project's Later list to move into
 * `@estiva-app/protocol`).
 */
import { addressToPointer, bech32Decode, convertBits, decodeNevent, encodeNaddr, encodeNevent, pointerToAddress, referenceToPointer } from '@estiva-app/protocol'

const EVENT_ID = /^[0-9a-f]{64}$/

/** The address or event id a `nostr:` reference names — what an `embed` carries for it. Undefined for a person. */
export function valueOfReference(reference: string): string | undefined {
  try {
    if (/^nostr:nevent1/i.test(reference)) return decodeNevent(reference).id.toLowerCase()
    if (/^nostr:naddr1/i.test(reference)) return pointerToAddress(referenceToPointer(reference))
    if (/^nostr:note1/i.test(reference)) {
      const { hrp, data } = bech32Decode(reference.slice('nostr:'.length).toLowerCase())
      const id = convertBits(data, 5, 8, false).map((b) => b.toString(16).padStart(2, '0')).join('')
      return hrp === 'note' && EVENT_ID.test(id) ? id : undefined
    }
  } catch {
    return undefined
  }
  return undefined
}

/** The `nostr:` reference for an `embed` value — how a card for a link is resolved, since the body wrote only the URL. */
export function referenceOfValue(value: string): string | undefined {
  if (EVENT_ID.test(value)) return `nostr:${encodeNevent({ id: value, relays: [] })}`
  try {
    return `nostr:${encodeNaddr(addressToPointer(value))}`
  } catch {
    return undefined
  }
}
