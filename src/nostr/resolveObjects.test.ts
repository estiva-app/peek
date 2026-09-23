/**
 * A set of files for the price of one request — PER-10.
 *
 * The Screener resolved each followed file on its own, every minute: 144 of an
 * idle Desk's 194 requests in five minutes, against a meter of 300 a minute that
 * every tab shares. These count what reaches the bridge, through the real
 * interop, because that is the unit the relay meters — a test of the hook's
 * calls would pass whatever the resolver underneath did.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { queryRelay } = vi.hoisted(() => ({ queryRelay: vi.fn() }))
vi.mock('./bridge', () => ({ queryRelay, publishSigned: vi.fn(), signViaEstivaId: vi.fn() }))

import { encodeNevent, type SignedEvent } from '@estiva-app/protocol'
import { forgetUrlShapes, resolveObjectsAsViewer } from './foreign'
import { RelayReadError } from './relayRead'

const AUTHOR = 'a'.repeat(64)
const VIEWER = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const ISSUE = 30851
const token = { accessToken: 't', pubkey: VIEWER } as never

let seq = 0
const event = (partial: Partial<SignedEvent>): SignedEvent => ({
  id: String(++seq).padStart(64, '0'),
  sig: '',
  pubkey: AUTHOR,
  created_at: 1_700_000_000 + seq,
  tags: [],
  content: '',
  kind: 1,
  ...partial,
})

const manifest = event({
  kind: 31990,
  tags: [['d', 'ship'], ['k', String(ISSUE)]],
  content: JSON.stringify({
    name: 'Ship',
    projections: { [ISSUE]: { widget: 'row', slots: { title: { tag: 'title' } } } },
    actions: [{ id: 'comment', label: 'Comment', appliesTo: String(ISSUE), emits: { kind: 1111, scope: 'address' } }],
  }),
})
const addresses = Array.from({ length: 12 }, (_, i) => `${ISSUE}:${AUTHOR}:f${i}`)
const events = [
  manifest,
  ...addresses.map((_, i) => event({ kind: ISSUE, tags: [['d', `f${i}`], ['title', `File ${i}`]] })),
  ...addresses.map((address, i) => event({ kind: 1111, tags: [['A', address], ['a', address]], content: `On ${i}` })),
]

/** The relay, matching each filter as buzz does and concatenating the answers. */
function answer(filters: Record<string, unknown>[]): SignedEvent[] {
  return filters.flatMap((f) =>
    events.filter((e) => {
      if (Array.isArray(f.ids) && !f.ids.includes(e.id)) return false
      if (Array.isArray(f.kinds) && !f.kinds.includes(e.kind)) return false
      if (Array.isArray(f.authors) && !f.authors.includes(e.pubkey)) return false
      for (const [key, want] of Object.entries(f)) {
        if (!key.startsWith('#') || !Array.isArray(want)) continue
        const held = e.tags.filter((t) => t[0] === key.slice(1)).map((t) => t[1])
        if (!want.some((v) => held.includes(v))) return false
      }
      return true
    }),
  )
}

beforeEach(() => {
  forgetUrlShapes()
  queryRelay.mockReset()
  queryRelay.mockImplementation(async (_url: string, filters: Record<string, unknown>[]) => ({ ok: true, events: answer(filters) }))
})

describe('resolveObjectsAsViewer', () => {
  it('reads twelve files in one request once the manifest is known, where it took twelve', async () => {
    await resolveObjectsAsViewer(addresses, 'https://relay.test', token)
    queryRelay.mockClear()

    const objects = await resolveObjectsAsViewer(addresses, 'https://relay.test', token)
    expect(queryRelay).toHaveBeenCalledTimes(1)
    expect(addresses.map((a) => objects[a]?.slots.title?.value)).toEqual(addresses.map((_, i) => `File ${i}`))
    expect(addresses.map((a) => objects[a]?.comments.map((c) => c.body))).toEqual(addresses.map((_, i) => [`On ${i}`]))
  })

  it('still knows the manifest after five minutes, and asks again after an hour (PER-11)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      await resolveObjectsAsViewer(addresses, 'https://relay.test', token)
      queryRelay.mockClear()

      vi.setSystemTime(Date.now() + 6 * 60_000)
      await resolveObjectsAsViewer(addresses, 'https://relay.test', token)
      expect(queryRelay).toHaveBeenCalledTimes(1)
      queryRelay.mockClear()

      vi.setSystemTime(Date.now() + 60 * 60_000)
      await resolveObjectsAsViewer(addresses, 'https://relay.test', token)
      expect(queryRelay.mock.calls.length).toBeGreaterThan(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('throws a refused read rather than answering null, so a held row can stay', async () => {
    await resolveObjectsAsViewer(addresses, 'https://relay.test', token)
    queryRelay.mockResolvedValue({ ok: false, reason: 'rate_limited' })
    await expect(resolveObjectsAsViewer(addresses, 'https://relay.test', token)).rejects.toBeInstanceOf(RelayReadError)
  })

  it('an event reference keeps the single path, and its failure is its own', async () => {
    const message = `nostr:${encodeNevent({ id: 'c'.repeat(64), relays: [], kind: 9 })}`
    const objects = await resolveObjectsAsViewer([addresses[0], message], 'https://relay.test', token)
    expect(objects[message]).toBeNull()
    expect(objects[addresses[0]]?.slots.title?.value).toBe('File 0')
    expect(queryRelay).toHaveBeenCalledWith('https://relay.test', [{ ids: ['c'.repeat(64)], limit: 1 }], 't', VIEWER)
  })
})
