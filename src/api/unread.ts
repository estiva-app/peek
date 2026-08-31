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
import { useCallback } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { topicHasUnread as mockTopicHasUnread } from '@/data/topicData'
import { dmHasUnread as mockDmHasUnread } from '@/data/dmData'
import { mockConvIdFor } from './directory'
import { hasConvex } from './store'
import { useTopicLookup } from './topics'
import { recordContainerRead, recordThreadRead } from '@/nostr/useReadStateSync'

/**
 * Sidebar indicators, per viewer:
 *   `*HasUnread` → the accent dot (non-urgent).
 *   `*IsUrgent`  → the warning indicator; an unread URGENT message shows this
 *                  instead of the dot (issue #11). Mock mode has no urgent
 *                  derivation, so it's always false there.
 */
export function useUnread(): {
  topicHasUnread: (topicId: string) => boolean
  dmHasUnread: (dmId: string) => boolean
  topicIsUrgent: (topicId: string) => boolean
  dmIsUrgent: (dmId: string) => boolean
} {
  const remote = useQuery(api.unread.summary, hasConvex ? {} : 'skip')

  const topicHasUnread = useCallback(
    (topicId: string) => {
      if (!hasConvex) return mockTopicHasUnread(topicId)
      return remote?.topics.includes(topicId) ?? false
    },
    [remote],
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
    (topicId: string) => (hasConvex ? (remote?.urgentTopics.includes(topicId) ?? false) : false),
    [remote],
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

  return {
    markContainerRead(parentKind: 'topic' | 'dm' | 'huddle', parentKey: string) {
      if (!hasConvex) return
      void markContainerRemote({ parentKind, parentKey })
      // Only a topic has a channel today. A DM lives in Convex until the
      // DMs-on-Nostr work lands, and a huddle is not a channel at all.
      if (parentKind === 'topic') {
        recordContainerRead(findTopic(parentKey)?.folderId, Date.now())
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
  }
}
