/**
 * The objects the open conversation already refers to (PEE-3).
 *
 * > **Katerina, 2026-08-19** — *"it would also be useful to assign existing
 * > issue, not just create new one"*
 *
 * Changing an existing object needs a **target**, and PEE-3's answer to which
 * one is *"objects already referenced in this conversation … the strongest
 * default — it is the same context the person is already looking at."* This is
 * where the launcher gets that list from.
 *
 * Shaped exactly like `composerRegistry`, and for the same reason: a global
 * surface invoked by a keystroke cannot reach into the thread's React tree, so
 * the thread publishes what it has and the launcher reads a snapshot. Kept
 * separate from the composer because these are properties of the *conversation*
 * — a thread has references whether or not its composer is focused.
 *
 * **This is not a substitute for the widget.** A referenced object already
 * renders in the thread with its own actions (`ForeignObjectWidget`), and that
 * remains the better place to act when the widget is on screen. What this adds
 * is reaching the same object from Cmd+K without hunting up a long thread for
 * the message that carries it.
 */

/**
 * What the open conversation refers to.
 *
 * References only — the conversation is not named here, because the launcher
 * names the *target object* it resolves, not the thread the person is already
 * looking at.
 */
export interface ConversationSnapshot {
  /**
   * Every reference in the thread, deduplicated, newest message first.
   *
   * Both notations are kept as they arrived: a message composed here carries
   * `nostr:naddr1…` in its body while the same message read back off the relay
   * carries a plain `<kind>:<pubkey>:<d>` on an `a` tag. `referenceToPointer`
   * takes either, so normalising here would only lose information.
   */
  references: string[]
  /**
   * The message bodies, oldest first — the material prefill reads (PEE-5).
   *
   * Bodies only: no authors, no timestamps. What a capture needs is what was
   * said, and every extra field is context window spent on something the model
   * was not asked about. `lib/prefill` bounds how much of this is sent.
   */
  messages: string[]
}

let active: ConversationSnapshot | null = null

/** A snapshot of the open conversation, or null when none is. */
export function getActiveConversation(): ConversationSnapshot | null {
  return active
}

export function registerActiveConversation(snapshot: ConversationSnapshot) {
  active = snapshot
}

/**
 * Cleared on unmount, so a launcher opened from the topic list does not offer
 * the references of a thread that is no longer on screen — the actions it would
 * draw are real, and applying one to an object the person is not looking at is
 * exactly the "created something somewhere you did not look" failure PEE-1 was
 * careful to avoid.
 */
export function unregisterActiveConversation() {
  active = null
}
