/**
 * Unread — two signals, two watermarks (§4.3; ruling 2026-07-09).
 *
 *   hasNewMessage → cleared by opening the topic/DM (after a short dwell)
 *   hasNewReply / isNew → cleared only by opening THAT message's thread panel
 *
 * Both are folded from the relay per viewer; mock mode keeps the fixture's
 * seeded flags so the demo renders identically. (The fixture is still keyed by
 * legacy DM conversation numbers — bridged here.)
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { topicHasUnread as mockTopicHasUnread } from '@/data/topicData'
import { dmHasUnread as mockDmHasUnread } from '@/data/dmData'
import { mockConvIdFor } from './directory'
import { hasConvex } from './store'
import { hasRelay } from './relayUrl'
import { useTopicLookup, useTopics } from './topics'
import { useTopicUnread } from './useTopicUnread'
import { useDmChannels } from './internal/dms'
import { recordContainerRead, recordFileRead, recordThreadRead } from '@/nostr/useReadStateSync'

/**
 * Sidebar indicators, per viewer:
 *   `*HasUnread` → the accent dot (non-urgent).
 *   `*IsUrgent`  → the warning indicator; an unread URGENT message shows this
 *                  instead of the dot (issue #11). Mock mode has no urgent
 *                  derivation, so it's always false there.
 *
 * ## One fold, two kinds of channel (SHR-5, REM-3)
 *
 * A topic and a DM are both channels, and a channel's dot is the same
 * question either way: is there a message in it newer than the person's
 * NIP-RS marker for it. So both go through `useTopicUnread` — a topic keyed by
 * its id and read from its Folder, a DM keyed by the partner's pubkey and read
 * from the channel the relay says it is.
 *
 * `unread.summary` is no longer asked anything (REM-3). It held the DM dots,
 * the huddle rollup — huddles have been off since CON-8 — and `topicMarks`,
 * Convex's cached watermark per topic channel. Without that cache a topic
 * whose marker has fallen out of the byte-capped frontier (SHR-4) can light
 * again; the relay frontier is the read state, and the cache was Convex's.
 *
 * A fold's worst case is a dot that fails to light, not content that is lost.
 */
export function useUnread(): {
  topicHasUnread: (topicId: string) => boolean
  dmHasUnread: (dmId: string) => boolean
  topicIsUrgent: (topicId: string) => boolean
  dmIsUrgent: (dmId: string) => boolean
} {
  const topics = useTopics()
  const fold = useTopicUnread(hasConvex ? topics : undefined)
  const { partners, channelOf } = useDmChannels()
  const dmChannels = useMemo(
    () => (hasRelay ? partners.map((pubkey) => ({ id: pubkey, folderId: channelOf(pubkey) })) : undefined),
    [partners, channelOf],
  )
  const dmFold = useTopicUnread(dmChannels)

  const topicHasUnread = useCallback(
    (topicId: string) => {
      if (!hasConvex) return mockTopicHasUnread(topicId)
      return fold.unread[topicId] ?? false
    },
    [fold],
  )

  const dmHasUnread = useCallback(
    (dmId: string) => {
      if (!hasRelay) {
        const convId = mockConvIdFor(dmId)
        return convId === undefined ? false : mockDmHasUnread(convId)
      }
      return dmFold.unread[dmId] ?? false
    },
    [dmFold],
  )

  const topicIsUrgent = useCallback((topicId: string) => (hasConvex ? (fold.urgent[topicId] ?? false) : false), [fold])
  const dmIsUrgent = useCallback((dmId: string) => (hasRelay ? (dmFold.urgent[dmId] ?? false) : false), [dmFold])

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
    markContainerRead(parentKind: 'topic' | 'dm' | 'huddle', parentKey: string) {
      // A topic's context is its Folder id and a DM's is its channel uuid —
      // the bare uuid either way (SPEC §11.1), never an app id. A huddle is
      // not a channel at all.
      if (parentKind === 'dm') {
        // Relay only (REM-3): nothing reads a DM's Convex watermark any more.
        if (hasRelay) recordContainerRead(dmChannelOf.current(parentKey), Date.now())
        return
      }
      if (!hasConvex) return
      void markContainerRemote({ parentKind, parentKey })
      if (parentKind === 'topic') recordContainerRead(findTopic(parentKey)?.folderId, Date.now())
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
      // Gated on the relay, not Convex (REM-2): Convex plays no part here.
      if (!hasRelay) return
      recordFileRead(address, Date.now())
    },
  }
}
