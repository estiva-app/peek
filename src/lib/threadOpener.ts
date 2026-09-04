/**
 * Opening a conversation from outside the view that owns it (INT-8).
 *
 * Shaped exactly like `composerRegistry` and `conversationRegistry`, and for
 * the same stated reason: *a global surface invoked by a keystroke cannot reach
 * into the thread's React tree*, so the view publishes what it can do and the
 * launcher calls it.
 *
 * The need is INT-8's citations. A topic-wide answer cites messages across
 * several conversations, and `scrollToMessage` can only find one that is
 * already mounted — `data-reply-id` exists inside the open panel and nowhere
 * else. So a citation into a closed conversation has to open it first.
 *
 * **INT-6 needs the same capability** ("when searching and the keyword is in
 * replies, open the replies panel"), which is why this is its own module with
 * no knowledge of citations in it.
 */

type Opener = (conversationId: string) => void

let opener: Opener | null = null

/** Publish "I can open a conversation" — the topic view, while it is mounted. */
export function registerThreadOpener(fn: Opener) {
  opener = fn
}

export function unregisterThreadOpener() {
  opener = null
}

/**
 * Ask for a conversation to be opened.
 *
 * Returns false when nothing can — no topic view is mounted, so there is
 * nowhere for the conversation to open. The caller has to say so rather than
 * appear to work, which is the rule `scrollToMessage` already follows.
 *
 * Returning true means the request was *made*, not that the panel is on screen:
 * it is React state, so the view renders a beat later. `scrollToMessageWhenReady`
 * is the other half.
 */
export function openConversation(conversationId: string): boolean {
  if (!opener) return false
  opener(conversationId)
  return true
}
