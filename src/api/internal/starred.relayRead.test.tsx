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
 * `usePeople` to resolve an id, and deriving the *publish* from the rendered
 * rows would drop every star the index was a beat behind on. FOL-23 made that
 * case permanent for a starred topic, which never renders again and must still
 * never be dropped.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

/** A starred person is their pubkey since REM-3. */
const GREG = 'a'.repeat(64)
const JUAN = 'b'.repeat(64)

vi.mock('@/api/relayUrl', () => ({ RELAY_URL: 'https://relay.test', hasRelay: true }))

const PEOPLE = [
  { id: GREG, name: 'Greg Bothman', avatarSrc: 'greg.png' },
  { id: JUAN, name: 'Juan Foley', avatarSrc: 'juan.png' },
]
let people: unknown = PEOPLE
vi.mock('@/api/people', async (importOriginal) => ({
  isPersonKey: (await importOriginal<typeof import('@/api/people')>()).isPersonKey,
  useWorkspacePeople: () => people,
}))

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
  syncState = 'present'
  relayBlob = undefined
  people = PEOPLE
})

describe('the set comes from the relay', () => {
  it('renders a starred person the relay holds', async () => {
    relayBlob = aBlob([], [GREG])
    const { result } = await setup()
    expect(result.current.entries).toEqual([
      { id: `star_dm_${GREG}`, kind: 'dm', dmId: GREG, name: 'Greg Bothman', avatarSrc: 'greg.png' },
    ])
    expect(result.current.isDmStarred(GREG)).toBe(true)
    expect(result.current.isLoading).toBe(false)
  })

  it('moves a star written under the old Peek key to the pubkey stored beside it (REM-3)', async () => {
    relayBlob = { ...aBlob([], []), people: [{ key: 'kh7abc', pubkey: GREG }] }
    const { result } = await setup()
    expect(result.current.isDmStarred(GREG)).toBe(true)
    await waitFor(() => expect(publish).toHaveBeenCalled())
    expect(publish.mock.calls.at(-1)?.[0]).toEqual({ topics: [], people: [{ key: GREG, pubkey: GREG }] })
  })

  it('drops an old-key star with no pubkey — nothing can say whose it is', async () => {
    relayBlob = { ...aBlob(['t1'], []), people: [{ key: 'kh7abc' }, { key: JUAN }] }
    const { result } = await setup()
    expect(result.current.isDmStarred('kh7abc')).toBe(false)
    await waitFor(() => expect(publish).toHaveBeenCalled())
    expect(publish.mock.calls.at(-1)?.[0]).toEqual({ topics: [{ id: 't1' }], people: [{ key: JUAN, pubkey: JUAN }] })
  })

  it('sorts people by name', async () => {
    relayBlob = aBlob([], [JUAN, GREG])
    const { result } = await setup()
    expect(result.current.entries.map((e) => e.name)).toEqual(['Greg Bothman', 'Juan Foley'])
  })
})

describe('what is published is the set, never the rows that could be drawn', () => {
  it('keeps a starred topic, which draws nothing since FOL-23, and publishes it back', async () => {
    relayBlob = aBlob(['t1', 't9'], [GREG])
    const { result } = await setup()
    expect(result.current.entries.map((e) => e.id)).toEqual([`star_dm_${GREG}`])
    await waitFor(() => expect(publish).toHaveBeenCalled())
    expect(publish.mock.calls.at(-1)?.[0]).toEqual({
      topics: [{ id: 't1' }, { id: 't9' }],
      people: [{ key: GREG, pubkey: GREG }],
    })
  })

  it('keeps a person the index cannot resolve yet, and publishes them', async () => {
    people = PEOPLE.filter((p) => p.id !== JUAN)
    relayBlob = aBlob([], [GREG, JUAN])
    const { result } = await setup()
    expect(result.current.entries.map((e) => e.id)).toEqual([`star_dm_${GREG}`])
    expect(result.current.isDmStarred(JUAN)).toBe(true)
    await waitFor(() => expect(publish).toHaveBeenCalled())
    expect(publish.mock.calls.at(-1)?.[0].people.map((p) => p.key)).toEqual([GREG, JUAN])
  })

  it('renders and publishes nothing while the relay has not answered — there is no fallback', async () => {
    // The guard the ticket asked to be kept: no answer is no set, and an empty
    // publish here is permanent. Convex used to fill this gap; nothing does now.
    syncState = 'unknown'
    relayBlob = undefined
    const { result } = await setup()
    expect(result.current.isLoading).toBe(true)
    expect(result.current.entries).toEqual([])
    act(() => result.current.toggleDm({ dmId: GREG, name: 'Greg Bothman' }))
    await act(async () => {})
    expect(publish).not.toHaveBeenCalled()
  })

  it('starts empty when the relay holds no set', async () => {
    // REM-4: Convex-only stars are dropped, not migrated (Miky, 2026-09-24).
    syncState = 'absent'
    relayBlob = undefined
    const { result } = await setup()
    expect(result.current.isLoading).toBe(false)
    expect(result.current.entries).toEqual([])
    // Nothing is written until the person toggles: `absent` may be a blob this
    // version cannot read, and an empty set must not overwrite it.
    await act(async () => {})
    expect(publish).not.toHaveBeenCalled()
    act(() => result.current.toggleDm({ dmId: GREG, name: 'Greg Bothman' }))
    await waitFor(() =>
      expect(publish.mock.calls.at(-1)?.[0]).toEqual({ topics: [], people: [{ key: GREG, pubkey: GREG }] }),
    )
  })
})

describe('toggling', () => {
  it('drops a star from the rendered set and from what is published', async () => {
    relayBlob = aBlob(['t1'], [GREG, JUAN])
    const { result } = await setup()
    act(() => result.current.toggleDm({ dmId: GREG, name: 'Greg Bothman' }))
    expect(result.current.isDmStarred(GREG)).toBe(false)
    expect(result.current.entries.map((e) => e.id)).toEqual([`star_dm_${JUAN}`])
    await waitFor(() =>
      expect(publish.mock.calls.at(-1)?.[0]).toEqual({ topics: [{ id: 't1' }], people: [{ key: JUAN, pubkey: JUAN }] }),
    )
  })

  it('adds a person optimistically, over a relay set that does not have them yet', async () => {
    relayBlob = aBlob([], [])
    const { result } = await setup()
    act(() => result.current.toggleDm({ dmId: JUAN, name: 'Juan Foley' }))
    expect(result.current.isDmStarred(JUAN)).toBe(true)
    expect(result.current.entries).toEqual([
      { id: `star_dm_${JUAN}`, kind: 'dm', dmId: JUAN, name: 'Juan Foley', avatarSrc: 'juan.png' },
    ])
    await waitFor(() => expect(publish.mock.calls.at(-1)?.[0]).toEqual({ topics: [], people: [{ key: JUAN, pubkey: JUAN }] }))
  })

  it('keeps the overlay when the relay set catches up, rather than starring twice', async () => {
    relayBlob = aBlob([], [])
    const { result, rerender } = await setup()
    act(() => result.current.toggleDm({ dmId: JUAN, name: 'Juan Foley' }))
    relayBlob = aBlob([], [JUAN])
    rerender()
    expect(result.current.entries.map((e) => e.id)).toEqual([`star_dm_${JUAN}`])
  })
})
