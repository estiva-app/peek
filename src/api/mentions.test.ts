/**
 * What the `[` menu offers for a message — RIC-11.
 *
 * The suggestion plugin is not a component, so it reads these module-level
 * answers; the guarantee is that a message is offered only once it has an
 * event id to be pointed at.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./currentUser', () => ({ useCurrentUser: () => undefined }))
vi.mock('./people', () => ({ useMentionNames: () => undefined, usePeople: () => undefined }))

import { registerActiveConversation, registerTopicConversation, unregisterActiveConversation, unregisterTopicConversation } from '@/lib/conversationRegistry'
import { mentionMessages } from './mentions'

beforeEach(() => {
  unregisterActiveConversation()
  unregisterTopicConversation()
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
