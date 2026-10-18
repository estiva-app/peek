/**
 * Peek's binding of the channel store (PER-8) — the one instance per tab, when
 * it catches up, and the hook both sidebar dots read through.
 *
 * `src/platform/channelStore.ts` is the mechanism and knows nothing about Peek.
 * This file is everything it deliberately does not know: the viewer's token,
 * the tab's socket, the page's visibility, the horizon, and the console.
 *
 * ## One store, one cadence
 *
 * Both dot hooks — the team column's and the topics column's — used to read
 * their own overlapping sets on their own triggers: two 90-day reads per
 * socket signal, focus, visibility change and 30 s tick, on two clocks that
 * never lined up. They now track channels in one store, which reads the union
 * once and applies what the socket delivers. The cadence lives here, once per
 * store, never per hook, so a third reader costs nothing extra:
 *
 * - **the socket returning to `live`** — what was said while it was away was
 *   delivered to nobody; a catch-up from the cursor.
 * - **the tab becoming visible** — the same, for a tab the browser throttled.
 * - **every {@link CATCH_UP_MS} while visible** — the safety net under a wide
 *   filter that is accepted and delivers nothing (the relay build FOL-40
 *   documents). One `POST` for up to 128 channels, from the cursor; Buzz's own
 *   desktop client refreshes its channel list on the same minute.
 * - **every {@link RESYNC_MS} while visible** — a full read, the only way a
 *   deleted message leaves (`kind:5` carries no `h`).
 *
 * Focus is not on the list. A focus without a visibility change is a window
 * switch on a desktop, the tab never stopped being current, and the socket was
 * listening throughout.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { KIND, type SignedEvent } from '@estiva-app/protocol'
import { validToken } from '@/auth/estivaId'
import { heldToken } from '@/auth/heldSession'
import { queryRelay } from '@/nostr/bridge'
import { readFromCopy } from '@/nostr/deviceCopy'
import { CHANNEL_STREAM_LIMIT, streamMessagesByFolder, type StreamMessage } from '@/nostr/channelStreams'
import { relayLog, type LiveTopics } from '@/nostr/liveTopics'
import { PEEK_HORIZON_DAYS } from '@/nostr/readState'
import { RelayReadError, withRateLimitRetry } from '@/nostr/relayRead'
import { useLiveClient } from '@/nostr/useLiveClient'
import { createChannelStore, type ChannelStore, type ChannelStoreRead } from '@/platform/channelStore'
import { useRelayViewer } from './foreign'

/** The safety-net catch-up, while the tab is visible. */
export const CATCH_UP_MS = 60_000
/** The full read that lets deletions leave, while the tab is visible. */
export const RESYNC_MS = 5 * 60_000
/**
 * How long a Folder no page tracks any more stays held and watched (OPT-4): a
 * page that left it and one coming back — Desk → a topic → Desk — ask nothing.
 * The same five minutes a resolved object is held.
 */
export const CHANNEL_LINGER_MS = 5 * 60_000
import { LOOKBACK_SECONDS } from './lookback'
export { LOOKBACK_SECONDS }

const HORIZON_SECONDS = PEEK_HORIZON_DAYS * 24 * 60 * 60

/** Every read the store made, for a diagnostic that wants to say why. */
const readListeners = new Set<(read: ChannelStoreRead) => void>()
/** Every event the socket delivered to the store, by channel. */
const deliveryListeners = new Set<(channel: string) => void>()

export function onChannelStoreRead(listener: (read: ChannelStoreRead) => void): () => void {
  readListeners.add(listener)
  return () => readListeners.delete(listener)
}

export function onChannelStoreDelivery(listener: (channel: string) => void): () => void {
  deliveryListeners.add(listener)
  return () => deliveryListeners.delete(listener)
}

/**
 * The viewer's `POST /query`, with the token read per request rather than
 * captured — a silent renewal must not leave the store asking with a dead one —
 * and a quota refusal waited out at the second the relay names.
 */
/**
 * Channels Desk's loader tracked for Topics and nobody else has asked for yet
 * (PEE-5): a read of only these goes in the `ahead` lane. Syncing 50 Folders'
 * streams in the click lane made a click landing beside it ~500 ms slower.
 */
const aheadOnly = new Set<string>()

const onlyAhead = (filters: Record<string, unknown>[]) =>
  aheadOnly.size > 0 && filters.every((filter) => Array.isArray(filter['#h']) && filter['#h'].every((h) => aheadOnly.has(h as string)))

function queryAsViewer(relayUrl: string) {
  return (filters: Record<string, unknown>[]) =>
    withRateLimitRetry(async () => {
      const token = validToken()
      if (!token) throw new RelayReadError('auth-required: no Estiva ID token in this tab')
      const result = await queryRelay(relayUrl, filters, token.accessToken, token.pubkey, onlyAhead(filters) ? 'ahead' : 'click')
      if (!result.ok) throw new RelayReadError(result.reason ?? 'unknown')
      return result.events
    })
}

/** Catch up and resync on the triggers the module doc lists. Returns a stop. */
function startCadence(store: ChannelStore, live: LiveTopics): () => void {
  const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible'
  const quietly = (read: Promise<void>) => void read.catch(() => {}) // `onError`/`onRead` already said it

  let wasLive = live.state() === 'live'
  const unwatchState = live.onState((state) => {
    if (state === 'live' && !wasLive) quietly(store.sync('relay-live'))
    wasLive = state === 'live'
  })
  const onVisible = () => {
    if (visible()) quietly(store.sync('visible'))
  }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
  const catchUp = setInterval(() => visible() && quietly(store.sync('interval')), CATCH_UP_MS)
  const resync = setInterval(() => visible() && quietly(store.resync('resync')), RESYNC_MS)

  return () => {
    unwatchState()
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
    clearInterval(catchUp)
    clearInterval(resync)
  }
}

/**
 * The tab's one store, for this relay and this viewer. A different viewer —
 * signed out and in as somebody else — gets a new one, so nothing one person
 * could read is ever shown to the next.
 */
let current: { key: string; store: ChannelStore; stop: () => void } | null = null

function storeFor(relayUrl: string, pubkey: string, live: LiveTopics): ChannelStore {
  const key = `${relayUrl}|${pubkey}`
  if (current?.key === key) return current.store
  current?.stop()
  const store = createChannelStore({
    query: queryAsViewer(relayUrl),
    seed: (filters) => readFromCopy(relayUrl, filters, heldToken()?.pubkey),
    watch: (channels, listener, options) =>
      live.watchChannels(
        channels,
        (channel, event) => {
          for (const heard of deliveryListeners) heard(channel)
          listener(channel, event)
        },
        options,
      ),
    kinds: [KIND.STREAM_MESSAGE, KIND.COMMENT],
    horizonSeconds: HORIZON_SECONDS,
    limitPerChannel: CHANNEL_STREAM_LIMIT,
    lookbackSeconds: LOOKBACK_SECONDS,
    lingerMs: CHANNEL_LINGER_MS,
    onError: (error) => relayLog('channel store read failed', error),
    onRead: (read) => {
      for (const listener of readListeners) listener(read)
    },
  })
  const stopCadence = startCadence(store, live)
  current = {
    key,
    store,
    stop: () => {
      stopCadence()
      store.close()
    },
  }
  return store
}

/** Tests only: stop and forget the tab's store, so each test starts with none. */
export function resetChannelStreamsForTests(): void {
  current?.stop()
  current = null
}

const NO_SNAPSHOT = { version: -1, at: 0 }
const subscribeNowhere = () => () => {}

/**
 * What has been said in each of `channels` inside the horizon, as the sidebar
 * reads it — kept current by the tab's store rather than read per call.
 *
 * Same contract as the read it replaces: a channel absent from `streams` was
 * not answered (signed out, not read yet, or its read failed), and a caller
 * draws nothing for it rather than a confident "nothing new". `at` is when the
 * store last changed, in unix seconds — the horizon's clock.
 */
export function useChannelStreams(channels: readonly string[]): {
  at: number
  streams: Record<string, StreamMessage[]>
} {
  const held = useTabChannelStore()
  const store = held?.store ?? null

  // Keyed on the ids, not the array: callers hand a fresh one per render.
  const key = useMemo(() => [...new Set(channels)].sort().join(','), [channels])
  const ids = useMemo(() => (key ? key.split(',') : []), [key])

  useEffect(() => {
    if (!store || ids.length === 0) return
    return store.track(ids)
  }, [store, ids])

  const snapshot = useSyncExternalStore(
    store ? store.subscribe : subscribeNowhere,
    store ? store.snapshot : () => NO_SNAPSHOT,
  )

  return useMemo(() => {
    const streams: Record<string, StreamMessage[]> = {}
    if (held) {
      for (const channel of ids) {
        const events = held.store.events(channel)
        if (events) streams[channel] = streamMessagesByFolder(events, [channel], held.me)[channel]
      }
    }
    return { at: snapshot.at, streams }
  }, [held, ids, snapshot])
}

/** The tab's store, for Desk's loader to read Topics' Folders into before Topics tracks them (PEE-5); null until connected. */
export function useTabChannelStoreForAhead(): ChannelStore | null {
  return useTabChannelStore()?.store ?? null
}

/**
 * Track `channels` for Desk's loader, their first read in the `ahead` lane until
 * {@link channelsAskedFor}. Returns the release, as `track` does.
 */
export function trackAhead(store: ChannelStore, channels: readonly string[]): () => void {
  for (const channel of channels) aheadOnly.add(channel)
  return store.track([...channels])
}

/** The person acted: whatever the loader tracked may be what they now wait for, so its reads go in the click lane. */
export function channelsAskedFor(): void {
  aheadOnly.clear()
}

/** The tab's store and the viewer it is for (urgency is per reader, CON-17); null until signed in and connected. */
function useTabChannelStore(): { store: ChannelStore; me: string } | null {
  const { live } = useLiveClient()
  const viewer = useRelayViewer()
  const [held, setHeld] = useState<{ store: ChannelStore; me: string } | null>(null)
  useEffect(() => {
    const v = viewer()
    if (!live || !v) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the store is outside React; this hands its identity in
    setHeld({ store: storeFor(v.relayUrl, v.token.pubkey, live), me: v.token.pubkey })
  }, [live, viewer])
  return held
}

/**
 * Every event the tab's store holds, whichever channel it was said in — a
 * snapshot that is a new array when the store changed and the same one
 * otherwise (OPT-5). Tracks nothing: it is what the sidebar and Desk already
 * keep live. For a reader that holds an answer of its own and folds in what
 * the socket has said since, rather than reading again.
 */
export function useHeldChannelEvents(): readonly SignedEvent[] {
  const held = useTabChannelStore()
  const store = held?.store ?? null
  const snapshot = useSyncExternalStore(
    store ? store.subscribe : subscribeNowhere,
    store ? store.snapshot : () => NO_SNAPSHOT,
  )
  return useMemo(
    () => (store ? store.channels().flatMap((channel) => store.events(channel) ?? []) : []),
    // `snapshot` is the store's version: a new one is a change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, snapshot],
  )
}
