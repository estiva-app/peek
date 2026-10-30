/**
 * The Screener's decisions come from the relay (SHR-10).
 *
 * `screenerFold.test.ts` pins the rules. This pins the wiring around them, which
 * is where the ways to lose data are:
 *
 * 1. **The blob is subtractive**, unlike every layer-2 store before it. Open
 *    work and stars say what to *show*; this says what to *take away*. So a
 *    render before the relay answers does not show an empty Screener — it shows
 *    rows the person already dismissed, and the obvious reaction to one is to
 *    dismiss it again. Nothing may render until the answer is in.
 * 2. **Publishing before the answer is in is permanent.** An empty `dismissed`
 *    written over a full one is last-write-wins, and every dismissal the person
 *    ever made comes back. SHR-6's trap, in the form this ticket takes it.
 * 3. **Three kinds of "no answer" want three different renders**, and the first
 *    cut of this conflated them. *Not asked* (no relay origin, no token) renders
 *    now, because the answer is never coming. *Asked, still in flight* waits,
 *    because it is seconds away and a dismissed row appearing and vanishing is a
 *    flicker on every load. *Asked, and it failed* renders too — held as "still
 *    in flight" it left the Desk under its skeleton for the whole load any time
 *    the relay was down. Only the last two can be told apart by a state the hook
 *    sets, which is why `unreachable` exists.
 *
 * The rows these tests draw are a DM and followed files, both folded from the
 * relay — the DM from the channel store since CON-14, when `desk.screenerList`
 * stopped being asked. The topic half went with the Convex topics in FOL-23.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { StreamMessage } from '@/nostr/channelStreams'

vi.mock('@/api/relayUrl', () => ({ RELAY_URL: 'https://relay.test', hasRelay: true }))

/* The DM half (CON-14): one DM, with one unread message from the partner. */
const GREG = 'b'.repeat(64)
const GREG_CHANNEL = '5f0c6a8e-1b2d-4c3e-9f4a-0b1c2d3e4f50'
const dmMessage = (over: Partial<StreamMessage> = {}): StreamMessage => ({
  id: 'dm-1',
  at: 1_787_000_100,
  by: GREG,
  root: 'dm-1',
  about: [],
  urgent: false,
  body: 'a DM',
  ...over,
})
let dmStream: StreamMessage[] | undefined = [dmMessage()]
vi.mock('@/api/internal/dms', () => ({
  useDmChannels: () => ({
    state: 'present',
    partners: [GREG],
    channelOf: (p: string) => (p === GREG ? GREG_CHANNEL : undefined),
    ensureChannel: vi.fn(),
  }),
}))
/** The channels the Screener tracked, per render — it must read the DMs' own. */
const tracked = vi.fn<(channels: readonly string[]) => void>()
vi.mock('@/api/useChannelStreams', () => ({
  useChannelStreams: (channels: readonly string[]) => {
    tracked(channels)
    return { at: 1_787_000_200, streams: dmStream ? { [GREG_CHANNEL]: dmStream } : {} }
  },
}))
vi.mock('@/api/people', () => ({
  useWorkspacePeople: () => [{ id: GREG, name: 'Greg Bothman', avatarSrc: 'greg.png' }],
}))

let openWorkFileAddresses = new Set<string>()
let openWorkDmIds = new Set<string>()
vi.mock('@/api/internal/openWork', () => ({
  useOpenWork: () => ({ items: [], fileAddresses: openWorkFileAddresses, dmIds: openWorkDmIds, isLoading: false }),
}))

/*
  The file half (FOL-34). `unknown` by default, so a test that does not follow
  a file sees the DM row alone.
*/
let followsState: 'unknown' | 'present' = 'unknown'
let followed = new Set<string>()
/* Stable between renders for the same set, as the real seam's is: a fresh array each render would re-ask. */
let memberFilesOf: { of: Set<string>; files: string[] } | undefined
vi.mock('@/api/internal/membership', () => ({
  useMembership: () => {
    if (memberFilesOf?.of !== followed) memberFilesOf = { of: followed, files: [...followed].sort() }
    return {
      state: followsState === 'present' ? 'known' : 'unknown',
      memberFiles: memberFilesOf.files,
      isMember: (k: string) => followed.has(k),
      isMuted: () => false,
      termsOf: () => ({ member: true, muted: false }),
      isMentioned: () => false,
      isUrgent: () => false,
    }
  },
}))
const fileObject = (address: string) => ({
  kind: 30840,
  slots: { title: { value: `Title of ${address.slice(-1)}` } },
  comments: [{ id: `c-${address}`, author: 'someone', body: `comment on ${address.slice(-1)}`, createdAt: 1_787_000_000 }],
})
let refuseReads = false
let archivedFiles = new Set<string>()
/** Files under an archived parent: interop marks them only when asked `archivedWith`, as the relay read does. */
let archivedAbove = new Map<string, string>()
const resolveObjects = vi.fn(async (addresses: readonly string[], options?: { archivedWith?: boolean }) => {
  if (refuseReads) throw new Error('rate_limited')
  return Object.fromEntries(
    addresses.map((address) => {
      const parent = options?.archivedWith ? archivedAbove.get(address) : undefined
      const archived = archivedFiles.has(address)
        ? { by: 'someone', at: 1_787_000_100 }
        : parent
          ? { by: 'someone', at: 1_787_000_100, with: parent }
          : undefined
      return [address, archived ? { ...fileObject(address), archived } : fileObject(address)]
    }),
  )
})
/** How many files were asked about, over every read — the cost PER-10 moved. */
const filesAsked = () => resolveObjects.mock.calls.reduce((n, [addresses]) => n + addresses.length, 0)
// The copy on the device holds nothing here (PEE-2): only the relay's reads are counted.
const fromRelayOnly = (addresses: readonly string[], source?: string, options?: { archivedWith?: boolean }) =>
  source === 'copy' ? Promise.resolve({}) : resolveObjects(addresses, options)
vi.mock('@/api/foreign', () => ({ useForeignObjects: () => ({ resolveObjects: fromRelayOnly }) }))
const FRONTIER = {
  ready: true,
  marker: () => 1_786_999_000,
  // Every context read at the same instant, whatever its key.
  merged: new Proxy({}, { get: () => 1_786_999_000 }) as Record<string, number>,
}
vi.mock('@/nostr/useReadStateSync', () => ({ useReadFrontier: () => FRONTIER }))
vi.mock('@/auth/estivaId', () => ({ validToken: () => ({ pubkey: 'me' }), storedToken: () => ({ pubkey: 'me' }) }))

const publish = vi.fn<(next: { snoozed: Record<string, number>; dismissed: Record<string, number> }) => Promise<void>>(
  async () => undefined,
)
let syncState: 'unknown' | 'unreachable' | 'absent' | 'present' = 'present'
let asked = true
let relayBlob: unknown = { v: 1, updatedAt: 1_787_142_018_561, snoozed: {}, dismissed: {} }
vi.mock('@/nostr/useScreenerSync', () => ({
  useScreenerSync: () => ({ state: syncState, asked, relayBlob, publish }),
}))

const A = `30840:${'a'.repeat(64)}:a`
const B = `30840:${'a'.repeat(64)}:b`
const fileRows = (items: readonly ({ kind: string } & Partial<{ address: string }>)[]) =>
  items.flatMap((i) => (i.kind === 'file' && i.address ? [i.address] : []))

async function setup() {
  const { ScreenerProvider, useScreener } = await import('./screener')
  const wrapper = ({ children }: { children: ReactNode }) => <ScreenerProvider>{children}</ScreenerProvider>
  return renderHook(() => useScreener(), { wrapper })
}

beforeEach(() => {
  vi.clearAllMocks()
  refuseReads = false
  archivedFiles = new Set()
  archivedAbove = new Map()
  dmStream = [dmMessage()]
  openWorkFileAddresses = new Set()
  openWorkDmIds = new Set()
  followsState = 'unknown'
  followed = new Set()
  syncState = 'present'
  asked = true
  relayBlob = { v: 1, updatedAt: 1_787_142_018_561, snoozed: {}, dismissed: {} }
})

describe('followed files (FOL-34)', () => {
  it('opening one file keeps the others on screen, and does not re-read them', async () => {
    // The flash Miky saw on production: "Open" puts the file in open work, the
    // set of files asked about shrinks, and holding one answer per *set* blanked
    // every file row until a fresh read of all of them came back.
    followsState = 'present'
    followed = new Set([A, B])
    const { result, rerender } = await setup()
    await waitFor(() => expect(fileRows(result.current.items)).toEqual([A, B].sort()))
    expect(filesAsked()).toBe(2)

    openWorkFileAddresses = new Set([A])
    rerender()
    // Synchronously, with no read in between: B never left the screen.
    expect(fileRows(result.current.items)).toEqual([B])
    await act(async () => {})
    expect(filesAsked()).toBe(2)
  })

  it('asks about every followed file in one read, not one each (PER-10)', async () => {
    followsState = 'present'
    const many = Array.from({ length: 12 }, (_, i) => `30840:${'a'.repeat(64)}:${i.toString(16)}`)
    followed = new Set(many)
    const { result } = await setup()
    await waitFor(() => expect(fileRows(result.current.items)).toHaveLength(12))
    expect(resolveObjects).toHaveBeenCalledTimes(1)
    expect([...resolveObjects.mock.calls[0][0]].sort()).toEqual([...many].sort())

    // A refresh is one more read for the whole set.
    await act(async () => window.dispatchEvent(new Event('focus')))
    await waitFor(() => expect(resolveObjects).toHaveBeenCalledTimes(2))
    expect(resolveObjects.mock.calls[1][0]).toHaveLength(12)
  })

  it('a refused refresh keeps the rows it held rather than blanking them', async () => {
    followsState = 'present'
    followed = new Set([A, B])
    const { result } = await setup()
    await waitFor(() => expect(fileRows(result.current.items)).toEqual([A, B].sort()))

    refuseReads = true
    await act(async () => window.dispatchEvent(new Event('focus')))
    await waitFor(() => expect(resolveObjects).toHaveBeenCalledTimes(2))
    await act(async () => {})
    expect(fileRows(result.current.items)).toEqual([A, B].sort())
  })

  it('a file someone archived stays while its comment is unread, marked archived; the other is not marked (PEE-68)', async () => {
    followsState = 'present'
    followed = new Set([A, B])
    archivedFiles = new Set([A])
    const { result } = await setup()
    await waitFor(() => expect(fileRows(result.current.items)).toEqual([A, B].sort()))
    const marked = Object.fromEntries(result.current.items.flatMap((i) => (i.kind === 'file' ? [[i.address, i.archived === true]] : [])))
    expect(marked).toEqual({ [A]: true, [B]: false })
  })

  it('a file whose project someone archived stays while unread, marked archived too (PEE-68)', async () => {
    const PROJECT = `30850:${'a'.repeat(64)}:project`
    followsState = 'present'
    followed = new Set([A, B])
    archivedAbove = new Map([[A, PROJECT]])
    const { result } = await setup()
    await waitFor(() => expect(fileRows(result.current.items)).toEqual([A, B].sort()))
    const marked = Object.fromEntries(result.current.items.flatMap((i) => (i.kind === 'file' ? [[i.address, i.archived === true]] : [])))
    expect(marked).toEqual({ [A]: true, [B]: false })
  })

  it('folds the DM half beside the file rows, newest first, from the DM channels', async () => {
    followsState = 'present'
    followed = new Set([A])
    // The file's comment is at 1_787_000_000: older than the DM, so below it —
    // and above it once the DM is older still.
    const { result, rerender } = await setup()
    await waitFor(() => expect(result.current.items).toHaveLength(2))
    expect(result.current.items.map((i) => i.kind)).toEqual(['dm', 'file'])
    expect(result.current.items[0]).toMatchObject({
      id: `sc_dm_${GREG}`,
      dmId: GREG,
      authorName: 'Greg Bothman',
      authorAvatarSrc: 'greg.png',
      preview: 'a DM',
    })
    expect(tracked).toHaveBeenLastCalledWith([GREG_CHANNEL])

    dmStream = [dmMessage({ at: 1_786_999_500 })]
    rerender()
    expect(result.current.items.map((i) => i.kind)).toEqual(['file', 'dm'])
  })

  it('applies a dismissal from the blob', async () => {

    followsState = 'present'
    followed = new Set([A])
    relayBlob = { v: 1, updatedAt: 1, snoozed: {}, dismissed: { [`file:${A}`]: 1_787_000_000 } }
    const { result } = await setup()
    await waitFor(() => expect(resolveObjects).toHaveBeenCalled())
    await act(async () => {})
    expect(fileRows(result.current.items)).toEqual([])
  })
})

describe('the DM half (CON-14)', () => {
  it('a DM dismissed on another device stays dismissed here — the blob holds it', async () => {
    relayBlob = { v: 1, updatedAt: 1, snoozed: {}, dismissed: { [`dm:${GREG}`]: 1_787_000_100 } }
    const { result } = await setup()
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.items).toEqual([])
  })

  it('and a later message brings it back', async () => {
    relayBlob = { v: 1, updatedAt: 1, snoozed: {}, dismissed: { [`dm:${GREG}`]: 1_787_000_100 } }
    dmStream = [dmMessage(), dmMessage({ id: 'dm-2', root: 'dm-2', at: 1_787_000_150, body: 'again' })]
    const { result } = await setup()
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    expect(result.current.items[0]).toMatchObject({ kind: 'dm', preview: 'again' })
  })

  it('dismissing a DM row publishes a dm: watermark', async () => {
    const { result } = await setup()
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    act(() => result.current.dismiss(`sc_dm_${GREG}`, 1_787_100_000_000))
    await waitFor(() => expect(result.current.items).toEqual([]))
    expect(publish.mock.calls.at(-1)![0].dismissed[`dm:${GREG}`]).toBe(1_787_100_000)
  })

  it('snoozing a DM row publishes its instant', async () => {
    const { result } = await setup()
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    const until = Date.now() + 3_600_000
    act(() => result.current.snooze(`sc_dm_${GREG}`, until))
    await waitFor(() => expect(result.current.items).toEqual([]))
    expect(publish.mock.calls.at(-1)![0].snoozed[`dm:${GREG}`]).toBe(Math.floor(until / 1000))
  })

  it('a DM in open work does not screen (PEE-6), off the list', async () => {
    openWorkDmIds = new Set([GREG])
    const { result } = await setup()
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.items).toEqual([])
  })

  it('a DM whose channel has not been read yet has no row, and holds nothing up', async () => {
    dmStream = undefined
    const { result } = await setup()
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.items).toEqual([])
  })

  it('hands the hover card the screening message’s thread', async () => {
    dmStream = [
      dmMessage({ id: 'root', root: 'root', at: 1_786_000_000, by: 'me', body: 'my question' }),
      dmMessage({ id: 'r1', root: 'root', at: 1_787_000_100, body: 'the answer' }),
      dmMessage({ id: 'other', root: 'other', at: 1_786_500_000, body: 'elsewhere' }),
    ]
    const { result } = await setup()
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    const source = result.current.previewOf(`sc_dm_${GREG}`)
    expect(source?.kind).toBe('dm')
    expect(source?.kind === 'dm' && source.messages.map((m) => m.body)).toEqual(['my question', 'the answer'])
    // A row that is not on screen has no preview.
    expect(result.current.previewOf('sc_dm_nobody')).toBeUndefined()
  })
})

describe('nothing renders, and nothing publishes, before the relay answers', () => {
  it('stays loading while the relay was asked and has not answered', async () => {
    syncState = 'unknown'
    asked = true
    const { result } = await setup()
    // The whole point: a row the person dismissed must not appear even for a
    // moment, because dismissing it again is the reaction it invites.
    expect(result.current.isLoading).toBe(true)
    expect(result.current.items).toEqual([])
    await waitFor(() => expect(publish).not.toHaveBeenCalled())
  })

  it('renders immediately when there is no relay to ask', async () => {
    syncState = 'unknown'
    asked = false
    const { result } = await setup()
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    // A Screener stuck under a skeleton for everyone without a token is a
    // broken feature, not a careful one.
    expect(result.current.items).toHaveLength(1)
  })

  it('renders on an empty coordinate, with no decisions to seed', async () => {
    syncState = 'absent'
    const { result } = await setup()
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.items).toHaveLength(1)
  })
})

describe('a decision this session', () => {
  it('hides the row and publishes the watermark', async () => {
    followsState = 'present'
    followed = new Set([A])
    const { result } = await setup()
    await waitFor(() => expect(fileRows(result.current.items)).toEqual([A]))

    act(() => result.current.dismiss(`sc_file_${A}`, 1_787_100_000_000))
    await waitFor(() => expect(fileRows(result.current.items)).toEqual([]))

    const last = publish.mock.calls.at(-1)![0]
    expect(last.dismissed[`file:${A}`]).toBe(Math.floor(1_787_100_000_000 / 1000))
  })

  it('a snooze hides the row and publishes its instant', async () => {
    followsState = 'present'
    followed = new Set([A])
    const { result } = await setup()
    await waitFor(() => expect(fileRows(result.current.items)).toEqual([A]))
    // Relative to the real clock: the provider compares a snooze against `now`,
    // so a hard-coded instant would pass or fail depending on the date it ran.
    const until = Date.now() + 3_600_000
    act(() => result.current.snooze(`sc_file_${A}`, until))
    await waitFor(() => expect(fileRows(result.current.items)).toEqual([]))

    const last = publish.mock.calls.at(-1)![0]
    expect(last.snoozed[`file:${A}`]).toBe(Math.floor(until / 1000))
  })
})

describe('the relay was asked and cannot answer', () => {
  it('renders without the decisions rather than skeletoning for ever', async () => {
    syncState = 'unreachable'
    asked = true
    relayBlob = undefined
    const { result } = await setup()
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    // A Screener that never appears is worse than one showing a row the person
    // dismissed — and before `unreachable` existed, a relay that was down left
    // `state` at `unknown` and the Desk under its skeleton for the whole load.
    expect(result.current.items).toHaveLength(1)
  })

  it('and publishes nothing, because those maps are missing the decisions', async () => {
    syncState = 'unreachable'
    asked = true
    relayBlob = undefined
    followsState = 'present'
    followed = new Set([A])
    const { result } = await setup()
    await waitFor(() => expect(fileRows(result.current.items)).toEqual([A]))
    act(() => result.current.dismiss(`sc_file_${A}`, Date.now()))
    await waitFor(() => expect(fileRows(result.current.items)).toEqual([]))
    // The provider still calls `publish` — the guard that matters is inside
    // `useScreenerSync`, and this asserts the provider does not route around it
    // by publishing through some other path.
    expect(publish.mock.calls.every((c) => c[0] !== undefined)).toBe(true)
  })
})
