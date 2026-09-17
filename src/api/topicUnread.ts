import type { StreamMessage } from '@/nostr/channelStreams'
import { containerContext, threadContext } from '@/nostr/readState'
import { fileHasUnread } from './fileUnread'

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
 * `containerContext(channelUuid)`, including one that happens to carry an
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
 * ## Why a cached marker still enters a relay fold
 *
 * `cachedMarker` is this deployment's `readState` row for the channel, in
 * seconds — the cache `convex/readState.ts` keeps precisely so that "the relay
 * has forgotten this context" does not read as "never opened". The relay
 * frontier is the newest 90 days of the person's own slots and is capped in
 * bytes (SHR-4), so a marker can genuinely fall out of it while the message it
 * covers is still inside the horizon, and absence would then light a topic
 * somebody read months ago. Taking the later of the two keeps that from
 * happening without putting any per-message work back in Convex: the whole
 * saving was the message-and-reply walk, and this is one indexed collect the
 * DM half already pays for.
 *
 * It only ever raises the marker, never lowers it, so a deployment that has
 * never seen the person changes nothing.
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
    /** This deployment's cached watermark for the channel, unix seconds. */
    cachedMarker?: number | undefined
  },
): { unread: boolean; urgent: boolean } {
  const relayMarker = frontier.marker(containerContext(channelUuid))
  const container =
    relayMarker === undefined || (frontier.cachedMarker ?? 0) > relayMarker
      ? (frontier.cachedMarker ?? relayMarker)
      : relayMarker
  const judge = (subset: readonly StreamMessage[]) =>
    subset.length > 0 &&
    fileHasUnread(subset, {
      file: container,
      thread: (root) => frontier.marker(threadContext(root)),
      me: frontier.me,
      nowSeconds: frontier.nowSeconds,
      horizonSeconds: frontier.horizonSeconds,
    })
  return {
    unread: judge(messages.filter((m) => !m.urgent)),
    urgent: judge(messages.filter((m) => m.urgent)),
  }
}
