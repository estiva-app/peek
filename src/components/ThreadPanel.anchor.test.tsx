/**
 * INT-3 — the ids a citation names are the ids the thread renders.
 *
 * The citation machinery spans two files that never call each other:
 * `ThreadPanel` publishes a snapshot the launcher reads, and the kit's Thread
 * and ReplyCard render the anchors the kit's `showInConversation` looks up — a
 * reply's `data-reply-id`, the first message's `data-thread-start`. Nothing
 * type-checks that those ids are the same one, and if they drift, every source
 * row closes the launcher and lands nowhere.
 *
 * So this asserts the join, from the rendered DOM to the published snapshot —
 * the shape of test that would have caught the Ship description bug, where
 * three readers each agreed with themselves.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PeekDataProvider } from '@/api'
import { REPLIES } from '@/api/fixtures'
import type { ConversationData } from '@/api'
import { DebugProvider } from '@/lib/debug'
import { getActiveConversation } from '@/lib/conversationRegistry'
import { ThreadPanel } from './ThreadPanel'

/** Where `showInConversation` finds a message of the open thread: the kit's anchors, as it reads them. */
const anchorOf = (id: string) => document.querySelector(`[data-reply-id="${CSS.escape(id)}"], [data-thread-start="${CSS.escape(id)}"]`)

Element.prototype.scrollIntoView = vi.fn()

const conversation: ConversationData = {
  id: 't1_c1',
  authorName: 'Juan Foley',
  timestamp: '9:14 AM',
  body: 'Our CI/CD pipeline has been failing at the build stage since this morning.',
}

function open() {
  render(
    <MemoryRouter>
      <DebugProvider>
        <PeekDataProvider>
        <ThreadPanel
          conversation={conversation}
          replies={REPLIES['t1_c1']}
          onClose={() => {}}
          onSendReply={async () => ({ accepted: true })}
        />
        </PeekDataProvider>
      </DebugProvider>
    </MemoryRouter>,
  )
}

describe('every message the launcher can cite is reachable in the DOM', () => {
  it('anchors the message that opened the thread', async () => {
    // Added by INT-3: replies were already anchored, the root was not, and a
    // citation of the first message would have had nowhere to go.
    open()
    await screen.findByText(conversation.body)

    expect(anchorOf(conversation.id)).not.toBeNull()
  })

  it('anchors every message it publishes to the launcher', async () => {
    open()
    await screen.findByText(conversation.body)

    const published = getActiveConversation()?.messages ?? []
    expect(published.length).toBeGreaterThan(1)
    for (const message of published) {
      expect(anchorOf(message.id)).not.toBeNull()
    }
  })

  it('publishes the author and timestamp a citation displays', async () => {
    // Bodies were enough until INT-3. A source row names who said it and when,
    // and neither can be recovered from a string.
    open()
    await screen.findByText(conversation.body)

    const [first] = getActiveConversation()?.messages ?? []
    expect(first).toMatchObject({
      id: conversation.id,
      author: conversation.authorName,
      body: conversation.body,
    })
    expect(first.timestamp).toBeTruthy()
  })
})
