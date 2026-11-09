/**
 * A topic followed at All (TOPI-3): its middle column draws its own conversation and every thread on each file it
 * lists, one list in time order, each file's threads under that file's heading. What a person sees: the order, the
 * heading over a file's thread and none over the topic's own, an archived file's thread with nothing to write and
 * its closed line, and the New line drawn once both reads are in.
 *
 * The real `useFileConversation` reads the topic's own over a mocked relay read, as in the PEE-44 test beside this
 * one; the files' conversations are handed in as the topic's view gets them (`useListedConversations`, tested on its
 * own). The cards are stubbed to what this test reads off them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import type { People } from '@estiva-app/interop'
import type { FileConversation, ListedSource } from '@/api'

const relay = vi.hoisted(() => ({
  read: vi.fn<(container: unknown, rootIds: readonly string[]) => Promise<FileConversation>>(),
}))
vi.mock('@/nostr/conversationCatchUp', () => ({
  readConversation: async (container: unknown, rootIds: readonly string[]) => ({ value: await relay.read(container, rootIds), events: [] }),
  catchUpConversation: async () => ({ changed: false, object: false, mentions: false }),
}))
const viewer = vi.hoisted(() => () => ({ relayUrl: 'https://relay.test', token: { pubkey: 'a'.repeat(64) } }))
vi.mock('@/api/foreign', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/api/foreign')),
  useRelayViewer: () => viewer,
}))
vi.mock('@/nostr/conversationFromCopy', () => ({ conversationFromCopy: async () => Promise.reject(new Error('no copy')) }))
vi.mock('@/nostr/useLiveFile', () => ({ useLiveFile: () => ({ relayState: 'live' }) }))
vi.mock('@/lib/useRefreshTriggers', () => ({ useRefreshTriggers: () => {} }))
vi.mock('@/api', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/api')),
  useWorkspaceDirectory: () => people,
  useMembership: () => ({ refresh: () => Promise.resolve() }),
  useReadActions: () => ({ markThreadRead: () => {}, markContainerRead: () => {}, markFileRead: () => {} }),
}))
vi.mock('@/lib/toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('@/components/ui/ConversationBox', () => ({
  ConversationBox: ({ contextLabel }: { contextLabel: string }) => <div data-testid="box">{contextLabel}</div>,
  ClosedBox: ({ reason }: { reason: string }) => <p data-testid="closed">{reason}</p>,
}))
vi.mock('@/components/ConversationCard', () => ({
  ConversationCard: ({ body, heading, readOnly }: { body: string; heading?: React.ReactNode; readOnly?: boolean }) => (
    <article data-read-only={String(!!readOnly)}>
      {heading}
      <p>{body}</p>
    </article>
  ),
}))
// The thread pane as far as this test reads it: whether it offers a box, and the line in its place.
vi.mock('@/components/ThreadPanel', () => ({
  ThreadPanel: ({ readOnly, readOnlyNotice }: { readOnly?: boolean; readOnlyNotice?: React.ReactNode }) => (
    <section data-testid="thread" data-read-only={String(!!readOnly)}>
      {readOnlyNotice}
    </section>
  ),
}))
// Every message read before; when the topic was left is the layout's record (`useLeftAt`), set per test.
vi.mock('@/nostr/useReadStateSync', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/nostr/useReadStateSync')),
  useReadFrontier: () => ({ marker: () => 4_000_000_000, merged: {}, ready: true }),
}))
const left = vi.hoisted(() => ({ at: null as number | null }))
vi.mock('@estiva-app/ui', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@estiva-app/ui')),
  useLeftAt: () => left.at,
}))

import { ConversationLayout } from '@estiva-app/ui'
import { useFileConversationView, type ListedView } from './useFileConversationView'

const CATH = 'b'.repeat(64)
const people: People = { [CATH]: { displayName: 'Cath' } } as unknown as People
const T = 1_700_000_000
const TEAM = '2b0c3d4e-5f60-4718-8293-a4b5c6d7e8f9'
const TOPIC = `30840:${CATH}:launch`
const ISSUE = `30851:${CATH}:issue-12`
const event = (id: string, body: string, at: number) => ({
  id: id.repeat(64).slice(0, 64),
  author: CATH,
  body,
  createdAt: at,
  kind: 1111,
  files: [],
  references: [],
})
const conversationOf = (roots: ReturnType<typeof event>[]): FileConversation => ({
  roots,
  replies: {},
  decorations: { byId: {}, reactionTargetsOmitted: 0, reactionEventsCut: false, editEventsCut: false },
  threads: {},
})

const first = event('1', 'Kick-off notes', T)
const last = event('2', 'Shipping Friday', T + 120)
const onIssue = event('3', 'Blocked on review', T + 60)
const issue = (archived = false): ListedSource => ({
  file: 'issue-12',
  address: ISSUE,
  folder: 'ship-team',
  container: { kind: 'file', address: ISSUE, h: 'ship-team' },
  conversation: conversationOf([onIssue]),
  archived,
})
const listedWith = (state: ListedView['state']): ListedView => ({
  state,
  actionsFor: () => undefined,
  headingOf: (address) => (address === ISSUE ? <h3>Issue 12</h3> : null),
  nameOf: () => 'Issue 12',
  closedOf: (address) => (address === ISSUE ? 'Archived. Unarchive it to comment.' : undefined),
})

function Topic({ listed, openThreadId }: { listed?: ListedView; openThreadId?: string }) {
  const { conversationParts } = useFileConversationView({
    container: { kind: 'file', address: TOPIC, h: TEAM },
    rootIds: [first.id, last.id],
    openThreadId,
    onOpenThread: () => {},
    title: 'Launch',
    listed,
  })
  return <ConversationLayout threads="beside" {...conversationParts} />
}

afterEach(() => {
  relay.read.mockReset()
  left.at = null
})

describe('a topic at All draws its files’ threads with its own (TOPI-3)', () => {
  it("one list in time order, a file's thread under its heading and the topic's own under none", async () => {
    relay.read.mockResolvedValue(conversationOf([first, last]))
    render(<Topic listed={listedWith({ files: [issue()] })} />)
    await waitFor(() => expect(screen.getByText('Blocked on review')).toBeInTheDocument())

    const order = screen.getAllByRole('article').map((card) => card.querySelector('p')!.textContent)
    expect(order).toEqual(['Kick-off notes', 'Blocked on review', 'Shipping Friday'])
    expect(screen.getByText('Blocked on review').closest('article')!.querySelector('h3')!.textContent).toBe('Issue 12')
    expect(screen.getByText('Kick-off notes').closest('article')!.querySelector('h3')).toBeNull()
    // The box under the list writes to the topic.
    expect(screen.getByTestId('box').textContent).toBe('Launch')
  })

  it("an archived file's thread offers nothing to write, says why where its box would be, and the topic's own stays open", async () => {
    relay.read.mockResolvedValue(conversationOf([first, last]))
    render(<Topic listed={listedWith({ files: [issue(true)] })} openThreadId={onIssue.id} />)
    await waitFor(() => expect(screen.getByText('Blocked on review')).toBeInTheDocument())

    expect(screen.getByText('Blocked on review').closest('article')!.getAttribute('data-read-only')).toBe('true')
    expect(screen.getByText('Kick-off notes').closest('article')!.getAttribute('data-read-only')).toBe('false')
    const thread = await screen.findByTestId('thread')
    expect(thread.getAttribute('data-read-only')).toBe('true')
    expect(thread.textContent).toBe('Archived. Unarchive it to comment.')
  })

  it("the New line waits for the files' read, then sits over the first new message of either", async () => {
    // Left between the kick-off and the issue's comment: the issue's is the first new one.
    left.at = (T + 30) * 1000
    relay.read.mockResolvedValue(conversationOf([first, last]))
    const view = render(<Topic listed={listedWith('loading')} />)
    await waitFor(() => expect(screen.getByText('Shipping Friday')).toBeInTheDocument())
    // The topic's own is in and the files' read is not: no line yet, not over the topic's newer message.
    expect(screen.queryByText('New')).toBeNull()

    view.rerender(<Topic listed={listedWith({ files: [issue()] })} />)
    await waitFor(() => expect(screen.getByText('New')).toBeInTheDocument())
    const cards = screen.getAllByRole('article')
    const line = screen.getByText('New')
    // Drawn just above the issue's comment, so before it and after the kick-off.
    expect(line.compareDocumentPosition(cards[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(cards[1].textContent).toContain('Blocked on review')
    expect(line.compareDocumentPosition(cards[0]) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
  })
})
