/**
 * A reaction to your message, at the wire (ACT-7): what the tab asks the relay to find the reactions to you, and what
 * seeing one writes. The reads go to the fake relay through Peek's real query path; the two requests kept open are
 * the tab's socket, faked here so a test can hear what they asked and deliver an event on them. Seeing is read back
 * off the relay: the `kind:30078` slot's decrypted blob, under the conversation's `reactions:` key.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-reaction-is-seen-once-in-its-conversation.md
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { REACTIONS_TO_ME_FROM } from '@estiva-app/conversation'
import type { SignedEvent } from '@estiva-app/protocol'
import { installWireRelay, ME, signed, type WireRelay } from '@/test/wireRelay'

vi.mock('@/api/relayUrl', () => ({ RELAY_URL: 'https://relay.test', hasRelay: true }))
vi.mock('@/auth/estivaId', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/estivaId')>()),
  validToken: () => ({ accessToken: 'wire-token', pubkey: 'c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2' }),
  storedToken: () => ({ accessToken: 'wire-token', pubkey: 'c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2' }),
}))

/** The tab's socket: every request kept open, with what it asked and how to deliver an event on it. */
const socket = vi.hoisted(() => ({
  subs: [] as { filters: Record<string, unknown>[]; onEvent: (event: SignedEvent) => void; closed: boolean }[],
  /** What the relay's NIP-11 says it supports. */
  extensions: [] as string[],
  relay: { info: async () => ({}) } as { info: () => Promise<unknown> },
  asked: [] as Record<string, unknown>[][],
}))
vi.mock('@/nostr/liveTopics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/nostr/liveTopics')>()),
  getLiveClient: () => ({
    relay: {
      subscribe: (filters: Record<string, unknown>[], onEvent: (event: SignedEvent) => void) => {
        const sub = { filters, onEvent, closed: false }
        socket.subs.push(sub)
        return { close: () => void (sub.closed = true) }
      },
    },
  }),
}))
vi.mock('@/nostr/relayInfo', () => ({ peekRelay: () => socket.relay }))
vi.mock('@/nostr/foreign', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/nostr/foreign')>()
  return {
    ...actual,
    // The real read, through the bridge to the fake relay; each read's filters are kept.
    viewerQuery: (...args: Parameters<typeof actual.viewerQuery>) => {
      const query = actual.viewerQuery(...args)
      return (filters: Parameters<ReturnType<typeof actual.viewerQuery>>[0]) => {
        socket.asked.push(filters as Record<string, unknown>[])
        return query(filters)
      }
    },
  }
})
// No DM is open here: the read writers' DM lookup answers nothing.
vi.mock('@/api/internal/dms', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/internal/dms')>()),
  useDmChannels: () => ({ partners: [], channelOf: (id: string) => id }),
}))
vi.mock('@/api/useFolderContents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/useFolderContents')>()),
  heldFolderIds: () => ['85db5b59-9e49-4ea1-8e93-3d2a2d78c048'],
}))

import { ReadStateSync, flushReadState, resetReadStateQueueForTests, useReadFrontier } from '@/nostr/useReadStateSync'
import { resetReactionsToMeForTests, useReactionsToMe } from '@/api/useReactionsToMe'
import { reactionNews } from '@/api/reactionNews'
import { useReactionsSeenOnClose } from '@/api/reactionsSeen'
import { useMarkFileRead } from '@/lib/useMarkRead'

const KATERINA = 'b'.repeat(64)
const MIKY = 'a'.repeat(64)
const TEAM = '85db5b59-9e49-4ea1-8e93-3d2a2d78c048'
const FILE_ID = 'b1bab6ee-47e6-4737-b384-9904a311122a'
const ISSUE = `30851:${MIKY}:${FILE_ID}`
/** A day after reactions to you start counting. */
const NOW = REACTIONS_TO_ME_FROM + 24 * 60 * 60

const commentOn = (by: string, ago: number, content: string) =>
  signed({ kind: 1111, created_at: NOW - ago, content, tags: [['A', ISSUE], ['K', '30851'], ['a', ISSUE], ['k', '30851'], ['h', TEAM]] }, by)
const reaction = (by: string, on: SignedEvent, ago: number, emoji = '👍') =>
  signed({ kind: 7, created_at: NOW - ago, content: emoji, tags: [['e', on.id], ['p', on.pubkey], ['k', '1111'], ['h', TEAM]] }, by)
const takeBack = (by: string, of: SignedEvent) => signed({ kind: 5, created_at: NOW - 10, content: '', tags: [['e', of.id], ['k', '7']] }, by)

const mine = commentOn(ME, 3600, 'Shipped the fix')
const theirs = commentOn(MIKY, 3500, 'Thanks')

let relay: WireRelay
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW * 1000)
  relay = installWireRelay()
  resetReadStateQueueForTests()
  resetReactionsToMeForTests()
  window.localStorage.clear()
  socket.subs = []
  socket.asked = []
  socket.extensions = ['buzz-live-as-stored']
  // A new relay object per test: what it supports is asked once per object.
  socket.relay = { info: async () => ({ supported_extensions: socket.extensions }) }
})
afterEach(() => vi.useRealTimers())
afterAll(() => vi.unstubAllGlobals())

const wrapper = ({ children }: { children: ReactNode }) => (
  <>
    <ReadStateSync />
    {children}
  </>
)

/** A row over the issue's conversation: its new reactions to you, and its card's open and close. */
function useIssueRow() {
  const source = useReactionsToMe()
  const { merged } = useReadFrontier()
  const lines = reactionNews(source, ISSUE, merged, { following: null })
  return { source, lines, card: useReactionsSeenOnClose(lines) }
}

const slots = () => relay.sentOf(30078)
const blobOf = (event: { content: string }) => JSON.parse(relay.decrypt(event.content)) as { contexts: Record<string, number> }
const live = (kind: number) => socket.subs.filter((sub) => !sub.closed && (sub.filters[0].kinds as number[]).includes(kind))

describe('finding the reactions to you (ACT-7)', () => {
  it('reads the newest 300 by #p, then the messages they react to by ids, and keeps only others’ reactions to your messages', async () => {
    const katerina = reaction(KATERINA, mine, 600)
    const own = reaction(ME, mine, 500)
    // Tagged to you, on someone else's message: not a reaction to your message.
    const misTagged = signed({ ...reaction(KATERINA, theirs, 400), tags: [['e', theirs.id], ['p', ME]] }, KATERINA)
    relay.seed(mine, theirs, katerina, own, misTagged)

    const { result } = renderHook(() => useIssueRow(), { wrapper })
    await waitFor(() => expect(result.current.source.ready).toBe(true))

    expect(result.current.source.list.map((r) => r.id)).toEqual([katerina.id])
    expect(result.current.lines.map((line) => [line.id, line.reaction?.emoji, line.words])).toEqual([[katerina.id, '👍', 'Shipped the fix']])
    const reads = socket.asked.filter((filters) => !filters.some((f) => (f.kinds as number[] | undefined)?.includes(30078)))
    expect(reads[0]).toEqual([{ kinds: [7], '#p': [ME], since: REACTIONS_TO_ME_FROM, limit: 300 }])
    expect(reads[1]).toHaveLength(1)
    expect((reads[1][0].ids as string[]).sort()).toEqual([mine.id, theirs.id].sort())
    expect(reads).toHaveLength(2)
  })

  it('keeps a #p request open from now on, naming no team on a relay that hears live as stored, and teams by #h on one that does not', async () => {
    relay.seed(mine, reaction(KATERINA, mine, 600))
    const first = renderHook(() => useReactionsToMe(), { wrapper })
    await waitFor(() => expect(live(7)).toHaveLength(1))
    expect(live(7)[0].filters).toEqual([{ kinds: [7], '#p': [ME], since: NOW }])
    first.unmount()

    resetReactionsToMeForTests()
    socket.subs = []
    socket.extensions = []
    socket.relay = { info: async () => ({ supported_extensions: socket.extensions }) }
    renderHook(() => useReactionsToMe(), { wrapper })
    await waitFor(() => expect(live(7)).toHaveLength(1))
    expect(live(7)[0].filters).toEqual([{ kinds: [7], '#p': [ME], since: NOW, '#h': [TEAM] }])
  })

  it('a reaction taken back by the one who made it goes; a deletion signed by anyone else does not take it', async () => {
    const katerina = reaction(KATERINA, mine, 600)
    relay.seed(mine, katerina)
    const { result } = renderHook(() => useIssueRow(), { wrapper })
    await waitFor(() => expect(result.current.lines).toHaveLength(1))
    await waitFor(() => expect(live(5)).toHaveLength(1))
    expect(live(5)[0].filters).toHaveLength(1)
    expect(live(5)[0].filters[0].kinds).toEqual([5])
    expect((live(5)[0].filters[0]['#e'] as string[]).sort()).toEqual([katerina.id, mine.id].sort())

    act(() => live(5)[0].onEvent(takeBack(MIKY, katerina)))
    expect(result.current.lines).toHaveLength(1)
    act(() => live(5)[0].onEvent(takeBack(KATERINA, katerina)))
    expect(result.current.lines).toHaveLength(0)
  })
})

describe('seeing a reaction to you (ACT-7)', () => {
  it('leaving the card after it was open writes the conversation’s reactions key at the newest reaction it listed, never on opening', async () => {
    const older = reaction(KATERINA, mine, 600)
    const newer = reaction(MIKY, mine, 300, '🎉')
    relay.seed(mine, older, newer)
    const { result } = renderHook(() => useIssueRow(), { wrapper })
    await waitFor(() => expect(result.current.lines).toHaveLength(2))

    act(() => result.current.card.onPreviewOpenChange(true))
    await act(() => flushReadState())
    // Opening writes nothing: the lines stay as they are while read.
    expect(slots()).toHaveLength(0)
    expect(result.current.lines).toHaveLength(2)

    act(() => result.current.card.onPreviewOpenChange(false))
    await act(() => flushReadState())
    expect(slots()).toHaveLength(1)
    expect(blobOf(slots()[0]).contexts[`reactions:file:${FILE_ID}`]).toBe(newer.created_at)
    expect(result.current.lines).toHaveLength(0)

    // One that arrives afterwards is new again: the key is the newest shown, never the clock.
    vi.setSystemTime((NOW + 60) * 1000)
    const later = signed({ ...reaction(KATERINA, mine, 0, '❤️'), created_at: NOW + 30 }, KATERINA)
    await act(async () => live(7)[0].onEvent(later))
    await waitFor(() => expect(result.current.lines.map((line) => line.id)).toEqual([later.id]))
  })

  it('a card that never opened writes nothing when its row goes', async () => {
    relay.seed(mine, reaction(KATERINA, mine, 600))
    const { result } = renderHook(() => useIssueRow(), { wrapper })
    await waitFor(() => expect(result.current.lines).toHaveLength(1))
    act(() => result.current.card.onPreviewOpenChange(false))
    await act(() => flushReadState())
    expect(slots()).toHaveLength(0)
  })

  it('opening the conversation sees the reactions under your messages once it has been open for the dwell', async () => {
    const katerina = reaction(KATERINA, mine, 600)
    relay.seed(mine, katerina)
    // The file's pane as it marks its conversation read: drawn once its newest comment is on screen.
    const { result, rerender } = renderHook(({ open }: { open: boolean }) => {
      const row = useIssueRow()
      useMarkFileRead(open ? ISSUE : null, open ? mine.created_at : undefined, 1500)
      return row
    }, { wrapper, initialProps: { open: false } })
    await waitFor(() => expect(result.current.lines).toHaveLength(1))

    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    rerender({ open: true })
    act(() => vi.advanceTimersByTime(1499))
    expect(result.current.lines).toHaveLength(1)
    act(() => vi.advanceTimersByTime(1))
    expect(result.current.lines).toHaveLength(0)
    vi.useRealTimers()

    await act(() => flushReadState())
    expect(blobOf(slots().at(-1)!).contexts[`reactions:file:${FILE_ID}`]).toBe(katerina.created_at)
  })
})
