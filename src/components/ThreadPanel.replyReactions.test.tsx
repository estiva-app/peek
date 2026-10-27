/**
 * A reaction on a thread reply has to leave the browser.
 *
 * PEE-12 built the whole persistence path for one: `toggleReaction` resolves a
 * reply key, `replies.list` folds the rows back per reply, and `mergeReply`
 * layers the optimistic window over the server aggregate exactly as a message
 * does. None of it ever ran, because the click never reached it —
 * `ThreadPanel` called `onReplyReactionsChange(reply.id, next)` and dropped the
 * two arguments `setReactions` uses to decide whether anything is persisted at
 * all. A missing `prev` reads as mock mode there, so the reaction stopped at a
 * session-local override: it rendered, it was never written to Convex, it was
 * never published, and it was gone on reload. Nobody in Ship ever saw one.
 *
 * Verified against production first (2026-09-07): every kind:7 Miky has
 * published targets a message, except the single one Ship wrote against a
 * reply. Peek had produced none in its whole history.
 *
 * So the assertion is the forwarding itself, because that is where it broke and
 * nothing else can see it: the seam is four arguments wide and each end agreed
 * with itself.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PeekDataProvider } from '@/api'
import type { ConversationData, ReplyData } from '@/api'
import { DebugProvider } from '@/lib/debug'
import { ThreadPanel } from './ThreadPanel'

Element.prototype.scrollIntoView = vi.fn()

const conversation: ConversationData = {
  id: 't1_c1',
  authorName: 'Juan Foley',
  timestamp: '9:14 AM',
  body: 'Our CI/CD pipeline has been failing at the build stage since this morning.',
}

/** One reply that already carries somebody else's reaction — so the pill is on
 *  screen without hovering, and `prev` is a non-empty aggregate worth passing. */
const reply: ReplyData = {
  id: 'r_1',
  authorName: 'Amie Miles',
  timestamp: '9:22 AM',
  body: 'Same on my branch.',
  reactions: [{ emoji: '👍', by: ['Amie Miles'] }],
}

function open(onReplyReactionsChange: (...args: unknown[]) => void) {
  render(
    <MemoryRouter>
      <DebugProvider>
        <PeekDataProvider>
          <ThreadPanel
            conversation={conversation}
            replies={[reply]}
            sentReplies={[]}
            onClose={() => {}}
            onSendReply={async () => ({ accepted: true })}
            onReplyReactionsChange={onReplyReactionsChange as never}
          />
        </PeekDataProvider>
      </DebugProvider>
    </MemoryRouter>,
  )
}

describe('a reaction on a reply', () => {
  it('reports the emoji and the aggregate it replaces, not just the new array', async () => {
    const onChange = vi.fn()
    open(onChange)

    // The pill for the reaction already there. Clicking it adds yours.
    const pill = screen.getAllByRole('button').find((b) => b.textContent?.includes('👍'))
    expect(pill, 'the existing reaction should render as a pill').toBeTruthy()
    fireEvent.click(pill!)

    expect(onChange).toHaveBeenCalledOnce()
    const [replyId, next, prev, emoji] = onChange.mock.calls[0]

    expect(replyId).toBe('r_1')
    expect(emoji).toBe('👍')
    /*
      The two that used to be dropped. `prev` decides persistence in
      `setReactions` — undefined means mock mode, and a reply is not mock mode —
      and `emoji` names which reaction was toggled. Without both, the write is
      skipped silently.
    */
    expect(prev).toEqual(reply.reactions)
    expect(next).toEqual([{ emoji: '👍', by: ['Amie Miles', 'You'] }])
  })
})
