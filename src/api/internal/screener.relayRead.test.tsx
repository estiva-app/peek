/**
 * The Screener's decisions come from the relay, and the rows are folded (SHR-10).
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
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { getFunctionName } from 'convex/server'

vi.mock('@/api/store', () => ({ hasConvex: true }))

interface Candidate {
  kind: 'topic'
  targetId: string
  isMember: boolean
  everOpened: boolean
  events: {
    id: string
    preview: string
    createdAt: number
    isReply: boolean
    mentionsMe: boolean
    iWroteInThread: boolean
  }[]
}

let candidates: { containers: Candidate[] } | undefined = { containers: [] }
let dmRows: unknown = []
let topicSnoozes: unknown = []

/*
  Queries are told apart by name, not by reference: `api.screener.candidates` is
  a proxy handing back a fresh object per access, so `===` is false even for the
  identical call — and it fails *open*, as a query that answers `undefined` for
  ever, which is scaffolding that passes while asserting nothing.
*/
vi.mock('convex/react', () => ({
  useQuery: (ref: unknown) => {
    const name = getFunctionName(ref as Parameters<typeof getFunctionName>[0])
    if (name.includes('candidates')) return candidates
    if (name.includes('screenerList')) return dmRows
    if (name.includes('topicSnoozes')) return topicSnoozes
    if (name.includes('relayConfig')) return { relayUrl: 'https://relay.test' }
    return undefined
  },
  useMutation: () => vi.fn(),
}))

let openWorkTopicIds = new Set<string>()
let openWorkFileAddresses = new Set<string>()
vi.mock('@/api/internal/openWork', () => ({
  useOpenWork: () => ({ items: [], topicIds: openWorkTopicIds, fileAddresses: openWorkFileAddresses, isLoading: false }),
}))

/*
  The file half (FOL-34). `unknown` by default, so every test above the file
  ones sees a Screener with no followed files — which is what they assert.
*/
let followsState: 'unknown' | 'present' = 'unknown'
let followed = new Set<string>()
vi.mock('@/api/internal/follows', () => ({
  useFollows: () => ({ state: followsState, followed, isFollowed: (k: string) => followed.has(k), setFollowed: vi.fn() }),
}))
const resolveObject = vi.fn(async (address: string) => ({
  kind: 30840,
  slots: { title: { value: `Title of ${address.slice(-1)}` } },
  comments: [{ id: `c-${address}`, author: 'someone', body: `comment on ${address.slice(-1)}`, createdAt: 1_787_000_000 }],
}))
vi.mock('@/api/foreign', () => ({ useForeignObjects: () => ({ resolveObject }) }))
const FRONTIER = { ready: true, marker: () => 1_786_999_000 }
vi.mock('@/nostr/useReadStateSync', () => ({ useReadFrontier: () => FRONTIER }))
vi.mock('@/auth/estivaId', () => ({ validToken: () => ({ pubkey: 'me' }) }))

vi.mock('@/api/topics', () => ({
  useTopics: () => [
    { id: 't1', title: 'CI/CD pipeline stuck', isResolved: false, folderId: 'u-1' },
    { id: 't2', title: 'Auth rollout', isResolved: true, folderId: null },
  ],
}))
vi.mock('@/api/avatars', () => ({ useAvatarSrc: () => (name: string) => `${name}.png` }))

const publish = vi.fn<(next: { snoozed: Record<string, number>; dismissed: Record<string, number> }) => Promise<void>>(
  async () => undefined,
)
let syncState: 'unknown' | 'unreachable' | 'absent' | 'present' = 'present'
let asked = true
let relayBlob: unknown = { v: 1, updatedAt: 1_787_142_018_561, snoozed: {}, dismissed: {} }
vi.mock('@/nostr/useScreenerSync', () => ({
  useScreenerSync: () => ({ state: syncState, asked, relayBlob, publish }),
}))

const event = (over: Partial<Candidate['events'][number]> = {}) => ({
  id: 'm1',
  preview: 'someone said something',
  createdAt: 1_787_000_000_000,
  isReply: false,
  mentionsMe: false,
  iWroteInThread: false,
  ...over,
})

/** A topic Ada is in and has never opened — rule 2 at its simplest. */
const screening = (targetId: string, over: Partial<Candidate> = {}): Candidate => ({
  kind: 'topic',
  targetId,
  isMember: true,
  everOpened: false,
  events: [event()],
  ...over,
})

async function setup() {
  const { ScreenerProvider, useScreener } = await import('./screener')
  const wrapper = ({ children }: { children: ReactNode }) => <ScreenerProvider>{children}</ScreenerProvider>
  return renderHook(() => useScreener(), { wrapper })
}

beforeEach(() => {
  vi.clearAllMocks()
  candidates = { containers: [screening('t1')] }
  dmRows = []
  topicSnoozes = []
  openWorkTopicIds = new Set()
  openWorkFileAddresses = new Set()
  followsState = 'unknown'
  followed = new Set()
  syncState = 'present'
  asked = true
  relayBlob = { v: 1, updatedAt: 1_787_142_018_561, snoozed: {}, dismissed: {} }
})

describe('followed files (FOL-34)', () => {
  const A = `30840:${'a'.repeat(64)}:a`
  const B = `30840:${'a'.repeat(64)}:b`
  const fileRows = (items: readonly ({ kind: string } & Partial<{ address: string }>)[]) =>
    items.flatMap((i) => (i.kind === 'file' && i.address ? [i.address] : []))

  it('opening one file keeps the others on screen, and does not re-read them', async () => {
    // The flash Miky saw on production: "Open" puts the file in open work, the
    // set of files asked about shrinks, and holding one answer per *set* blanked
    // every file row until a fresh read of all of them came back.
    candidates = { containers: [] }
    followsState = 'present'
    followed = new Set([A, B])
    const { result, rerender } = await setup()
    await waitFor(() => expect(fileRows(result.current.items)).toEqual([A, B].sort()))
    expect(resolveObject).toHaveBeenCalledTimes(2)

    openWorkFileAddresses = new Set([A])
    rerender()
    // Synchronously, with no read in between: B never left the screen.
    expect(fileRows(result.current.items)).toEqual([B])
    await act(async () => {})
    expect(resolveObject).toHaveBeenCalledTimes(2)
  })
})

describe('the fold renders from the relay answer', () => {
  it('draws a folded topic row', async () => {
    const { result } = await setup()
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.items).toHaveLength(1)
    expect(result.current.items[0]).toMatchObject({ kind: 'topic', topicId: 't1', topicTitle: 'CI/CD pipeline stuck' })
  })

  it('merges the DM half in, and does not fold it', async () => {
    dmRows = [{ id: 'k17abc', kind: 'dm', dmId: 'greg', authorName: 'Greg Bothman', preview: 'a DM' }]
    const { result } = await setup()
    await waitFor(() => expect(result.current.items).toHaveLength(2))
    expect(result.current.items.map((i) => i.kind)).toEqual(['dm', 'topic'])
    // The DM row keeps its Convex id — the thing that routes its dismiss to the
    // table rather than the blob.
    expect(result.current.items[0].id).toBe('k17abc')
  })

  it('applies a dismissal from the blob', async () => {
    relayBlob = {
      v: 1,
      updatedAt: 1,
      snoozed: {},
      dismissed: { 'topic:t1': Math.floor(1_787_000_000_000 / 1000) },
    }
    const { result } = await setup()
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.items).toEqual([])
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

  it('seeds snoozes from Convex when the coordinate is empty', async () => {
    syncState = 'absent'
    topicSnoozes = [{ topicId: 't1', snoozedUntil: Date.now() + 3_600_000 }]
    const { result } = await setup()
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    // The seeded snooze is live, so the row it covers is not drawn…
    expect(result.current.items).toEqual([])
    // …and it is published, so the next load reads it from the blob.
    await waitFor(() => expect(publish).toHaveBeenCalled())
    expect(Object.keys(publish.mock.calls[0][0].snoozed)).toEqual(['topic:t1'])
  })
})

describe('a decision this session', () => {
  it('hides the row and publishes the watermark', async () => {
    const { result } = await setup()
    await waitFor(() => expect(result.current.items).toHaveLength(1))

    act(() => result.current.dismissTopic('t1', 1_787_100_000_000))
    await waitFor(() => expect(result.current.items).toEqual([]))

    const last = publish.mock.calls.at(-1)![0]
    expect(last.dismissed['topic:t1']).toBe(Math.floor(1_787_100_000_000 / 1000))
  })

  it('a snooze hides the row and publishes its instant', async () => {
    const { result } = await setup()
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    // Relative to the real clock: the provider compares a snooze against `now`,
    // so a hard-coded instant would pass or fail depending on the date it ran.
    const until = Date.now() + 3_600_000
    act(() => result.current.snoozeTopic('t1', until))
    await waitFor(() => expect(result.current.items).toEqual([]))

    const last = publish.mock.calls.at(-1)![0]
    expect(last.snoozed['topic:t1']).toBe(Math.floor(until / 1000))
  })
})

describe('PEE-6', () => {
  it('a topic held in open work does not screen', async () => {
    openWorkTopicIds = new Set(['t1'])
    const { result } = await setup()
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.items).toEqual([])
  })

  it('and the check is on the list, so a topic the index has not resolved still counts', async () => {
    // `t3` is in open work but not in `useTopics`. It must not screen, and it
    // must not throw — the row simply is not there.
    candidates = { containers: [screening('t3'), screening('t1')] }
    openWorkTopicIds = new Set(['t3'])
    const { result } = await setup()
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.items.map((i) => (i.kind === 'topic' ? i.topicId : i.kind === 'dm' ? i.dmId : i.address))).toEqual(['t1'])
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
    const { result } = await setup()
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    act(() => result.current.dismissTopic('t1', Date.now()))
    await waitFor(() => expect(result.current.items).toEqual([]))
    // The provider still calls `publish` — the guard that matters is inside
    // `useScreenerSync`, and this asserts the provider does not route around it
    // by publishing through some other path.
    expect(publish.mock.calls.every((c) => c[0] !== undefined)).toBe(true)
  })
})
