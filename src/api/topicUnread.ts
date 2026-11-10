import type { StreamMessage } from '@/nostr/channelStreams'
import { REPLY_FLOOR_CONTEXT, channelContext, threadContext } from '@estiva-app/conversation'
import { fileHasUnread, fileUnreadMessages } from './fileUnread'
import { explainUnread, newestFirst, type RowNewsItem } from './rowNews'

/**
 * A topic's two sidebar signals, folded from its channel — SHR-5, §4.3.
 *
 * The rule is the one `convex/unread.ts`'s `containerFlags` has always
 * applied, moved onto relay data: a topic shows the accent dot when a
 * NON-urgent message or reply in it is new to you, and the urgent indicator
 * when an urgent one is. Urgency belongs to the individual message (ruling
 * 2026-07-16), so a non-urgent reply on an urgent thread raises the dot and
 * not the indicator, and an unread urgent message raises the indicator
 * *instead of* the dot (issue #11) — which is why this returns two booleans
 * from two passes rather than one flag and a severity.
 *
 * ## One stream, not the union FOL-18 takes
 *
 * A team Folder's dot is the union of its streams, each judged against its
 * own marker (`teamUnread.ts`). A topic's is not: everything said in a topic
 * is the one conversation the person opens, and opening it advances the
 * channel's marker and only that (`useReadActions`.`markContainerRead` →
 * `recordContainerRead(folderId)`). So every message here is judged against
 * `channelContext(channelUuid)`, including one that happens to carry an
 * `a` — honouring the `a` would open a stream with a marker that nothing in
 * Peek ever advances, and the dot would never clear.
 *
 * Replies still answer to the later of the channel's marker and their own
 * thread's (§11.3, via `fileHasUnread`): reading the whole topic reads its
 * replies, and opening one thread clears that thread. That is a **change from
 * Convex**, which judged a reply against its thread watermark alone — so a
 * reply on a thread you had never opened kept the dot lit however recently
 * you had read the topic. The relay rule is the specified one and the one
 * every other surface in the app already uses.
 *
 * The marker is the relay's alone (REM-5). Convex's `readState` cache used to
 * raise it for a context the 90-day slot horizon had dropped, but a marker
 * that old is older than every message judged here, so its absence lights
 * nothing it would not have lit anyway.
 */
export function topicChannelFlags(
  channelUuid: string,
  messages: readonly StreamMessage[],
  frontier: {
    /** One context's merged marker, unix seconds; absent = undefined. */
    marker: (context: string | undefined) => number | undefined
    /** The viewer's pubkey; their own messages do not count. */
    me: string | undefined
    /** Now and the horizon, both unix seconds — the absent-marker rule needs them. */
    nowSeconds: number
    horizonSeconds: number
  },
): { unread: boolean; urgent: boolean; news: RowNewsItem[] } {
  const container = frontier.marker(channelContext(channelUuid))
  const judged = {
    file: container,
    thread: (root: string) => frontier.marker(threadContext(root)),
    floor: frontier.marker(REPLY_FLOOR_CONTEXT),
    me: frontier.me,
    nowSeconds: frontier.nowSeconds,
    horizonSeconds: frontier.horizonSeconds,
  }
  const judge = (subset: readonly StreamMessage[]) => subset.length > 0 && fileHasUnread(subset, judged)
  return {
    unread: judge(messages.filter((m) => !m.urgent)),
    urgent: judge(messages.filter((m) => m.urgent)),
    news: channelNews(messages, fileUnreadMessages(messages, judged), frontier.me),
  }
}

/**
 * A DM's unread messages as card lines (ACT-3), newest first, urgent or not: the words are the channel's own. A DM is
 * one conversation, so each line is a mention or a message (§11.8).
 */
function channelNews(all: readonly StreamMessage[], unread: readonly StreamMessage[], me: string | undefined): RowNewsItem[] {
  if (!me || unread.length === 0) return []
  const asRule = (m: StreamMessage) => ({ id: m.id, pubkey: m.by, kind: 9, created_at: m.at, content: m.body, tags: m.root !== m.id ? [['e', m.root, '', 'root']] : [] })
  const ids = new Set(unread.map((m) => m.id))
  const rules = all.map(asRule)
  const byId = new Map(all.map((m) => [m.id, m]))
  return newestFirst(
    explainUnread(rules, rules.filter((m) => ids.has(m.id)), me, (m) => ({ root: byId.get(m.id)!.root, words: byId.get(m.id)!.body }), { dm: true }),
  )
}
