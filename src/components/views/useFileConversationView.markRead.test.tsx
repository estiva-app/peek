/**
 * What the conversation view reads — PEE-44, Miky 2026-10-03.
 *
 * The view drives a DM's mark and Peek's own file view's: its `newestAt` is
 * what the DM or file is marked up to, and it must be the newest top-level
 * message, never a reply, or opening the conversation reads every thread in it
 * (SPEC §11.3 carries the stream's marker down). The open thread is marked by
 * the view itself, up to its newest reply. The real `useFileConversation` runs
 * over a mocked relay read, as in the SID-1 test beside this one.
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
  ConversationCard: ({ body, hasNewReply }: { body: string; hasNewReply?: boolean }) => <article data-new-reply={String(!!hasNewReply)}>{body}</article>,
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
  const { conversation: view, newestAt } = useFileConversationView({
    container: { kind: 'channel', h: '1c7a1f52-6721-42fe-a348-9efde8565374' },
    rootIds: [],
    openThreadId,
    onOpenThread: () => {},
    title: 'DM · Cath',
  })
  return (
    <>
      <output data-testid="newest">{newestAt}</output>
      {view}
    </>
  )
}

afterEach(() => {
  relay.read.mockReset()
  marks.thread.mockReset()
})

describe('the conversation view reads top-level messages, and threads only when open (PEE-44)', () => {
  it('its newestAt is the newest top-level message, not a newer reply', async () => {
    relay.read.mockResolvedValue(conversation)
    render(<View openThreadId={undefined} />)
    await waitFor(() => expect(screen.getByTestId('newest').textContent).toBe(String(T)))
    await new Promise((r) => setTimeout(r, 1700))
    expect(marks.thread).not.toHaveBeenCalled()
  })

  it('a message whose thread holds a reply newer than the DM marker says "new reply"', async () => {
    relay.read.mockResolvedValue(conversation)
    render(<View openThreadId={undefined} />)
    await waitFor(() => expect(screen.getByText('Root').getAttribute('data-new-reply')).toBe('true'))
  })

  it('an open thread is marked up to its newest reply', async () => {
    relay.read.mockResolvedValue(conversation)
    render(<View openThreadId={root.id} />)
    await waitFor(() => expect(marks.thread).toHaveBeenCalledWith(root.id, T + 120))
  })
})
