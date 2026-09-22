/**
 * Reading open work back off the relay, and the one thing it has that stars do
 * not: an order (SHR-9).
 *
 * The three-answer distinction is `starsRead.test.ts`'s and is re-pinned here
 * because `fetchOpenWork` is a second copy of it and a copy can drift: "you have
 * no open work" and "we could not find out" have opposite consequences, the
 * first an empty list to render and a coordinate to seed, the second a publish
 * that must not happen.
 *
 * What is new is order. Open work is a list the person will be able to reorder,
 * so array order is the state — which makes two things load-bearing that are
 * free for a set: the serializer must not sort, and the change check must
 * compare in order, or a drag would publish nothing at all.
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

const aList = (updatedAt: number) =>
  JSON.stringify({
    v: 1,
    updatedAt,
    entries: [
      { kind: 'topic', id: 't1' },
      { kind: 'dm', key: 'greg' },
    ],
  })

beforeEach(() => vi.clearAllMocks())

describe('fetchOpenWork keeps apart the three answers the relay can give', () => {
  it('reports a relay that did not answer as unreachable, never as an empty list', async () => {
    const { fetchOpenWork } = await import('./openWork')
    queryRelay.mockResolvedValue({ ok: false, events: [] })
    expect(await fetchOpenWork(SEAM)).toEqual({ state: 'unreachable' })
  })

  it('reports no event at the coordinate as absent, which is what licenses the seed', async () => {
    const { fetchOpenWork } = await import('./openWork')
    queryRelay.mockResolvedValue({ ok: true, events: [] })
    expect(await fetchOpenWork(SEAM)).toEqual({ state: 'absent' })
  })

  it('reports a blob this tab cannot decrypt as unreachable, never as absent', async () => {
    // The blob is there and intact as far as anyone can tell; what failed is
    // this tab's key. Seeding over it is the one move that could destroy a list.
    const { fetchOpenWork } = await import('./openWork')
    queryRelay.mockResolvedValue({ ok: true, events: anEvent('cipher') })
    decryptBlob.mockResolvedValue(undefined)
    expect(await fetchOpenWork(SEAM)).toEqual({ state: 'unreachable' })
  })

  it('reports a blob that decrypts to nothing usable as absent', async () => {
    // The invariant between two functions rather than a property of either:
    // `parseOpenWorkBlob` floors an unreadable blob at `updatedAt: 0`, and no
    // real publish can produce that, because `openWorkToPublish` stamps a clock.
    const { fetchOpenWork } = await import('./openWork')
    queryRelay.mockResolvedValue({ ok: true, events: anEvent('cipher') })
    decryptBlob.mockResolvedValue('{"v":7,"entries":[]}')
    expect(await fetchOpenWork(SEAM)).toEqual({ state: 'absent' })
  })

  it('reports a list it can read as present', async () => {
    const { fetchOpenWork } = await import('./openWork')
    queryRelay.mockResolvedValue({ ok: true, events: anEvent('cipher') })
    decryptBlob.mockResolvedValue(aList(1_787_142_018_561))
    expect(await fetchOpenWork(SEAM)).toEqual({
      state: 'present',
      blob: {
        v: 1,
        updatedAt: 1_787_142_018_561,
        entries: [
          { kind: 'topic', id: 't1' },
          { kind: 'dm', key: 'greg' },
        ],
      },
    })
  })
})

describe('parsing keeps the order and drops only what it cannot trust', () => {
  it('keeps topics and DMs interleaved exactly as they were written', async () => {
    // The reason this blob is one array rather than the stars blob's two: a DM
    // promoted from the Screener between two topics sits where it was put.
    const { parseOpenWorkBlob } = await import('./openWork')
    const blob = parseOpenWorkBlob(
      JSON.stringify({
        v: 1,
        updatedAt: 1,
        entries: [
          { kind: 'topic', id: 't1' },
          { kind: 'dm', key: 'greg' },
          { kind: 'topic', id: 't2' },
        ],
      }),
    )
    expect(blob.entries).toEqual([
      { kind: 'topic', id: 't1' },
      { kind: 'dm', key: 'greg' },
      { kind: 'topic', id: 't2' },
    ])
  })

  it('drops one malformed entry without moving the survivors', async () => {
    const { parseOpenWorkBlob } = await import('./openWork')
    const blob = parseOpenWorkBlob(
      JSON.stringify({
        v: 1,
        updatedAt: 1,
        entries: [
          { kind: 'topic', id: 't1' },
          { kind: 'topic' },
          { kind: 'huddle', id: 'h1' },
          { kind: 'dm', key: 'greg' },
        ],
      }),
    )
    expect(blob.entries).toEqual([
      { kind: 'topic', id: 't1' },
      { kind: 'dm', key: 'greg' },
    ])
  })

  it('keeps the relay identity when one travels with an entry', async () => {
    const { parseOpenWorkBlob } = await import('./openWork')
    const blob = parseOpenWorkBlob(
      JSON.stringify({
        v: 1,
        updatedAt: 1,
        entries: [
          { kind: 'topic', id: 't1', channelUuid: 'u-1' },
          { kind: 'dm', key: 'greg', pubkey: 'ab' },
        ],
      }),
    )
    expect(blob.entries).toEqual([
      { kind: 'topic', id: 't1', channelUuid: 'u-1' },
      { kind: 'dm', key: 'greg', pubkey: 'ab' },
    ])
  })

  it('collapses a duplicate to its first position, not its last', async () => {
    const { parseOpenWorkBlob } = await import('./openWork')
    const blob = parseOpenWorkBlob(
      JSON.stringify({
        v: 1,
        updatedAt: 1,
        entries: [
          { kind: 'topic', id: 't1' },
          { kind: 'topic', id: 't2' },
          { kind: 'topic', id: 't1' },
        ],
      }),
    )
    expect(blob.entries).toEqual([
      { kind: 'topic', id: 't1' },
      { kind: 'topic', id: 't2' },
    ])
  })

  it('keeps a file by its address, in its place among the other kinds (FOL-34)', async () => {
    const { parseOpenWorkBlob, serializeOpenWorkBlob, openWorkKey } = await import('./openWork')
    const address = `30840:${'a'.repeat(64)}:topic-d`
    const blob = parseOpenWorkBlob(
      JSON.stringify({
        v: 1,
        updatedAt: 5,
        entries: [
          { kind: 'topic', id: 't1' },
          { kind: 'file', address },
          { kind: 'file' },
          { kind: 'file', address },
          { kind: 'dm', key: 'greg' },
        ],
      }),
    )
    // The one with no address is dropped, and the duplicate keeps the first slot.
    expect(blob.entries).toEqual([
      { kind: 'topic', id: 't1' },
      { kind: 'file', address },
      { kind: 'dm', key: 'greg' },
    ])
    expect(JSON.parse(serializeOpenWorkBlob(blob)).entries).toEqual(blob.entries)
    // Its own prefix: a topic id that happened to look like an address cannot shadow it.
    expect(openWorkKey({ kind: 'file', address })).toBe(`file:${address}`)
    expect(openWorkKey({ kind: 'topic', id: address })).not.toBe(openWorkKey({ kind: 'file', address }))
  })

  it('ignores a version it does not know rather than reading it with v1 rules', async () => {
    const { parseOpenWorkBlob } = await import('./openWork')
    expect(parseOpenWorkBlob(JSON.stringify({ v: 2, updatedAt: 9, entries: [{ kind: 'topic', id: 't1' }] }))).toEqual({
      v: 1,
      updatedAt: 0,
      entries: [],
    })
  })
})

describe('order is the state, so the serializer must not sort', () => {
  it('serializes in array order', async () => {
    const { serializeOpenWorkBlob } = await import('./openWork')
    const out = serializeOpenWorkBlob({
      v: 1,
      updatedAt: 5,
      entries: [
        { kind: 'topic', id: 't2' },
        { kind: 'topic', id: 't1' },
      ],
    })
    expect(JSON.parse(out).entries).toEqual([
      { kind: 'topic', id: 't2' },
      { kind: 'topic', id: 't1' },
    ])
  })

  it('treats the same members in a different order as a change worth publishing', async () => {
    // The failure this pins is total rather than partial: a sorted comparison
    // would call a reorder "unchanged" and publish nothing at all, so a drag
    // would survive until the next reload and then silently undo itself.
    const { openWorkToPublish } = await import('./openWork')
    const current = {
      v: 1 as const,
      updatedAt: 1,
      entries: [
        { kind: 'topic' as const, id: 't1' },
        { kind: 'topic' as const, id: 't2' },
      ],
    }
    const reordered = [{ kind: 'topic' as const, id: 't2' }, { kind: 'topic' as const, id: 't1' }]
    expect(openWorkToPublish(reordered, current, 99)).toEqual({ v: 1, updatedAt: 99, entries: reordered })
  })

  it('publishes nothing for a list that has not changed', async () => {
    const { openWorkToPublish } = await import('./openWork')
    const entries = [{ kind: 'topic' as const, id: 't1' }, { kind: 'dm' as const, key: 'greg' }]
    expect(openWorkToPublish(entries, { v: 1, updatedAt: 1, entries }, 99)).toBeUndefined()
  })

  it('publishes a first list when the relay holds none', async () => {
    const { openWorkToPublish } = await import('./openWork')
    const entries = [{ kind: 'topic' as const, id: 't1' }]
    expect(openWorkToPublish(entries, undefined, 99)).toEqual({ v: 1, updatedAt: 99, entries })
  })
})

describe('publishing', () => {
  it('signs and publishes the list under the open-work coordinate, with no h tag', async () => {
    const { publishOpenWork, OPEN_WORK_D_TAG } = await import('./openWork')
    const result = await publishOpenWork(
      { v: 1, updatedAt: 1_787_142_018_561, entries: [{ kind: 'topic', id: 't1' }] },
      SEAM,
    )
    expect(result.ok).toBe(true)
    expect(OPEN_WORK_D_TAG).toBe('estiva-peek:open-work:v1')
    const unsigned = signViaEstivaId.mock.calls[0][0] as { tags: string[][] }
    expect(unsigned.tags).toEqual([
      ['d', 'estiva-peek:open-work:v1'],
      ['t', 'estiva-peek-appdata'],
    ])
    // SPEC §12.2 makes an `h` a MUST NOT: the relay's read path treats an
    // explicit one as authoritative, so a stray tag would make a private blob
    // answer `#h` queries.
    expect(unsigned.tags.some(([name]) => name === 'h')).toBe(false)
  })

  it('refuses an over-cap list with its reason, rather than truncating it', async () => {
    // A hand-curated list silently losing an entry is data loss; a refusal is
    // actionable — close something. This is the opposite of SHR-4's eviction,
    // and deliberately so.
    const { publishOpenWork } = await import('./openWork')
    encryptBlob.mockRejectedValueOnce(new Error('app-data blob is 70000 bytes, over the 65535-byte plaintext limit'))
    const result = await publishOpenWork({ v: 1, updatedAt: 1, entries: [{ kind: 'topic', id: 't1' }] }, SEAM)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('over the 65535-byte plaintext limit')
    expect(publishSigned).not.toHaveBeenCalled()
  })

  it('names the kind when the Estiva ID ceiling refuses to sign', async () => {
    const { publishOpenWork } = await import('./openWork')
    signViaEstivaId.mockRejectedValueOnce(new Error('kind_not_allowed'))
    const result = await publishOpenWork({ v: 1, updatedAt: 1, entries: [] }, SEAM)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('kind:30078')
  })
})
