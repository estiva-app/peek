/**
 * A message is an event, not an address — RIC-11.
 *
 * `resolveObjectAsViewer` took every reference to `resolveForeignObject`, which
 * decodes an `naddr` or a bare address and throws on anything else. A mention
 * of a message reached it as `nostr:nevent…`, threw, and drew as its own
 * shortened URI. PRO-11 built `resolveForeignEvent` for exactly this and nothing
 * called it; this is the dispatch, and the read of the relay's signing key a
 * topic's address needs.
 */
import { describe, expect, it, vi } from 'vitest'

const { queryRelay } = vi.hoisted(() => ({ queryRelay: vi.fn() }))
vi.mock('./bridge', () => ({ queryRelay, publishSigned: vi.fn(), signViaEstivaId: vi.fn() }))

import { encodeNevent } from '@estiva-app/protocol'
import { isEventReference, relaySigningKeyAsViewer, resolveObjectAsViewer } from './foreign'

const RELAY = 'f3a38fa6c6a1e5d2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7081920'
const VIEWER = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const EVENT = 'c'.repeat(64)
const token = { accessToken: 't', pubkey: VIEWER } as never

describe('isEventReference', () => {
  it('recognises the two event forms and a bare id', () => {
    expect(isEventReference(`nostr:${encodeNevent({ id: EVENT, relays: [] })}`)).toBe(true)
    expect(isEventReference('nostr:note1abc')).toBe(true)
    expect(isEventReference(EVENT)).toBe(true)
  })

  it('leaves addresses and keys to the resolver they already have', () => {
    expect(isEventReference('nostr:naddr1abc')).toBe(false)
    expect(isEventReference(`39000:${RELAY}:uuid`)).toBe(false)
    expect(isEventReference('nostr:npub1abc')).toBe(false)
  })
})

describe('resolveObjectAsViewer, handed a message', () => {
  it('fetches the event by id rather than throwing on its form', async () => {
    queryRelay.mockClear()
    // Nothing on the relay: the answer is null, and the point is which
    // question was asked on the way there.
    queryRelay.mockResolvedValue({ ok: true, events: [] })
    const result = await resolveObjectAsViewer(`nostr:${encodeNevent({ id: EVENT, relays: [], kind: 9 })}`, 'https://relay.test', token)
    expect(result).toBeNull()
    expect(queryRelay).toHaveBeenCalledWith('https://relay.test', [{ ids: [EVENT], limit: 1 }], 't', VIEWER, 'click')
  })
})

describe('relaySigningKeyAsViewer', () => {
  it('reads the key off any one channel record', async () => {
    queryRelay.mockResolvedValue({ ok: true, events: [{ kind: 39000, pubkey: RELAY, tags: [['d', 'uuid']] }] })
    expect(await relaySigningKeyAsViewer('https://relay.test', token)).toBe(RELAY)
    expect(queryRelay).toHaveBeenLastCalledWith('https://relay.test', [{ kinds: [39000], limit: 1 }], 't', VIEWER, 'click')
  })

  it('answers null, not a throw, when the read is refused or empty', async () => {
    queryRelay.mockResolvedValue({ ok: false, reason: 'relay_membership_required' })
    expect(await relaySigningKeyAsViewer('https://relay.test', token)).toBeNull()
    queryRelay.mockResolvedValue({ ok: true, events: [] })
    expect(await relaySigningKeyAsViewer('https://relay.test', token)).toBeNull()
  })
})
