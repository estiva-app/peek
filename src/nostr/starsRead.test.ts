/**
 * Reading the starred set back off the relay (SHR-6).
 *
 * Since the blob became the set rather than its backup, one distinction decides
 * everything on load: has the relay said what it holds? "You have no stars" and
 * "we could not find out" now have opposite consequences — the first is a set
 * to render and a coordinate to seed, the second is a publish that must not
 * happen. `fetchStars` used to collapse both into `undefined`, so all of this
 * is new ground rather than a regression net.
 *
 * Every failure here is silent by construction: a relay that answers `ok:false`
 * looks exactly like one that answers with nothing, and the cost of confusing
 * them is a last-write-wins publish that cannot be taken back.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { SignedEvent } from '@estiva-app/protocol'

const queryRelay = vi.fn<(...args: unknown[]) => Promise<{ ok: boolean; events: SignedEvent[] }>>()
const decryptBlob = vi.fn<(...args: unknown[]) => Promise<string | undefined>>()
const publishSigned = vi.fn(async () => ({ ok: true, eventId: 'e1' }))
const signViaEstivaId = vi.fn(async (unsigned: unknown) => unsigned as SignedEvent)
const encryptBlob = vi.fn(async (plaintext: string) => `cipher(${plaintext})`)

vi.mock('./bridge', () => ({
  queryRelay: (...args: unknown[]) => queryRelay(...args),
  publishSigned: () => publishSigned(),
  signViaEstivaId: (unsigned: unknown) => signViaEstivaId(unsigned),
}))
vi.mock('./appData', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./appData')>()),
  decryptBlob: (...args: unknown[]) => decryptBlob(...args),
  encryptBlob: (plaintext: string) => encryptBlob(plaintext),
}))

const SEAM = { relayUrl: 'https://relay.test', accessToken: 'tok', pubkey: 'c4'.repeat(32) }

/** One event is enough: the coordinate is parameterized-replaceable. */
const anEvent = (content: string) => [{ content, created_at: 1_787_142_018 } as unknown as SignedEvent]

const aSet = (updatedAt: number) =>
  JSON.stringify({ v: 1, updatedAt, topics: [{ id: 't1' }], people: [{ key: 'greg' }] })

beforeEach(() => vi.clearAllMocks())

describe('fetchStars keeps apart the three answers the relay can give', () => {
  it('reports a relay that did not answer as unreachable, never as an empty set', async () => {
    const { fetchStars } = await import('./stars')
    queryRelay.mockResolvedValue({ ok: false, events: [] })
    expect(await fetchStars(SEAM)).toEqual({ state: 'unreachable' })
  })

  it('reports a relay that answered with nothing as absent, which is what licenses the seed', async () => {
    const { fetchStars } = await import('./stars')
    queryRelay.mockResolvedValue({ ok: true, events: [] })
    expect(await fetchStars(SEAM)).toEqual({ state: 'absent' })
  })

  it('returns the set when there is one', async () => {
    const { fetchStars } = await import('./stars')
    queryRelay.mockResolvedValue({ ok: true, events: anEvent('cipher') })
    decryptBlob.mockResolvedValue(aSet(1_787_142_018_561))
    const read = await fetchStars(SEAM)
    expect(read.state).toBe('present')
    expect(read.state === 'present' && read.blob.topics).toEqual([{ id: 't1' }])
    expect(read.state === 'present' && read.blob.people).toEqual([{ key: 'greg' }])
  })

  it('treats a blob it cannot decrypt as unreachable, so nothing is published over it', async () => {
    // The event is there and, as far as anyone can tell, intact. What failed is
    // this tab's key. Republishing here is the one move that destroys something.
    const { fetchStars } = await import('./stars')
    queryRelay.mockResolvedValue({ ok: true, events: anEvent('cipher') })
    decryptBlob.mockResolvedValue(undefined)
    expect(await fetchStars(SEAM)).toEqual({ state: 'unreachable' })
  })

  it('treats a blob it can read and cannot use as absent, so Convex rewrites it', async () => {
    const { fetchStars } = await import('./stars')
    queryRelay.mockResolvedValue({ ok: true, events: anEvent('cipher') })
    for (const unusable of ['not json at all', JSON.stringify({ v: 2, topics: [{ id: 't1' }] }), '{}']) {
      decryptBlob.mockResolvedValue(unusable)
      expect(await fetchStars(SEAM)).toEqual({ state: 'absent' })
    }
  })

  it('never reports a real set as absent, which is what the updatedAt floor rests on', async () => {
    // `absent` for an unusable blob is detected by `parseStarsBlob`'s floor,
    // `updatedAt: 0`. That is only sound while no publish can write a zero, and
    // that invariant lives in a different function — so it is pinned here
    // rather than assumed.
    const { fetchStars, starsToPublish } = await import('./stars')
    const published = starsToPublish({ topics: [], people: [] }, undefined, Date.now())
    expect(published?.updatedAt).toBeGreaterThan(0)
    queryRelay.mockResolvedValue({ ok: true, events: anEvent('cipher') })
    decryptBlob.mockResolvedValue(JSON.stringify(published))
    expect((await fetchStars(SEAM)).state).toBe('present')
  })

  it('reads an empty set as present, so a person who cleared their stars keeps them cleared', async () => {
    const { fetchStars } = await import('./stars')
    queryRelay.mockResolvedValue({ ok: true, events: anEvent('cipher') })
    decryptBlob.mockResolvedValue(JSON.stringify({ v: 1, updatedAt: 1_787_142_018_561, topics: [], people: [] }))
    const read = await fetchStars(SEAM)
    expect(read.state).toBe('present')
    expect(read.state === 'present' && read.blob.topics).toEqual([])
  })
})
