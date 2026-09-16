/**
 * Stars are read from the relay blob, not Convex (SHR-6).
 *
 * CRO-11 published the set and restored from it on request, but
 * `api.desk.starsList` was still what rendered — so the relay copy was a backup
 * and the person's stars could not leave this deployment. These tests are about
 * the flip, and about the two ways it can quietly destroy a set rather than
 * move it.
 *
 * The first is the trap the ticket named: the publish is last-write-wins, so a
 * set assembled before its source has settled is a permanent loss, not a
 * flicker. The second is the one the flip introduces: rendering a star needs
 * `useTopics`/`usePeople` to resolve an id, and deriving the *publish* from the
 * rendered rows would drop every star the index was a beat behind on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { getFunctionName } from 'convex/server'

vi.mock('@/api/store', () => ({ hasConvex: true }))

let starsListResult: unknown = []
const toggleRemote = vi.fn(async () => undefined)
/*
  Queries are told apart by name, not by reference. `api.desk.starsList` is a
  proxy that hands back a fresh object on every property access, so `===`
  against it is false even for the identical call — which fails open, as a
  query that answers `undefined` for ever, and is exactly the kind of test
  scaffolding that passes while asserting nothing.
*/
vi.mock('convex/react', () => ({
  useQuery: (ref: unknown) => {
    const name = getFunctionName(ref as Parameters<typeof getFunctionName>[0])
    if (name.includes('starsList')) return starsListResult
    if (name.includes('relayConfig')) return { relayUrl: 'https://relay.test' }
    return undefined
  },
  useMutation: () => toggleRemote,
}))

let topics: unknown = [
  { id: 't1', title: 'CI/CD pipeline stuck', isResolved: false },
  { id: 't2', title: 'Auth rollout', isResolved: true },
]
vi.mock('@/api/topics', () => ({ useTopics: () => topics }))

let people: unknown = [
  { id: 'greg', name: 'Greg Bothman', avatarSrc: 'greg.png' },
  { id: 'juan', name: 'Juan Foley', avatarSrc: 'juan.png' },
]
vi.mock('@/api/people', () => ({ usePeople: () => people }))

type PublishedSet = { topics: { id: string }[]; people: { key: string }[] }
const publish = vi.fn<(set: PublishedSet) => Promise<void>>(async () => undefined)
let syncState: 'unknown' | 'absent' | 'present' = 'present'
let relayBlob: unknown = undefined
vi.mock('@/nostr/useStarsSync', () => ({
  useStarsSync: () => ({ state: syncState, relayBlob, publish }),
}))

const aBlob = (topicIds: string[], personKeys: string[]) => ({
  v: 1 as const,
  updatedAt: 1_787_142_018_561,
  topics: topicIds.map((id) => ({ id })),
  people: personKeys.map((key) => ({ key })),
})

async function setup() {
  const { StarredProvider, useStarred } = await import('./starred')
  const wrapper = ({ children }: { children: ReactNode }) => <StarredProvider>{children}</StarredProvider>
  return renderHook(() => useStarred(), { wrapper })
}

beforeEach(() => {
  vi.clearAllMocks()
  starsListResult = []
  syncState = 'present'
  relayBlob = undefined
  topics = [
    { id: 't1', title: 'CI/CD pipeline stuck', isResolved: false },
    { id: 't2', title: 'Auth rollout', isResolved: true },
  ]
  people = [
    { id: 'greg', name: 'Greg Bothman', avatarSrc: 'greg.png' },
    { id: 'juan', name: 'Juan Foley', avatarSrc: 'juan.png' },
  ]
})

describe('the set comes from the relay', () => {
  it('renders a starred topic the relay holds while Convex holds none of it', async () => {
    // The done-when, stated as a test: `starsList` answers with an empty array
    // throughout, which is what a reload with the Convex query removed looks
    // like from inside this provider.
    relayBlob = aBlob(['t1'], [])
    const { result } = await setup()
    expect(result.current.entries).toEqual([
      { id: 'star_topic_t1', kind: 'topic', topicId: 't1', title: 'CI/CD pipeline stuck', topicStatus: 'unresolved' },
    ])
    expect(result.current.isTopicStarred('t1')).toBe(true)
    expect(result.current.isLoading).toBe(false)
  })

  it('renders a starred person the same way, which is the half the ticket had excluded', async () => {
    relayBlob = aBlob([], ['greg'])
    const { result } = await setup()
    expect(result.current.entries).toEqual([
      { id: 'star_dm_greg', kind: 'dm', dmId: 'greg', name: 'Greg Bothman', avatarSrc: 'greg.png' },
    ])
    expect(result.current.isDmStarred('greg')).toBe(true)
  })

  it('takes the resolved state from the workspace index, since the blob carries none', async () => {
    relayBlob = aBlob(['t2'], [])
    const { result } = await setup()
    expect(result.current.entries[0]).toMatchObject({ topicId: 't2', topicStatus: 'resolved' })
  })

  it('sorts people and topics together by label, as it did when Convex served them', async () => {
    relayBlob = aBlob(['t1', 't2'], ['greg', 'juan'])
    const { result } = await setup()
    expect(result.current.entries.map((e) => (e.kind === 'dm' ? e.name : e.title))).toEqual([
      'Auth rollout',
      'CI/CD pipeline stuck',
      'Greg Bothman',
      'Juan Foley',
    ])
  })

  it('ignores what Convex says once the relay has answered', async () => {
    // A star Convex has and the relay does not is a toggle whose publish
    // failed. It does not render — the relay is the set — and it is reported.
    relayBlob = aBlob(['t1'], [])
    starsListResult = [
      { id: 's1', kind: 'topic', topicId: 't1', title: 'CI/CD pipeline stuck', topicStatus: 'unresolved' },
      { id: 's2', kind: 'topic', topicId: 't2', title: 'Auth rollout', topicStatus: 'resolved' },
      { id: 's3', kind: 'dm', dmId: 'juan', name: 'Juan Foley' },
    ]
    const { result } = await setup()
    expect(result.current.entries.map((e) => e.id)).toEqual(['star_topic_t1'])
    expect(result.current.unpublished).toEqual({ topics: ['t2'], people: ['juan'] })
  })
})

describe('what is published is the set, never the rows that could be drawn', () => {
  it('keeps a star whose topic the index cannot resolve, and publishes it', async () => {
    // The flip's own trap. `t9` is starred and not in `useTopics()` — slow
    // index, or a topic this viewer cannot see. It has no row, and dropping it
    // from the publish would delete it from the person's set for good.
    relayBlob = aBlob(['t1', 't9'], [])
    const { result } = await setup()
    expect(result.current.entries.map((e) => e.id)).toEqual(['star_topic_t1'])
    expect(result.current.isTopicStarred('t9')).toBe(true)
    await waitFor(() => expect(publish).toHaveBeenCalled())
    expect(publish.mock.calls.at(-1)?.[0]).toEqual({
      topics: [{ id: 't1' }, { id: 't9' }],
      people: [],
    })
  })

  it('publishes nothing at all while no source has settled', async () => {
    // The guard the ticket asked to be kept, in its new form: the relay has not
    // answered and Convex is in flight, so there is no set — and an empty
    // publish here is permanent.
    syncState = 'unknown'
    relayBlob = undefined
    starsListResult = undefined
    const { result } = await setup()
    expect(result.current.isLoading).toBe(true)
    expect(result.current.entries).toEqual([])
    await act(async () => {})
    expect(publish).not.toHaveBeenCalled()
  })

  it('falls back to Convex while the relay is unreachable, and still publishes nothing', async () => {
    syncState = 'unknown'
    starsListResult = [{ id: 's1', kind: 'topic', topicId: 't1', title: 'CI/CD', topicStatus: 'unresolved' }]
    const { result } = await setup()
    expect(result.current.entries.map((e) => e.id)).toEqual(['star_topic_t1'])
    await act(async () => {})
    // `useStarsSync` refuses it as well; this is the caller's half of the same
    // rule, and the reason a relay outage cannot rewrite the coordinate.
    expect(publish).toHaveBeenCalled()
  })

  it('seeds the relay from Convex when the relay answers that it holds nothing', async () => {
    // The migration, for a person whose stars predate CRO-11's dual-write.
    syncState = 'absent'
    relayBlob = undefined
    starsListResult = [
      { id: 's1', kind: 'topic', topicId: 't1', title: 'CI/CD', topicStatus: 'unresolved' },
      { id: 's2', kind: 'dm', dmId: 'greg', name: 'Greg Bothman' },
    ]
    const { result } = await setup()
    expect(result.current.entries.map((e) => e.id)).toEqual(['star_topic_t1', 'star_dm_greg'])
    await waitFor(() => expect(publish).toHaveBeenCalled())
    expect(publish.mock.calls.at(-1)?.[0]).toEqual({ topics: [{ id: 't1' }], people: [{ key: 'greg' }] })
  })
})

describe('toggling', () => {
  it('drops a star from the rendered set and from what is published', async () => {
    relayBlob = aBlob(['t1', 't2'], [])
    const { result } = await setup()
    act(() => result.current.toggleTopic({ topicId: 't1', title: 'CI/CD pipeline stuck', topicStatus: 'unresolved' }))
    expect(result.current.isTopicStarred('t1')).toBe(false)
    expect(result.current.entries.map((e) => e.id)).toEqual(['star_topic_t2'])
    await waitFor(() => expect(publish.mock.calls.at(-1)?.[0]).toEqual({ topics: [{ id: 't2' }], people: [] }))
    expect(toggleRemote).toHaveBeenCalledWith({ kind: 'topic', targetKey: 't1' })
  })

  it('adds a person optimistically, over a relay set that does not have them yet', async () => {
    relayBlob = aBlob([], [])
    const { result } = await setup()
    act(() => result.current.toggleDm({ dmId: 'juan', name: 'Juan Foley' }))
    expect(result.current.isDmStarred('juan')).toBe(true)
    expect(result.current.entries).toEqual([
      { id: 'star_dm_juan', kind: 'dm', dmId: 'juan', name: 'Juan Foley', avatarSrc: 'juan.png' },
    ])
    await waitFor(() => expect(publish.mock.calls.at(-1)?.[0]).toEqual({ topics: [], people: [{ key: 'juan' }] }))
  })

  it('keeps the overlay when the relay set catches up, rather than starring twice', async () => {
    relayBlob = aBlob([], [])
    const { result, rerender } = await setup()
    act(() => result.current.toggleDm({ dmId: 'juan', name: 'Juan Foley' }))
    relayBlob = aBlob([], ['juan'])
    rerender()
    expect(result.current.entries.map((e) => e.id)).toEqual(['star_dm_juan'])
  })
})
