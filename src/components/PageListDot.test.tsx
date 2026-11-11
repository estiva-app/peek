/**
 * The dot beside a topic's title and the list behind it (ACT-4): a quiet ring with nothing new, blue with an unread
 * mention; its list New on top, then Earlier — what was about you and is seen now. A plain comment you have read is not
 * repeated there. The topic's dot and its list are judged by the real rule over relay answers stood in for here: the
 * topic's conversation (the badges read), the read markers, and the list's own read, which waits for the list to open.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { ForeignObject } from '@estiva-app/interop'
import { fileContext } from '@estiva-app/conversation'
import { encodeNpub, type SignedEvent } from '@estiva-app/protocol'

const ME = '1'.repeat(64)
const KATERINA = '2'.repeat(64)
const TOPIC = `30840:${ME}:pitch`
const NOW = Math.floor(Date.now() / 1000)

const relay = vi.hoisted(() => ({
  /** The read markers the tab holds, by context. */
  merged: {} as Record<string, number>,
  /** What the relay holds on the topic. */
  events: [] as SignedEvent[],
  /** Ids the membership read says name the viewer. */
  mentioned: new Set<string>(),
  /** The list's own reads, each a set of filters. */
  listReads: [] as unknown[][],
  /** The relay refuses the list's read. */
  refuse: false,
}))

const comment = (id: string, at: number, content: string, tags: string[][] = []): SignedEvent =>
  ({ id: id.repeat(64).slice(0, 64), pubkey: KATERINA, created_at: at, kind: 1111, content, sig: '', tags: [['A', TOPIC], ['a', TOPIC], ['K', '30840'], ['k', '30840'], ['h', 'team-1'], ...tags] }) as SignedEvent
const PLAIN = comment('a', NOW - 3000, 'Totals moved to Friday')
const MENTION = comment('b', NOW - 2000, `Can you check the numbers, nostr:${encodeNpub(ME)}`, [['p', ME]])

const membership = {
  state: 'known',
  me: ME,
  termsOf: () => ({ member: true, muted: false }),
  isMentioned: (id: string) => relay.mentioned.has(id),
  isMember: () => true,
  changesOf: () => [],
  floor: NOW - 200 * 24 * 60 * 60,
  namedComments: [],
}
const conversation = vi.hoisted(() => ({
  // The badges read: the topic's conversation as ids and times. The copy on the device holds nothing.
  read: (_files: unknown, source?: string) =>
    Promise.resolve(source === 'copy' ? {} : { [`30840:${'1'.repeat(64)}:pitch`]: relay.events.map((e) => ({ id: e.id, at: e.created_at, by: e.pubkey, root: e.id })) }),
}))
const viewer = vi.hoisted(() => () => ({ relayUrl: 'wss://relay', token: { pubkey: '1'.repeat(64), accessToken: 't' } }))

// Each stood in for where it is defined, so the seam's own modules read the same ones.
vi.mock('@/api/internal/membership', async (original) => ({ ...(await original<Record<string, unknown>>()), useMembership: () => membership }))
vi.mock('@/api/foreign', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useForeignObjects: () => ({ conversations: conversation.read }),
  useRelayViewer: () => viewer,
  useResolvedReferences: () => ({}),
}))
vi.mock('@/api/people', async (original) => ({ ...(await original<Record<string, unknown>>()), useMentionNames: () => [{ pubkey: '2'.repeat(64), name: 'Katerina' }] }))
vi.mock('@/api/avatars', async (original) => ({ ...(await original<Record<string, unknown>>()), useAvatarSrc: () => () => undefined }))
vi.mock('@/api/relayUrl', async (original) => ({ ...(await original<Record<string, unknown>>()), hasRelay: true }))
vi.mock('@/api/useChannelStreams', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useChannelStreams: () => ({ at: 0, streams: {} }),
  useHeldChannelEvents: () => [],
}))
// The topic is in no team: its level is the one its author has.
vi.mock('@/api/useTeams', async (original) => ({ ...(await original<Record<string, unknown>>()), useTeams: () => ({ teams: null, failed: true, reload: async () => {} }) }))
vi.mock('@/auth/heldSession', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  heldToken: () => ({ pubkey: '1'.repeat(64), accessToken: 't' }),
  useSessionResumed: () => 0,
}))
vi.mock('@/nostr/useReadStateSync', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useReadFrontier: () => ({ ready: true, marker: (context: string | undefined) => (context ? relay.merged[context] : undefined), merged: relay.merged }),
}))
vi.mock('@/nostr/liveTopics', async (original) => ({ ...(await original<Record<string, unknown>>()), getLiveClient: () => null }))
vi.mock('@/nostr/foreign', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  // The list's read: what the relay holds on the topic, whatever it is asked.
  viewerQuery: () => async (filters: unknown[]) => {
    relay.listReads.push(filters)
    if (relay.refuse) throw new Error('429 Too Many Requests')
    return relay.events
  },
  // The topic lists no file.
  topicListsAsViewer: async (topics: string[]) => new Map(topics.map((topic) => [topic, []])),
  topicActivityAsViewer: async () => ({ at: new Map(), comments: new Map(), parents: new Map() }),
}))

const topic = { ref: TOPIC, address: TOPIC, kind: 30840, folder: 'team-1', slots: { title: { value: 'Pitch' } } } as unknown as ForeignObject

async function mount() {
  const { useTopicPageDot } = await import('@/api')
  const { PageDot } = await import('./PageListDot')
  function TopicTitle() {
    const dot = useTopicPageDot(topic, '/topic/pitch')
    return dot ? <PageDot dot={dot} /> : null
  }
  return render(
    <MemoryRouter>
      <TopicTitle />
    </MemoryRouter>,
  )
}

/** Opens the list as a finger does: a tap on the dot. */
async function openList() {
  await userEvent.setup().pointer({ keys: '[TouchA]', target: document.querySelector('[data-page-dot]')! })
}

beforeEach(() => {
  // What a list and the badges read is held for the tab, at module level: each test its own tab.
  vi.resetModules()
  relay.merged = {}
  relay.events = [PLAIN, MENTION]
  relay.mentioned = new Set([MENTION.id])
  relay.listReads = []
  relay.refuse = false
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the dot beside a topic’s title (ACT-4)', () => {
  it('is a quiet ring when everything there is read', async () => {
    relay.merged = { [fileContext(TOPIC)!]: NOW }
    await mount()
    await waitFor(() => expect(document.querySelector('[data-page-dot]')?.getAttribute('data-page-dot')).toBe('quiet'))
  })

  it('is blue with a mention of you you have not read, and lists it under New', async () => {
    // The plain comment is read; the mention after it is not.
    relay.merged = { [fileContext(TOPIC)!]: NOW - 2500 }
    await mount()
    await waitFor(() => expect(document.querySelector('[data-page-dot]')?.getAttribute('data-page-dot')).toBe('lit'))
    await openList()
    const fresh = await waitFor(() => {
      const part = document.querySelector<HTMLElement>('[data-page-list-part="new"]')
      expect(part).not.toBeNull()
      return part!
    })
    expect(within(fresh).getByText('mentioned you')).toBeInTheDocument()
    expect(within(fresh).queryByText(/Totals moved/)).toBeNull()
  })

  it('lists a read mention under Earlier and not a read plain comment, and reads only once the list is open', async () => {
    relay.merged = { [fileContext(TOPIC)!]: NOW }
    await mount()
    await waitFor(() => expect(document.querySelector('[data-page-dot]')?.getAttribute('data-page-dot')).toBe('quiet'))
    expect(relay.listReads).toEqual([])
    await openList()
    const earlier = await waitFor(() => {
      const part = document.querySelector<HTMLElement>('[data-page-list-part="earlier"]')
      expect(part && within(part).queryByText('mentioned you')).toBeTruthy()
      return part!
    })
    expect(within(earlier).getByText(/Can you check the numbers/)).toBeInTheDocument()
    expect(screen.queryByText(/Totals moved/)).toBeNull()
    expect(document.querySelector('[data-page-list-part="new"]')).toBeNull()
    expect(relay.listReads).toHaveLength(1)
  })

  it('says "Nothing here yet." when nothing there was ever about you', async () => {
    relay.events = [PLAIN]
    relay.mentioned = new Set()
    relay.merged = { [fileContext(TOPIC)!]: NOW }
    await mount()
    await waitFor(() => expect(document.querySelector('[data-page-dot]')?.getAttribute('data-page-dot')).toBe('quiet'))
    await openList()
    expect(await screen.findByText('Nothing here yet.')).toBeInTheDocument()
    expect(screen.queryByText(/Totals moved/)).toBeNull()
  })

  it('says Earlier could not be read when the relay refuses the list, never "Nothing here yet."', async () => {
    relay.refuse = true
    relay.merged = { [fileContext(TOPIC)!]: NOW }
    await mount()
    await waitFor(() => expect(document.querySelector('[data-page-dot]')?.getAttribute('data-page-dot')).toBe('quiet'))
    await openList()
    expect(await screen.findByText('Earlier could not be read.')).toBeInTheDocument()
    expect(screen.queryByText('Nothing here yet.')).toBeNull()
  })

  it('opened again a minute later, lists a mention said and read since it was first opened', async () => {
    // Only the clock is faked; a minute past the first open, inside the same hour, so the read's horizon is the same.
    const start = NOW % 3600 > 3500 ? (Math.floor(NOW / 3600) + 1) * 3600 + 600 : NOW
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(start * 1000)
    relay.merged = { [fileContext(TOPIC)!]: NOW }
    await mount()
    await waitFor(() => expect(document.querySelector('[data-page-dot]')?.getAttribute('data-page-dot')).toBe('quiet'))
    await openList()
    await screen.findByText(/Can you check the numbers/)
    await openList()
    await waitFor(() => expect(document.querySelector('[data-page-list]')).toBeNull())
    // Said after the first open, and read since: the page holds nothing new, so only a fresh read lists it.
    const later = comment('c', NOW - 1000, `Ready for review, nostr:${encodeNpub(ME)}`, [['p', ME]])
    relay.events = [...relay.events, later]
    relay.mentioned = new Set([...relay.mentioned, later.id])
    vi.setSystemTime((start + 61) * 1000)
    await openList()
    expect(await screen.findByText(/Ready for review/)).toBeInTheDocument()
  })
})

describe('a page’s list (ACT-4)', () => {
  const line = (id: string, at: number, seen: boolean, reason: 'mention' | 'message' = 'mention') => ({ id, by: KATERINA, at, reason, root: id, words: `Words ${id}`, seen, href: `/topic/pitch?thread=${id}` })

  it('draws New on top and Earlier under it, newest first in each', async () => {
    const { PageList } = await import('./PageListDot')
    render(
      <MemoryRouter>
        <PageList lines={[line('old-seen', NOW - 500, true), line('new-1', NOW - 100, false, 'message'), line('new-2', NOW - 50, false), line('seen-1', NOW - 200, true)]} />
      </MemoryRouter>,
    )
    const fresh = document.querySelector<HTMLElement>('[data-page-list-part="new"]')!
    const earlier = document.querySelector<HTMLElement>('[data-page-list-part="earlier"]')!
    expect(within(fresh).getByText('New')).toBeInTheDocument()
    expect(within(fresh).getAllByText(/^Words /).map((el) => el.textContent)).toEqual(['Words new-2', 'Words new-1'])
    expect(within(earlier).getAllByText(/^Words /).map((el) => el.textContent)).toEqual(['Words seen-1', 'Words old-seen'])
  })

  it('shows New at once and a loading Earlier while its read is out, and "Nothing here yet." only once it returned empty', async () => {
    const { PageList } = await import('./PageListDot')
    const { rerender } = render(
      <MemoryRouter>
        <PageList lines={undefined} held={[line('new-1', NOW - 100, false)]} />
      </MemoryRouter>,
    )
    expect(within(document.querySelector<HTMLElement>('[data-page-list-part="new"]')!).getByText('Words new-1')).toBeInTheDocument()
    expect(document.querySelector('[data-page-list-part="earlier"]')).not.toBeNull()
    expect(screen.queryByText('Nothing here yet.')).toBeNull()
    rerender(
      <MemoryRouter>
        <PageList lines={[]} />
      </MemoryRouter>,
    )
    expect(screen.getByText('Nothing here yet.')).toBeInTheDocument()
  })
})
