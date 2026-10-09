/**
 * Keep one open file's conversation in step with the relay — FOL-32.
 *
 * `useChannelSync` was what made a topic live: the open channel was watched and
 * projected, so another person's message landed in seconds. A file's
 * conversation had no such path. `useFileConversation` reads it over HTTP and
 * `useRefreshTriggers` re-reads on focus, on becoming visible and every 30 s —
 * so somebody who stayed on the page saw a comment from Ship up to half a
 * minute late, and the first measurement that said otherwise was the focus
 * refresh firing when the tab was brought back to look.
 *
 * ## The wide filter
 *
 * A file's comments are `kind:1111` carrying the Folder as `h`, and nothing in
 * Peek stores them: the relay is their only copy (FOL-31). What fits is
 * `watchChannels`, the client's wide `#h` filter: one REQ on the tab's
 * one socket, narrowed to `kinds: [1111]` because the Folder's `h` also carries
 * its own chat and a re-read of the file for every line said in the Folder
 * would be the cost with none of the point.
 *
 * ## The event, applied — not a signal to re-read (OPT-5)
 *
 * The listener is handed each event the socket delivers, and the caller
 * applies it to what it holds: most are another topic's in the same Folder and
 * cost nothing. It used to be told only "something was said here" and re-read
 * the conversation every time — one or two requests for each line said
 * anywhere in the Folder. Called with no event, the caller catches up instead:
 * on the transition into live, and if a socket ever delivers a signal without
 * its event.
 *
 * ## One watch per Folder, shared
 *
 * Every view of the same Folder and kinds shares one REQ, kept for
 * {@link LIVE_FILE_LINGER_MS} after the last view leaves it, so going from one
 * topic to another in the Folder, or out and straight back, neither closes nor
 * reopens it. `since` is when the watch opened: a reconnect replays from there,
 * and what is already held is merged as nothing.
 *
 * `getLiveTopics` builds the socket if nothing has yet: a file page opened from a
 * pasted link may be the first thing in the tab to want it, and the holder
 * guarantees there is still only one.
 *
 * ## Additive, like the rest
 *
 * If the socket never connects this degrades to exactly the HTTP behaviour
 * above. A caller passes `interval: relayState !== 'live'` to its refresh
 * triggers: the timer idles under a working socket
 * and returns the moment it is not one. Focus and visibility stay regardless.
 * A transition *into* live re-reads once, to cover what was missed while it was
 * out — the first connect's read is the caller's own mount.
 */
import { useEffect, useRef, useState } from 'react'
import { KIND, type RelayState, type SignedEvent } from '@estiva-app/protocol'
import { getLiveTopics, type LiveTopics } from './liveTopics'
import { RELAY_URL } from '@/api/relayUrl'

/** How long a Folder's watch outlives the last view of it. */
export const LIVE_FILE_LINGER_MS = 60_000

/**
 * What a file's conversation is made of that carries the Folder's `h`: its
 * comments, a `kind:9` written before Ship flipped, edits, resolutions, an
 * admin's delete, and the file's field changes. Applied, not re-read, so the
 * Folder's own chat costs a frame each and nothing more.
 */
const FILE_KINDS: readonly number[] = [
  KIND.COMMENT,
  KIND.STREAM_MESSAGE,
  KIND.MESSAGE_EDIT,
  KIND.ASSERTION,
  /* NIP-29's admin delete */ 9005,
  /* a file's field change (SPEC §6.7) */ 1851,
]

type Listener = (event?: SignedEvent) => void
interface Watch {
  live: LiveTopics
  folder: string
  kinds: ReadonlySet<number>
  listeners: Set<Listener>
  watch: { stop(): void }
  linger?: ReturnType<typeof setTimeout>
}
const watches = new Set<Watch>()
/** Which watch each joined listener is on now: a wider watch of its Folder can take it over. */
const placed = new Map<Listener, Watch>()

const covers = (watch: Watch, kinds: readonly number[]) => kinds.every((kind) => watch.kinds.has(kind))

function stop(watch: Watch): void {
  if (watch.linger) clearTimeout(watch.linger)
  watch.watch.stop()
  watches.delete(watch)
}

/**
 * Join a shared watch of the Folder that delivers at least `kinds`; the
 * returned function leaves it. The listener hears only `kinds` (and the
 * catch-up signal), whatever else the watch it sits on carries.
 *
 * A Folder has one watch where it can: a narrower one joins a wider one already
 * open — a widget's field changes ride the open topic's own watch of its Folder —
 * and a wider one opened later takes the narrower one's listeners
 * over and closes it.
 */
function share(live: LiveTopics, folder: string, kinds: readonly number[], listener: Listener): () => void {
  const wanted = new Set(kinds)
  const filtered: Listener = (event) => {
    if (!event || wanted.has(event.kind)) listener(event)
  }
  // A watch on a client the holder has since replaced delivers nothing: start one on this client.
  for (const watch of [...watches]) if (watch.folder === folder && watch.live !== live) stop(watch)
  let entry = [...watches].find((watch) => watch.folder === folder && covers(watch, kinds))
  if (!entry) {
    const listeners = new Set<Listener>()
    const watch = live.watchChannels(
      [folder],
      (_folder, event) => {
        for (const each of [...listeners]) each(event)
      },
      { kinds, since: Math.floor(Date.now() / 1000) },
    )
    const wider: Watch = { live, folder, kinds: wanted, listeners, watch }
    for (const narrower of [...watches]) {
      if (narrower.folder !== folder || ![...narrower.kinds].every((kind) => wanted.has(kind))) continue
      for (const each of narrower.listeners) {
        listeners.add(each)
        placed.set(each, wider)
      }
      stop(narrower)
    }
    watches.add(wider)
    entry = wider
  }
  if (entry.linger) clearTimeout(entry.linger)
  entry.linger = undefined
  entry.listeners.add(filtered)
  placed.set(filtered, entry)
  return () => {
    const held = placed.get(filtered)
    placed.delete(filtered)
    if (!held) return
    held.listeners.delete(filtered)
    if (held.listeners.size || !watches.has(held)) return
    held.linger = setTimeout(() => stop(held), LIVE_FILE_LINGER_MS)
  }
}

/**
 * Hear `kinds` in a Folder from the tab's socket, on the shared watch, outside
 * a component: what a held object (a widget's file) needs to follow its file's
 * field changes. A no-op without a relay, or if the socket cannot be built.
 */
export function joinFolderWatch(folder: string, kinds: readonly number[], listener: (event: SignedEvent) => void): () => void {
  if (!RELAY_URL) return () => {}
  try {
    return share(getLiveTopics(RELAY_URL), folder, kinds, (event) => {
      if (event) listener(event)
    })
  } catch (error) {
    console.warn('[nostr] live Folder watch unavailable:', error)
    return () => {}
  }
}

/** Every shared watch, stopped — for a test. */
export function stopLiveFileWatches(): void {
  for (const watch of [...watches]) stop(watch)
  placed.clear()
}

export function useLiveFile(
  /** The Folder the file is in — its `h`. Nothing is watched while null. */
  folder: string | null | undefined,
  /**
   * The socket delivered `event` in the Folder: apply it. Called with none on
   * the transition into live: catch up. Held in a ref, so an inline function is fine.
   */
  onActivity: (event?: SignedEvent) => void,
  /**
   * What to watch for. A file's conversation by default; a channel's
   * conversation (REM-1) passes its messages and what else carries its `h`.
   * Read by value, so a fresh array each render does not re-subscribe.
   */
  kinds: readonly number[] = FILE_KINDS,
): { relayState: RelayState } {
  const kindList = kinds.join(',')
  const relayUrl = RELAY_URL
  const [relayState, setRelayState] = useState<RelayState>('connecting')

  // Written in an effect rather than during render (`react-hooks/refs`); every
  // read happens from a socket frame or a timer, both after the commit.
  const latest = useRef(onActivity)
  useEffect(() => {
    latest.current = onActivity
  })

  useEffect(() => {
    // Relay-only: gated on the relay, never on Convex (REM-2).
    if (!folder || !relayUrl) return

    let unsubscribe: (() => void) | undefined
    let leave: (() => void) | undefined
    try {
      const live = getLiveTopics(relayUrl)
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
      /*
        From when the watch opened (OPT-3). Without `since` the REQ replays the
        Folder's stored history on subscribe, and every open and every return
        paid its reads twice.
      */
      leave = share(live, folder, kindList.split(',').map(Number), (event) => latest.current(event))
    } catch (error) {
      // A failure costs the live path and nothing else.
      console.warn('[nostr] live file subscription unavailable:', error)
    }
    return () => {
      unsubscribe?.()
      leave?.()
    }
  }, [folder, relayUrl, kindList])

  return { relayState }
}
