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
 * The page these waits poll is gone: the tab closed under a pending attempt,
 * or a test's page was torn down while one waited (DeskPage.test threw
 * "document is not defined" from a 10 s wait, peek#677's CI). Gives up, as at
 * the deadline.
 */
const pageGone = () => typeof document === 'undefined'

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
      if (pageGone()) {
        resolve(false)
        return
      }
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

/** How long a page arriving at a thread waits for its conversation: a large workspace takes seconds to read. */
const ARRIVAL_WAIT_MS = 10_000

/**
 * Bring a message into view where it was said, once its conversation has drawn it: the middle column's item (the
 * kit's `data-conversation-item`, or an app's comment's `data-comment`), scrolled to the middle (Katerina, 15 November, U-07: a line in a dot's list, a row's
 * card or the Screener opens where it was said and scrolls it into view, "generalize it so that it works in every
 * similar case"). The kit's `showInConversation` reaches the thread panel's copy first, which is already on screen
 * when the thread opens beside. Resolves whether it appeared in time.
 */
export function showConversationItemWhenDrawn(id: string, waitMs = ARRIVAL_WAIT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + waitMs
    const attempt = () => {
      if (pageGone()) {
        resolve(false)
        return
      }
      // A conversation's item (the kit's), or a comment on another app's file (Peek's CommentRow).
      const item = document.querySelector(`[data-conversation-item="${CSS.escape(id)}"], [data-comment="${CSS.escape(id)}"]`)
      if (item) {
        item.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
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
