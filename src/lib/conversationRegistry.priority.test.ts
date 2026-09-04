/**
 * INT-8 — two things are on screen, and one of them is the answer.
 *
 * A topic publishes its conversations; opening one publishes that thread. Both
 * are live at once, and the question "what am I looking at" has to resolve to
 * the narrower of the two.
 *
 * Priority rather than one slot overwriting another, because the panel mounts
 * and unmounts *inside* a topic that stays put — a single slot would make
 * correctness depend on the order two effects happen to run in, and effect
 * order is not something a test would reliably catch going wrong.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  getActiveConversation,
  registerActiveConversation,
  registerTopicConversation,
  unregisterActiveConversation,
  unregisterTopicConversation,
} from './conversationRegistry'

const msg = (id: string, body: string) => ({ id, author: 'Katerina', timestamp: '9:41 AM', body })
const topic = { references: [], messages: [msg('c1', 'the migration is blocked'), msg('c2', 'lunch?')] }
const thread = { references: [], messages: [msg('c1', 'the migration is blocked'), msg('r1', 'reverting')] }

afterEach(() => {
  unregisterActiveConversation()
  unregisterTopicConversation()
})

describe('the open thread wins over the topic around it', () => {
  it('answers from the topic when no thread is open', () => {
    // The gap INT-8 closes: this used to be null, so Cmd+K offered nothing on
    // a topic detail page.
    registerTopicConversation(topic)
    expect(getActiveConversation()?.messages.map((m) => m.id)).toEqual(['c1', 'c2'])
  })

  it('answers from the thread once one is open', () => {
    // A question asked with a thread open is a question about that thread.
    registerTopicConversation(topic)
    registerActiveConversation(thread)
    expect(getActiveConversation()?.messages.map((m) => m.id)).toEqual(['c1', 'r1'])
  })

  it('does not depend on which registered first', () => {
    registerActiveConversation(thread)
    registerTopicConversation(topic)
    expect(getActiveConversation()?.messages.map((m) => m.id)).toEqual(['c1', 'r1'])
  })

  it('falls back to the topic when the thread closes', () => {
    // Closing the panel leaves the topic on screen, so it must still be
    // askable — the topic's own registration was never disturbed.
    registerTopicConversation(topic)
    registerActiveConversation(thread)
    unregisterActiveConversation()

    expect(getActiveConversation()?.messages.map((m) => m.id)).toEqual(['c1', 'c2'])
  })

  it('is null once neither is on screen', () => {
    // The launcher is global — over the desk or a people list there is nothing
    // to ask about, and the rows are absent rather than broken.
    expect(getActiveConversation()).toBeNull()
  })
})
