/**
 * The tab's live client, acquired rather than borrowed — FOL-40.
 *
 * `peekLiveTopics()` hands back the wiring **only if something else has
 * already built it**, and returns null otherwise. That is right for a panel
 * that is a passenger on a topic view's socket, and wrong for anything the
 * sidebar draws: the wiring is built by `LiveWorkingSet` (only once Convex has
 * answered `watchableChannels`, and only when that set is non-empty), by the
 * topic view, or by a file page. A person sitting on the Folders page with
 * nothing starred and no topic open has no socket at all — and a subscription
 * effect that read `peekLiveTopics()` once at mount never learned that one
 * appeared later, because nothing it depends on changed when it did.
 *
 * That is the whole of "the dot only moves on a refresh" after FOL-40 shipped:
 * the subscription was right and was never made. This builds the client the
 * way `useLiveFile` does — the holder keeps it single, so asking for it is
 * free when it exists — and re-runs when the relay's origin lands, which is
 * the moment it becomes possible at all.
 *
 * Returns `null` until Convex has said where the relay is, which is a real
 * state: the caller keeps whatever fallback it had.
 */
import { useEffect, useState } from 'react'
import { useConvex, useQuery } from 'convex/react'
import type { RelayState } from '@estiva-app/protocol'
import { api } from '../../convex/_generated/api'
import { hasConvex } from '@/api/store'
import { getLiveTopics, type LiveTopics } from './liveTopics'

export function useLiveTopics(): { live: LiveTopics | null; relayState: RelayState } {
  const convex = useConvex()
  const relayConfig = useQuery(api.nostr.config.relayConfig, hasConvex ? {} : 'skip')
  const relayUrl = relayConfig?.relayUrl
  const [live, setLive] = useState<LiveTopics | null>(null)
  const [relayState, setRelayState] = useState<RelayState>('connecting')

  useEffect(() => {
    if (!hasConvex || !relayUrl) return
    let client: LiveTopics
    try {
      client = getLiveTopics(relayUrl, {
        importChannel: (args) => convex.action(api.nostr.sync.importChannel, args as never),
        importReactions: (args) => convex.action(api.nostr.sync.importReactions, args as never),
        importResolutions: (args) => convex.action(api.nostr.sync.importResolutions, args as never),
      })
    } catch (error) {
      // A failure costs the live path and nothing else.
      console.warn('[nostr] live client unavailable:', error)
      return
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLive(client)
    // The socket may already be live when this mounts; `onState` only fires on
    // a change, so the snapshot is taken here.
    setRelayState(client.state())
    /*
      An inline listener, not `setRelayState` itself. React hands out the same
      setter for the life of the hook, and a client that keeps its listeners in
      a `Set` would then have StrictMode's second mount add a value the first
      mount's cleanup removes — leaving the tab subscribed to nothing, in dev
      only, which is the worst place to debug it from.
    */
    return client.onState((next) => setRelayState(next))
  }, [relayUrl, convex])

  return { live, relayState }
}
