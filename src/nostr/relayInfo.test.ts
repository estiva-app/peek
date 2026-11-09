/**
 * The relay's NIP-11 document as Peek reads it (TOPI-12): once per page, shared by the project-fields switch and the
 * Topics column's live watch, which stops naming teams only when the relay says it may.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/relayUrl', () => ({ RELAY_URL: 'https://relay.test', hasRelay: true }))

import { forgetRelayInfo, relayInfo } from './relayInfo'

const DOC = { supported_extensions: ['nip-er', 'buzz-live-as-stored'] }
const answers = (doc: unknown) => ({ ok: true, json: async () => doc })

beforeEach(() => forgetRelayInfo())

describe('the relay’s information document (TOPI-12)', () => {
  it('asks the relay for its NIP-11 document, which it sends only to a request that accepts it, not its web page', async () => {
    const fetch = vi.fn(async () => answers(DOC))
    vi.stubGlobal('fetch', fetch)
    expect(await relayInfo()).toEqual(DOC)
    expect(fetch).toHaveBeenCalledWith('https://relay.test', expect.objectContaining({ headers: expect.objectContaining({ accept: 'application/nostr+json' }) }))
  })

  it('a read that fails is asked again by the next caller, and the answer it then gets is shared, not read again', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(answers(DOC))
    vi.stubGlobal('fetch', fetch)
    await expect(relayInfo()).rejects.toThrow('offline')
    expect(await relayInfo()).toEqual(DOC)
    expect(await relayInfo()).toEqual(DOC)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
