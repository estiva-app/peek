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
   * The thread's messages, oldest first — the material the model reads.
   *
   * **Bodies alone were enough until INT-3.** PEE-5 captured only what was
   * said, on the reasoning that every extra field is context window spent on
   * something the model was not asked about — and that still holds for what is
   * *sent*: `bodies()` is what goes in a prompt. But INT-3 has to show which
   * messages an answer came from and let a person click through to them, and
   * neither is possible from a string. So the snapshot carries the identity
   * and the prompt still carries only the prose.
   */
  messages: ConversationMessage[]
}

/**
 * One message, in the two capacities INT-3 needs it in: prose for the model,
 * and enough identity to point at the message in the thread behind the modal.
 *
 * `id` matches the `data-reply-id` the thread renders, which is the anchor a
 * citation scrolls to.
 */
export interface ConversationMessage {
  id: string
  author: string
  /** As the thread displays it ("9:41 AM") — shown on a citation, never parsed. */
  timestamp: string
  body: string
  /**
   * The event this message was published as, when it has reached the relay —
   * what a mention of it is written as (`nostr:nevent…`, RIC-11). Absent for
   * a message still on its way, and for one that was never published.
   */
  eventId?: string
  /**
   * The conversation this message belongs to, when that is not the thread on
   * screen (INT-8).
   *
   * A topic-wide snapshot spans many conversations, and a citation into one
   * that is not open has to open it before it can scroll — `data-reply-id`
   * only exists inside the mounted panel. Absent for a thread snapshot, where
   * every message is already in the conversation being read.
   */
  conversationId?: string
  /**
   * Replies this message has that the snapshot does **not** include (INT-8).
   *
   * A topic reads its conversations' opening messages; replies are fetched per
   * thread and are not in memory until one is opened. That is a real limit on
   * what an answer can have been drawn from, and it is carried here so the
   * answer can say so rather than imply it read everything.
   */
  repliesNotRead?: number
}

/**
 * Just the prose, oldest first.
 *
 * Every prompt-facing caller goes through this rather than reaching into the
 * snapshot, so there is one derivation and nothing to drift: the identity a
 * citation needs never reaches a context window it was not asked for.
 */
export function bodies(snapshot: Pick<ConversationSnapshot, 'messages'> | null | undefined): string[] {
  return (snapshot?.messages ?? []).map((m) => m.body)
}

let active: ConversationSnapshot | null = null
let topic: ConversationSnapshot | null = null

/**
 * What is being read, or null when nothing is.
 *
 * **The open thread wins over the topic around it (INT-8).** Two things can be
 * on screen at once — a topic with all its conversations, and one of them open
 * in the panel — and a question asked with a thread open is a question about
 * that thread. The narrower context is the better answer to "what am I looking
 * at", and it is what INT-3 shipped.
 *
 * Two slots rather than one register overwriting another: the panel mounts
 * and unmounts inside a topic that stays put, so a single slot would make
 * correctness depend on the order those effects run in. Priority does not.
 */
export function getActiveConversation(): ConversationSnapshot | null {
  return active ?? topic
}

/**
 * A message on screen by the event it was published as — **either** snapshot,
 * not the winner above (RIC-11).
 *
 * The priority rule answers "what is being read"; this answers "what does
 * this `nevent` in the editor name", and a message mentioned from the topic
 * list is still on screen when its thread is not the one open. Undefined when
 * nothing on screen carries that id, which the caller draws as the URI's own
 * shortened form rather than as an error.
 */
export function findMessageByEventId(eventId: string): ConversationMessage | undefined {
  const id = eventId.toLowerCase()
  for (const snapshot of [active, topic]) {
    const found = snapshot?.messages.find((m) => m.eventId?.toLowerCase() === id)
    if (found) return found
  }
  return undefined
}

/**
 * The messages `[` offers, by where they sit (PEE-21): the open thread's are
 * *here* and its file's are the *parent*; with no thread open, the file's are
 * here and there is no parent.
 */
export function referenceConversations(): { here: ConversationMessage[]; parent: ConversationMessage[] } {
  if (active) return { here: active.messages, parent: topic?.messages ?? [] }
  return { here: topic?.messages ?? [], parent: [] }
}

export function registerActiveConversation(snapshot: ConversationSnapshot) {
  active = snapshot
}

/**
 * Publish the whole topic — its conversations' opening messages (INT-8).
 *
 * Registered whenever a topic is on screen, open thread or not; the priority
 * above is what decides which one a question is answered from.
 */
export function registerTopicConversation(snapshot: ConversationSnapshot) {
  topic = snapshot
}

export function unregisterTopicConversation() {
  topic = null
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
