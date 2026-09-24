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

/** A person in open work is their pubkey since REM-3. */
const GREG = 'a'.repeat(64)
const JUAN = 'b'.repeat(64)

/*
  REM-4: open work never touches Convex. Any read or write reaching it fails the
  test loudly rather than answering `undefined`, which is what a query in flight
  looks like and would pass unnoticed.
*/
vi.mock('convex/react', () => ({
  useQuery: () => {
    throw new Error('open work asked Convex')
  },
  useMutation: () => {
    throw new Error('open work wrote Convex')
  },
}))
vi.mock('@/api/relayUrl', () => ({ RELAY_URL: 'https://relay.test', hasRelay: true }))

let topics: unknown = [
  { id: 't1', title: 'CI/CD pipeline stuck', isResolved: false, folderId: 'u-1' },
  { id: 't2', title: 'Auth rollout', isResolved: true, folderId: null },
]
vi.mock('@/api/topics', () => ({ useTopics: () => topics }))

let people: unknown = [
  { id: GREG, name: 'Greg Bothman', avatarSrc: 'greg.png', pubkey: GREG },
  { id: JUAN, name: 'Juan Foley', avatarSrc: 'juan.png' },
]
vi.mock('@/api/people', async (importOriginal) => ({
  isPersonKey: (await importOriginal<typeof import('@/api/people')>()).isPersonKey,
  useWorkspacePeople: () => people,
}))

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
  syncState = 'present'
  relayBlob = undefined
  topics = [
    { id: 't1', title: 'CI/CD pipeline stuck', isResolved: false, folderId: 'u-1' },
    { id: 't2', title: 'Auth rollout', isResolved: true, folderId: null },
  ]
  people = [
    { id: GREG, name: 'Greg Bothman', avatarSrc: 'greg.png', pubkey: GREG },
    { id: JUAN, name: 'Juan Foley', avatarSrc: 'juan.png' },
  ]
})

describe('the list comes from the relay', () => {
  it('renders a topic the relay holds', async () => {
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
    relayBlob = aBlob([{ kind: 'dm', key: GREG }])
    const { result } = await setup()
    expect(result.current.items).toEqual([
      { id: `ow_dm_${GREG}`, kind: 'dm', dmId: GREG, name: 'Greg Bothman', avatarSrc: 'greg.png' },
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
      { kind: 'dm', key: GREG },
      { kind: 'topic', id: 't2' },
    ])
    const { result } = await setup()
    expect(result.current.items.map((i) => i.id)).toEqual(['ow_topic_t1', `ow_dm_${GREG}`, 'ow_topic_t2'])
  })

  it('hands the live working set the list, with the relay identity each entry carries', async () => {
    relayBlob = aBlob([
      { kind: 'topic', id: 't9', channelUuid: 'u-9' },
      { kind: 'dm', key: GREG },
    ])
    const { result } = await setup()
    expect(result.current.entries).toEqual([
      { kind: 'topic', id: 't9', channelUuid: 'u-9' },
      { kind: 'dm', key: GREG, pubkey: GREG },
    ])
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

  it('renders and publishes nothing while the relay has not answered — there is no fallback', async () => {
    // The guard the ticket asked to be kept: no answer is no list, and an empty
    // publish here is permanent. Convex used to fill this gap; nothing does now.
    syncState = 'unknown'
    relayBlob = undefined
    const { result } = await setup()
    expect(result.current.isLoading).toBe(true)
    expect(result.current.items).toEqual([])
    expect(result.current.entries).toEqual([])
    act(() => result.current.addTopics(['t1']))
    await act(async () => {})
    expect(publish).not.toHaveBeenCalled()
  })

  it('carries the relay identity when the index has it, and keeps the blob’s when it does not', async () => {
    // Decoration, never membership: an id the index cannot resolve keeps
    // whatever the blob already carried rather than losing its channel.
    relayBlob = aBlob([
      { kind: 'topic', id: 't9', channelUuid: 'u-9' },
      { kind: 'dm', key: GREG },
    ])
    await setup()
    await waitFor(() => expect(publish).toHaveBeenCalled())
    expect(publish.mock.calls.at(-1)?.[0]).toEqual([
      { kind: 'topic', id: 't9', channelUuid: 'u-9' },
      { kind: 'dm', key: GREG, pubkey: GREG },
    ])
  })

  it('moves an entry under the old Peek key to its stored pubkey, and drops one with none (REM-3)', async () => {
    relayBlob = aBlob([
      { kind: 'dm', key: 'kh7abc', pubkey: JUAN },
      { kind: 'dm', key: 'kh7def' },
      { kind: 'topic', id: 't1' },
    ])
    const { result } = await setup()
    expect(result.current.items.map((i) => i.id)).toEqual([`ow_dm_${JUAN}`, 'ow_topic_t1'])
    await waitFor(() => expect(publish).toHaveBeenCalled())
    expect(publish.mock.calls.at(-1)?.[0]).toEqual([
      { kind: 'dm', key: JUAN, pubkey: JUAN },
      { kind: 'topic', id: 't1', channelUuid: 'u-1' },
    ])
  })

  it('starts empty when the relay holds no list, with nothing seeded from Convex', async () => {
    // REM-4: Convex-only open work is dropped, not migrated (Miky, 2026-09-24).
    syncState = 'absent'
    relayBlob = undefined
    const { result } = await setup()
    expect(result.current.isLoading).toBe(false)
    expect(result.current.items).toEqual([])
    // Nothing is written until the person changes something: `absent` may be a
    // blob this version cannot read, and an empty list must not overwrite it.
    await act(async () => {})
    expect(publish).not.toHaveBeenCalled()
    act(() => result.current.addDm(GREG))
    await waitFor(() => expect(publish.mock.calls.at(-1)?.[0]).toEqual([{ kind: 'dm', key: GREG, pubkey: GREG }]))
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
    relayBlob = aBlob([{ kind: 'topic', id: 't1' }, { kind: 'dm', key: GREG }])
    const { result } = await setup()
    act(() => result.current.removeDm(GREG))
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
