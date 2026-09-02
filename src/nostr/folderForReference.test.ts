/**
 * PRO-11's last clause: the `web` template must name a URL that opens the object.
 *
 * NIP-89 lets an app say "open one of my objects here". Peek published that
 * claim before it had any routing, so a consumer resolved a Topic, offered
 * "open in Peek", and landed the person on their desk — the failure RFC 0.4
 * §13.6 names: renders fine, quietly does less.
 */
import { describe, expect, it, vi } from 'vitest'

const { queryRelay } = vi.hoisted(() => ({ queryRelay: vi.fn() }))
vi.mock('./bridge', () => ({ queryRelay, publishSigned: vi.fn(), signViaEstivaId: vi.fn() }))

import { addrToNaddr, encodeNevent } from '@estiva-app/protocol'
import { folderForReferenceAsViewer } from './foreign'

const AUTHOR = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const FOLDER = '925897ad-796e-4bc6-999c-ca19df26c4aa'
const MESSAGE_ID = 'c'.repeat(64)
const token = { accessToken: 't', pubkey: AUTHOR } as never
const resolve = (reference: string) => folderForReferenceAsViewer(reference, 'https://relay.test', token)

describe('a Topic answers from the pointer, with no read at all', () => {
  it('reads the channel uuid out of the naddr', async () => {
    /*
      A Topic's `d` *is* the channel uuid — measured across all 50 production
      channels (RFC 0.4 §5.2). So the answer is already in the reference and
      fetching would be asking a question we hold the answer to.
    */
    queryRelay.mockClear()
    expect(await resolve(`nostr:${addrToNaddr(`39000:${AUTHOR}:${FOLDER}`, [])}`)).toBe(FOLDER)
    expect(queryRelay).not.toHaveBeenCalled()
  })

  it('takes a bare address too, as every other reference path does', async () => {
    expect(await resolve(`39000:${AUTHOR}:${FOLDER}`)).toBe(FOLDER)
  })

  it('refuses another app’s object rather than redirecting somewhere arbitrary', async () => {
    // A Ship project's naddr is a perfectly good reference that Peek has
    // nowhere to open. Saying so beats landing the person on a desk.
    expect(await resolve(`30850:${AUTHOR}:some-project`)).toBeNull()
  })
})

describe('a Message has no address, so its Folder has to be fetched', () => {
  it('reads the h tag off the event', async () => {
    // A kind:9 carries no `d` at all, so nothing but its event id names it.
    queryRelay.mockResolvedValueOnce({
      ok: true,
      events: [{ id: MESSAGE_ID, kind: 9, pubkey: AUTHOR, tags: [['h', FOLDER]], content: '', created_at: 1, sig: '' }],
    })
    expect(await resolve(`nostr:${encodeNevent({ id: MESSAGE_ID, relays: [] })}`)).toBe(FOLDER)
  })

  it('accepts a bare event id, which is what a pasted `e` tag gives you', async () => {
    queryRelay.mockResolvedValueOnce({
      ok: true,
      events: [{ id: MESSAGE_ID, kind: 9, pubkey: AUTHOR, tags: [['h', FOLDER]], content: '', created_at: 1, sig: '' }],
    })
    expect(await resolve(MESSAGE_ID)).toBe(FOLDER)
  })

  it('returns null for an event that is not readable from here', async () => {
    queryRelay.mockResolvedValueOnce({ ok: true, events: [] })
    expect(await resolve(`nostr:${encodeNevent({ id: MESSAGE_ID, relays: [] })}`)).toBeNull()
  })

  it('returns null for an event carrying no Folder', async () => {
    queryRelay.mockResolvedValueOnce({
      ok: true,
      events: [{ id: MESSAGE_ID, kind: 9, pubkey: AUTHOR, tags: [], content: '', created_at: 1, sig: '' }],
    })
    expect(await resolve(`nostr:${encodeNevent({ id: MESSAGE_ID, relays: [] })}`)).toBeNull()
  })
})

describe('nonsense is nonsense', () => {
  it('returns null rather than throwing into the route', async () => {
    expect(await resolve('nostr:not-a-reference')).toBeNull()
    expect(await resolve('')).toBeNull()
  })
})
