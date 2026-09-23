/**
 * Open work is read from the relay blob, not Convex (SHR-9).
 *
 * `deskOpenWork` met none of ADR 0001 §3's five — four authored fields, one
 * index, every access a `.some()` over it — so `api.desk.openWorkList` had no
 * business being what rendered. These tests are about the flip, and about the
 * ways it can quietly destroy a list rather than move it.
 *
 * The first is the trap SHR-6 named and this ticket inherits: the publish is
 * last-write-wins, so a list assembled before its source has settled is a
 * permanent loss, not a flicker. The second is the one the flip introduces:
 * rendering a row needs `useTopics`/`usePeople` to resolve an id, and deriving
 * the *publish* from the rendered rows would drop every entry the index was a
 * beat behind on.
 *
 * The third is this ticket's own, and has no equivalent in SHR-6: open work is
 * ordered. New work goes on the end, and the order has to survive the seed, the
 * optimistic window and the reload.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { getFunctionName } from 'convex/server'

vi.mock('@/api/store', () => ({ hasConvex: true }))

let openWorkListResult: unknown = []
/*
  Queries are told apart by name, not by reference. `api.desk.openWorkList` is a
  proxy that hands back a fresh object on every property access, so `===`
  against it is false even for the identical call — which fails open, as a query
  that answers `undefined` for ever, and is exactly the kind of test scaffolding
  that passes while asserting nothing.
*/
vi.mock('convex/react', () => ({
  useQuery: (ref: unknown) => {
    const name = getFunctionName(ref as Parameters<typeof getFunctionName>[0])
    if (name.includes('openWorkList')) return openWorkListResult
    return undefined
  },
  useMutation: () => vi.fn(),
}))
vi.mock('@/api/relayUrl', () => ({ RELAY_URL: 'https://relay.test', hasRelay: true }))

let topics: unknown = [
  { id: 't1', title: 'CI/CD pipeline stuck', isResolved: false, folderId: 'u-1' },
  { id: 't2', title: 'Auth rollout', isResolved: true, folderId: null },
]
vi.mock('@/api/topics', () => ({ useTopics: () => topics }))

let people: unknown = [
  { id: 'greg', name: 'Greg Bothman', avatarSrc: 'greg.png', pubkey: 'ab' },
  { id: 'juan', name: 'Juan Foley', avatarSrc: 'juan.png' },
]
vi.mock('@/api/people', () => ({ usePeople: () => people }))

type Ref = { kind: 'topic'; id: string; channelUuid?: string } | { kind: 'dm'; key: string; pubkey?: string }
const publish = vi.fn<(entries: Ref[]) => Promise<void>>(async () => undefined)
let syncState: 'unknown' | 'absent' | 'present' = 'present'
let relayBlob: unknown = undefined
vi.mock('@/nostr/useOpenWorkSync', () => ({
  useOpenWorkSync: () => ({ state: syncState, relayBlob, publish }),
}))

const aBlob = (entries: Ref[]) => ({ v: 1 as const, updatedAt: 1_787_142_018_561, entries })

async function setup() {
  const { OpenWorkProvider, useOpenWork } = await import('./openWork')
  const wrapper = ({ children }: { children: ReactNode }) => <OpenWorkProvider>{children}</OpenWorkProvider>
  return renderHook(() => useOpenWork(), { wrapper })
}

beforeEach(() => {
  vi.clearAllMocks()
  openWorkListResult = []
  syncState = 'present'
  relayBlob = undefined
  topics = [
    { id: 't1', title: 'CI/CD pipeline stuck', isResolved: false, folderId: 'u-1' },
    { id: 't2', title: 'Auth rollout', isResolved: true, folderId: null },
  ]
  people = [
    { id: 'greg', name: 'Greg Bothman', avatarSrc: 'greg.png', pubkey: 'ab' },
    { id: 'juan', name: 'Juan Foley', avatarSrc: 'juan.png' },
  ]
})

describe('the list comes from the relay', () => {
  it('renders a topic the relay holds while Convex holds none of it', async () => {
    // The done-when, stated as a test: `openWorkList` answers with an empty
    // array throughout, which is what a reload with the Convex query removed
    // looks like from inside this provider.
    relayBlob = aBlob([{ kind: 'topic', id: 't1' }])
    const { result } = await setup()
    expect(result.current.items).toEqual([
      { id: 'ow_topic_t1', kind: 'topic', topicId: 't1', title: 'CI/CD pipeline stuck', topicStatus: 'unresolved' },
    ])
    expect(result.current.topicIds).toEqual(new Set(['t1']))
    expect(result.current.isLoading).toBe(false)
  })

  it('renders a DM entry, which needs no relay stream to resolve its partner', async () => {
    // Why this ticket is not gated on DMS-3: a DM row resolves through the
    // workspace directory either way, so the list can move without the stream.
    relayBlob = aBlob([{ kind: 'dm', key: 'greg' }])
    const { result } = await setup()
    expect(result.current.items).toEqual([
      { id: 'ow_dm_greg', kind: 'dm', dmId: 'greg', name: 'Greg Bothman', avatarSrc: 'greg.png' },
    ])
  })

  it('takes the resolved state from the workspace index, since the blob carries none', async () => {
    relayBlob = aBlob([{ kind: 'topic', id: 't2' }])
    const { result } = await setup()
    expect(result.current.items[0]).toMatchObject({ topicId: 't2', topicStatus: 'resolved' })
  })

  it('renders topics and DMs interleaved in the blob order, not grouped by kind', async () => {
    relayBlob = aBlob([
      { kind: 'topic', id: 't1' },
      { kind: 'dm', key: 'greg' },
      { kind: 'topic', id: 't2' },
    ])
    const { result } = await setup()
    expect(result.current.items.map((i) => i.id)).toEqual(['ow_topic_t1', 'ow_dm_greg', 'ow_topic_t2'])
  })

  it('ignores what Convex says once the relay has answered', async () => {
    relayBlob = aBlob([{ kind: 'topic', id: 't1' }])
    openWorkListResult = [
      { id: 'w1', kind: 'topic', topicId: 't2', title: 'Auth rollout', topicStatus: 'resolved' },
      { id: 'w2', kind: 'dm', dmId: 'juan', name: 'Juan Foley' },
    ]
    const { result } = await setup()
    expect(result.current.items.map((i) => i.id)).toEqual(['ow_topic_t1'])
  })
})

describe('what is published is the list, never the rows that could be drawn', () => {
  it('keeps an entry whose topic the index cannot resolve, and publishes it', async () => {
    // The flip's own trap. `t9` is in the list and not in `useTopics()` — slow
    // index, or a topic this viewer cannot see. It has no row, and dropping it
    // from the publish would delete it from the person's list for good.
    relayBlob = aBlob([{ kind: 'topic', id: 't1' }, { kind: 'topic', id: 't9' }])
    const { result } = await setup()
    expect(result.current.items.map((i) => i.id)).toEqual(['ow_topic_t1'])
    expect(result.current.topicIds.has('t9')).toBe(true)
    await waitFor(() => expect(publish).toHaveBeenCalled())
    expect(publish.mock.calls.at(-1)?.[0]).toEqual([
      { kind: 'topic', id: 't1', channelUuid: 'u-1' },
      { kind: 'topic', id: 't9' },
    ])
  })

  it('publishes nothing at all while no source has settled', async () => {
    // The guard the ticket asked to be kept, in its new form: the relay has not
    // answered and Convex is in flight, so there is no list — and an empty
    // publish here is permanent.
    syncState = 'unknown'
    relayBlob = undefined
    openWorkListResult = undefined
    const { result } = await setup()
    expect(result.current.isLoading).toBe(true)
    expect(result.current.items).toEqual([])
    await act(async () => {})
    expect(publish).not.toHaveBeenCalled()
  })

  it('carries the relay identity when the index has it, and keeps the blob’s when it does not', async () => {
    // Decoration, never membership: an id the index cannot resolve keeps
    // whatever the blob already carried rather than losing its channel.
    relayBlob = aBlob([
      { kind: 'topic', id: 't9', channelUuid: 'u-9' },
      { kind: 'dm', key: 'greg' },
    ])
    await setup()
    await waitFor(() => expect(publish).toHaveBeenCalled())
    expect(publish.mock.calls.at(-1)?.[0]).toEqual([
      { kind: 'topic', id: 't9', channelUuid: 'u-9' },
      { kind: 'dm', key: 'greg', pubkey: 'ab' },
    ])
  })

  it('seeds the relay from Convex, oldest first, when the relay holds nothing', async () => {
    // The migration, for a person whose open work predates this ticket. The
    // query sorts `addedAt` descending; the list is oldest-first, so the seed
    // reverses it rather than freezing the old presentation order into the blob.
    syncState = 'absent'
    relayBlob = undefined
    openWorkListResult = [
      { id: 'w1', kind: 'dm', dmId: 'greg', name: 'Greg Bothman' },
      { id: 'w2', kind: 'topic', topicId: 't2', title: 'Auth rollout', topicStatus: 'resolved' },
      { id: 'w3', kind: 'topic', topicId: 't1', title: 'CI/CD', topicStatus: 'unresolved' },
    ]
    const { result } = await setup()
    expect(result.current.items.map((i) => i.id)).toEqual(['ow_topic_t1', 'ow_topic_t2', 'ow_dm_greg'])
    await waitFor(() => expect(publish).toHaveBeenCalled())
    expect(publish.mock.calls.at(-1)?.[0]).toEqual([
      { kind: 'topic', id: 't1', channelUuid: 'u-1' },
      { kind: 'topic', id: 't2' },
      { kind: 'dm', key: 'greg', pubkey: 'ab' },
    ])
  })
})

describe('adding and removing', () => {
  it('appends new work to the end, the way a browser tab opens', async () => {
    relayBlob = aBlob([{ kind: 'topic', id: 't1' }])
    const { result } = await setup()
    act(() => result.current.addTopics(['t2']))
    expect(result.current.items.map((i) => i.id)).toEqual(['ow_topic_t1', 'ow_topic_t2'])
    await waitFor(() =>
      expect(publish.mock.calls.at(-1)?.[0]).toEqual([
        { kind: 'topic', id: 't1', channelUuid: 'u-1' },
        { kind: 'topic', id: 't2' },
      ]),
    )
  })

  it('keeps a batch in the order it was given, with no timestamp left to tie on', async () => {
    // `desk.ts` needed strictly increasing `addedAt` because a batch inserted
    // inside one millisecond tied and sorted back to click order, flipping the
    // rows the overlay had drawn. A Map's insertion order cannot tie.
    relayBlob = aBlob([])
    const { result } = await setup()
    act(() => result.current.addTopics(['t2', 't1']))
    expect(result.current.items.map((i) => i.id)).toEqual(['ow_topic_t2', 'ow_topic_t1'])
  })

  it('drops an entry from the rendered list and from what is published', async () => {
    relayBlob = aBlob([{ kind: 'topic', id: 't1' }, { kind: 'dm', key: 'greg' }])
    const { result } = await setup()
    act(() => result.current.removeDm('greg'))
    expect(result.current.items.map((i) => i.id)).toEqual(['ow_topic_t1'])
    await waitFor(() =>
      expect(publish.mock.calls.at(-1)?.[0]).toEqual([{ kind: 'topic', id: 't1', channelUuid: 'u-1' }]),
    )
  })

  it('keeps the overlay when the relay list catches up, rather than adding twice', async () => {
    relayBlob = aBlob([])
    const { result, rerender } = await setup()
    act(() => result.current.addTopics(['t1']))
    relayBlob = aBlob([{ kind: 'topic', id: 't1' }])
    rerender()
    expect(result.current.items.map((i) => i.id)).toEqual(['ow_topic_t1'])
  })

  it('moves a re-added entry to the end rather than back into the slot it left', async () => {
    relayBlob = aBlob([{ kind: 'topic', id: 't1' }, { kind: 'topic', id: 't2' }])
    const { result } = await setup()
    act(() => result.current.removeTopic('t1'))
    act(() => result.current.addTopics(['t1']))
    expect(result.current.items.map((i) => i.id)).toEqual(['ow_topic_t2', 'ow_topic_t1'])
  })
})
