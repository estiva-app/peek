/**
 * The tab's live client, acquired rather than borrowed — FOL-40.
 *
 * Anything the sidebar draws has to *build* the client rather than wait for
 * something else to: a person sitting on the Folders page with nothing open
 * had no socket at all while the only builders were a topic view and the
 * Convex working set, and a subscription effect that looked once at mount
 * never learned that one appeared later. That was the whole of "the dot only
 * moves on a refresh" after FOL-40 shipped.
 *
 * So this builds the client the way `useLiveFile` does — the holder keeps it
 * single, so asking for it is free when it exists — and re-runs when the
 * relay's origin changes. Named for the client since FOL-23: it was
 * `useLiveTopics`, and Convex topics are gone.
 *
 * Returns `null` without a relay origin, which is a real state: the caller
 * keeps whatever fallback it had.
 */
import { useEffect, useState } from 'react'
import type { RelayState } from '@estiva-app/protocol'
import { getLiveTopics, type LiveTopics } from './liveTopics'
import { RELAY_URL } from '@/api/relayUrl'

export function useLiveClient(): { live: LiveTopics | null; relayState: RelayState } {
  const relayUrl = RELAY_URL
  const [live, setLive] = useState<LiveTopics | null>(null)
  const [relayState, setRelayState] = useState<RelayState>('connecting')

  useEffect(() => {
    if (!relayUrl) return
    let client: LiveTopics
    try {
      client = getLiveTopics(relayUrl)
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
  }, [relayUrl])

  return { live, relayState }
}
