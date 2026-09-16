import { findMessageByEventId } from './conversationRegistry'

/**
 * Reaching a message in the thread behind the launcher (INT-3).
 *
 * A citation that only names a message is half the mitigation. The point is
 * that a claim is **checkable in one click** — so the click has to land on the
 * message, in the thread, where its author and its neighbours are visible.
 *
 * `data-reply-id` is rendered by `ThreadPanel` around every reply and, since
 * INT-3, around the message that opened the thread too. That attribute is the
 * contract; it existed before this and is now depended on, which is why
 * `ThreadPanel`'s test asserts it.
 */

/** How long the arrival stays marked. Matches `cited-flash` in index.css. */
const FLASH_MS = 1800

/**
 * The un-marking timer currently owed to each element.
 *
 * Without it, two citations clicked in quick succession leave the first click's
 * timer to clear the second click's mark — the guard "is it still marked?"
 * cannot tell whose mark it is. Cancelling the previous timer can.
 */
const pending = new WeakMap<HTMLElement, number>()

/**
 * Scroll a message into view and mark it briefly.
 *
 * Returns false when the message is not on screen — a thread paginates, and a
 * cited message could sit above the loaded window. The caller decides what to
 * do about that; silently doing nothing is the one option it must not have,
 * because a click that appears to work and does not is worse than a disabled
 * row.
 */
export function scrollToMessage(id: string): boolean {
  const el = document.querySelector<HTMLElement>(`[data-reply-id="${CSS.escape(id)}"]`)
  if (!el) return false
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })

  const previous = pending.get(el)
  if (previous !== undefined) window.clearTimeout(previous)
  el.dataset.cited = 'true'
  pending.set(
    el,
    window.setTimeout(() => {
      delete el.dataset.cited
      pending.delete(el)
    }, FLASH_MS),
  )
  return true
}

/**
 * How long to wait for a conversation to mount before giving up (INT-8).
 *
 * A citation into a conversation that is not open asks the topic view to open
 * it and then has to wait — React has to render, and the messages may still be
 * loading. Bounded, because "waiting forever" and "never worked" look
 * identical to the person who clicked.
 */
const WAIT_MS = 3000
const POLL_MS = 50

/**
 * Scroll to a message that may not be in the DOM yet.
 *
 * Used when a citation points into a conversation the caller has just asked to
 * be opened: the request is React state, so the panel mounts a render or more
 * later, and the element cannot be looked up until it does.
 *
 * Resolves `true` once it scrolled, `false` if the message never appeared —
 * which the caller must surface. A click that appears to work and does not is
 * worse than a row that was never offered.
 */
export function scrollToMessageWhenReady(id: string, waitMs = WAIT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + waitMs
    const attempt = () => {
      if (scrollToMessage(id)) {
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

/**
 * Scroll to a message known only by its relay event, once its conversation has
 * opened — a reply found by the launcher's message search (R13, UIG-29).
 *
 * A search hit carries the event, and `data-reply-id` carries Peek's own id, so
 * the open thread's snapshot is asked for the match on every attempt: a reply
 * is only in it after the thread has mounted and loaded.
 */
export function scrollToEventWhenReady(eventId: string, waitMs = WAIT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + waitMs
    const attempt = () => {
      const message = findMessageByEventId(eventId)
      if (message && scrollToMessage(message.id)) {
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
