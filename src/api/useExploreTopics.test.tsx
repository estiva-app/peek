/**
 * Explore topics' data (TOPI-6): every topic the Topics column read, by tab —
 * All, Other topics and Archived A to Z, Your topics in the column's order —
 * with Members and Active read for the tab on screen only, never on a cold
 * open of Peek. A topic you join is yours at once (Miky, 10 Nov).
 *
 * The column's hook, the teams list and the two relay reads are mocked: the
 * column has its own tests, the member count is tested at the wire in
 * `nostr/topicMembers.test.ts`, and the activity rule is interop's.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ForeignObject } from '@estiva-app/interop'

const PK = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const TEAM = '05bebd5b-b699-4bd4-af50-f5377df0fd67'
const topic = (d: string, title: string) => ({ ref: `30840:${PK}:${d}`, address: `30840:${PK}:${d}`, kind: 30840, folder: TEAM, slots: { title: { value: title } } }) as unknown as ForeignObject
const WIDGETS = topic('widgets', 'Widgets')
const ALPHA = topic('alpha', 'alpha')
const PRICING = topic('pricing', 'Pricing')
const BETA = topic('beta', 'Beta plan')
const OLD = topic('old', 'Level 2')

const column = vi.hoisted(() => ({
  state: 'loading' as unknown,
  signedOut: false,
  yours: undefined as ReadonlyMap<string, number> | undefined,
  readAgain: vi.fn(),
}))
vi.mock('./useTopicsColumn', () => ({
  useTopicsColumn: () => ({ state: column.state, signedOut: column.signedOut }),
  useTopicTimes: () => ({ yours: column.yours, createdAt: new Map() }),
  readTopicsAgain: column.readAgain,
}))
vi.mock('./useFolderContents', () => ({ useFolders: () => ({ folders: [{ id: TEAM, name: 'Product' }] }) }))
const viewer = { relayUrl: 'https://relay.test', token: { accessToken: 't', pubkey: PK } }
vi.mock('./foreign', () => ({ useRelayViewer: () => () => viewer }))
vi.mock('./relayUrl', () => ({ hasRelay: true }))
const reads = vi.hoisted(() => ({ members: vi.fn(), lists: vi.fn(), activity: vi.fn() }))
vi.mock('@/nostr/topicMembers', () => ({ topicMemberCountsAsViewer: reads.members }))
vi.mock('@/nostr/foreign', () => ({ topicListsAsViewer: reads.lists, topicActivityAsViewer: reads.activity }))

const { useExploreTopics, resetExploreTopics } = await import('./useExploreTopics')

const titles = (rows: { title: string }[]) => rows.map((row) => row.title)
const asked = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.flatMap(([topics]) => (topics as { address: string }[]).map((t) => t.address))

beforeEach(() => {
  resetExploreTopics()
  column.state = { mine: [WIDGETS, ALPHA], others: [PRICING, BETA], archived: [OLD] }
  column.signedOut = false
  column.yours = new Map([[WIDGETS.address!, 300], [ALPHA.address!, 200]])
  column.readAgain.mockReset()
  reads.members.mockReset().mockImplementation(async (topics: { address: string }[]) => new Map(topics.map((t) => [t.address, 4])))
  reads.lists.mockReset().mockResolvedValue(new Map())
  reads.activity.mockReset().mockImplementation(async (topics: { address: string }[]) => ({ at: new Map(topics.map((t) => [t.address, 100])) }))
})

describe('useExploreTopics', () => {
  it('lists All, Other topics and Archived A to Z, and Your topics in the column’s order', () => {
    const { result } = renderHook(() => useExploreTopics('yours'))
    const lists = result.current.state as Record<string, { title: string; team?: string; archived: boolean }[]>
    expect(titles(lists.all!)).toEqual(['alpha', 'Beta plan', 'Pricing', 'Widgets'])
    expect(titles(lists.yours!)).toEqual(['Widgets', 'alpha'])
    expect(titles(lists.others!)).toEqual(['Beta plan', 'Pricing'])
    expect(titles(lists.archived!)).toEqual(['Level 2'])
    expect(lists.archived![0]!.archived).toBe(true)
    expect(lists.all![0]!.team).toBe('Product')
  })

  it('reads Members for the tab on screen only, and Your topics’ Active is the column’s, with no read', async () => {
    const { result } = renderHook(() => useExploreTopics('yours'))
    await waitFor(() => expect(reads.members).toHaveBeenCalledTimes(1))
    expect(asked(reads.members)).toEqual([WIDGETS.address, ALPHA.address])
    expect(reads.activity).not.toHaveBeenCalled()
    await waitFor(() => expect((result.current.state as Record<string, { members?: number; active?: number }[]>).yours![0]).toMatchObject({ members: 4, active: 300 }))
  })

  it('reads Active for the topics that are not yours when their tab is shown', async () => {
    const { result, rerender } = renderHook(({ tab }) => useExploreTopics(tab), { initialProps: { tab: 'yours' as 'yours' | 'others' } })
    rerender({ tab: 'others' })
    await waitFor(() => expect(reads.activity).toHaveBeenCalledTimes(1))
    expect(asked(reads.activity)).toEqual([BETA.address, PRICING.address])
    await waitFor(() => expect((result.current.state as Record<string, { active?: number }[]>).others![0]!.active).toBe(100))
  })

  it('a topic left moves to Other topics as soon as the column hears it, and has its Members read again', async () => {
    const { result, rerender } = renderHook(({ tab }) => useExploreTopics(tab), { initialProps: { tab: 'yours' as const } })
    await waitFor(() => expect(asked(reads.members)).toContain(ALPHA.address))
    reads.members.mockImplementation(async (topics: { address: string }[]) => new Map(topics.map((t) => [t.address, 3])))
    // The column hears the leave: alpha is no longer yours.
    column.state = { mine: [WIDGETS], others: [ALPHA, PRICING, BETA], archived: [OLD] }
    rerender({ tab: 'yours' })
    const lists = () => result.current.state as Record<string, { title: string; members?: number; yours: boolean }[]>
    expect(titles(lists().others!)).toContain('alpha')
    await waitFor(() => expect(lists().all!.find((row) => row.title === 'alpha')!.members).toBe(3))
  })

  it('a topic joined moves to Your topics as soon as the column hears it, and has its Members read again', async () => {
    const { result, rerender } = renderHook(({ tab }) => useExploreTopics(tab), { initialProps: { tab: 'others' as const } })
    await waitFor(() => expect(asked(reads.members)).toContain(PRICING.address))
    reads.members.mockImplementation(async (topics: { address: string }[]) => new Map(topics.map((t) => [t.address, 5])))
    // The column hears the join: Pricing is yours.
    column.state = { mine: [WIDGETS, ALPHA, PRICING], others: [BETA], archived: [OLD] }
    rerender({ tab: 'others' })
    const lists = () => result.current.state as Record<string, { title: string; members?: number }[]>
    expect(titles(lists().yours!)).toContain('Pricing')
    expect(titles(lists().others!)).toEqual(['Beta plan'])
    await waitFor(() => expect(lists().all!.find((row) => row.title === 'Pricing')!.members).toBe(5))
  })

  it('says signed out, not loading, when nobody is signed in: the column never reads then', () => {
    column.state = 'loading'
    column.signedOut = true
    const { result } = renderHook(() => useExploreTopics('all'))
    expect(result.current.state).toBe('signedOut')
  })

  it('says the read failed when the column’s did, and Try again reads the topics again', () => {
    column.state = { failed: true }
    const { result } = renderHook(() => useExploreTopics('yours'))
    expect(result.current.state).toEqual({ failed: true })
    act(() => result.current.retry())
    expect(column.readAgain).toHaveBeenCalledTimes(1)
  })
})
