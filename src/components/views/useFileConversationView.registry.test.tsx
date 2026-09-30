/**
 * A file's conversation is something the launcher can ask about (FOL-36).
 *
 * "Ask about this" reads what `registerTopicConversation` published, and only
 * the topic view published — so on a file page the launcher had nothing to
 * ask about. This view has read every thread already, so it publishes the
 * whole conversation, each root followed by its replies, and registers how to
 * open one of its threads for a citation into a closed one (INT-8).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { People } from '@estiva-app/interop'
import type { FileConversation } from '@/api'
import { getActiveConversation } from '@/lib/conversationRegistry'
import { openConversation } from '@/lib/threadOpener'

const relay = vi.hoisted(() => ({ state: 'loading' as unknown }))
vi.mock('@/api', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/api')),
  useFileConversation: () => ({ state: relay.state, actions: {}, viewerPubkey: 'a'.repeat(64) }),
  useWorkspaceDirectory: () => people,
}))
vi.mock('@/lib/toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))

import { useFileConversationView } from './useFileConversationView'

const ME = 'a'.repeat(64)
const CATH = 'b'.repeat(64)
const people: People = { [CATH]: { displayName: 'Cath' } } as unknown as People
const T = 1_700_000_000
const event = (id: string, author: string, body: string, at = T) => ({
  id: id.repeat(64).slice(0, 64),
  author,
  body,
  createdAt: at,
  kind: 1111,
  files: [],
  references: [],
})
const rootA = event('1', CATH, 'First')
const rootB = event('2', CATH, 'Second', T + 60)
const reply = event('3', ME, 'Agreed', T + 120)
const conversation: FileConversation = {
  roots: [rootB, rootA],
  replies: { [rootA.id]: [reply] },
  decorations: { byId: {}, reactionTargetsOmitted: 0, reactionEventsCut: false, editEventsCut: false },
}

function mount(openThreadId?: string) {
  const onOpenThread = vi.fn()
  const hook = renderHook(() =>
    useFileConversationView({
      container: { kind: 'file', address: `30840:${CATH}:d`, h: 'team' },
      rootIds: [rootA.id, rootB.id],
      openThreadId,
      onOpenThread,
      title: 'A file',
      onCommented: async () => {},
    }),
  )
  return { ...hook, onOpenThread }
}

afterEach(() => {
  relay.state = 'loading'
})

describe('the file view publishes its conversation to the launcher', () => {
  it('every root followed by its replies, oldest first, each naming the thread it opens in', () => {
    relay.state = conversation
    const { unmount } = mount()
    const snapshot = getActiveConversation()
    expect(snapshot?.messages.map((m) => [m.body, m.author, m.eventId === m.id, m.conversationId])).toEqual([
      ['First', 'Cath', true, rootA.id],
      ['Agreed', 'You', true, rootA.id],
      ['Second', 'Cath', true, rootB.id],
    ])
    // Nothing is unread: a file's replies came with the threads.
    expect(snapshot?.messages.some((m) => m.repliesNotRead)).toBe(false)
    unmount()
    expect(getActiveConversation()).toBeNull()
  })

  it('publishes nothing while the conversation is still loading', () => {
    mount()
    expect(getActiveConversation()).toBeNull()
  })

  it('opens a thread for a citation into one that is closed, while mounted', () => {
    relay.state = conversation
    const { onOpenThread, unmount } = mount()
    expect(openConversation(rootA.id)).toBe(true)
    expect(onOpenThread).toHaveBeenCalledWith(rootA.id)
    unmount()
    expect(openConversation(rootA.id)).toBe(false)
  })
})
