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
import { buildLevelChange, buildMembershipChange } from '@estiva-app/conversation'

const VIEWER = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const FOLDER = '05bebd5b-b699-4bd4-af50-f5377df0fd67'
const OTHER_FOLDER = 'a1c3e3e0-6f0b-4d55-9a57-3b1d6f2f9e10'

type Event = { id: string; kind: number; pubkey: string; created_at: number; tags: string[][]; content: string; sig: string }
const relay = vi.hoisted(() => ({
  topics: [] as Event[],
  entries: [] as Event[],
  files: [] as Event[],
  /** Membership changes and comments, answered to the filters that name a person. */
  changes: [] as Event[],
  /** Messages, changes and comments on topics and their files: what the order of topics is read from (TOPI-10). */
  activity: [] as Event[],
  queryRelay: vi.fn(),
}))
vi.mock('@/nostr/bridge', () => ({ publishSigned: vi.fn(), signViaEstivaId: vi.fn(), queryRelay: relay.queryRelay }))
/** The tab's socket: each live subscription the hook opens, to deliver an event to as the relay would. */
const socket = vi.hoisted(() => ({
  subs: [] as Array<{ filters: Record<string, unknown>[]; onEvent: (event: unknown) => void; closed: boolean }>,
}))
vi.mock('@/nostr/liveTopics', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/nostr/liveTopics')),
  getLiveClient: () => ({
    relay: {
      subscribe: (filters: Record<string, unknown>[], onEvent: (event: unknown) => void) => {
        const sub = { filters, onEvent, closed: false }
        socket.subs.push(sub)
        return { close: () => (sub.closed = true) }
      },
    },
  }),
}))
vi.mock('@/api/relayUrl', () => ({ RELAY_URL: 'https://relay.test', hasRelay: true }))
vi.mock('@/auth/heldSession', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/auth/heldSession')),
  heldToken: () => ({ accessToken: 't', pubkey: VIEWER }),
}))
const seen = vi.hoisted(() => ({
  objects: {} as Record<string, unknown>,
  /** Archived with a file above it: marked only when read `archivedWith`, as interop marks it. */
  withParent: {} as Record<string, unknown>,
  /** The changes naming the viewer inside the membership read's 90-day horizon. */
  horizon: [] as Event[],
  /** Files the viewer muted (`estiva:muted:v1`). */
  muted: new Set<string>(),
  /** Every reference a hook asked to resolve. */
  resolved: [] as string[],
}))
const resolveSeen = vi.hoisted(() => (ref: string, archivedWith = false) => {
  const object = seen.objects[ref] as Record<string, unknown> | undefined
  if (!object) return null
  return archivedWith && seen.withParent[ref] && !object.archived ? { ...object, archived: seen.withParent[ref] } : object
})
vi.mock('./foreign', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('./foreign')),
  useResolvedReferences: (refs: readonly string[], options?: { archivedWith?: boolean }) => {
    seen.resolved.push(...refs)
    return Object.fromEntries(refs.map((ref) => [ref, resolveSeen(ref, options?.archivedWith)]))
  },
}))
vi.mock('@/nostr/foreign', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/nostr/foreign')),
  resolveObjectAsViewer: async (ref: string, _relay: string, _token: unknown, options?: { archivedWith?: boolean }) => resolveSeen(ref, options?.archivedWith),
}))
// The membership read as the shared fold takes it: who you are, its horizon, the changes naming you inside it, your mutes.
vi.mock('@/api/internal/membership', () => ({
  useMembership: () => ({
    state: 'known',
    me: VIEWER,
    floor: Math.floor(Date.now() / 1000) - 90 * 24 * 60 * 60,
    changesOf: (key: string) => seen.horizon.filter((e) => e.tags.some((t) => t[0] === 'a' && t[1] === key)),
    termsOf: (key: string) => ({ member: false, muted: seen.muted.has(key) }),
  }),
}))

import * as topicsColumnModule from './useTopicsColumn'
import { fileArchiveChanged, resetTopicsColumn, topicListChanged, useTopicsColumn } from './useTopicsColumn'
import type { ListedNews } from './placeDots'

/**
 * Your topics' listed files' news (TOPI-3), read off the module so that on code without it this file still loads and
 * the test says, on its assertion, that nothing reached it.
 */
const listedNews = (): ReadonlyMap<string, ListedNews> =>
  (topicsColumnModule as { useListedNews?: () => ReadonlyMap<string, ListedNews> }).useListedNews?.() ?? new Map()
import { forgetProjectFields } from '@/nostr/projectFields'
import { TOPIC_ORDER_KEY } from '@/lib/topicOrder'
import { useTeamTopics } from './useTeams'

/** The relay's NIP-11 document, as the tab reads it once per page. */
let nip11: Record<string, unknown> = {}

const d = (address: string) => address.split(':')[2]!
const event = (kind: number, tags: string[][], at = 100): Event => ({ id: `${kind}-${tags[0]?.[1]}-${at}`, kind, pubkey: VIEWER, created_at: at, tags, content: '', sig: '' })
const topicAt = (dd: string) => `30840:${VIEWER}:${dd}`

const WIDGETS = topicAt('7a384136-31a6-4d91-80ac-1d599464d2f2')
const ALPHA = topicAt('1e2f3a4b-0000-4000-8000-000000000001')
const SOMEBODY = 'c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00'
// Somebody else's: a topic whose address is the viewer's is theirs from creation, on its page as here.
const STRANGER = `30840:${SOMEBODY}:1e2f3a4b-0000-4000-8000-000000000002`
const ARCHIVED = topicAt('1e2f3a4b-0000-4000-8000-000000000003')
const BUILD_1 = `30850:${VIEWER}:0ebd5fdd-c58a-416e-b8a7-cbdcec77b77f`
const TESTING = `30851:${VIEWER}:c579e675-6365-4b62-9cc1-d14495c22ca2`

/** A topic somebody else started, as the topics re-published on 15 Sep are. */
const OLD = `30840:${SOMEBODY}:1e2f3a4b-0000-4000-8000-000000000004`
const DAY = 24 * 60 * 60

function addOldTopic() {
  relay.topics.push({ ...event(30840, [['d', d(OLD)], ['h', FOLDER]]), pubkey: SOMEBODY })
  seen.objects[OLD] = object(OLD, 'Pitch')
}

const signedAs = (signer: string, id: string, at: number, unsigned: unknown): Event => ({
  id,
  pubkey: signer,
  content: '',
  sig: '',
  ...(unsigned as Omit<Event, 'id' | 'pubkey' | 'content' | 'sig'>),
  created_at: at,
})

/** The viewer's Join of `OLD` 100 days ago, before the membership read's 90-day horizon — or an Add of them by `signer`. */
function oldJoin(signer = VIEWER): Event {
  const at = Math.floor(Date.now() / 1000) - 100 * DAY
  return signedAs(signer, 'join-old', at, buildMembershipChange(signer, at * 1000, { file: OLD, folder: FOLDER, person: VIEWER, member: true }))
}

/** A join (or leave) of the viewer's on `topic` a day ago, inside the horizon. */
function recentMembership(topic: string, member: boolean, daysAgo = 1): Event {
  const at = Math.floor(Date.now() / 1000) - daysAgo * DAY
  return signedAs(VIEWER, `${member ? 'join' : 'leave'}-${topic}-${at}`, at, buildMembershipChange(VIEWER, at * 1000, { file: topic, folder: FOLDER, person: VIEWER, member }))
}

/** A level the viewer chose on `topic` with the switch, `daysAgo` days ago. */
function level(topic: string, value: 'all' | 'important', daysAgo = 1): Event {
  const at = Math.floor(Date.now() / 1000) - daysAgo * DAY
  return signedAs(VIEWER, `level-${topic}-${at}`, at, buildLevelChange(VIEWER, at * 1000, { place: topic, folder: FOLDER, level: value }))
}

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

/** A filter for the changes and comments that can make one person a member, not a topic's list or root. */
const namesAPerson = (f: Record<string, unknown>) =>
  !f['#O'] && (f.kinds as number[]).some((kind) => kind === 1851 || kind === 1111) && !!(f['#p'] || f.authors)

/** A list read: list entries (`kind:1851`) by the topics' `O`. */
const isListRead = (f: Record<string, unknown>) => !!f['#O'] && (f.kinds as number[]).includes(1851)
/** Every list request the hook sent: each is the topics whose lists it read. */
const listReads = () =>
  relay.queryRelay.mock.calls
    .map(([, filters]) => filters as Array<Record<string, unknown>>)
    .filter((filters) => filters.some(isListRead))
    .map((filters) => filters.filter(isListRead).flatMap((f) => f['#O'] as string[]))
/** Every request of the order's read: a topic's conversation by its `A` is its first filter. */
const activityReads = () =>
  relay.queryRelay.mock.calls
    .map(([, filters]) => filters as Array<Record<string, unknown>>)
    .filter((filters) => filters.some((f) => (f.kinds as number[]).includes(9)))

/** As the relay answers one filter: by kind, author, every `#x` tag, `until`, newest first, cut at `limit`. */
function answer(f: Record<string, unknown>, pool: readonly Event[]): Event[] {
  const found = pool.filter(
    (e) =>
      (f.kinds as number[]).includes(e.kind) &&
      (!f.authors || (f.authors as string[]).includes(e.pubkey)) &&
      (f.until === undefined || e.created_at <= (f.until as number)) &&
      Object.entries(f).every(([key, values]) => !key.startsWith('#') || e.tags.some((t) => t[0] === key.slice(1) && (values as string[]).includes(t[1]!))),
  )
  found.sort((a, b) => b.created_at - a.created_at)
  return typeof f.limit === 'number' ? found.slice(0, f.limit) : found
}

/** A message in `topic` by somebody, `at` Unix seconds. */
const message = (topic: string, at: number, id = `m-${topic}-${at}`): Event => ({ ...event(9, [['A', topic], ['h', FOLDER]], at), id, pubkey: SOMEBODY })

const titlesOf = (state: ReturnType<typeof useTopicsColumn>['state']) => {
  if (typeof state !== 'object' || 'failed' in state) return state
  return {
    mine: state.mine.map((topic) => topic.slots.title?.value),
    others: state.others.map((topic) => topic.slots.title?.value),
    // `?? []`: on code from before Archived, the archived-with tests fail on what is listed, not on a missing field.
    archived: (state.archived ?? []).map((topic) => topic.slots.title?.value),
  }
}

beforeEach(() => {
  resetTopicsColumn()
  forgetProjectFields()
  nip11 = { supported_extensions: ['nip-er'] }
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => nip11 })))
  relay.entries = []
  relay.topics = [WIDGETS, ALPHA, STRANGER, ARCHIVED].map((address) => ({ ...event(30840, [['d', d(address)], ['h', FOLDER]]), pubkey: address.split(':')[1]! }))
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
  // WIDGETS, ALPHA and ARCHIVED are the viewer's own: theirs from creation.
  seen.horizon = []
  seen.muted = new Set()
  seen.resolved = []
  relay.changes = []
  relay.activity = []
  socket.subs = []
  window.localStorage.clear()
  relay.queryRelay.mockReset().mockImplementation(async (_url: string, filters: Array<Record<string, unknown>>) => {
    const events = filters.flatMap((f) =>
      // The membership read's changes naming a person; every other filter over all the relay holds.
      namesAPerson(f) ? answer(f, relay.changes) : answer(f, [...relay.topics, ...relay.files, ...relay.entries, ...relay.activity]),
    )
    return { ok: true, events }
  })
})

describe('the Topics screen’s topics (TOP-4, TOPI-10)', () => {
  it('lists your topics flat, the one where something last happened first, not A–Z; other topics apart; an archived topic only under Archived', async () => {
    relay.activity = [message(ALPHA, 400), message(WIDGETS, 500)]
    const { result } = renderHook(() => useTopicsColumn())
    await waitFor(() => expect(typeof result.current.state).toBe('object'))
    expect(titlesOf(result.current.state)).toEqual({ mine: ['Widgets', 'alpha'], others: ['Somebody else’s'], archived: ['Old'] })
  })

  it('a change to a file a topic lists, in that file’s own team, moves the topic up (TOPI-10)', async () => {
    list(ALPHA, TESTING, true, 200)
    relay.activity = [message(WIDGETS, 400), { ...event(1851, [['a', TESTING], ['h', OTHER_FOLDER], ['field', 'status'], ['value', 'done']], 500), id: 'status' }]
    const { result } = renderHook(() => useTopicsColumn())
    await waitFor(() => expect(titlesOf(result.current.state)).toMatchObject({ mine: ['alpha', 'Widgets'] }))
  })

  it('a rename of a topic does not move it up (TOPI-10, Miky 9 Nov)', async () => {
    relay.activity = [message(ALPHA, 400), { ...event(1851, [['a', WIDGETS], ['h', FOLDER], ['field', 'title'], ['value', 'Widgets!']], 900), id: 'rename' }]
    const { result } = renderHook(() => useTopicsColumn())
    await waitFor(() => expect(typeof result.current.state).toBe('object'))
    expect(titlesOf(result.current.state)).toMatchObject({ mine: ['alpha', 'Widgets'] })
  })

  it('reads the order of all your topics together, every topic’s conversation in one request', async () => {
    const { result } = renderHook(() => useTopicsColumn())
    await waitFor(() => expect(typeof result.current.state).toBe('object'))
    expect(activityReads()).toHaveLength(1)
    const conversations = activityReads()[0]!.filter((f) => (f.kinds as number[]).includes(9)).flatMap((f) => f['#A'] as string[])
    expect(conversations.sort()).toEqual([ALPHA, WIDGETS].sort())
  })

  it('a message heard live moves its topic to the top without a reload, and the order is kept for the next visit (TOPI-10)', async () => {
    relay.activity = [message(ALPHA, 400)]
    const { result } = renderHook(() => useTopicsColumn())
    await waitFor(() => expect(titlesOf(result.current.state)).toMatchObject({ mine: ['alpha', 'Widgets'] }))
    const now = Math.floor(Date.now() / 1000)
    const live = socket.subs.filter((sub) => !sub.closed)
    expect(live).toHaveLength(1)
    act(() => live[0]!.onEvent(message(WIDGETS, now)))
    expect(titlesOf(result.current.state)).toMatchObject({ mine: ['Widgets', 'alpha'] })
    expect(JSON.parse(window.localStorage.getItem(`${TOPIC_ORDER_KEY}.${VIEWER}`)!)).toMatchObject({ [WIDGETS]: now, [ALPHA]: 400 })
  })

  it('a rename heard live does not move its topic (TOPI-10)', async () => {
    relay.activity = [message(ALPHA, 400)]
    const { result } = renderHook(() => useTopicsColumn())
    await waitFor(() => expect(titlesOf(result.current.state)).toMatchObject({ mine: ['alpha', 'Widgets'] }))
    const rename = { ...event(1851, [['a', WIDGETS], ['h', FOLDER], ['field', 'title'], ['value', 'Widgets!']], Math.floor(Date.now() / 1000)), id: 'rename-live' }
    act(() => socket.subs[0]!.onEvent(rename))
    expect(titlesOf(result.current.state)).toMatchObject({ mine: ['alpha', 'Widgets'] })
  })

  it('draws the order this browser last saw at once, while the order is read again (TOPI-10)', async () => {
    window.localStorage.setItem(`${TOPIC_ORDER_KEY}.${VIEWER}`, JSON.stringify({ [WIDGETS]: 900, [ALPHA]: 300 }))
    const answered = relay.queryRelay.getMockImplementation()!
    // The order's read never answers.
    relay.queryRelay.mockImplementation((url: string, filters: Array<Record<string, unknown>>) =>
      filters.some((f) => (f.kinds as number[]).includes(9)) ? new Promise(() => {}) : answered(url, filters),
    )
    const { result } = renderHook(() => useTopicsColumn())
    await waitFor(() => expect(titlesOf(result.current.state)).toMatchObject({ mine: ['Widgets', 'alpha'] }))
  })

  it('the first time on this browser, a skeleton until the order is read, never a list that then jumps (TOPI-10)', async () => {
    let answerOrder: () => void = () => {}
    const answered = relay.queryRelay.getMockImplementation()!
    relay.queryRelay.mockImplementation((url: string, filters: Array<Record<string, unknown>>) =>
      filters.some((f) => (f.kinds as number[]).includes(9))
        ? new Promise((done) => (answerOrder = () => done(answered(url, filters))))
        : answered(url, filters),
    )
    relay.activity = [message(WIDGETS, 500)]
    const { result } = renderHook(() => useTopicsColumn())
    await waitFor(() => expect(activityReads()).toHaveLength(1))
    expect(result.current.state).toBe('loading')
    await act(async () => answerOrder())
    await waitFor(() => expect(titlesOf(result.current.state)).toMatchObject({ mine: ['Widgets', 'alpha'] }))
  })

  it('a failed order read still draws your topics, by what this browser last saw (TOPI-10)', async () => {
    window.localStorage.setItem(`${TOPIC_ORDER_KEY}.${VIEWER}`, JSON.stringify({ [WIDGETS]: 900 }))
    const answered = relay.queryRelay.getMockImplementation()!
    relay.queryRelay.mockImplementation(async (url: string, filters: Array<Record<string, unknown>>) =>
      filters.some((f) => (f.kinds as number[]).includes(9)) ? { ok: false, reason: 'rate-limited' } : answered(url, filters),
    )
    const { result } = renderHook(() => useTopicsColumn())
    await waitFor(() => expect(titlesOf(result.current.state)).toMatchObject({ mine: ['Widgets', 'alpha'] }))
  })

  it('closes its live watch when nothing draws the order any more (TOPI-10)', async () => {
    const { result, unmount } = renderHook(() => useTopicsColumn())
    await waitFor(() => expect(typeof result.current.state).toBe('object'))
    await waitFor(() => expect(socket.subs).toHaveLength(1))
    unmount()
    expect(socket.subs[0]!.closed).toBe(true)
  })

  it('on a relay that says a kept-open request hears what asking again would return, the live watch names no team, so a comment in a team no topic names still moves its topic (TOPI-12)', async () => {
    nip11 = { supported_extensions: ['nip-er', 'buzz-live-as-stored'] }
    list(ALPHA, TESTING, true, 200)
    relay.activity = [message(WIDGETS, 400)]
    const { result } = renderHook(() => useTopicsColumn())
    await waitFor(() => expect(titlesOf(result.current.state)).toMatchObject({ mine: ['Widgets', 'alpha'] }))
    await waitFor(() => expect(socket.subs).toHaveLength(1))
    const filters = socket.subs[0]!.filters
    expect(filters.some((f) => (f['#A'] as string[] | undefined)?.includes(TESTING))).toBe(true)
    for (const f of filters) expect(f['#h']).toBeUndefined()
    const comment = { ...event(1111, [['A', TESTING], ['h', 'a-team-no-topic-names']], Math.floor(Date.now() / 1000)), id: 'comment-live' }
    act(() => socket.subs[0]!.onEvent(comment))
    expect(titlesOf(result.current.state)).toMatchObject({ mine: ['alpha', 'Widgets'] })
  })

  it('on a relay that does not say so, the live watch names the teams of the topics and their files (TOPI-12)', async () => {
    list(ALPHA, TESTING, true, 200)
    const { result } = renderHook(() => useTopicsColumn())
    await waitFor(() => expect(typeof result.current.state).toBe('object'))
    await waitFor(() => expect(socket.subs).toHaveLength(1))
    for (const f of socket.subs[0]!.filters) expect(new Set(f['#h'] as string[])).toEqual(new Set([FOLDER, OTHER_FOLDER]))
  })

  it('back on Topics within a minute, a message heard there still moves its topic to the top (TOPI-10)', async () => {
    relay.activity = [message(ALPHA, 400)]
    const first = renderHook(() => useTopicsColumn())
    await waitFor(() => expect(titlesOf(first.result.current.state)).toMatchObject({ mine: ['alpha', 'Widgets'] }))
    first.unmount()
    // Back at once: nothing kept the order current while away, so it is read again and heard again.
    const { result } = renderHook(() => useTopicsColumn())
    await waitFor(() => expect(socket.subs.filter((sub) => !sub.closed)).toHaveLength(1))
    const now = Math.floor(Date.now() / 1000)
    act(() => socket.subs.find((sub) => !sub.closed)!.onEvent(message(WIDGETS, now)))
    await waitFor(() => expect(titlesOf(result.current.state)).toMatchObject({ mine: ['Widgets', 'alpha'] }))
  })

  it('a topic archived with the project above it is under Archived, not among yours or the other topics (b1ace226)', async () => {
    const PROJECT = `30850:${VIEWER}:archived-project`
    seen.withParent[ALPHA] = { by: VIEWER, at: 1, with: PROJECT }
    seen.withParent[STRANGER] = { by: VIEWER, at: 1, with: PROJECT }
    const { result } = renderHook(() => useTopicsColumn())
    await waitFor(() => expect(typeof result.current.state).toBe('object'))
    expect(titlesOf(result.current.state)).toEqual({ mine: ['Widgets'], others: [], archived: ['alpha', 'Old', 'Somebody else’s'] })
  })

  it('a topic archived in this tab moves to Archived without a reload, and unarchived moves back (b1ace226)', async () => {
    const { result } = renderHook(() => useTopicsColumn())
    await waitFor(() => expect(typeof result.current.state).toBe('object'))
    seen.objects[WIDGETS] = object(WIDGETS, 'Widgets', { archived: { by: VIEWER, at: 2 } })
    await act(() => fileArchiveChanged(WIDGETS))
    expect(titlesOf(result.current.state)).toMatchObject({ mine: ['alpha'], archived: ['Old', 'Widgets'] })
    seen.objects[WIDGETS] = object(WIDGETS, 'Widgets')
    await act(() => fileArchiveChanged(WIDGETS))
    await waitFor(() => expect(titlesOf(result.current.state)).toMatchObject({ mine: ['alpha', 'Widgets'], archived: ['Old'] }))
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
    expect(titlesOf(result.current.state)).toMatchObject({ mine: ['alpha', 'Widgets'], archived: ['Old'] })
    resolve.mockRestore()
  })

  it("a listed file's newest comment, from the order's read, and one heard live are what its topic's dot judges, with no request added (TOPI-3)", async () => {
    list(ALPHA, TESTING, true, 200)
    const onTesting = (id: string, at: number): Event => ({ ...event(1111, [['A', TESTING], ['K', '30851'], ['a', TESTING], ['k', '30851'], ['h', OTHER_FOLDER]], at), id, pubkey: SOMEBODY })
    relay.activity = [message(WIDGETS, 400), onTesting('said-before', 500)]

    // The column alone, for how many requests its read takes.
    const alone = renderHook(() => useTopicsColumn())
    await waitFor(() => expect(titlesOf(alone.result.current.state)).toMatchObject({ mine: ['alpha', 'Widgets'] }))
    alone.unmount()
    const requests = relay.queryRelay.mock.calls.length
    resetTopicsColumn()
    relay.queryRelay.mockClear()
    socket.subs = []

    const { result } = renderHook(() => ({ column: useTopicsColumn(), news: listedNews() }))
    await waitFor(() => expect(result.current.news.get(ALPHA)?.map((one) => one.file)).toEqual([TESTING]))
    expect(result.current.news.get(ALPHA)![0]!.events.map((e) => e.id)).toEqual(['said-before'])
    expect(relay.queryRelay.mock.calls.length).toBe(requests)

    // Heard live, older than the topic's time or not: it reaches the topic's news with no read.
    await waitFor(() => expect(socket.subs.filter((sub) => !sub.closed)).toHaveLength(1))
    act(() => socket.subs.find((sub) => !sub.closed)!.onEvent(onTesting('said-live', Math.floor(Date.now() / 1000))))
    expect(result.current.news.get(ALPHA)![0]!.events.map((e) => e.id)).toEqual(['said-before', 'said-live'])
    expect(relay.queryRelay.mock.calls.length).toBe(requests)
  })

  it('reads none of the listed files’ fields: the column draws no file under a topic (TOPI-10)', async () => {
    list(WIDGETS, TESTING)
    list(WIDGETS, BUILD_1)
    const { result } = renderHook(() => useTopicsColumn())
    await waitFor(() => expect(typeof result.current.state).toBe('object'))
    expect(seen.resolved).toContain(WIDGETS)
    expect(seen.resolved).not.toContain(TESTING)
    expect(seen.resolved).not.toContain(BUILD_1)
  })

  it('reads every one of your topics’ lists in one request, not one per topic', async () => {
    const { result } = renderHook(() => useTopicsColumn())
    await waitFor(() => expect(typeof result.current.state).toBe('object'))
    expect(listReads()).toHaveLength(1)
    expect(listReads()[0]!.sort()).toEqual([d(ALPHA), d(WIDGETS)].sort())
  })

  it('a file added on a topic’s page reads only that topic’s list again, and the order with it, so the file’s activity counts (TOPI-10)', async () => {
    relay.activity = [message(ALPHA, 400), { ...event(1851, [['a', TESTING], ['h', OTHER_FOLDER], ['field', 'status'], ['value', 'done']], 300), id: 'status' }]
    const { result } = renderHook(() => useTopicsColumn())
    await waitFor(() => expect(titlesOf(result.current.state)).toMatchObject({ mine: ['alpha', 'Widgets'] }))
    // Added at 600: its entry is news on the topic, and the file's own change is now read for it.
    list(WIDGETS, TESTING, true, 600)
    act(() => topicListChanged(WIDGETS))
    await waitFor(() => expect(titlesOf(result.current.state)).toMatchObject({ mine: ['Widgets', 'alpha'] }))
    expect(listReads().at(-1)).toEqual([d(WIDGETS)])
    expect(activityReads()).toHaveLength(2)
  })

  it('a topic joined from Other topics moves up among yours, in its place by activity', async () => {
    relay.activity = [message(ALPHA, 400), message(STRANGER, 500)]
    const { result, rerender } = renderHook(() => useTopicsColumn())
    await waitFor(() => expect(titlesOf(result.current.state)).toMatchObject({ others: ['Somebody else’s'] }))
    seen.horizon = [recentMembership(STRANGER, true)]
    rerender()
    await waitFor(() => expect(titlesOf(result.current.state)).toEqual({ mine: ['Somebody else’s', 'alpha', 'Widgets'], others: [], archived: ['Old'] }))
  })

  it('a topic joined 100 days ago, with nothing naming you since, is among yours, as its page counts you (7525c414)', async () => {
    addOldTopic()
    relay.changes = [oldJoin()]
    const { result } = renderHook(() => useTopicsColumn())
    await waitFor(() => expect(typeof result.current.state).toBe('object'))
    expect(titlesOf(result.current.state)).toEqual({
      mine: ['alpha', 'Widgets', 'Pitch'],
      others: ['Somebody else’s'],
      archived: ['Old'],
    })
  })

  it('a topic somebody else added you to 100 days ago, with nothing naming you since, is among yours (7525c414)', async () => {
    addOldTopic()
    relay.changes = [oldJoin(SOMEBODY)]
    const { result } = renderHook(() => useTopicsColumn())
    await waitFor(() => expect(typeof result.current.state).toBe('object'))
    expect(titlesOf(result.current.state)).toMatchObject({ mine: ['alpha', 'Widgets', 'Pitch'] })
  })

  it('a topic yours by an old join moves to Other topics when you leave it in this tab (7525c414)', async () => {
    addOldTopic()
    relay.changes = [oldJoin()]
    const { result, rerender } = renderHook(() => useTopicsColumn())
    await waitFor(() => expect(titlesOf(result.current.state)).toMatchObject({ mine: ['alpha', 'Widgets', 'Pitch'] }))
    // The Leave reaches the membership read: it now has a word on the topic, and it is not yours.
    seen.horizon = [recentMembership(OLD, false)]
    rerender()
    await waitFor(() => expect(titlesOf(result.current.state)).toMatchObject({ others: ['Pitch', 'Somebody else’s'] }))
  })

  it('asks about every topic the membership read has no word on in one request, and about none it has (7525c414)', async () => {
    addOldTopic()
    relay.changes = [oldJoin()]
    const { result } = renderHook(() => useTopicsColumn())
    await waitFor(() => expect(typeof result.current.state).toBe('object'))
    const pastReads = relay.queryRelay.mock.calls
      .map(([, filters]) => filters as Array<Record<string, unknown>>)
      .filter((filters) => filters.some(namesAPerson))
    expect(pastReads).toHaveLength(1)
    expect(new Set(pastReads[0]!.flatMap((f) => (f['#a'] ?? f['#A']) as string[]))).toEqual(new Set([OLD, STRANGER]))
  })

  it('a topic the membership read has a word on — you left it — stays under Other topics, whatever an older join says (7525c414)', async () => {
    addOldTopic()
    relay.changes = [oldJoin()]
    seen.horizon = [recentMembership(OLD, false)]
    const { result } = renderHook(() => useTopicsColumn())
    await waitFor(() => expect(typeof result.current.state).toBe('object'))
    expect(titlesOf(result.current.state)).toMatchObject({ others: ['Pitch', 'Somebody else’s'] })
  })

  /*
    TEA-6, decided by Miky 6 Nov: Your topics follows the shared rule Ship's
    Topics reads — any level or Add puts a topic there, Not following takes it
    out, writing in it does not, and a muted topic is not yours.
  */
  it('a topic you only chose a level on with the switch is among yours', async () => {
    seen.horizon = [level(STRANGER, 'all')]
    const { result } = renderHook(() => useTopicsColumn())
    await waitFor(() => expect(typeof result.current.state).toBe('object'))
    expect(titlesOf(result.current.state)).toMatchObject({ mine: ['alpha', 'Widgets', 'Somebody else’s'], others: [] })
  })

  it('a topic you chose a level on, then set to Not following, is under Other topics', async () => {
    seen.horizon = [level(STRANGER, 'important', 2), recentMembership(STRANGER, false, 1)]
    const { result } = renderHook(() => useTopicsColumn())
    await waitFor(() => expect(typeof result.current.state).toBe('object'))
    expect(titlesOf(result.current.state)).toMatchObject({ mine: ['alpha', 'Widgets'], others: ['Somebody else’s'] })
  })

  it('a topic you chose a level on 100 days ago, with nothing naming you since, is among yours', async () => {
    relay.changes = [{ ...level(STRANGER, 'important', 100), id: 'level-old' }]
    const { result } = renderHook(() => useTopicsColumn())
    await waitFor(() => expect(typeof result.current.state).toBe('object'))
    expect(titlesOf(result.current.state)).toMatchObject({ mine: ['alpha', 'Widgets', 'Somebody else’s'] })
  })

  it('a topic you only wrote in is not yours, and its past read asks for no comment', async () => {
    const at = Math.floor(Date.now() / 1000) - 100 * DAY
    relay.changes = [{ ...event(1111, [['A', STRANGER], ['a', STRANGER], ['h', FOLDER]], at), id: 'wrote' }]
    const { result } = renderHook(() => useTopicsColumn())
    await waitFor(() => expect(typeof result.current.state).toBe('object'))
    expect(titlesOf(result.current.state)).toMatchObject({ others: ['Somebody else’s'] })
    const pastReads = relay.queryRelay.mock.calls.flatMap(([, filters]) => (filters as Array<Record<string, unknown>>).filter(namesAPerson))
    expect(pastReads.flatMap((f) => f.kinds as number[])).not.toContain(1111)
  })

  it('a topic you joined and then muted is under Other topics', async () => {
    seen.horizon = [recentMembership(STRANGER, true)]
    seen.muted = new Set([STRANGER])
    const { result } = renderHook(() => useTopicsColumn())
    await waitFor(() => expect(typeof result.current.state).toBe('object'))
    expect(titlesOf(result.current.state)).toMatchObject({ others: ['Somebody else’s'] })
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

describe('the Teams column’s topics (TEA-5)', () => {
  it('draws every active topic you can read while the topics’ lists are still unanswered, and asks for no list', async () => {
    list(WIDGETS, BUILD_1)
    const answer = relay.queryRelay.getMockImplementation()!
    // A topic's list never answers: the Topics screen's heaviest read, which no team row draws.
    relay.queryRelay.mockImplementation((url: string, filters: Array<Record<string, unknown>>) =>
      filters.some((f) => f['#O']) ? new Promise(() => {}) : answer(url, filters),
    )
    const { result } = renderHook(() => useTeamTopics())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect([...result.current.topics.values()].map((topic) => topic.slots.title?.value)).toEqual(['alpha', 'Somebody else’s', 'Widgets'])
    expect(listReads()).toEqual([])
  })
})
