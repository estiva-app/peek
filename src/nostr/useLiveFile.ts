/**
 * Keep one open file's conversation in step with the relay — FOL-32.
 *
 * `useChannelSync` is what makes a topic live: the open channel is watched and
 * projected, so another person's message lands in seconds. A file's
 * conversation had no such path. `useFileConversation` reads it over HTTP and
 * `useRefreshTriggers` re-reads on focus, on becoming visible and every 30 s —
 * so somebody who stayed on the page saw a comment from Ship up to half a
 * minute late, and the first measurement that said otherwise was the focus
 * refresh firing when the tab was brought back to look.
 *
 * ## The wide filter, not the projection
 *
 * A file's comments are `kind:1111` carrying the Folder as `h`, and nothing in
 * Peek stores them: the relay is their only copy (FOL-31). So the per-channel
 * `watch` is wrong twice over — it would project the Folder's channel into
 * Convex, and it delivers what the projection *takes*, which is not this. What
 * fits is `watchChannels`, the client's wide `#h` filter: one REQ on the tab's
 * one socket, narrowed to `kinds: [1111]` because the Folder's `h` also carries
 * its own chat and a re-read of the file for every line said in the Folder
 * would be the cost with none of the point.
 *
 * The listener is told *which Folder* changed and nothing else — the platform's
 * `watchFolders` carries no event — so this cannot tell a new root (`#a` on the
 * file, which the object's own read owns) from a reply (`#e` on a root, which
 * the conversation read owns). It reports "something was said here" and the
 * caller re-reads both. Bursts are gathered for a moment so a comment posted
 * with a resolution is one re-read rather than two.
 *
 * ## The socket is the tab's one
 *
 * `getLiveTopics` rather than `peekLiveTopics()`: a file page opened from a
 * pasted link may be the first thing in the tab to want the socket, and the
 * holder guarantees there is still only one. The Convex actions it takes are
 * the projection's, read once when the wiring is built and ignored after.
 *
 * ## Additive, like the rest
 *
 * If the socket never connects this degrades to exactly the HTTP behaviour
 * above. A caller passes `interval: relayState !== 'live'` to its refresh
 * triggers, as `useChannelSync` does: the timer idles under a working socket
 * and returns the moment it is not one. Focus and visibility stay regardless.
 * A transition *into* live re-reads once, to cover what was missed while it was
 * out — the first connect's read is the caller's own mount.
 */
import { useEffect, useRef, useState } from 'react'
import { useConvex, useQuery } from 'convex/react'
import { KIND, type RelayState } from '@estiva-app/protocol'
import { api } from '../../convex/_generated/api'
import { hasConvex } from '@/api/store'
import { getLiveTopics } from './liveTopics'

/** How long the socket's activity is gathered before one re-read pays for all of it. */
export const LIVE_FILE_SETTLE_MS = 300

export function useLiveFile(
  /** The Folder the file is in — its `h`. Nothing is watched while null. */
  folder: string | null | undefined,
  /** Something was said about the file: re-read. Held in a ref, so an inline function is fine. */
  onActivity: () => void,
): { relayState: RelayState } {
  const convex = useConvex()
  const relayConfig = useQuery(api.nostr.config.relayConfig, hasConvex ? {} : 'skip')
  const relayUrl = relayConfig?.relayUrl
  const [relayState, setRelayState] = useState<RelayState>('connecting')

  // Written in an effect rather than during render (`react-hooks/refs`); every
  // read happens from a socket frame or a timer, both after the commit.
  const latest = useRef(onActivity)
  useEffect(() => {
    latest.current = onActivity
  })

  useEffect(() => {
    if (!hasConvex || !folder || !relayUrl) return

    let unsubscribe: (() => void) | undefined
    let watch: { stop(): void } | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const settle = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        latest.current()
      }, LIVE_FILE_SETTLE_MS)
    }
    try {
      const live = getLiveTopics(relayUrl, {
        importChannel: (args) => convex.action(api.nostr.sync.importChannel, args as never),
        importReactions: (args) => convex.action(api.nostr.sync.importReactions, args as never),
        importResolutions: (args) => convex.action(api.nostr.sync.importResolutions, args as never),
      })
      // The initial snapshot: `onState` fires on change, and the tab-wide
      // socket may already be live when this mounts.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRelayState(live.state())
      let wasLive = live.state() === 'live'
      unsubscribe = live.onState((next) => {
        setRelayState(next)
        if (next === 'live' && !wasLive) latest.current()
        wasLive = next === 'live'
      })
      watch = live.watchChannels([folder], settle, { kinds: [KIND.COMMENT] })
    } catch (error) {
      // A failure costs the live path and nothing else.
      console.warn('[nostr] live file subscription unavailable:', error)
    }
    return () => {
      if (timer) clearTimeout(timer)
      unsubscribe?.()
      watch?.stop()
    }
  }, [folder, relayUrl, convex])

  return { relayState }
}
