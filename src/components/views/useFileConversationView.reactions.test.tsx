/**
 * Reacting in Peek with the shared reaction row — PEEKM-5.
 *
 * The real view, `useFileConversation` and the real cards run over a mocked
 * relay read; the relay's answer to the `kind:7` is what each case sets. A
 * refused reaction is taken back and said under the message, "Not reacted: …",
 * as Ship and Leaf say it, with no toast (the project's Done when; record
 * a-refused-action-is-undone-and-your-text-comes-back).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { UnsignedEvent } from '@estiva-app/protocol'
import type { People } from '@estiva-app/interop'
import type { FileConversation } from '@/api'

const relay = vi.hoisted(() => ({ read: vi.fn<() => Promise<FileConversation>>(), answer: { ok: true } as { ok: boolean; reason?: string } }))
vi.mock('@/nostr/conversationCatchUp', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/nostr/conversationCatchUp')),
  readConversation: async () => ({ value: await relay.read(), events: [] }),
  catchUpConversation: async (store: { settle: (key: string, at: number, value: FileConversation) => void }, key: string) => {
    store.settle(key, Date.now(), await relay.read())
    return { changed: true, object: false, mentions: false }
  },
}))
const signed = vi.hoisted(() => ({ events: [] as UnsignedEvent[] }))
vi.mock('@/nostr/bridge', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/nostr/bridge')),
  signViaEstivaId: async (unsigned: UnsignedEvent) => {
    signed.events.push(unsigned)
    return { ...unsigned, id: 'e'.repeat(64), sig: 'f'.repeat(128) }
  },
  publishSigned: async () => relay.answer,
}))
const viewer = vi.hoisted(() => () => ({ relayUrl: 'https://relay.test', token: { pubkey: 'a'.repeat(64), accessToken: 't' } }))
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
const toast = vi.hoisted(() => ({ show: vi.fn() }))
vi.mock('@/lib/toast', () => ({ useToast: () => ({ showToast: toast.show }) }))
vi.mock('@/components/ui/ConversationBox', () => ({ ConversationBox: () => null, ClosedBox: () => null, EditBox: () => null }))

import { PeekDataProvider } from '@/api'
import { DebugProvider } from '@/lib/debug'
import { useFileConversationView } from './useFileConversationView'

const ME = 'a'.repeat(64)
const CATH = 'b'.repeat(64)
const people: People = { [ME]: { displayName: 'Me' }, [CATH]: { displayName: 'Cath' } } as unknown as People
const T = 1_700_000_000
const ROOT = '1'.repeat(64)
const root = { id: ROOT, author: CATH, body: 'Shall we ship it?', createdAt: T, kind: 1111, files: [], references: [] }
const cathReacted = { id: '7'.repeat(64), author: CATH, by: CATH, emoji: '👍', target: ROOT, createdAt: T + 1 }
const conversation = (): FileConversation => ({
  roots: [root],
  replies: {},
  decorations: { byId: { [ROOT]: { reactions: [cathReacted] } } as never, reactionTargetsOmitted: 0, reactionEventsCut: false, editEventsCut: false },
})

function View() {
  const { conversation: list } = useFileConversationView({
    container: { kind: 'file', address: `30840:${ME}:d`, h: 'team' },
    rootIds: [ROOT],
    openThreadId: undefined,
    onOpenThread: () => {},
    title: 'A file',
    onCommented: async () => {},
  })
  return list
}

const open = () =>
  render(
    <MemoryRouter>
      <DebugProvider>
        <PeekDataProvider>
          <View />
        </PeekDataProvider>
      </DebugProvider>
    </MemoryRouter>,
  )

/** Cath's 👍 pill on the comment, as the shared row names it. */
const pill = () => screen.findByRole('button', { name: /^Makes sense, \d$/ })

afterEach(() => {
  relay.read.mockReset()
  relay.answer = { ok: true }
  toast.show.mockReset()
  signed.events = []
})

describe('a reaction in Peek', () => {
  it('is written as a kind:7 on the comment when you click the pill — the control', async () => {
    relay.read.mockResolvedValue(conversation())
    open()
    await userEvent.click(await pill())
    await waitFor(() => expect(signed.events.find((e) => e.kind === 7)?.content).toBe('👍'))
    expect(signed.events.find((e) => e.kind === 7)!.tags).toContainEqual(['e', ROOT])
    expect(screen.queryByText(/Not reacted/)).toBeNull()
  })

  it('refused, is said under the comment and not in a toast', async () => {
    relay.read.mockResolvedValue(conversation())
    relay.answer = { ok: false, reason: 'invalid: something the relay disliked' }
    open()
    await userEvent.click(await pill())
    // Answered: either way it is said somewhere, so the checks below see the answer, not a wait.
    await waitFor(() => expect(toast.show.mock.calls.length + screen.queryAllByText(/Not reacted/).length).toBeGreaterThan(0))
    expect(toast.show).not.toHaveBeenCalled()
    expect(screen.getByText('Not reacted: the relay did not take it.')).toBeInTheDocument()
    // Taken back: Cath's alone again.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Makes sense, 1' })).toHaveAttribute('aria-pressed', 'false'))
  })
})
