/**
 * Peek's Topics screen as its hook reads it (TOP-4): your topics A–Z with the
 * files their lists hold, the other topics apart, every list in one request,
 * and a topic's rows changed in the same tab when Add file or Remove writes
 * to it.
 *
 * The relay is faked at the bridge, so the reads asserted are the filters that
 * would reach it; titles and archive state come from a faked resolve, as the
 * Folder tree's tests have them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { planListInTopic, planRemoveFromTopic } from '@estiva-app/interop'

const VIEWER = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const FOLDER = '05bebd5b-b699-4bd4-af50-f5377df0fd67'
const OTHER_FOLDER = 'a1c3e3e0-6f0b-4d55-9a57-3b1d6f2f9e10'

type Event = { id: string; kind: number; pubkey: string; created_at: number; tags: string[][]; content: string; sig: string }
const relay = vi.hoisted(() => ({
  topics: [] as Event[],
  entries: [] as Event[],
  files: [] as Event[],
  queryRelay: vi.fn(),
}))
vi.mock('@/nostr/bridge', () => ({ publishSigned: vi.fn(), signViaEstivaId: vi.fn(), queryRelay: relay.queryRelay }))
vi.mock('@/api/relayUrl', () => ({ RELAY_URL: 'https://relay.test', hasRelay: true }))
vi.mock('@/auth/heldSession', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/auth/heldSession')),
  heldToken: () => ({ accessToken: 't', pubkey: VIEWER }),
}))
const seen = vi.hoisted(() => ({
  objects: {} as Record<string, unknown>,
  /** Archived with a file above it: marked only when read `archivedWith`, as interop marks it. */
  withParent: {} as Record<string, unknown>,
  members: new Set<string>(),
}))
const resolveSeen = vi.hoisted(() => (ref: string, archivedWith = false) => {
  const object = seen.objects[ref] as Record<string, unknown> | undefined
  if (!object) return null
  return archivedWith && seen.withParent[ref] && !object.archived ? { ...object, archived: seen.withParent[ref] } : object
})
vi.mock('./foreign', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('./foreign')),
  useResolvedReferences: (refs: readonly string[], options?: { archivedWith?: boolean }) =>
    Object.fromEntries(refs.map((ref) => [ref, resolveSeen(ref, options?.archivedWith)])),
}))
vi.mock('@/nostr/foreign', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/nostr/foreign')),
  resolveObjectAsViewer: async (ref: string, _relay: string, _token: unknown, options?: { archivedWith?: boolean }) => resolveSeen(ref, options?.archivedWith),
}))
vi.mock('@/api/internal/membership', () => ({
  useMembership: () => ({ state: 'known', isMember: (key: string) => seen.members.has(key) }),
}))

import { fileArchiveChanged, resetTopicsColumn, topicListChanged, useTopicsColumn } from './useTopicsColumn'

const d = (address: string) => address.split(':')[2]!
const event = (kind: number, tags: string[][], at = 100): Event => ({ id: `${kind}-${tags[0]?.[1]}-${at}`, kind, pubkey: VIEWER, created_at: at, tags, content: '', sig: '' })
const topicAt = (dd: string) => `30840:${VIEWER}:${dd}`

const WIDGETS = topicAt('7a384136-31a6-4d91-80ac-1d599464d2f2')
const ALPHA = topicAt('1e2f3a4b-0000-4000-8000-000000000001')
const STRANGER = topicAt('1e2f3a4b-0000-4000-8000-000000000002')
const ARCHIVED = topicAt('1e2f3a4b-0000-4000-8000-000000000003')
const BUILD_1 = `30850:${VIEWER}:0ebd5fdd-c58a-416e-b8a7-cbdcec77b77f`
const TESTING = `30851:${VIEWER}:c579e675-6365-4b62-9cc1-d14495c22ca2`
const GONE = `30851:${VIEWER}:dddddddd-0000-4000-8000-00000000dead`

const object = (address: string, title: string, extra: Record<string, unknown> = {}) => ({
  ref: address,
  address,
  kind: Number(address.split(':')[0]),
  folder: FOLDER,
  slots: { title: { value: title } },
  ...extra,
})

function list(topic: string, file: string, listed = true, at = 200) {
  const plan = listed ? planListInTopic : planRemoveFromTopic
  for (const unsigned of plan(VIEWER, at * 1000, { topic: { address: topic, folder: FOLDER }, file: d(file) })) {
    relay.entries.push({ id: `e${relay.entries.length}`, pubkey: VIEWER, content: '', sig: '', ...(unsigned as Omit<Event, 'id' | 'pubkey' | 'content' | 'sig'>), created_at: at })
  }
}

/** Every `#O` request the hook sent: each is the topics whose lists it read. */
const listReads = () =>
  relay.queryRelay.mock.calls
    .map(([, filters]) => filters as Array<Record<string, unknown>>)
    .filter((filters) => filters.some((f) => f['#O']))
    .map((filters) => filters.flatMap((f) => f['#O'] as string[]))

const titlesOf = (state: ReturnType<typeof useTopicsColumn>['state']) => {
  if (typeof state !== 'object' || 'failed' in state) return state
  return {
    mine: state.mine.map(({ topic, files }) => [topic.slots.title?.value, files.map((file) => file.slots.title?.value)]),
    others: state.others.map((topic) => topic.slots.title?.value),
    // `?? []`: on code from before Archived, the archived-with tests fail on what is listed, not on a missing field.
    archived: (state.archived ?? []).map((topic) => topic.slots.title?.value),
  }
}

beforeEach(() => {
  resetTopicsColumn()
  relay.entries = []
  relay.topics = [WIDGETS, ALPHA, STRANGER, ARCHIVED].map((address) => event(30840, [['d', d(address)], ['h', FOLDER]]))
  relay.files = [event(30850, [['d', d(BUILD_1)], ['h', OTHER_FOLDER]]), event(30851, [['d', d(TESTING)], ['h', OTHER_FOLDER]])]
  seen.objects = {
    [WIDGETS]: object(WIDGETS, 'Widgets'),
    [ALPHA]: object(ALPHA, 'alpha'),
    [STRANGER]: object(STRANGER, 'Somebody else’s'),
    [ARCHIVED]: object(ARCHIVED, 'Old', { archived: { by: VIEWER, at: 1 } }),
    [BUILD_1]: object(BUILD_1, 'Widgets 2: build 1'),
    [TESTING]: object(TESTING, 'Testing Widgets'),
  }
  seen.withParent = {}
  seen.members = new Set([WIDGETS, ALPHA, ARCHIVED])
  relay.queryRelay.mockReset().mockImplementation(async (_url: string, filters: Array<Record<string, unknown>>) => {
    const events = filters.flatMap((f) => {
      if (f['#O']) return relay.entries.filter((e) => e.tags.some((t) => t[0] === 'O' && (f['#O'] as string[]).includes(t[1]!)))
      const kinds = f.kinds as number[]
      const pool = [...relay.topics, ...relay.files].filter((e) => kinds.includes(e.kind))
      const ds = f['#d'] as string[] | undefined
      return ds ? pool.filter((e) => ds.includes(e.tags.find((t) => t[0] === 'd')![1]!)) : pool
    })
    return { ok: true, events }
  })
})

describe('the Topics screen’s topics (TOP-4)', () => {
  it('lists your topics A–Z, each with its files from any Folder; other topics apart; an archived topic only under Archived', async () => {
    list(WIDGETS, BUILD_1, true, 200)
    list(WIDGETS, TESTING, true, 201)
    const { result } = renderHook(() => useTopicsColumn())
    await waitFor(() => expect(typeof result.current.state).toBe('object'))
    expect(titlesOf(result.current.state)).toEqual({
      mine: [
        ['alpha', []],
        ['Widgets', ['Widgets 2: build 1', 'Testing Widgets']],
      ],
      others: ['Somebody else’s'],
      archived: ['Old'],
    })
  })

  it('a topic archived with the project above it is under Archived, not among yours or the other topics (b1ace226)', async () => {
    const PROJECT = `30850:${VIEWER}:archived-project`
    seen.withParent[ALPHA] = { by: VIEWER, at: 1, with: PROJECT }
    seen.withParent[STRANGER] = { by: VIEWER, at: 1, with: PROJECT }
    const { result } = renderHook(() => useTopicsColumn())
    await waitFor(() => expect(typeof result.current.state).toBe('object'))
    expect(titlesOf(result.current.state)).toEqual({ mine: [['Widgets', []]], others: [], archived: ['alpha', 'Old', 'Somebody else’s'] })
  })

  it('a listed file archived on its own or with its project is not among its topic’s files, but behind its Archived line (b1ace226)', async () => {
    list(WIDGETS, BUILD_1, true, 200)
    list(WIDGETS, TESTING, true, 201)
    seen.objects[BUILD_1] = object(BUILD_1, 'Widgets 2: build 1', { archived: { by: VIEWER, at: 1 } })
    seen.withParent[TESTING] = { by: VIEWER, at: 1, with: `30850:${VIEWER}:archived-project` }
    const { result } = renderHook(() => useTopicsColumn())
    await waitFor(() => expect(typeof result.current.state).toBe('object'))
    expect(titlesOf(result.current.state)).toMatchObject({ mine: [['alpha', []], ['Widgets', []]] })
    const state = result.current.state as Extract<typeof result.current.state, { mine: unknown }>
    expect(state.mine[1]!.archivedFiles?.map((file) => file.slots.title?.value)).toEqual(['Widgets 2: build 1', 'Testing Widgets'])
    // Opened by link, an archived file a topic of yours lists still belongs under Topics.
    expect(result.current.column(TESTING)).toBe('topics')
  })

  it('a topic archived in this tab moves to Archived without a reload, and unarchived moves back (b1ace226)', async () => {
    const { result } = renderHook(() => useTopicsColumn())
    await waitFor(() => expect(typeof result.current.state).toBe('object'))
    seen.objects[WIDGETS] = object(WIDGETS, 'Widgets', { archived: { by: VIEWER, at: 2 } })
    await act(() => fileArchiveChanged(WIDGETS))
    expect(titlesOf(result.current.state)).toMatchObject({ mine: [['alpha', []]], archived: ['Old', 'Widgets'] })
    seen.objects[WIDGETS] = object(WIDGETS, 'Widgets')
    await act(() => fileArchiveChanged(WIDGETS))
    expect(titlesOf(result.current.state)).toMatchObject({ mine: [['alpha', []], ['Widgets', []]], archived: ['Old'] })
  })

  it('Archive then Undo at once: the later re-read is drawn even when the earlier one answers last (b1ace226)', async () => {
    const { result } = renderHook(() => useTopicsColumn())
    await waitFor(() => expect(typeof result.current.state).toBe('object'))
    const nostr = await import('@/nostr/foreign')
    let answerArchive: (value: unknown) => void = () => {}
    const resolve = vi.spyOn(nostr, 'resolveObjectAsViewer')
    resolve.mockImplementationOnce(() => new Promise((done) => (answerArchive = done)) as never)
    resolve.mockImplementationOnce(async () => object(WIDGETS, 'Widgets') as never)
    const archiving = fileArchiveChanged(WIDGETS)
    await act(() => fileArchiveChanged(WIDGETS))
    await act(async () => {
      answerArchive(object(WIDGETS, 'Widgets', { archived: { by: VIEWER, at: 2 } }))
      await archiving
    })
    expect(titlesOf(result.current.state)).toMatchObject({ mine: [['alpha', []], ['Widgets', []]], archived: ['Old'] })
    resolve.mockRestore()
  })

  it('a file two of your topics list is under both', async () => {
    list(WIDGETS, TESTING)
    list(ALPHA, TESTING)
    const { result } = renderHook(() => useTopicsColumn())
    await waitFor(() => expect(typeof result.current.state).toBe('object'))
    expect(titlesOf(result.current.state)).toMatchObject({ mine: [['alpha', ['Testing Widgets']], ['Widgets', ['Testing Widgets']]] })
  })

  it('a listed file that resolves to nothing — unreadable or deleted — is not drawn', async () => {
    list(WIDGETS, TESTING)
    list(WIDGETS, GONE)
    const { result } = renderHook(() => useTopicsColumn())
    await waitFor(() => expect(typeof result.current.state).toBe('object'))
    expect(titlesOf(result.current.state)).toMatchObject({ mine: [['alpha', []], ['Widgets', ['Testing Widgets']]] })
  })

  it('reads every one of your topics’ lists in one request, not one per topic', async () => {
    const { result } = renderHook(() => useTopicsColumn())
    await waitFor(() => expect(typeof result.current.state).toBe('object'))
    expect(listReads()).toHaveLength(1)
    expect(listReads()[0]!.sort()).toEqual([d(ALPHA), d(WIDGETS)].sort())
  })

  it('a file added on a topic’s page shows under that topic in the same tab, reading only that topic again', async () => {
    list(WIDGETS, BUILD_1, true, 200)
    const { result } = renderHook(() => useTopicsColumn())
    await waitFor(() => expect(titlesOf(result.current.state)).toMatchObject({ mine: [['alpha', []], ['Widgets', ['Widgets 2: build 1']]] }))
    list(WIDGETS, TESTING, true, 300)
    act(() => topicListChanged(WIDGETS))
    await waitFor(() =>
      expect(titlesOf(result.current.state)).toMatchObject({ mine: [['alpha', []], ['Widgets', ['Widgets 2: build 1', 'Testing Widgets']]] }),
    )
    expect(listReads().at(-1)).toEqual([d(WIDGETS)])
  })

  it('a file removed on a topic’s page leaves that topic’s rows in the same tab', async () => {
    list(WIDGETS, BUILD_1, true, 200)
    const { result } = renderHook(() => useTopicsColumn())
    await waitFor(() => expect(titlesOf(result.current.state)).toMatchObject({ mine: [['alpha', []], ['Widgets', ['Widgets 2: build 1']]] }))
    list(WIDGETS, BUILD_1, false, 300)
    act(() => topicListChanged(WIDGETS))
    await waitFor(() => expect(titlesOf(result.current.state)).toMatchObject({ mine: [['alpha', []], ['Widgets', []]] }))
  })

  it('a topic joined from Other topics moves up among yours, with its files', async () => {
    list(STRANGER, TESTING)
    const { result, rerender } = renderHook(() => useTopicsColumn())
    await waitFor(() => expect(titlesOf(result.current.state)).toMatchObject({ others: ['Somebody else’s'] }))
    seen.members = new Set([...seen.members, STRANGER])
    rerender()
    await waitFor(() =>
      expect(titlesOf(result.current.state)).toEqual({
        mine: [['alpha', []], ['Somebody else’s', ['Testing Widgets']], ['Widgets', []]],
        others: [],
        archived: ['Old'],
      }),
    )
  })

  it('a file opened by link belongs under Topics when a topic of yours is it or lists it, else under Folders', async () => {
    list(WIDGETS, TESTING)
    const { result } = renderHook(() => useTopicsColumn())
    await waitFor(() => expect(typeof result.current.state).toBe('object'))
    expect(result.current.column(TESTING)).toBe('topics')
    expect(result.current.column(WIDGETS)).toBe('topics')
    expect(result.current.column(BUILD_1)).toBe('folders')
    expect(result.current.column(STRANGER)).toBe('folders')
  })
})
