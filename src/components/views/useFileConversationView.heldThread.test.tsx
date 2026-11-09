/**
 * A comment deleted while you reply to it stays open — ONE-10, Decided 9 November.
 *
 * A comment with no replies leaves the read the moment it is deleted. The thread panel was built from the read, so it
 * closed and took the reply box and the half-written reply with it. While the box holds text, the thread now stays as
 * "This comment was deleted." with the box, so Send can be pressed and says why it is refused. The real
 * `useFileConversation` runs over a mocked relay read; the box is a stand-in, since what is under test is whether the
 * view keeps it, and the kit's box has its own tests for the wording.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import type { People } from '@estiva-app/interop'
import type { FileConversation } from '@/api'
import { browserDrafts, draftKeys } from '@/lib/drafts'

const relay = vi.hoisted(() => ({
  read: vi.fn<(container: unknown, rootIds: readonly string[]) => Promise<FileConversation>>(),
}))
vi.mock('@/nostr/conversationCatchUp', () => ({
  readConversation: async (container: unknown, rootIds: readonly string[]) => ({ value: await relay.read(container, rootIds), events: [] }),
  catchUpConversation: async (
    store: { settle: (key: string, at: number, value: FileConversation) => void },
    key: string,
    container: unknown,
    rootIds: readonly string[],
  ) => {
    store.settle(key, Date.now(), await relay.read(container, rootIds))
    return { changed: true, object: false, mentions: false, authors: [] }
  },
}))
const viewer = vi.hoisted(() => () => ({ relayUrl: 'https://relay.test', token: { pubkey: 'a'.repeat(64) } }))
vi.mock('@/api/foreign', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/api/foreign')),
  useRelayViewer: () => viewer,
}))
vi.mock('@/nostr/useLiveFile', () => ({ useLiveFile: () => ({ relayState: 'live' }) }))
vi.mock('@/lib/useRefreshTriggers', () => ({ useRefreshTriggers: () => {} }))
const membership = vi.hoisted(() => ({ refresh: () => Promise.resolve() }))
vi.mock('@/api', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/api')),
  useWorkspaceDirectory: () => people,
  useMembership: () => membership,
  useReadActions: () => ({ markThreadRead: () => {}, markContainerRead: () => {}, markFileRead: () => {} }),
}))
vi.mock('@/lib/toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
// The reply box, as a stand-in that says it is there: its upload hooks need more than this test sets up.
vi.mock('@/components/ui/ConversationBox', () => ({
  ConversationBox: ({ kind }: { kind?: string }) => <div role="textbox" aria-label={kind === 'reply' ? 'Reply box' : 'Message box'} />,
  ClosedBox: () => null,
}))
// The list's card, as a stand-in: a deleted comment's card has no words (the real one says it was deleted).
vi.mock('@/components/ConversationCard', () => ({
  ConversationCard: ({ body, deleted }: { body: string; deleted?: boolean }) => <article>{deleted ? null : body}</article>,
}))

import { useFileConversationView } from './useFileConversationView'
import { ConversationLayout } from '@estiva-app/ui'

const CATH = 'b'.repeat(64)
const people: People = { [CATH]: { displayName: 'Cath' } } as unknown as People
const T = 1_700_000_000
const event = (id: string, body: string, at: number) => ({
  id: id.repeat(64).slice(0, 64),
  author: CATH,
  body,
  createdAt: at,
  kind: 1111,
  files: [],
  references: [],
})
const rootA = event('1', 'Can you check the numbers?', T)
const rootB = event('2', 'Another comment', T + 60)
const conversationOf = (...roots: ReturnType<typeof event>[]): FileConversation => ({
  roots: [...roots].reverse(),
  replies: {},
  decorations: { byId: {}, reactionTargetsOmitted: 0, reactionEventsCut: false, editEventsCut: false },
  threads: {},
})

function View({ rootIds }: { rootIds: string[] }) {
  const { conversationParts } = useFileConversationView({
    container: { kind: 'file', address: `30840:${CATH}:d`, h: 'team' },
    rootIds,
    openThreadId: rootA.id,
    onOpenThread: () => {},
    title: 'A file',
    onCommented: async () => {},
  })
  return <ConversationLayout threads="beside" {...conversationParts} />
}

/** Cath's comment is open with its reply box; then it is deleted, and the next read no longer has it. */
async function deletedWhileOpenAt() {
  let onRelay = conversationOf(rootA, rootB)
  relay.read.mockImplementation(async () => onRelay)
  const rendered = render(<View rootIds={[rootA.id, rootB.id]} />)
  await screen.findByRole('textbox', { name: 'Reply box' })
  onRelay = conversationOf(rootB)
  await act(async () => rendered.rerender(<View rootIds={[rootB.id]} />))
  await screen.findAllByText('Another comment')
  return rendered
}
const deletedWhileOpen = async () => void (await deletedWhileOpenAt())

const drafts = browserDrafts()
afterEach(() => {
  relay.read.mockReset()
  drafts.clear(draftKeys.thread(rootA.id))
})

describe('a comment deleted while you reply to it (ONE-10)', () => {
  it('stays open as "This comment was deleted." with the reply box while the box holds text', async () => {
    drafts.write(draftKeys.thread(rootA.id), 'Yes, the totals are off')
    await deletedWhileOpen()
    expect(screen.getByText('This comment was deleted.')).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Reply box' })).toBeTruthy()
    expect(screen.queryByText(/takes no new replies/)).toBeNull()
    expect(screen.queryByText('Can you check the numbers?')).toBeNull()
  })

  it('stays while Send waits for the relay, though the box has emptied its draft and the reply is drawn', async () => {
    drafts.write(draftKeys.thread(rootA.id), 'Yes, the totals are off')
    const { rerender } = await deletedWhileOpenAt()
    // Send: Peek's box empties its draft at once and draws the reply, which reads the conversation again.
    drafts.clear(draftKeys.thread(rootA.id))
    await act(async () => rerender(<View rootIds={[rootB.id]} />))
    expect(screen.getByText('This comment was deleted.')).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Reply box' })).toBeTruthy()
    expect(screen.queryByText(/takes no new replies/)).toBeNull()
  })

  it('negative control: with nothing in the box the thread goes with its comment', async () => {
    await deletedWhileOpen()
    expect(screen.queryByText('This comment was deleted.')).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Reply box' })).toBeNull()
  })
})
