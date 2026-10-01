/**
 * A new root does not reload the view — SID-1.
 *
 * Sending a top-level message, or anyone's new root arriving, re-resolves the
 * file and hands this view one more root id. Keyed on the roots, that dropped
 * the conversation to 'loading': the list was swapped for the skeleton and
 * every card remounted, losing the scroll and the open replies. Here the real
 * `useFileConversation` runs over a mocked relay read, so what is pinned is
 * the view as a person sees it — the card already on screen is the same DOM
 * node after the new root lands, and no skeleton is drawn on the way.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import type { People } from '@estiva-app/interop'
import type { FileConversation } from '@/api'

const relay = vi.hoisted(() => ({
  read: vi.fn<(container: unknown, rootIds: readonly string[]) => Promise<FileConversation>>(),
}))
vi.mock('@/nostr/fileConversation', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/nostr/fileConversation')),
  conversationAsViewer: (container: unknown, rootIds: readonly string[]) => relay.read(container, rootIds),
}))
// Stable across renders, as the real one is.
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
}))
vi.mock('@/lib/toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
// The composer is not what is under test, and its upload hooks need a Convex client.
vi.mock('@/components/ui/ComposeBox', () => ({ ComposeBox: () => null }))
/*
  The card is drawn by a stand-in that counts its mounts: what is under test is
  whether the view keeps a card mounted, not what the card draws, and the real
  one reads the topic store and Convex for its links and uploads.
*/
const mounts = vi.hoisted(() => ({ byBody: new Map<string, number>() }))
vi.mock('@/components/ConversationCard', async () => {
  const { useEffect } = await vi.importActual<typeof import('react')>('react')
  return {
    ConversationCard: ({ body }: { body: string }) => {
      useEffect(() => {
        mounts.byBody.set(body, (mounts.byBody.get(body) ?? 0) + 1)
      }, [body])
      return <article>{body}</article>
    },
  }
})

import { useFileConversationView } from './useFileConversationView'

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
const rootA = event('1', 'First', T)
const rootB = event('2', 'Second', T + 60)
const conversationOf = (...roots: ReturnType<typeof event>[]): FileConversation => ({
  roots: [...roots].reverse(),
  replies: {},
  decorations: { byId: {}, reactionTargetsOmitted: 0, reactionEventsCut: false, editEventsCut: false },
})

type Props = { address: string; rootIds: string[] }
function View({ address, rootIds }: Props) {
  const { conversation } = useFileConversationView({
    container: { kind: 'file', address, h: 'team' },
    rootIds,
    openThreadId: undefined,
    onOpenThread: () => {},
    title: 'A file',
    onCommented: async () => {},
  })
  return <>{conversation}</>
}

const ADDRESS = `30840:${CATH}:d`
const skeleton = () => document.querySelector('.animate-skeleton-in')

afterEach(() => {
  relay.read.mockReset()
  mounts.byBody.clear()
})

describe('a new root keeps the file view on screen (SID-1)', () => {
  it('the card already drawn is the same node after the new root lands, and no skeleton shows', async () => {
    relay.read.mockResolvedValueOnce(conversationOf(rootA))
    const { rerender } = render(<View address={ADDRESS} rootIds={[rootA.id]} />)
    const first = await screen.findByText('First')

    let land!: (c: FileConversation) => void
    relay.read.mockReturnValueOnce(new Promise((resolve) => (land = resolve)))
    rerender(<View address={ADDRESS} rootIds={[rootA.id, rootB.id]} />)
    // The read with the new root is out: the list is still the list.
    expect(skeleton()).toBeNull()
    expect(screen.getByText('First')).toBe(first)

    await act(async () => land(conversationOf(rootA, rootB)))
    expect(screen.getByText('Second')).toBeTruthy()
    expect(screen.getByText('First')).toBe(first)
    expect(first.isConnected).toBe(true)
    expect(skeleton()).toBeNull()
    expect(mounts.byBody.get('First')).toBe(1)
  })

  it('negative control: opening another file still shows the skeleton', async () => {
    relay.read.mockResolvedValueOnce(conversationOf(rootA))
    const { rerender } = render(<View address={ADDRESS} rootIds={[rootA.id]} />)
    await screen.findByText('First')
    expect(skeleton()).toBeNull()

    relay.read.mockReturnValueOnce(new Promise(() => {}))
    rerender(<View address={`30840:${CATH}:other`} rootIds={[rootB.id]} />)
    await waitFor(() => expect(skeleton()).not.toBeNull())
    expect(screen.queryByText('First')).toBeNull()
  })
})
