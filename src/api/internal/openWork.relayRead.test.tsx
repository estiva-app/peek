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
 * rendering a row needs `usePeople` to resolve an id, and deriving the
 * *publish* from the rendered rows would drop every entry the index was a beat
 * behind on. FOL-23 made that case permanent for a topic entry, which never
 * renders again and must still never be dropped.
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
const CY = 'c'.repeat(64)

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

const PEOPLE = [
  { id: GREG, name: 'Greg Bothman', avatarSrc: 'greg.png', pubkey: GREG },
  { id: JUAN, name: 'Juan Foley', avatarSrc: 'juan.png', pubkey: JUAN },
  { id: CY, name: 'Cy Twombly', avatarSrc: 'cy.png', pubkey: CY },
]
let people: unknown = PEOPLE
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
  people = PEOPLE
})

describe('the list comes from the relay', () => {
  it('renders a DM entry the relay holds', async () => {
    relayBlob = aBlob([{ kind: 'dm', key: GREG }])
    const { result } = await setup()
    expect(result.current.items).toEqual([
      { id: `ow_dm_${GREG}`, kind: 'dm', dmId: GREG, name: 'Greg Bothman', avatarSrc: 'greg.png' },
    ])
    expect(result.current.isLoading).toBe(false)
  })

  it('renders in the blob order', async () => {
    relayBlob = aBlob([
      { kind: 'dm', key: JUAN },
      { kind: 'dm', key: GREG },
      { kind: 'dm', key: CY },
    ])
    const { result } = await setup()
    expect(result.current.items.map((i) => i.id)).toEqual([`ow_dm_${JUAN}`, `ow_dm_${GREG}`, `ow_dm_${CY}`])
  })
})

describe('what is published is the list, never the rows that could be drawn', () => {
  it('keeps a topic entry, which draws nothing since FOL-23, and publishes it back unchanged', async () => {
    relayBlob = aBlob([
      { kind: 'topic', id: 't1', channelUuid: 'u-1' },
      { kind: 'dm', key: GREG },
    ])
    const { result } = await setup()
    expect(result.current.items.map((i) => i.id)).toEqual([`ow_dm_${GREG}`])
    await waitFor(() => expect(publish).toHaveBeenCalled())
    expect(publish.mock.calls.at(-1)?.[0]).toEqual([
      { kind: 'topic', id: 't1', channelUuid: 'u-1' },
      { kind: 'dm', key: GREG, pubkey: GREG },
    ])
  })

  it('keeps a person the index cannot resolve yet, and publishes them', async () => {
    // The flip's own trap: a slow index must not delete someone from the
    // person's list for good.
    people = PEOPLE.filter((p) => p.id !== JUAN)
    relayBlob = aBlob([{ kind: 'dm', key: GREG }, { kind: 'dm', key: JUAN }])
    const { result } = await setup()
    expect(result.current.items.map((i) => i.id)).toEqual([`ow_dm_${GREG}`])
    await waitFor(() => expect(publish).toHaveBeenCalled())
    expect(publish.mock.calls.at(-1)?.[0].map((e) => (e.kind === 'dm' ? e.key : e.id))).toEqual([GREG, JUAN])
  })

  it('renders and publishes nothing while the relay has not answered — there is no fallback', async () => {
    // The guard the ticket asked to be kept: no answer is no list, and an empty
    // publish here is permanent. Convex used to fill this gap; nothing does now.
    syncState = 'unknown'
    relayBlob = undefined
    const { result } = await setup()
    expect(result.current.isLoading).toBe(true)
    expect(result.current.items).toEqual([])
    act(() => result.current.addDm(GREG))
    await act(async () => {})
    expect(publish).not.toHaveBeenCalled()
  })

  it('moves an entry under the old Peek key to its stored pubkey, and drops one with none (REM-3)', async () => {
    relayBlob = aBlob([
      { kind: 'dm', key: 'kh7abc', pubkey: JUAN },
      { kind: 'dm', key: 'kh7def' },
      { kind: 'dm', key: GREG },
    ])
    const { result } = await setup()
    expect(result.current.items.map((i) => i.id)).toEqual([`ow_dm_${JUAN}`, `ow_dm_${GREG}`])
    await waitFor(() => expect(publish).toHaveBeenCalled())
    expect(publish.mock.calls.at(-1)?.[0]).toEqual([
      { kind: 'dm', key: JUAN, pubkey: JUAN },
      { kind: 'dm', key: GREG, pubkey: GREG },
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
    relayBlob = aBlob([{ kind: 'dm', key: GREG }])
    const { result } = await setup()
    act(() => result.current.addDm(JUAN))
    expect(result.current.items.map((i) => i.id)).toEqual([`ow_dm_${GREG}`, `ow_dm_${JUAN}`])
    await waitFor(() =>
      expect(publish.mock.calls.at(-1)?.[0]).toEqual([
        { kind: 'dm', key: GREG, pubkey: GREG },
        { kind: 'dm', key: JUAN, pubkey: JUAN },
      ]),
    )
  })

  it('keeps additions in the order they were made, with no timestamp left to tie on', async () => {
    // `desk.ts` needed strictly increasing `addedAt` because a batch inserted
    // inside one millisecond tied and sorted back to click order, flipping the
    // rows the overlay had drawn. A Map's insertion order cannot tie.
    relayBlob = aBlob([])
    const { result } = await setup()
    act(() => {
      result.current.addDm(JUAN)
      result.current.addDm(GREG)
    })
    expect(result.current.items.map((i) => i.id)).toEqual([`ow_dm_${JUAN}`, `ow_dm_${GREG}`])
  })

  it('drops an entry from the rendered list and from what is published', async () => {
    relayBlob = aBlob([{ kind: 'dm', key: JUAN }, { kind: 'dm', key: GREG }])
    const { result } = await setup()
    act(() => result.current.removeDm(GREG))
    expect(result.current.items.map((i) => i.id)).toEqual([`ow_dm_${JUAN}`])
    await waitFor(() => expect(publish.mock.calls.at(-1)?.[0]).toEqual([{ kind: 'dm', key: JUAN, pubkey: JUAN }]))
  })

  it('keeps the overlay when the relay list catches up, rather than adding twice', async () => {
    relayBlob = aBlob([])
    const { result, rerender } = await setup()
    act(() => result.current.addDm(GREG))
    relayBlob = aBlob([{ kind: 'dm', key: GREG }])
    rerender()
    expect(result.current.items.map((i) => i.id)).toEqual([`ow_dm_${GREG}`])
  })

  it('moves a re-added entry to the end rather than back into the slot it left', async () => {
    relayBlob = aBlob([{ kind: 'dm', key: GREG }, { kind: 'dm', key: JUAN }])
    const { result } = await setup()
    act(() => result.current.removeDm(GREG))
    act(() => result.current.addDm(GREG))
    expect(result.current.items.map((i) => i.id)).toEqual([`ow_dm_${JUAN}`, `ow_dm_${GREG}`])
  })
})
