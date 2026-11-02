import { showInConversation } from '@estiva-app/ui'
import { findMessageByEventId } from './conversationRegistry'

/**
 * Reaching a message known only by its relay event (INT-3, R13).
 *
 * Showing a message — scrolled to the middle of the view and marked a moment, so
 * a citation lands on it and not near it — is the kit's `showInConversation`
 * (C3, 2 November): it reads the kit's own anchors, a reply's `data-reply-id`
 * and the pinned first message's `data-thread-start`. What is Peek's is only
 * this: a search hit carries the event, and those anchors carry Peek's own id,
 * so the open thread's snapshot is asked for the match.
 */

/**
 * How long to wait for a conversation to mount before giving up (INT-8).
 * Bounded, because "waiting forever" and "never worked" look identical to the
 * person who clicked.
 */
const WAIT_MS = 3000
const POLL_MS = 50

/**
 * Show a message known only by its relay event, once its conversation has
 * opened — a reply found by the launcher's message search (R13, UIG-29).
 *
 * The open thread's snapshot is asked for the match on every attempt: a reply
 * is only in it after the thread has mounted and loaded. Resolves `false` if it
 * never appeared, which the caller must say.
 */
export function scrollToEventWhenReady(eventId: string, waitMs = WAIT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + waitMs
    const attempt = () => {
      const message = findMessageByEventId(eventId)
      if (message && showInConversation(message.id)) {
        resolve(true)
        return
      }
      if (Date.now() >= deadline) {
        resolve(false)
        return
      }
      window.setTimeout(attempt, POLL_MS)
    }
    attempt()
  })
}
