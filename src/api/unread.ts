/**
 * Unread — two signals, two watermarks (§4.3; ruling 2026-07-09).
 *
 *   hasNewMessage → cleared by opening the DM (after a short dwell), up to
 *                   its newest top-level message
 *   hasNewReply / isNew → cleared only by opening THAT message's thread panel
 *                   (Miky, 2026-10-03; PEE-44 keeps the DM's marker off replies)
 *
 * Both are folded from the relay per viewer; mock mode keeps the fixture's
 * seeded flags so the demo renders identically. (The fixture is still keyed by
 * legacy DM conversation numbers — bridged here.)
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { dmHasUnread as mockDmHasUnread } from '@/data/dmData'
import { mockConvIdFor } from './directory'
import { hasRelay } from './relayUrl'
import { useTopicUnread } from './useTopicUnread'
import { useDmChannels } from './internal/dms'
import { newestFirst, type RowNewsItem } from './rowNews'
import { reactionNews } from './reactionNews'
import { useReactionsToMe } from './useReactionsToMe'
import type { UnreadDotTone } from '@estiva-app/ui'
import { recordContainerRead, recordFileRead, recordThreadRead, useReadFrontier } from '@/nostr/useReadStateSync'

/**
 * Sidebar indicators, per viewer:
 *   `*HasUnread` → the accent dot (non-urgent).
 *   `*IsUrgent`  → the warning indicator; an unread URGENT message shows this
 *                  instead of the dot (issue #11). Mock mode has no urgent
 *                  derivation, so it's always false there.
 *
 * A DM is a channel, and its dot is a channel's question: is there a message in
 * it newer than the person's NIP-RS marker for it. So it goes through
 * `useTopicUnread`, the channel fold, keyed by the partner's pubkey and read
 * from the channel the relay says it is (REM-3). Topics went with Convex in
 * FOL-23; a file's dot is the listing's (`useConversationBadges`).
 *
 * A fold's worst case is a dot that fails to light, not content that is lost.
 */
export function useUnread({ reactions: withReactions = true }: {
  /** A reaction to your message lights a DM too (ACT-7); off where no DM row is drawn, so a reaction draws nothing again. */
  reactions?: boolean
} = {}): {
  dmHasUnread: (dmId: string) => boolean
  dmIsUrgent: (dmId: string) => boolean
  dmNews: (dmId: string) => readonly RowNewsItem[]
  /** A lit DM's dot colour (ACT-7): `reaction` when reactions to you are all that is new in it. An urgent DM keeps its mark. */
  dmTone: (dmId: string) => UnreadDotTone
} {
  const { partners, channelOf } = useDmChannels()
  const dmChannels = useMemo(
    () => (hasRelay ? partners.map((pubkey) => ({ id: pubkey, folderId: channelOf(pubkey) })) : undefined),
    [partners, channelOf],
  )
  const dmFold = useTopicUnread(dmChannels)
  const reactions = useReactionsToMe(hasRelay && withReactions)
  const { merged, ready } = useReadFrontier()

  /*
    A reaction to your message in a DM (ACT-7; Miky, 10 Nov): a DM is one conversation you are in, from the day it
    starts counting. Its card lists it beside the messages, newest first.
  */
  const dmReactions = useMemo(() => {
    const out = new Map<string, RowNewsItem[]>()
    if (!hasRelay || !ready) return out
    for (const pubkey of partners) {
      const lines = reactionNews(reactions, channelOf(pubkey), merged, { following: null })
      if (lines.length > 0) out.set(pubkey, lines)
    }
    return out
  }, [partners, channelOf, reactions, merged, ready])

  const dmHasUnread = useCallback(
    (dmId: string) => {
      if (!hasRelay) {
        const convId = mockConvIdFor(dmId)
        return convId === undefined ? false : mockDmHasUnread(convId)
      }
      return (dmFold.unread[dmId] ?? false) || dmReactions.has(dmId)
    },
    [dmFold, dmReactions],
  )

  const dmIsUrgent = useCallback((dmId: string) => (hasRelay ? (dmFold.urgent[dmId] ?? false) : false), [dmFold])

  // What lit a DM, for its row's card (ACT-3): the channel's own unread messages, words and all, and the reactions to you.
  const dmNews = useCallback(
    (dmId: string): readonly RowNewsItem[] => {
      if (!hasRelay) return NO_NEWS
      const lines = dmFold.news[dmId] ?? NO_NEWS
      const reacted = dmReactions.get(dmId)
      return reacted ? newestFirst(lines, reacted) : lines
    },
    [dmFold, dmReactions],
  )

  // Blue wins (Miky, 10 Nov): an unread message, urgent or not, keeps the dot blue.
  const dmTone = useCallback(
    (dmId: string): UnreadDotTone => (hasRelay && !dmFold.unread[dmId] && !dmFold.urgent[dmId] && dmReactions.has(dmId) ? 'reaction' : 'blue'),
    [dmFold, dmReactions],
  )

  return { dmHasUnread, dmIsUrgent, dmNews, dmTone }
}

const NO_NEWS: readonly RowNewsItem[] = []

/** How long a conversation/thread must stay open before it counts as read. */
export const READ_DWELL_MS = 1500

/**
 * Mark-as-read writers. Call these from a dwell timer, never on mount alone —
 * flicking past a conversation shouldn't consume its unread state.
 *
 * Each writer records a NIP-RS marker so read state follows the person between
 * apps (CRO-4, SPEC §11). A marker that cannot be expressed as a protocol
 * identity is skipped rather than published under a Peek-private id. See
 * `useReadStateSync` for which those are.
 */
export function useReadActions() {
  /*
   * A DM's channel uuid, by the partner pubkey the page marks read with
   * (DMS-8, REM-3). Read through a ref rather than the closure: `useMarkRead`
   * captures `markContainerRead` once per target and fires it 1.5 s later, and
   * opening the DM may mint its channel inside that window.
   */
  const { channelOf } = useDmChannels()
  const dmChannelOf = useRef(channelOf)
  useEffect(() => {
    dmChannelOf.current = channelOf
  }, [channelOf])

  return {
    /** A DM's channel uuid by its partner: the context its reactions are seen under (ACT-7). */
    dmChannelOf: channelOf,
    /**
     * A DM was read, up to `newestAt` — its newest top-level message, in unix
     * seconds (PEE-44). Its context is its channel uuid, never an app id (SPEC §11.1).
     */
    markContainerRead(dmId: string, newestAt?: number) {
      // Relay only (REM-3): nothing reads a DM's Convex watermark any more.
      if (hasRelay) recordContainerRead(dmChannelOf.current(dmId), newestAt !== undefined ? newestAt * 1000 : Date.now())
    },
    /** A team's chat was read, up to `newestAt` (TEA-5): its context is the team's uuid, as a DM's is its channel's. */
    markChannelRead(channelUuid: string, newestAt?: number) {
      if (hasRelay) recordContainerRead(channelUuid, newestAt !== undefined ? newestAt * 1000 : Date.now())
    },
    /** A thread was read, up to `newestAt` — its newest reply drawn, in unix seconds (PEE-44). */
    markThreadRead(messageKey: string, newestAt?: number) {
      // Relay only (REM-5): the NIP-RS blob is the only read state.
      if (!hasRelay) return
      // §11.2: this advances the thread and MUST NOT touch its container.
      // For a relay-synced message the Peek key *is* the event id; for one that
      // has never been published, `recordThreadRead` finds no context and stops.
      recordThreadRead(messageKey, newestAt !== undefined ? newestAt * 1000 : Date.now())
    },
    /**
     * A file's conversation was read — the pane a Folder opens on a file
     * (SPEC §11.1, FOL-16). Relay only: Convex has no watermark for a file,
     * and the listing judges from the relay frontier for exactly that reason.
     * §11.2: this advances the file's own stream and nothing else — not the
     * Folder's channel, whose general chat the person did not read.
     */
    markFileRead(address: string | null | undefined, newestAt?: number) {
      // Gated on the relay, not Convex (REM-2): Convex plays no part here.
      if (!hasRelay) return
      // Up to the newest top-level message the pane drew (unix seconds), not the clock:
      // the relay may hold one the pane has not drawn yet, and an author whose
      // clock runs ahead would otherwise stay newer than the marker (PEE-44).
      recordFileRead(address, newestAt !== undefined ? newestAt * 1000 : Date.now())
    },
  }
}
