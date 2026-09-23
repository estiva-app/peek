/**
 * Keep a live subscription on the channels the Desk and inbox are showing
 * (PEE-11) — topics, and since DMS-5 DMs on the same terms.
 *
 * Before this, only the **open topic** had a relay read path. Nothing else had
 * one at all — so a Ship-side change to a topic you were not looking at had no
 * route into the inbox, and "takes time to appear" actually meant "never, until
 * you open the topic it lives in".
 *
 * Renders nothing. Mounted once in `AppShell`, beside the nav rail, because the
 * working set is a property of the person rather than of any page — navigating
 * from Desk to a topic must not tear these down and build them again.
 *
 * ## It costs one subscription, not two, for a topic that is also open
 *
 * `useTopicView` watches the open topic, and that topic is usually also in the
 * Desk or the inbox. Both hold the same channel, PEE-6's refcount collapses
 * them into one REQ, and the relay sees one. Whichever releases second closes
 * it. That is the whole reason the manager is refcounted rather than keyed on
 * the current screen.
 *
 * ## Not a cron, and it cannot be
 *
 * `convex/crons.ts` explains why: reads happen as the signed-in viewer because
 * only they are a member of their own channels. Background work has no identity
 * that can see anything. This is a subscription held by a person's own tab, for
 * exactly as long as that tab is open.
 *
 * ## Subscribing does not mark anything read
 *
 * Read state moves in `useMarkRead`, which is driven by *opening* a topic.
 * Projecting a message into a topic nobody is looking at raises its unread
 * count, which is the entire point of this ticket.
 */
import { useEffect } from 'react'
import { useConvex, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { hasConvex, RELAY_URL } from '@/api'
import { getLiveTopics } from '@/nostr/liveTopics'

export function LiveWorkingSet() {
  const convex = useConvex()
  const relayUrl = RELAY_URL
  const channels = useQuery(api.nostr.sync.watchableChannels, hasConvex ? {} : 'skip')

  // Reactive: the query re-runs when the Desk, inbox or stars change, so the
  // set follows what is on screen without anything polling for it.
  //
  // The dependency is a stringified list rather than the array, because Convex
  // hands back a new array identity on every update and the effect would
  // otherwise tear down and rebuild every subscription each time — closing and
  // reopening REQs the relay was perfectly happy with.
  const key =
    channels?.map((c) => `${c.containerKind}:${c.containerKey}:${c.channelUuid}`).join(',') ?? ''

  useEffect(() => {
    if (!hasConvex || !relayUrl || !channels || channels.length === 0) return

    let live
    try {
      live = getLiveTopics(relayUrl, {
        importChannel: (args) => convex.action(api.nostr.sync.importChannel, args as never),
        importReactions: (args) => convex.action(api.nostr.sync.importReactions, args as never),
        importResolutions: (args) => convex.action(api.nostr.sync.importResolutions, args as never),
      })
    } catch (error) {
      console.warn('[nostr] live working set unavailable:', error)
      return
    }

    const handles = channels.flatMap((channel) => {
      try {
        return [live.watch(channel)]
      } catch (error) {
        // A channel key that is not a uuid would register globally and then
        // deliver nothing (PEE-6). One bad row must not cost the whole set.
        console.warn('[nostr] skipping a channel in the working set:', error)
        return []
      }
    })

    return () => {
      for (const handle of handles) handle.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, relayUrl, convex])

  return null
}
