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
