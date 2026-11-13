/**
 * A reaction to your message turns a topic's row orange (ACT-7): on the topic's own talk at either level you follow
 * it at, and on a file it lists. Anything blue there keeps the row one blue dot, and its card lists the reaction too.
 * Not following, or muted: nothing. The reactions come through the tab's one source (`useReactionsToMe`) reading the
 * relay, faked here at the read; the row, dot and card are the real Topics column over the shared rule.
 * Real timers, as the card test: Base UI's hover card does not open under fake timers in jsdom.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-reaction-names-whose-message-it-reacts-to.md
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { buildLevelChange, buildMembershipChange } from '@estiva-app/conversation'
import type { ForeignObject } from '@estiva-app/interop'
import type { SignedEvent } from '@estiva-app/protocol'
import { signed } from '@/test/wireRelay'

const ME = 'c'.repeat(64)
const MIKY = 'a'.repeat(64)
const KATERINA = 'b'.repeat(64)
const TEAM = '85db5b59-9e49-4ea1-8e93-3d2a2d78c048'
const TOPIC = `30840:${MIKY}:launch`
const ISSUE = `30851:${MIKY}:issue-12`
const NOW = Math.floor(Date.now() / 1000)
const topic = { ref: TOPIC, address: TOPIC, kind: 30840, folder: TEAM, slots: { title: { value: 'Launch' } } } as unknown as ForeignObject

const state = vi.hoisted(() => ({
  changes: [] as SignedEvent[],
  muted: false,
  listed: new Map<string, readonly { file: string; events: readonly unknown[] }[]>(),
  /** What the relay holds: the reactions read by `#p`, the messages by `ids`. */
  events: [] as SignedEvent[],
}))

const membership = vi.hoisted(() => () => ({
  state: 'known',
  me: 'c'.repeat(64),
  floor: Math.floor(Date.now() / 1000) - 90 * 24 * 60 * 60,
  changesOf: (address: string) => (address === `30840:${'a'.repeat(64)}:launch` ? state.changes : []),
  termsOf: () => ({ member: true, muted: state.muted }),
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
  useTopicsColumn: () => ({ state: { mine: [topic], others: [], archived: [] }, signedOut: false }),
  useListedNews: () => state.listed,
  useFolders: () => ({ folders: [], signedOut: false, reload: async () => {} }),
  useForeignObjects: () => ({ conversations: async () => ({ [TOPIC]: [] }) }),
  useMembership: membership,
  useTeams: () => ({ teams: [], failed: false, reload: async () => {} }),
  usePeekActions: () => ({ markSpace: async () => ({ ok: true }) }),
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
  // The topic's own conversation, as the listing reads it: nothing new from anyone else.
  conversationsAsViewer: async (files: readonly { ref: string }[]) => Object.fromEntries(files.map((file) => [file.ref, []])),
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
  useResolvedReferences: (refs: readonly string[]) =>
    Object.fromEntries(refs.map((ref) => [ref, ref === `30851:${'a'.repeat(64)}:issue-12` ? { slots: { title: { value: 'Sign-in keeps failing' } } } : null])),
}))
vi.mock('@/auth/heldSession', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/auth/heldSession')),
  heldToken: () => ({ accessToken: 't', pubkey: 'c'.repeat(64) }),
}))
vi.mock('@/nostr/useReadStateSync', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/nostr/useReadStateSync')),
  useReadFrontier: () => ({ ready: true, marker: () => undefined, merged: {} }),
}))
vi.mock('@/lib/toast', () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock('@/api/useChannelStreams', () => ({ useChannelStreams: () => ({ at: 0, streams: {} }), useHeldChannelEvents: () => [] }))
vi.mock('@/api/useTeams', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/api/useTeams')),
  useTeams: () => ({ teams: [], failed: false, reload: async () => {} }),
}))

import { PeekSetup } from '@/lib/PeekSetup'
import { resetReactionsToMeForTests } from '@/api/useReactionsToMe'
import { TopicsColumn } from './TopicsColumn'

const added = signed({ ...buildMembershipChange(MIKY, (NOW - 3600) * 1000, { file: TOPIC, folder: TEAM, person: ME, member: true }), created_at: NOW - 3600 }, MIKY)
const chose = (value: 'all' | 'important') => signed({ ...buildLevelChange(ME, (NOW - 1800) * 1000, { place: TOPIC, folder: TEAM, level: value }), created_at: NOW - 1800 }, ME)
const commentOn = (address: string, by: string, ago: number, content: string) => {
  const kind = address.split(':')[0]
  return signed({ kind: 1111, created_at: NOW - ago, content, tags: [['A', address], ['K', kind], ['a', address], ['k', kind], ['h', TEAM]] }, by)
}
const reaction = (by: string, on: SignedEvent, ago: number, emoji = '👍') =>
  signed({ kind: 7, created_at: NOW - ago, content: emoji, tags: [['e', on.id], ['p', on.pubkey], ['k', '1111'], ['h', TEAM]] }, by)

const mount = () =>
  render(
    <MemoryRouter initialEntries={['/app/topics']}>
      <PeekSetup>
        <TopicsColumn />
      </PeekSetup>
    </MemoryRouter>,
  )
const dotOf = () => document.querySelector(`[data-file="${CSS.escape(TOPIC)}"]`)?.parentElement?.querySelector('[data-unread]') ?? null

beforeEach(() => {
  resetReactionsToMeForTests()
  state.changes = [added, chose('important')]
  state.muted = false
  state.listed = new Map()
  state.events = []
})

describe('a reaction to your message in a topic (ACT-7)', () => {
  it('on the topic’s own talk you follow at Important, its row is orange and its card names who reacted with what', async () => {
    const mine = commentOn(TOPIC, ME, 900, 'Draft is up')
    state.events = [mine, reaction(KATERINA, mine, 120)]
    const user = userEvent.setup()
    mount()
    await waitFor(() => expect(dotOf()?.getAttribute('data-tone')).toBe('reaction'))
    await user.hover(screen.getByText('Launch'))
    const line = await screen.findByText('reacted 👍 to your message')
    const card = line.closest('[data-reaction]')
    expect(card?.textContent).toContain('Katerina')
    expect(card?.textContent).toContain('Draft is up')
  })

  it('anything blue there keeps one blue dot, and its card lists the reaction beside it', async () => {
    state.changes = [added, chose('all')]
    const mine = commentOn(TOPIC, ME, 900, 'Draft is up')
    state.events = [mine, reaction(KATERINA, mine, 120)]
    state.listed = new Map([[TOPIC, [{ file: ISSUE, events: [commentOn(ISSUE, MIKY, 60, 'Blocked on review')] }]]])
    const user = userEvent.setup()
    mount()
    await screen.findByText('Launch')
    // Wait for the reaction to be judged in: the card lists it, while the dot stays blue.
    await user.hover(screen.getByText('Launch'))
    await screen.findByText('reacted 👍 to your message')
    expect(screen.getByText(/Blocked on review/)).toBeTruthy()
    expect(dotOf()?.getAttribute('data-tone')).toBe('blue')
  })

  it('on your comment on a file the topic lists, at Important, the row is orange and the line names the file where every line does', async () => {
    const mine = commentOn(ISSUE, ME, 900, 'Fixed in 0.4')
    state.events = [mine, reaction(KATERINA, mine, 120, '🎉')]
    state.listed = new Map([[TOPIC, [{ file: ISSUE, events: [] }]]])
    const user = userEvent.setup()
    mount()
    await waitFor(() => expect(dotOf()?.getAttribute('data-tone')).toBe('reaction'))
    await user.hover(screen.getByText('Launch'))
    const card = (await screen.findByText(/^reacted 🎉 to your message/)).closest('[data-reaction]')
    // The file in the place line, before the words: "Sign-in keeps failing · Fixed in 0.4".
    expect(card?.textContent).toContain('Sign-in keeps failing · Fixed in 0.4')
  })

  it('lights nothing in a topic you do not follow, or one you muted', async () => {
    const mine = commentOn(TOPIC, ME, 900, 'Draft is up')
    // A control first: the same reaction, followed, is orange.
    state.events = [mine, reaction(KATERINA, mine, 120)]
    const followed = mount()
    await waitFor(() => expect(dotOf()?.getAttribute('data-tone')).toBe('reaction'))
    followed.unmount()

    // The reactions are held now: each mount below judges them on its first draw.
    state.muted = true
    const muted = mount()
    await muted.findByText('Launch')
    expect(dotOf()).toBeNull()
    muted.unmount()

    state.muted = false
    state.changes = []
    const notIn = mount()
    await notIn.findByText('Launch')
    expect(dotOf()).toBeNull()
  })
})
