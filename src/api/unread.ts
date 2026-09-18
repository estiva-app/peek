/**
 * Unread — two signals, two watermarks (§4.3; ruling 2026-07-09).
 *
 *   hasNewMessage → cleared by opening the topic/DM (after a short dwell)
 *   hasNewReply / isNew → cleared only by opening THAT message's thread panel
 *
 * Convex mode derives both per viewer from `readState`; mock mode keeps the
 * fixture's seeded flags so the demo renders identically. (The fixture is
 * still keyed by legacy DM conversation numbers — bridged here.)
 */
import { useCallback, useEffect, useRef } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { topicHasUnread as mockTopicHasUnread } from '@/data/topicData'
import { dmHasUnread as mockDmHasUnread } from '@/data/dmData'
import { mockConvIdFor } from './directory'
import { hasConvex } from './store'
import { useTopicLookup, useTopics } from './topics'
import { useTopicUnread } from './useTopicUnread'
import { recordContainerRead, recordFileRead, recordThreadRead } from '@/nostr/useReadStateSync'

/**
 * Sidebar indicators, per viewer:
 *   `*HasUnread` → the accent dot (non-urgent).
 *   `*IsUrgent`  → the warning indicator; an unread URGENT message shows this
 *                  instead of the dot (issue #11). Mock mode has no urgent
 *                  derivation, so it's always false there.
 *
 * ## Two answers, one union (SHR-5)
 *
 * A topic's indicator is the union of its own channel and any huddle under
 * it, and the two halves now come from different places: the channel is
 * folded from the relay (`useTopicUnread`), and the huddle rollup stays in
 * `unread.summary` because a huddle is not a channel. DMs stay there too.
 * A topic lights if **either** says so, which is the same `unread || f.unread`
 * the Convex loop used to do internally.
 *
 * The relay half undercounts by whatever has never been published: SHR-8
 * counted 202 non-DM messages on production with no relay event. A fold's
 * worst case is a dot that fails to light, not content that is lost, and the
 * huddle and DM halves are unaffected.
 */
export function useUnread(): {
  topicHasUnread: (topicId: string) => boolean
  dmHasUnread: (dmId: string) => boolean
  topicIsUrgent: (topicId: string) => boolean
  dmIsUrgent: (dmId: string) => boolean
} {
  const remote = useQuery(api.unread.summary, hasConvex ? {} : 'skip')
  const topics = useTopics()
  const fold = useTopicUnread(hasConvex ? topics : undefined, remote?.topicMarks)

  const topicHasUnread = useCallback(
    (topicId: string) => {
      if (!hasConvex) return mockTopicHasUnread(topicId)
      return (fold.unread[topicId] ?? false) || (remote?.huddleTopics.includes(topicId) ?? false)
    },
    [remote, fold],
  )

  const dmHasUnread = useCallback(
    (dmId: string) => {
      if (!hasConvex) {
        const convId = mockConvIdFor(dmId)
        return convId === undefined ? false : mockDmHasUnread(convId)
      }
      return remote?.dms.includes(dmId) ?? false
    },
    [remote],
  )

  const topicIsUrgent = useCallback(
    (topicId: string) =>
      hasConvex
        ? (fold.urgent[topicId] ?? false) || (remote?.urgentHuddleTopics.includes(topicId) ?? false)
        : false,
    [remote, fold],
  )
  const dmIsUrgent = useCallback(
    (dmId: string) => (hasConvex ? (remote?.urgentDms.includes(dmId) ?? false) : false),
    [remote],
  )

  return { topicHasUnread, dmHasUnread, topicIsUrgent, dmIsUrgent }
}

/** How long a conversation/thread must stay open before it counts as read. */
export const READ_DWELL_MS = 1500

/**
 * Mark-as-read writers. Call these from a dwell timer, never on mount alone —
 * flicking past a conversation shouldn't consume its unread state.
 *
 * Each writer also records a NIP-RS marker so read state follows the person
 * between apps (CRO-4, SPEC §11). The relay write is a **mirror**: the Convex
 * mutation is the user's action succeeding, and a marker that cannot be
 * expressed as a protocol identity is skipped rather than published under a
 * Peek-private id. See `useReadStateSync` for which those are.
 */
export function useReadActions() {
  const markContainerRemote = useMutation(api.readState.markContainerRead)
  const markThreadRemote = useMutation(api.readState.markThreadRead)
  const findTopic = useTopicLookup()
  /*
   * A DM's channel uuid, by the partner key the page marks read with (DMS-8).
   * The same query `DmVisibilityProvider` holds open, so this costs no second
   * subscription. Read through a ref rather than the closure: `useMarkRead`
   * captures `markContainerRead` once per target and fires it 1.5 s later, and
   * `useEnsureDmChannel` may mint the channel inside that window.
   */
  const dmChannels = useQuery(api.nostr.outbox.dmChannels, hasConvex ? {} : 'skip')
  const dmChannelByKey = useRef<ReadonlyMap<string, string>>(new Map())
  useEffect(() => {
    dmChannelByKey.current = new Map((dmChannels ?? []).map((c) => [c.dmKey, c.channelUuid]))
  }, [dmChannels])

  return {
    markContainerRead(parentKind: 'topic' | 'dm' | 'huddle', parentKey: string) {
      if (!hasConvex) return
      void markContainerRemote({ parentKind, parentKey })
      // A topic's context is its Folder id and a DM's is its channel uuid —
      // the bare uuid either way (SPEC §11.1), never the Convex id. A huddle is
      // not a channel at all. A DM with no channel yet records only the Convex
      // watermark here; `cachedReadContexts` hands it to the relay once the
      // uuid exists, so nothing is lost by waiting.
      if (parentKind === 'topic') {
        recordContainerRead(findTopic(parentKey)?.folderId, Date.now())
      } else if (parentKind === 'dm') {
        recordContainerRead(dmChannelByKey.current.get(parentKey), Date.now())
      }
    },
    markThreadRead(messageKey: string) {
      if (!hasConvex) return
      void markThreadRemote({ messageKey })
      // §11.2: this advances the thread and MUST NOT touch its container.
      // For a relay-synced message the Peek key *is* the event id; for one that
      // has never been published, `recordThreadRead` finds no context and stops.
      recordThreadRead(messageKey, Date.now())
    },
    /**
     * A file's conversation was read — the pane a Folder opens on a file
     * (SPEC §11.1, FOL-16). Relay only: Convex has no watermark for a file,
     * and the listing judges from the relay frontier for exactly that reason.
     * §11.2: this advances the file's own stream and nothing else — not the
     * Folder's channel, whose general chat the person did not read.
     */
    markFileRead(address: string | null | undefined) {
      if (!hasConvex) return
      recordFileRead(address, Date.now())
    },
  }
}
