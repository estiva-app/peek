/**
 * Keep one open container in step with its channel on the relay — DMS-5.
 *
 * This is `useTopicView`'s relay wiring, lifted whole and given a second caller
 * rather than copied. That is the shape DMS-5 asked for: *one projection, two
 * container types.* A DM's channel is an ordinary private channel carrying
 * ordinary `kind:9`s, so there is nothing for a DM-specific version to do
 * differently — and two hooks would diverge silently, because each would stay
 * self-consistent while drifting from the other.
 *
 * Three things run here, and each covers a gap the other two cannot:
 *
 *   1. **A backfill on open.** A subscription only delivers what arrives after
 *      it is registered, so opening a container must still read history. This
 *      path owns the `since` cursor, the paging, and the resolution read that is
 *      deliberately *not* cursored.
 *   2. **A re-run on focus, on becoming visible, and on a slow interval**, the
 *      interval idling while the socket is live (PEE-1).
 *   3. **A live subscription**, additive by construction: if the socket never
 *      connects, this degrades to exactly the HTTP behaviour above.
 *
 * Everything is wrapped so that a failure costs the live path and nothing else.
 * `watch()` throws on a channel key that is not a uuid — correct at that
 * boundary, since such a subscription would register globally and never deliver
 * — but an uncaught throw in an effect would take the whole view down with it.
 *
 * **The relay reads stay in the browser** (PEEK-106): the viewer's Estiva ID
 * token is the credential, it exists nowhere else, and Convex surfaces action
 * arguments in its dashboard logs. Convex still does the projection.
 *
 * **Nothing here marks anything read.** Read state moves in `useMarkRead`,
 * driven by a person opening something. Projecting a message raises an unread
 * count, which is the point.
 */
import { useCallback, useEffect, useState } from 'react'
import { useConvex, useQuery } from 'convex/react'
import type { RelayState } from '@estiva-app/protocol'
import { api } from '../../convex/_generated/api'
import { hasConvex } from '@/api/store'
import { validToken } from '@/auth/estivaId'
import { useRefreshTriggers } from '@/lib/useRefreshTriggers'
import { recordBackfillEnd, recordBackfillStart } from './freshness'
import { getLiveTopics } from './liveTopics'
import { syncContainerFromRelay, type SyncContainer } from './sync'
import { RELAY_URL } from '@/api/relayUrl'

export interface ChannelSync {
  /** The tab's socket state, for PEE-9's freshness indicator. */
  relayState: RelayState
  /**
   * This container's channel, or null while it has none.
   *
   * Answered by `syncPlan`, the same query the backfill uses, so the two paths
   * cannot disagree about which channel a container is.
   */
  channelUuid: string | null
  /**
   * Reaction targets the last sync left past the §6.6 horizon, for the caption
   * that reports it. 0 until a sync has recorded one.
   */
  reactionTargetsOmitted: number
}

export function useChannelSync(kind: SyncContainer['kind'], key: string | null): ChannelSync {
  const convex = useConvex()
  const relayUrl = RELAY_URL

  const plan = useQuery(
    api.nostr.sync.syncPlan,
    hasConvex && key != null ? { containerKind: kind, containerKey: key } : 'skip',
  )
  const channelUuid = plan?.channelUuid ?? null

  const [relayState, setRelayState] = useState<RelayState>('connecting')

  /*
    Memoised on exactly what it closes over, so the effects below re-run when it
    genuinely changes and not otherwise.

    A run that lands after `key` has changed is harmless rather than cancelled:
    every import is keyed by the container, so a late backfill writes the
    previous container's history to the previous container. Nothing here is
    applied to component state, which is what makes that true.
  */
  const backfill = useCallback(() => {
    if (!hasConvex || key == null || !relayUrl) return
    // `validToken()` rather than a module-load snapshot: that constant is fixed
    // at import time, so a page opened while the stored token had expired would
    // disable this sync for the whole session even after a renewal.
    const token = validToken()
    if (!token) return
    // Observed rather than inferred: PEE-9 shows "catching up" while this is in
    // flight and "last synced" from when it succeeded. A failure records the end
    // without moving the timestamp, so the age on screen keeps growing — which
    // is the whole point of showing it.
    recordBackfillStart()
    void syncContainerFromRelay({ kind, key }, relayUrl, token, {
      syncPlan: (args) => convex.query(api.nostr.sync.syncPlan, args),
      importChannel: (args) => convex.action(api.nostr.sync.importChannel, args as never),
      importReactions: (args) => convex.action(api.nostr.sync.importReactions, args as never),
      importResolutions: (args) => convex.action(api.nostr.sync.importResolutions, args as never),
    })
      .then((synced) => recordBackfillEnd(synced))
      .catch((error) => {
        recordBackfillEnd(false)
        console.warn('[nostr] viewer sync failed:', error)
      })
  }, [kind, key, relayUrl, convex])

  /*
    The mount-time run is unconditional and stays that way — see above.

    Gated on `channelUuid` rather than on the key alone, because a container with
    no channel has nothing to read: a topic created before Nostr emission was
    wired up never gets one, and a DM gets one on its first render or first
    message (DMS-3), at which point this effect re-runs on its own.
  */
  useEffect(() => {
    if (!hasConvex || key == null || !channelUuid || !relayUrl) return
    backfill()
  }, [backfill, key, channelUuid, relayUrl])

  /*
    The interval idles while the socket is live: polling underneath a working
    live connection would undo M3. Focus and visibility still fire regardless —
    they happen at human frequency, the `since` cursor makes a repeat almost
    free, and returning to a tab is the one moment somebody actively wants
    certainty, including when the socket believes it is connected and is not.
  */
  useRefreshTriggers(backfill, {
    enabled: hasConvex && key != null && !!relayUrl,
    interval: relayState !== 'live',
  })

  useEffect(() => {
    if (!hasConvex || key == null || !relayUrl || !channelUuid) return

    let unsubscribe: (() => void) | undefined
    let handle: { stop(): void } | undefined
    try {
      const live = getLiveTopics(relayUrl, {
        importChannel: (args) => convex.action(api.nostr.sync.importChannel, args as never),
        importReactions: (args) => convex.action(api.nostr.sync.importReactions, args as never),
        importResolutions: (args) => convex.action(api.nostr.sync.importResolutions, args as never),
      })

      // The initial snapshot of an external system, which `onState` cannot
      // give: it fires on change, and the socket is a tab-wide singleton that
      // may already be live when this mounts — leaving the indicator stuck on
      // "connecting" for a container opened second.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRelayState(live.state())
      let wasLive = live.state() === 'live'
      unsubscribe = live.onState((next) => {
        setRelayState(next)
        // Only on the transition *into* live, and not for the first connect —
        // the mount effect above has already backfilled that one.
        if (next === 'live' && !wasLive) backfill()
        wasLive = next === 'live'
      })

      // Refcounted: StrictMode's double mount shares one REQ, and the channel
      // closes when the second release lands.
      handle = live.watch({ containerKind: kind, containerKey: key, channelUuid })
    } catch (error) {
      console.warn('[nostr] live subscription unavailable:', error)
    }
    return () => {
      unsubscribe?.()
      handle?.stop()
    }
  }, [backfill, kind, key, relayUrl, channelUuid, convex])

  return { relayState, channelUuid, reactionTargetsOmitted: plan?.reactionTargetsOmitted ?? 0 }
}
