/**
 * What the conversation view reads — PEE-44, Miky 2026-10-03.
 *
 * The view drives a DM's mark and Peek's own file view's: its `seenAt` is
 * what the DM or file is marked up to, and it must be the newest top-level
 * message seen, never a reply, or opening the conversation reads every thread
 * in it (SPEC §11.3 carries the stream's marker down). The open thread is
 * marked by the view itself, up to its newest reply seen. The real
 * `useFileConversation` runs over a mocked relay read, as in the SID-1 test
 * beside this one. jsdom has no IntersectionObserver, so everything drawn is
 * on screen and the dwell alone decides (`useSeenOnScreen`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import type { People } from '@estiva-app/interop'
import type { FileConversation } from '@/api'

const relay = vi.hoisted(() => ({
  read: vi.fn<(container: unknown, rootIds: readonly string[]) => Promise<FileConversation>>(),
}))
// The first read; the store holds what it answered (OPT-3).
vi.mock('@/nostr/conversationCatchUp', () => ({
  readConversation: async (container: unknown, rootIds: readonly string[]) => ({ value: await relay.read(container, rootIds), events: [] }),
  catchUpConversation: async () => ({ changed: false, object: false, mentions: false }),
}))
const viewer = vi.hoisted(() => () => ({ relayUrl: 'https://relay.test', token: { pubkey: 'a'.repeat(64) } }))
vi.mock('@/api/foreign', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/api/foreign')),
  useRelayViewer: () => viewer,
}))
vi.mock('@/nostr/useLiveFile', () => ({ useLiveFile: () => ({ relayState: 'live' }) }))
vi.mock('@/lib/useRefreshTriggers', () => ({ useRefreshTriggers: () => {} }))
const membership = vi.hoisted(() => ({ refresh: () => Promise.resolve() }))
const marks = vi.hoisted(() => ({ thread: vi.fn(), container: vi.fn(), file: vi.fn() }))
vi.mock('@/api', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/api')),
  useWorkspaceDirectory: () => people,
  useMembership: () => membership,
  useReadActions: () => ({ markThreadRead: marks.thread, markContainerRead: marks.container, markFileRead: marks.file }),
}))
vi.mock('@/lib/toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('@/components/ui/ConversationBox', () => ({ ConversationBox: () => null, ClosedBox: () => null }))
vi.mock('@/components/ConversationCard', () => ({
  ConversationCard: ({ body, hasNewMessage, hasNewReply, isUrgent }: { body: string; hasNewMessage?: boolean; hasNewReply?: boolean; isUrgent?: boolean }) => (
    <article data-new-message={String(!!hasNewMessage)} data-new-reply={String(!!hasNewReply)} data-urgent={String(!!isUrgent)}>
      {body}
    </article>
  ),
}))
vi.mock('@/components/ReplyCard', () => ({
  ReplyCard: ({ body, isNew, isUrgent }: { body: string; isNew?: boolean; isUrgent?: boolean }) => (
    <article data-new={String(!!isNew)} data-urgent={String(!!isUrgent)}>
      {body}
    </article>
  ),
}))
// The DM read up to its root, before the reply: the reply's thread is new (PEE-44).
vi.mock('@/nostr/useReadStateSync', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/nostr/useReadStateSync')),
  useReadFrontier: () => ({
    marker: (context: string | undefined) => (context === '1c7a1f52-6721-42fe-a348-9efde8565374' ? 1_700_000_000 : undefined),
    merged: { '1c7a1f52-6721-42fe-a348-9efde8565374': 1_700_000_000 },
    ready: true,
  }),
}))

import { useFileConversationView } from './useFileConversationView'

const CATH = 'b'.repeat(64)
const people: People = { [CATH]: { displayName: 'Cath' } } as unknown as People
const T = 1_700_000_000
const event = (id: string, body: string, at: number) => ({
  id: id.repeat(64).slice(0, 64),
  author: CATH,
  body,
  createdAt: at,
  kind: 9,
  files: [],
  references: [],
})
const root = event('1', 'Root', T)
const reply = event('2', 'A later reply', T + 120)
const conversation: FileConversation = {
  roots: [root],
  replies: { [root.id]: [reply] },
  decorations: { byId: {}, reactionTargetsOmitted: 0, reactionEventsCut: false, editEventsCut: false },
}

function View({ openThreadId }: { openThreadId: string | undefined }) {
  const { conversation: view, threadPanel, seenAt } = useFileConversationView({
    container: { kind: 'channel', h: '1c7a1f52-6721-42fe-a348-9efde8565374' },
    rootIds: [],
    openThreadId,
    onOpenThread: () => {},
    title: 'DM · Cath',
  })
  return (
    <>
      <output data-testid="seen">{seenAt}</output>
      {view}
      {threadPanel}
    </>
  )
}

afterEach(() => {
  relay.read.mockReset()
  marks.thread.mockReset()
})

describe('the conversation view reads top-level messages, and threads only when open (PEE-44)', () => {
  it('its seenAt is the newest top-level message seen, not a newer reply', async () => {
    relay.read.mockResolvedValue(conversation)
    render(<View openThreadId={undefined} />)
    await waitFor(() => expect(screen.getByText('Root')).toBeInTheDocument())
    expect(screen.getByTestId('seen').textContent).toBe('')
    await waitFor(() => expect(screen.getByTestId('seen').textContent).toBe(String(T)))
    await new Promise((r) => setTimeout(r, 1700))
    expect(marks.thread).not.toHaveBeenCalled()
  })

  it('a message whose thread holds a reply newer than the DM marker says "new reply"', async () => {
    relay.read.mockResolvedValue(conversation)
    render(<View openThreadId={undefined} />)
    await waitFor(() => expect(screen.getByText('Root').getAttribute('data-new-reply')).toBe('true'))
  })

  it('an open thread is marked up to its newest reply seen', async () => {
    relay.read.mockResolvedValue(conversation)
    render(<View openThreadId={root.id} />)
    await waitFor(() => expect(marks.thread).toHaveBeenCalledWith(root.id, T + 120))
  })
})

describe('a message keeps the unread look until it has been seen (Katerina, 30 October)', () => {
  const later = event('3', 'A later message', T + 60)
  const urgent = event('4', 'Look at this now !@Cath', T + 90)
  const withNew: FileConversation = { ...conversation, roots: [root, later, urgent] }

  it('a top-level message newer than the marker is drawn new, urgent for you in its urgent tone, until seen', async () => {
    relay.read.mockResolvedValue(withNew)
    render(<View openThreadId={undefined} />)
    await waitFor(() => expect(screen.getByText('A later message').getAttribute('data-new-message')).toBe('true'))
    expect(screen.getByText('A later message').getAttribute('data-urgent')).toBe('false')
    expect(screen.getByText('Look at this now !@Cath').getAttribute('data-new-message')).toBe('true')
    expect(screen.getByText('Look at this now !@Cath').getAttribute('data-urgent')).toBe('true')
    // Read before: no look.
    expect(screen.getByText('Root').getAttribute('data-new-message')).toBe('false')
    // On screen for the dwell: seen, and the look goes.
    await waitFor(() => expect(screen.getByText('A later message').getAttribute('data-new-message')).toBe('false'))
    expect(screen.getByText('Look at this now !@Cath').getAttribute('data-new-message')).toBe('false')
  })

  it('a new reply in the open thread is drawn new until it has been seen there', async () => {
    relay.read.mockResolvedValue(conversation)
    render(<View openThreadId={root.id} />)
    await waitFor(() => expect(screen.getByText('A later reply').getAttribute('data-new')).toBe('true'))
    await waitFor(() => expect(screen.getByText('A later reply').getAttribute('data-new')).toBe('false'))
  })

  it('your own new message is never drawn new', async () => {
    const mine = { ...later, author: 'a'.repeat(64) }
    relay.read.mockResolvedValue({ ...conversation, roots: [root, mine] })
    render(<View openThreadId={undefined} />)
    await waitFor(() => expect(screen.getByText('A later message')).toBeInTheDocument())
    expect(screen.getByText('A later message').getAttribute('data-new-message')).toBe('false')
  })
})
