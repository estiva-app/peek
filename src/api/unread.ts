/**
 * Unread — two signals, two watermarks (§4.3; ruling 2026-07-09).
 *
 *   hasNewMessage → cleared by opening the DM (after a short dwell)
 *   hasNewReply / isNew → cleared only by opening THAT message's thread panel
 *
 * Both are folded from the relay per viewer; mock mode keeps the fixture's
 * seeded flags so the demo renders identically. (The fixture is still keyed by
 * legacy DM conversation numbers — bridged here.)
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { dmHasUnread as mockDmHasUnread } from '@/data/dmData'
import { mockConvIdFor } from './directory'
import { hasConvex } from './store'
import { hasRelay } from './relayUrl'
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
 * A DM is a channel, and its dot is a channel's question: is there a message in
 * it newer than the person's NIP-RS marker for it. So it goes through
 * `useTopicUnread`, the channel fold, keyed by the partner's pubkey and read
 * from the channel the relay says it is (REM-3). Topics went with Convex in
 * FOL-23; a file's dot is the listing's (`useConversationBadges`).
 *
 * A fold's worst case is a dot that fails to light, not content that is lost.
 */
export function useUnread(): {
  dmHasUnread: (dmId: string) => boolean
  dmIsUrgent: (dmId: string) => boolean
} {
  const { partners, channelOf } = useDmChannels()
  const dmChannels = useMemo(
    () => (hasRelay ? partners.map((pubkey) => ({ id: pubkey, folderId: channelOf(pubkey) })) : undefined),
    [partners, channelOf],
  )
  const dmFold = useTopicUnread(dmChannels)

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

  const dmIsUrgent = useCallback((dmId: string) => (hasRelay ? (dmFold.urgent[dmId] ?? false) : false), [dmFold])

  return { dmHasUnread, dmIsUrgent }
}

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
  const markThreadRemote = useMutation(api.readState.markThreadRead)
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
    /** A DM was read. Its context is its channel uuid, never an app id (SPEC §11.1). */
    markContainerRead(dmId: string) {
      // Relay only (REM-3): nothing reads a DM's Convex watermark any more.
      if (hasRelay) recordContainerRead(dmChannelOf.current(dmId), Date.now())
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
