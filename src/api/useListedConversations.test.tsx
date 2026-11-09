/**
 * A topic's listed files' conversations, as its view reads them at All (TOPI-3): nothing asked until the topic is
 * followed at All, one read for every file's comments, each event the watch hears landing on its own file only, a
 * file with no team read-only, a changed list read again, and a reply written through a file's own actions as that
 * file's comment, in its own team.
 *
 * Over the wire fake (`src/test/wireRelay.ts`): the reads asserted are the `/query` bodies that would reach the
 * relay, the write the event it would be sent. The tab's socket is faked as `useTopicsColumn.test.tsx` fakes it.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ListedFile } from '@estiva-app/interop'
import { installWireRelay, signed, tagOf, type WireRelay } from '@/test/wireRelay'

vi.mock('@/api/relayUrl', () => ({ RELAY_URL: 'https://relay.test', hasRelay: true }))
vi.mock('@/auth/estivaId', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/estivaId')>()),
  validToken: () => ({ accessToken: 'wire-token', pubkey: 'c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2' }),
  storedToken: () => ({ accessToken: 'wire-token', pubkey: 'c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2' }),
}))
// Our relay says a kept-open request hears what asking again would return: the watch asks by file alone.
vi.mock('@/nostr/relayInfo', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  peekRelay: () => ({ info: async () => ({ supported_extensions: ['buzz-live-as-stored'] }) }),
}))
/** The tab's socket: each live subscription opened, to deliver an event to as the relay would. */
const socket = vi.hoisted(() => ({
  subs: [] as Array<{ filters: Record<string, unknown>[]; onEvent: (event: unknown) => void; closed: boolean }>,
}))
vi.mock('@/nostr/liveTopics', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
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

import { useListedConversations } from './useListedConversations'
import { resetConversationsForTests } from './conversations'
import type { TopicFile } from './useTopicFiles'

const CATH = 'a8a7d739dda599143ec2e88a1c3b2d69808cd2a50001179c786f51d00dc3c697'
const BARE_FILE = 30840
const NOTES_TEAM = '9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a'
const PLAN_TEAM = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const NOTES = `${BARE_FILE}:${CATH}:launch-notes`
const PLAN = `${BARE_FILE}:${CATH}:launch-plan`
const LOOSE = `${BARE_FILE}:${CATH}:loose`

const manifest = signed(
  {
    kind: 31990,
    tags: [['d', 'bare-file'], ['k', String(BARE_FILE)]],
    content: JSON.stringify({
      name: 'File',
      projections: { [BARE_FILE]: { widget: 'card', slots: { title: { tag: 'title' } } } },
      actions: [{ id: 'comment', label: 'Comment', appliesTo: String(BARE_FILE), emits: { kind: 1111, scope: 'address' }, input: { type: 'string' } }],
    }),
  },
  CATH,
)
const fileEvent = (d: string, team?: string) => signed({ kind: BARE_FILE, tags: [['d', d], ['title', d], ...(team ? [['h', team]] : [])] }, CATH)
const commentOn = (address: string, team: string | null, content: string, at: number, extra: string[][] = []) =>
  signed(
    {
      kind: 1111,
      created_at: at,
      content,
      tags: [['A', address], ['K', String(BARE_FILE)], ['P', CATH], ['a', address], ['k', String(BARE_FILE)], ['p', CATH], ...(team ? [['h', team]] : []), ...extra],
    },
    CATH,
  )
const onNotes = commentOn(NOTES, NOTES_TEAM, 'Is this date right?', 1_700_000_100, [['block', 'b-dates']])
const onPlan = commentOn(PLAN, PLAN_TEAM, 'Budget is in', 1_700_000_200)
const onLoose = commentOn(LOOSE, null, 'Nobody owns this one', 1_700_000_300)

const listedOf = (d: string, address: string, folder: string | null): TopicFile => ({
  file: d,
  address,
  archived: false,
  listed: { file: d, address, folder, entry: {} as ListedFile['entry'] },
})
const NOTES_LISTED = listedOf('launch-notes', NOTES, NOTES_TEAM)
const PLAN_LISTED = listedOf('launch-plan', PLAN, PLAN_TEAM)
const LOOSE_LISTED = listedOf('loose', LOOSE, null)

let relay: WireRelay
beforeEach(() => {
  resetConversationsForTests()
  socket.subs = []
  relay = installWireRelay()
  relay.seed(manifest, fileEvent('launch-notes', NOTES_TEAM), fileEvent('launch-plan', PLAN_TEAM), fileEvent('loose'), onNotes, onPlan, onLoose)
})
afterAll(() => vi.unstubAllGlobals())

/** The filters of every `/query` the relay was asked, one list per request. */
const queries = () =>
  vi
    .mocked(fetch)
    .mock.calls.filter(([url]) => String(url).endsWith('/query'))
    .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>[])

type Hook = ReturnType<typeof useListedConversations>
const filesOf = (hook: { current: Hook }) => (typeof hook.current.state === 'object' && 'files' in hook.current.state ? hook.current.state.files : [])
const bodiesOf = (hook: { current: Hook }, address: string) =>
  filesOf(hook)
    .find((file) => file.address === address)
    ?.conversation.roots.map((root) => root.body)

describe("a topic's listed conversations (TOPI-3)", () => {
  it('asks the relay nothing until the topic is followed at All', async () => {
    const { result } = renderHook(() => useListedConversations(null))
    await act(async () => {})
    expect(result.current.state).toBe('off')
    expect(queries()).toEqual([])
    expect(socket.subs).toEqual([])
  })

  it("reads every listed file's comments in one request, each file holding its own", async () => {
    const { result } = renderHook(() => useListedConversations([NOTES_LISTED, PLAN_LISTED]))
    await waitFor(() => expect(filesOf(result)).toHaveLength(2))
    expect(bodiesOf(result, NOTES)).toEqual(['Is this date right?'])
    expect(bodiesOf(result, PLAN)).toEqual(['Budget is in'])
    const byA = queries().filter((filters) => filters.some((filter) => '#A' in filter))
    expect(byA).toHaveLength(1)
    expect(byA[0].flatMap((filter) => (filter['#A'] as string[] | undefined) ?? []).sort()).toEqual([NOTES, PLAN].sort())
  })

  it('an event the watch hears lands on its own file only, with no read', async () => {
    const { result } = renderHook(() => useListedConversations([NOTES_LISTED, PLAN_LISTED]))
    await waitFor(() => expect(filesOf(result)).toHaveLength(2))
    await waitFor(() => expect(socket.subs.length).toBeGreaterThan(0))
    const before = queries().length
    const live = commentOn(PLAN, PLAN_TEAM, 'Signed off', 1_700_000_400)
    act(() => socket.subs.filter((sub) => !sub.closed).forEach((sub) => sub.onEvent(live)))

    await waitFor(() => expect(bodiesOf(result, PLAN)).toEqual(['Budget is in', 'Signed off']))
    expect(bodiesOf(result, NOTES)).toEqual(['Is this date right?'])
    expect(queries().length).toBe(before)
  })

  it('a file whose root names no team is drawn with nothing to write through', async () => {
    const { result } = renderHook(() => useListedConversations([NOTES_LISTED, LOOSE_LISTED]))
    await waitFor(() => expect(filesOf(result)).toHaveLength(2))
    const loose = filesOf(result).find((file) => file.address === LOOSE)!
    expect(loose.container).toBeNull()
    expect(loose.conversation.roots.map((root) => root.body)).toEqual(['Nobody owns this one'])
    expect(result.current.actionsFor(LOOSE)).toBeUndefined()
    expect(result.current.actionsFor(NOTES)).toBeDefined()
  })

  it('a changed list is read again, and its new file drawn', async () => {
    const { result, rerender } = renderHook(({ listed }) => useListedConversations(listed), { initialProps: { listed: [NOTES_LISTED] } })
    await waitFor(() => expect(filesOf(result)).toHaveLength(1))
    rerender({ listed: [NOTES_LISTED, PLAN_LISTED] })
    await waitFor(() => expect(filesOf(result)).toHaveLength(2))
    expect(bodiesOf(result, PLAN)).toEqual(['Budget is in'])
  })

  it("a reply through a file's actions is a 1111 on that file, in its team, its block kept, and drawn at once", async () => {
    const { result } = renderHook(() => useListedConversations([NOTES_LISTED, PLAN_LISTED]))
    await waitFor(() => expect(filesOf(result)).toHaveLength(2))
    const parent = filesOf(result).find((file) => file.address === NOTES)!.conversation.roots[0]
    const answer = await act(() => result.current.actionsFor(NOTES)!.reply(parent, 'Yes, the 14th'))

    expect(answer.ok).toBe(true)
    const [reply] = relay.sentOf(1111)
    expect(tagOf(reply, 'A')).toBe(NOTES)
    expect(tagOf(reply, 'h')).toBe(NOTES_TEAM)
    expect(tagOf(reply, 'e')).toBe(onNotes.id)
    expect(tagOf(reply, 'block')).toBe('b-dates')
    const notes = filesOf(result).find((file) => file.address === NOTES)!.conversation
    expect(notes.replies[onNotes.id]?.map((one) => one.body)).toEqual(['Yes, the 14th'])
  })
})
