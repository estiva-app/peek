/**
 * What the `[` menu writes for a topic and offers for a message — RIC-11.
 *
 * The suggestion plugin is not a component, so it reads these module-level
 * answers; the guarantees are that a topic's address is spelled only when
 * every part of it is known, and that a message is offered only once it has
 * an event id to be pointed at.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./foreign', () => ({ useRelayViewer: () => () => null }))
vi.mock('./store', () => ({ hasConvex: false }))
vi.mock('./currentUser', () => ({ useCurrentUser: () => undefined }))
vi.mock('./people', () => ({ useMentionNames: () => undefined, usePeople: () => undefined }))
vi.mock('./topics', () => ({ useTopics: () => undefined }))
vi.mock('@/nostr/foreign', () => ({ relaySigningKeyAsViewer: vi.fn() }))

import { registerActiveConversation, registerTopicConversation, unregisterActiveConversation, unregisterTopicConversation } from '@/lib/conversationRegistry'
import { mentionMessages, setRelaySigningKey, topicAddress } from './mentions'

const RELAY = 'f3a38fa6c6a1e5d2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7081920'
const UUID = 'b7c1e0a4-2f3d-4a86-9c15-8d0e6f2a4b91'

beforeEach(() => {
  setRelaySigningKey(null)
  unregisterActiveConversation()
  unregisterTopicConversation()
})

describe('topicAddress', () => {
  it('spells the address once the relay key and the channel are both known', () => {
    setRelaySigningKey(RELAY)
    expect(topicAddress({ folderId: UUID })).toBe(`39000:${RELAY}:${UUID}`)
  })

  it('answers null for a topic with no channel — the mock cast', () => {
    setRelaySigningKey(RELAY)
    expect(topicAddress({ folderId: undefined })).toBeNull()
    expect(topicAddress({ folderId: null })).toBeNull()
  })

  it('answers null before the relay key has been read, so the bracket form is written instead', () => {
    expect(topicAddress({ folderId: UUID })).toBeNull()
  })
})

describe('mentionMessages', () => {
  const sent = { id: 'a', author: 'Ada', timestamp: '9:41 AM', body: 'on the relay', eventId: 'e'.repeat(64) }
  const pending = { id: 'b', author: 'Ada', timestamp: '9:42 AM', body: 'still sending' }

  it('offers the messages on screen that have reached the relay', () => {
    registerTopicConversation({ references: [], messages: [sent, pending] })
    expect(mentionMessages()).toEqual([sent])
  })

  it('offers the open thread over the topic around it, as Cmd+K does', () => {
    registerTopicConversation({ references: [], messages: [sent] })
    const reply = { ...sent, id: 'r', body: 'in the thread', eventId: 'f'.repeat(64) }
    registerActiveConversation({ references: [], messages: [reply] })
    expect(mentionMessages()).toEqual([reply])
  })

  it('offers nothing when nothing is on screen', () => {
    expect(mentionMessages()).toEqual([])
  })
})
