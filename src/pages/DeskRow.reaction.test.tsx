/**
 * A reaction to your message on a file in the Desk's Open work (ACT-7): alone it turns the row orange; with an unread
 * comment there, blue wins (one blue dot) and the row's card lists both, the comment beside the reaction. The row is
 * the Desk's own, drawn from the real badges over the shared rule; the file's conversation and the reactions are the
 * relay's reads, stood in for here. Real timers, as the Topics column's card test: Base UI's hover card does not open
 * under fake timers in jsdom.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-reaction-is-seen-once-in-its-conversation.md
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { ForeignObject } from '@estiva-app/interop'
import type { SignedEvent } from '@estiva-app/protocol'
import { signed } from '@/test/wireRelay'

const ME = 'c'.repeat(64)
const MIKY = 'a'.repeat(64)
const KATERINA = 'b'.repeat(64)
const TEAM = '85db5b59-9e49-4ea1-8e93-3d2a2d78c048'
const ISSUE = `30851:${MIKY}:issue-12`
const NOW = Math.floor(Date.now() / 1000)
const issue = { ref: ISSUE, address: ISSUE, kind: 30851, folder: TEAM, slots: { title: { value: 'Sign-in keeps failing' } } } as unknown as ForeignObject

const state = vi.hoisted(() => ({
  /** What the relay holds: the reactions read by `#p`, the messages by `ids`. */
  events: [] as SignedEvent[],
  live: [] as SignedEvent[],
}))

const membership = vi.hoisted(() => () => ({
  state: 'known',
  me: 'c'.repeat(64),
  floor: Math.floor(Date.now() / 1000) - 90 * 24 * 60 * 60,
  changesOf: () => [],
  // A member of the issue since a day ago.
  termsOf: () => ({ member: true, muted: false, since: Math.floor(Date.now() / 1000) - 24 * 60 * 60 }),
  isMentioned: () => false,
  isMember: () => true,
  refresh: async () => {},
}))
vi.mock('@/api/internal/membership', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/api/internal/membership')),
  useMembership: membership,
}))
vi.mock('@/api', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/api')),
  useMembership: membership,
  useMentionNames: () => [
    { pubkey: MIKY, name: 'Miky' },
    { pubkey: KATERINA, name: 'Katerina' },
  ],
}))
vi.mock('@/api/relayUrl', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/api/relayUrl')),
  hasRelay: true,
  RELAY_URL: 'wss://relay.test',
}))
// The relay's reads, answered from what it holds by ids, kinds, authors and tags (times and limits aside).
vi.mock('@/nostr/foreign', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/nostr/foreign')),
  // The issue's conversation, as the badges read it: ids, times and authors, no words. The copy on the device holds nothing.
  conversationsAsViewer: async (files: readonly { ref: string }[], _relay: string, _token: unknown, source?: string) =>
    source === 'copy'
      ? {}
      : Object.fromEntries(
          files.map((file) => [
            file.ref,
            state.events.filter((event) => event.kind === 1111).map((event) => ({ id: event.id, root: event.id, at: event.created_at, by: event.pubkey })),
          ]),
        ),
  viewerQuery: () => async (filters: Record<string, unknown>[]) =>
    state.events.filter((event) =>
      filters.some((filter) =>
        Object.entries(filter).every(([key, value]) => {
          if (key === 'ids') return (value as string[]).includes(event.id)
          if (key === 'kinds') return (value as number[]).includes(event.kind)
          if (key === 'authors') return (value as string[]).includes(event.pubkey)
          if (key.startsWith('#')) return event.tags.some((t) => t[0] === key.slice(1) && (value as string[]).includes(t[1]))
          return true
        }),
      ),
    ),
}))
// No socket: the requests kept open are the wire test's.
vi.mock('@/nostr/liveTopics', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/nostr/liveTopics')),
  getLiveClient: () => null,
}))
vi.mock('@/api/foreign', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/api/foreign')),
  useRelayViewer: () => () => ({ relayUrl: 'wss://relay.test', token: { accessToken: 't', pubkey: 'c'.repeat(64) } }),
  useResolvedReferences: () => ({}),
}))
vi.mock('@/auth/heldSession', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/auth/heldSession')),
  heldToken: () => ({ accessToken: 't', pubkey: 'c'.repeat(64) }),
}))
vi.mock('@/nostr/useReadStateSync', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/nostr/useReadStateSync')),
  useReadFrontier: () => ({ ready: true, marker: () => undefined, merged: {} }),
}))
// What the tab's socket has said in the issue's team since the read: folded into the row with no read.
vi.mock('@/api/useChannelStreams', () => ({ useChannelStreams: () => ({ at: 0, streams: {} }), useHeldChannelEvents: () => state.live }))
vi.mock('@/api/useTeams', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/api/useTeams')),
  useTeams: () => ({ teams: [], failed: false, reload: async () => {} }),
}))

import { PeekSetup } from '@/lib/PeekSetup'
import { useLiveConversationBadges } from '@/api/useConversationBadges'
import { resetReactionsToMeForTests } from '@/api/useReactionsToMe'
import { DeskRowItem } from './DeskPage'

const commentOn = (by: string, ago: number, content: string) =>
  signed({ kind: 1111, created_at: NOW - ago, content, tags: [['A', ISSUE], ['K', '30851'], ['a', ISSUE], ['k', '30851'], ['h', TEAM]] }, by)
const reaction = (by: string, on: SignedEvent, ago: number) =>
  signed({ kind: 7, created_at: NOW - ago, content: '👍', tags: [['e', on.id], ['p', on.pubkey], ['k', '1111'], ['h', TEAM]] }, by)

const FILES = [issue]

/** The issue's row in Open work, as the Desk builds it from the badges. */
function OpenWorkRow() {
  const { unread, news, tones } = useLiveConversationBadges(FILES)
  return (
    <DeskRowItem
      row={{
        id: ISSUE,
        kind: 'file',
        name: 'Sign-in keeps failing',
        isUnread: unread[ISSUE] === true,
        ...(tones[ISSUE] ? { tone: tones[ISSUE] } : {}),
        isSelected: false,
        href: '/app/desk',
        onClick: () => {},
        card: { items: news[ISSUE] ?? [], fileRef: ISSUE, place: 'topic', open: () => {} },
      }}
    />
  )
}

const tree = () => (
  <MemoryRouter initialEntries={['/app/desk']}>
    <PeekSetup>
      <OpenWorkRow />
    </PeekSetup>
  </MemoryRouter>
)
const mount = () => render(tree())
const dot = () => document.querySelector('[data-unread]')

beforeEach(() => {
  resetReactionsToMeForTests()
  state.events = []
  state.live = []
})

describe('a reaction to your message on a Desk file (ACT-7)', () => {
  it('alone turns the row orange', async () => {
    const mine = commentOn(ME, 900, 'Fixed in 0.4')
    state.events = [mine, reaction(KATERINA, mine, 120)]
    mount()
    await waitFor(() => expect(dot()?.getAttribute('data-tone')).toBe('reaction'))
  })

  it('a comment arriving there makes it one blue dot, and its card lists the comment beside the reaction', async () => {
    const mine = commentOn(ME, 900, 'Fixed in 0.4')
    state.events = [mine, reaction(KATERINA, mine, 120)]
    const user = userEvent.setup()
    const { rerender } = render(tree())
    await waitFor(() => expect(dot()?.getAttribute('data-tone')).toBe('reaction'))

    // Miky comments there, heard on the socket.
    const blocked = commentOn(MIKY, 60, 'Still failing on Safari')
    state.events = [...state.events, blocked]
    state.live = [blocked]
    rerender(tree())
    await waitFor(() => expect(dot()?.getAttribute('data-tone')).toBe('blue'))
    await user.hover(screen.getByText('Sign-in keeps failing'))
    const reacted = (await screen.findByText('reacted 👍 to your message')).closest('a')
    expect(reacted?.textContent).toContain('Katerina')
    // The card's lines, newest first: Miky's comment, then the reaction.
    const lines = () => [...document.querySelectorAll('a[href*="thread="]')].map((line) => line.textContent ?? '')
    await waitFor(() => expect(lines().map((line) => (line.includes('Miky') ? 'Miky' : line.includes('Katerina') ? 'Katerina' : line))).toEqual(['Miky', 'Katerina']))
    expect(lines()[0]).toContain('started a conversation')
  })
})
