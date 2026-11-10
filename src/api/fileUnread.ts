import { belowReplyFloor, threadReadAt } from '@estiva-app/conversation'
import type { ConversationMessage } from '@estiva-app/interop'

/**
 * Is there something new in a file's conversation — SPEC §11.1–§11.3, FOL-16.
 *
 * A file's conversation is its own stream, and the **file's** marker is its
 * frontier: the bare address, the same context Ship advances when an issue is
 * read. The channel's marker never enters this — reading the team's general
 * chat is not reading any file's talk, and a team with five issues would
 * otherwise go quiet on all five the moment somebody read the chat.
 *
 * A root is judged against the file's marker. A reply is judged by the
 * package's thread rule (§11.3, CON-34): its thread's own marker and the reply
 * floor read it, and the file's marker only up to the cut-over — after it, a
 * reply waits for its thread to be opened, however far the pane was read.
 *
 * ## Absence, Peek's choice (§11.6)
 *
 * No marker means the person has never read this file's conversation anywhere,
 * *or* their marker is older than the relay horizon. Peek reads back 90 days
 * (`PEEK_HORIZON_DAYS`), so the two are told apart by the message's own age:
 * something said inside the horizon with no marker in the horizon is new, and
 * something older is left quiet — if the marker aged out, it was at least as old
 * as the horizon, and a message older than that is not something the person
 * missed since. Nothing is written to settle it; an app MUST NOT publish a
 * marker for something the person did not read.
 *
 * Your own message is never new to you.
 */
export function fileHasUnread(
  messages: readonly ConversationMessage[],
  frontier: {
    /** The file's own marker (`fileContext(address)`), unix seconds; absent = undefined. */
    file: number | undefined
    /** A thread's marker (`thread:<root>`), unix seconds; absent = undefined. */
    thread: (root: string) => number | undefined
    /** The reply floor (`REPLY_FLOOR_CONTEXT`), unix seconds; absent = undefined. */
    floor: number | undefined
    /** The viewer's pubkey; their own messages do not count. */
    me: string | undefined
    /** Now and the horizon, both unix seconds — the absent-marker rule needs them. */
    nowSeconds: number
    horizonSeconds: number
  },
): boolean {
  return messages.some((message) => isNewInFile(message, frontier))
}

/** {@link fileHasUnread}'s messages: each one it lights for, in the order given (ACT-3, a DM's card). */
export function fileUnreadMessages<M extends ConversationMessage>(messages: readonly M[], frontier: FileFrontier): M[] {
  return messages.filter((message) => isNewInFile(message, frontier))
}

type FileFrontier = Parameters<typeof fileHasUnread>[1]

function isNewInFile(message: ConversationMessage, frontier: FileFrontier): boolean {
  if (frontier.me && message.by === frontier.me) return false
  const isRoot = message.root === message.id
  const marker = isRoot
    ? frontier.file
    : threadReadAt({ thread: frontier.thread(message.root), stream: frontier.file, floor: frontier.floor })
  if (marker === undefined) {
    if (!isRoot && belowReplyFloor(message.at, frontier.floor)) return false
    return message.at > frontier.nowSeconds - frontier.horizonSeconds
  }
  return message.at > marker
}

/**
 * The thread to open for a conversation lit only by replies — clicking a Desk
 * row whose dot a thread reply lit opens that thread, so one click reads it
 * (CON-34, Miky 2026-10-05). The thread with the newest new reply; `null` when
 * a top-level message is new (opening the conversation reads that) or nothing is.
 */
export function replyOnlyThread(
  roots: readonly ConversationMessage[],
  replies: Readonly<Record<string, readonly ConversationMessage[]>>,
  /** One stream's markers, or each thread's own stream's: a topic at All holds its files' threads too (TOPI-3). */
  frontier: Parameters<typeof fileHasUnread>[1] | ((root: string) => Parameters<typeof fileHasUnread>[1]),
): string | null {
  const judge = typeof frontier === 'function' ? frontier : () => frontier
  if (roots.some((root) => fileHasUnread([root], judge(root.root)))) return null
  let newest: ConversationMessage | undefined
  for (const list of Object.values(replies)) {
    for (const reply of list) {
      if (newest && reply.at <= newest.at) continue
      if (fileHasUnread([reply], judge(reply.root))) newest = reply
    }
  }
  return newest?.root ?? null
}
