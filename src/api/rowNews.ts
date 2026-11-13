/**
 * What lit a row, line by line (ACT-3): the card that opens on a lit topic, space, team chat or DM in Peek's
 * columns lists these, newest first. Each line is one unread message the row's dot already judged, with the reason
 * the shared rule names for it (`unreadReasons`, SPEC §11.8 *Why a message is unread*), so the card and the dot can
 * never disagree: the card is the dot's own list, folded from what the dot read, with no read of its own.
 *
 * Pure: the dots hand their unread messages in.
 */
import { unreadReasons, type UnreadReason, type UnreadReasonOptions } from '@estiva-app/conversation'

/** One line of a lit row's card. */
export interface RowNewsItem {
  id: string
  /** Who said it: a pubkey. */
  by: string
  /** When, unix seconds. */
  at: number
  /** Why it is unread for the viewer: what the message is to them, never which level lit it; or a reaction to their message (ACT-7). */
  reason: UnreadReason | 'reaction'
  /** Its conversation's root: what a click opens (`?thread=`). */
  root: string
  /** The words, when the dot's read held them; a card that opens asks for the rest. */
  words?: string
  /** The file it was said on, when that is not the row's own place: a file a topic lists, or one under it. */
  file?: string
  /** It is urgent for the viewer: what put a DM on the Desk's Urgent, whose card lists these and the reactions to you (`urgentNews`). */
  urgent?: boolean
  /**
   * A reaction to the viewer's message (ACT-7): its emoji, the message it reacts to (where the line opens) and the
   * conversation it is seen in (`reactionStreamOf`). The line's `id`, `by` and `at` are the reaction's; `words` are the
   * message's.
   */
  reaction?: { emoji: string; target: string; contexts: readonly string[] }
}

/** The most a card lists; the rest are its "N more". */
export const CARD_LINES = 5

/** A message as the shared rule reads one. */
type RuleMessage = { id: string; pubkey: string; kind: number; created_at: number; content: string; tags: string[][] }

/**
 * The lines for `unread`, the messages of `all` the row's dot judged unread, each with its reason. `all` is the
 * whole stream the dot read, since whether `me` is in a conversation is read from all of it.
 */
export function explainUnread<E extends RuleMessage>(
  all: readonly E[],
  unread: readonly E[],
  me: string,
  line: (message: E) => Pick<RowNewsItem, 'root'> & Partial<Pick<RowNewsItem, 'words' | 'file' | 'urgent'>>,
  options: UnreadReasonOptions = {},
): RowNewsItem[] {
  if (unread.length === 0) return []
  const reasons = unreadReasons(all, me, options)
  return unread.map((message) => ({
    id: message.id,
    by: message.pubkey,
    at: message.created_at,
    reason: reasons.get(message.id) ?? 'message',
    ...line(message),
  }))
}

/**
 * What an urgent DM's row on the Desk's Urgent lists: the urgent messages that put it there (ACT-9) and the reactions
 * to you in it (ACT-7), never its other unread messages.
 */
export function urgentNews(lines: readonly RowNewsItem[]): RowNewsItem[] {
  return lines.filter((line) => line.urgent || line.reaction)
}

/** Newest first, one line per message however many ways it lit the row. */
export function newestFirst(...lists: readonly (readonly RowNewsItem[])[]): RowNewsItem[] {
  const byId = new Map<string, RowNewsItem>()
  for (const list of lists) for (const item of list) if (!byId.has(item.id)) byId.set(item.id, item)
  return [...byId.values()].sort((a, b) => b.at - a.at)
}
