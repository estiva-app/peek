import { describe, expect, it } from 'vitest'
import {
  addressToPointer,
  encodeNaddr,
  encodeNpub,
  pointerToAddress,
  referenceToPointer,
} from '@estiva-app/protocol'
import { mentionedPubkeys } from './refs'

const POINTER = {
  identifier: 'fee-1',
  pubkey: 'a8a7d739dda599143ec2e88a1c3b2d69808cd2a50001179c786f51d00dc3c697',
  kind: 30851,
  relays: [],
}

describe('a reference in either notation', () => {
  /**
   * The bug this pins (FEE-2): a message composed in Peek carries
   * `nostr:naddr1…` in its body, and the *same message* read back off the relay
   * carries the same reference as an `a` tag — a plain address. Accepting only
   * the first made a widget vanish the moment its message round-tripped.
   */
  it('resolves an naddr and its address to the same object', () => {
    const naddr = encodeNaddr(POINTER)
    const address = pointerToAddress(POINTER)
    expect(pointerToAddress(referenceToPointer(naddr))).toBe(address)
    expect(pointerToAddress(referenceToPointer(address))).toBe(address)
  })

  it('accepts the nostr: scheme on either form', () => {
    const address = pointerToAddress(POINTER)
    expect(referenceToPointer(`nostr:${address}`).identifier).toBe('fee-1')
    expect(referenceToPointer(`nostr:${encodeNaddr(POINTER)}`).identifier).toBe('fee-1')
  })

  /** `d` identifiers are free-form, and Ship's are not guaranteed colon-free. */
  it('keeps colons inside the identifier', () => {
    const pointer = addressToPointer(`30851:${POINTER.pubkey}:project:fee:1`)
    expect(pointer.identifier).toBe('project:fee:1')
    expect(pointer.kind).toBe(30851)
  })

  /**
   * An address has nowhere to put relay hints, so a round trip through one
   * loses them. Stated here so nobody later "fixes" the encoder to match.
   */
  it('loses relay hints that only naddr can carry', () => {
    const withRelay = { ...POINTER, relays: ['wss://estiva.estiva.app'] }
    expect(referenceToPointer(encodeNaddr(withRelay)).relays).toEqual(['wss://estiva.estiva.app'])
    expect(referenceToPointer(pointerToAddress(withRelay)).relays).toEqual([])
  })

  it('refuses things that are neither', () => {
    expect(() => referenceToPointer('just some text')).toThrow()
    expect(() => referenceToPointer('30851:not-a-pubkey:fee-1')).toThrow()
    expect(() => referenceToPointer('')).toThrow()
  })
})

describe('who a body mentions (RIC-2)', () => {
  const ADA = 'a'.repeat(64)
  const GRACE = 'b'.repeat(64)

  it('reads each nostr:npub once, as a hex key, in order of first appearance', () => {
    const body = `nostr:${encodeNpub(GRACE)} and nostr:${encodeNpub(ADA)}, then nostr:${encodeNpub(GRACE)} again`
    expect(mentionedPubkeys(body)).toEqual([GRACE, ADA])
  })

  it('does not tag an object reference, a display-name mention, or prose', () => {
    // An naddr goes to `about`; `@Ada` names nobody the wire can identify.
    expect(mentionedPubkeys(`see nostr:${encodeNaddr(POINTER)} and @Ada Lovelace`)).toEqual([])
    expect(mentionedPubkeys('nothing here')).toEqual([])
  })

  it('treats a malformed key as prose rather than refusing the message', () => {
    expect(mentionedPubkeys('nostr:npub1notarealkey')).toEqual([])
  })
})
