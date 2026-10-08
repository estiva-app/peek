/**
 * What has been said in a set of channels, held — and kept current from the
 * socket rather than re-read (PER-8).
 *
 * ## Why it exists
 *
 * Peek's sidebar dots re-read 90 days of every listed Folder on every socket
 * signal, every focus, every visibility change and every 30 s tick — twice, once
 * per dot hook, over two overlapping sets of channels. Buzz meters `POST /query`
 * **per request** at 300 a minute per pubkey (`enforce_http_admission`), shared
 * with every other Estiva tab, and a production tab spent that on an ordinary
 * load. Each re-read existed to learn about the one event the socket had just
 * delivered and dropped.
 *
 * ## The model, and whose it is
 *
 * Buzz's own desktop client (`desktop/src/shared/api/relayReconnectReplay.ts`,
 * `desktop/src-tauri/src/observed_unread.rs`), which is Linear's sync model with
 * the relay as the change log:
 *
 * 1. **Load once.** A channel is read over its horizon the first time anybody
 *    tracks it — one filter per channel, batched into as few `POST /query` as
 *    the relay allows.
 * 2. **Then apply, do not re-read.** New events come from the live wide filter
 *    (`watchFolders`, which hands them over since platform 0.2.0). A pushed
 *    event costs nothing against either meter.
 * 3. **Catch up from a cursor.** After the socket was away, or the tab was, a
 *    channel is read only `since` the start of its last successful read, less
 *    {@link ChannelStoreOptions.lookbackSeconds}. Nostr has no server sequence
 *    to resume from — Linear's `lastSyncId` — so the cursor is a timestamp, and
 *    the lookback is what makes it safe: Buzz refuses an event whose
 *    `created_at` is more than `BUZZ_CREATED_AT_FLOOR_SECS` (960 s) old, so
 *    anything that arrived after a read began is dated no earlier than that
 *    read's start minus the floor, plus whatever the two clocks disagree by.
 * 4. **Resync now and then.** A `kind:5` deletion names its target by `e` and
 *    carries no `h`, so no `#h` filter will ever deliver it. A full read
 *    replaces what is held and is the only way a deleted message leaves. The
 *    relay has no NIP-77 (`nip11.rs`), so there is no cheaper reconciliation.
 *
 * Cadence — when to catch up, when to resync — belongs to the caller, because
 * it is where the clock and the page's visibility live.
 *
 * ## Written to leave (ADR 0002 §10)
 *
 * Headed for `@estiva-app/platform` once a second app has argued with it — Ship,
 * whose PER-6 is the same problem. So: nothing here imports Peek; the query,
 * the socket and the clock are parameters; the tests need no app; and it sits
 * under `platform/` because that is where it is going. It holds raw events, not
 * Peek's shape of a message, so the next app brings its own reading.
 */
import { MAX_FILTERS_PER_QUERY, type SignedEvent } from '@estiva-app/protocol'

/** `POST /query`, as the viewer. Throws on a refusal — an empty answer is an answer. */
export type ChannelQuery = (filters: Record<string, unknown>[]) => Promise<SignedEvent[]>

/** The socket's wide filter: `LiveClient.watchFolders`, or an app's wrapper of it. */
export type ChannelWatch = (
  channels: string[],
  listener: (channel: string, event?: SignedEvent) => void,
  options: { kinds: number[]; since: number },
) => { stop(): void }

export interface ChannelStoreOptions {
  query: ChannelQuery
  watch: ChannelWatch
  /** The kinds held. Every one must carry the channel's `h`. */
  kinds: number[]
  /** How far back a channel is read, in seconds. Older events are dropped. */
  horizonSeconds: number
  /** The newest this many per channel, per read and while held. */
  limitPerChannel: number
  /**
   * Subtracted from a catch-up's cursor. At least the relay's `created_at`
   * floor plus the clock skew you are willing to absorb; Buzz desktop uses
   * 1,870 s for the same job.
   */
  lookbackSeconds: number
  /** Milliseconds. */
  now?: () => number
  /**
   * How tracking calls made together become one read. Defaults to a microtask,
   * so two hooks mounting in one commit ask once for the union of their sets.
   */
  defer?: (run: () => void) => void
  /**
   * Milliseconds a channel nobody tracks any more is still held — watched,
   * caught up, read by the next tracker at once — before it is forgotten. A
   * page that leaves a channel and one that comes back to it a while later
   * (Desk → a topic → Desk, OPT-4) then cost no subscription and no read.
   * Defaults to 0: forgotten at the next {@link defer}.
   */
  lingerMs?: number
  /**
   * A read nobody awaited failed — the one tracking schedules, a queued
   * follow-up, a signal with no event. What was held stays held, and a channel
   * never read stays unread until the next {@link ChannelStore.sync}.
   */
  onError?: (error: unknown) => void
  /** Every read that reached the relay, and every one that failed — a diagnostic's feed. */
  onRead?: (read: ChannelStoreRead) => void
}

/** One read, as {@link ChannelStoreOptions.onRead} is told it. */
export interface ChannelStoreRead {
  /**
   * What asked: `track` (a channel never read), `signal` (a notification with
   * no event), `queued` (a call that arrived while another read ran), or the
   * caller's own word passed to `sync` / `resync`.
   */
  reason: string
  mode: 'sync' | 'resync'
  /** Channels tracked when it began. */
  channels: number
  /** `POST /query` sent; `null` when it failed part-way and the count is not known. */
  requests: number | null
  outcome: 'ok' | 'failed'
  error?: unknown
  ms: number
}

export interface ChannelStore {
  /**
   * Hold these channels while the returned release is unheld. A channel not yet
   * loaded is read at the next {@link sync}, which tracking schedules itself.
   * Refcounted, so two callers asking about one channel share it.
   */
  track(channels: readonly string[]): () => void
  /** What is held for a channel, oldest first; `undefined` if it was never read. */
  events(channel: string): readonly SignedEvent[] | undefined
  /**
   * A new object on every change and the same one otherwise —
   * `useSyncExternalStore`'s snapshot. `at` is when it changed, in unix
   * seconds, so a reader judging against a horizon has a clock that moves with
   * the data rather than one it would have to consult while rendering.
   */
  snapshot(): ChannelStoreSnapshot
  subscribe(listener: () => void): () => void
  /** Apply one event, whatever delivered it. Idempotent by id. */
  apply(event: SignedEvent): void
  /**
   * Bring every tracked channel current: an unread one over its horizon, a read
   * one from its cursor. Calls made while one runs share a single follow-up.
   */
  sync(reason?: string): Promise<void>
  /** Re-read every tracked channel over its horizon and replace what is held. */
  resync(reason?: string): Promise<void>
  /** Stop watching and forget everything. */
  close(): void
}

export interface ChannelStoreSnapshot {
  version: number
  at: number
}

interface Held {
  /** Oldest first, by `created_at`, then id. */
  events: SignedEvent[]
  ids: Set<string>
  /** Unix seconds at which the last successful read of this channel began. */
  cursor: number
}

function channelOf(event: SignedEvent): string | undefined {
  return event.tags.find((tag) => tag[0] === 'h' && tag[1])?.[1]
}

function byTime(a: SignedEvent, b: SignedEvent): number {
  return a.created_at - b.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

export function createChannelStore(options: ChannelStoreOptions): ChannelStore {
  const now = options.now ?? Date.now
  const defer = options.defer ?? ((run: () => void) => queueMicrotask(run))
  const kinds = new Set(options.kinds)
  const refs = new Map<string, number>()
  // Released by every tracker but not yet forgotten (`lingerMs`): still watched and caught up.
  const lingering = new Map<string, ReturnType<typeof setTimeout>>()
  const tracked = () => [...new Set([...refs.keys(), ...lingering.keys()])]
  const held = new Map<string, Held>()
  const listeners = new Set<() => void>()
  let snapshot: ChannelStoreSnapshot = { version: 0, at: Math.floor(now() / 1000) }
  let closed = false
  let watch: { stop(): void } | null = null
  let watchedKey = ''
  let scheduled = false
  let running: Promise<void> | null = null
  let again: 'sync' | 'resync' | null = null

  const seconds = () => Math.floor(now() / 1000)

  function changed() {
    snapshot = { version: snapshot.version + 1, at: seconds() }
    for (const listener of listeners) {
      try {
        listener()
      } catch {
        /* a listener's own problem */
      }
    }
  }

  /** Drop what fell out of the horizon, and keep the newest `limitPerChannel`. */
  function trim(entry: Held) {
    const floor = seconds() - options.horizonSeconds
    let start = 0
    while (start < entry.events.length && entry.events[start].created_at < floor) start += 1
    start = Math.max(start, entry.events.length - options.limitPerChannel)
    if (start > 0) {
      for (const dropped of entry.events.slice(0, start)) entry.ids.delete(dropped.id)
      entry.events = entry.events.slice(start)
    }
  }

  function insert(entry: Held, event: SignedEvent): boolean {
    if (entry.ids.has(event.id)) return false
    entry.ids.add(event.id)
    entry.events.push(event)
    return true
  }

  /** One wide filter over every tracked channel, re-made only when the set moves. */
  function rewatch() {
    const channels = tracked().sort()
    const key = channels.join(',')
    if (key === watchedKey) return
    watch?.stop()
    watch = null
    watchedKey = key
    if (closed || channels.length === 0) return
    watch = options.watch(
      channels,
      (_channel, event) => {
        // A signal with no event is "something changed, re-read": the one kind
        // of notification a store cannot apply.
        if (event) api.apply(event)
        else background(api.sync('signal'))
      },
      // Bounded, so a subscribe or a reconnect replays what a catch-up would
      // have read rather than whatever the relay's default limit allows.
      { kinds: options.kinds, since: seconds() - options.lookbackSeconds },
    )
  }

  function schedule() {
    if (scheduled || closed) return
    scheduled = true
    defer(() => {
      scheduled = false
      rewatch()
      // Only when something tracked has never been read: a channel released and
      // tracked again in one commit is still held, and costs nothing.
      if ([...refs.keys()].some((channel) => !held.has(channel))) background(api.sync('track'))
    })
  }

  /** Read `channels`, each from `since[channel]`, in as few requests as allowed. */
  async function read(
    channels: string[],
    since: (channel: string) => number,
  ): Promise<{ byChannel: Map<string, SignedEvent[]>; requests: number }> {
    const filters = channels.map((channel) => ({
      kinds: options.kinds,
      '#h': [channel],
      since: since(channel),
      limit: options.limitPerChannel,
    }))
    const byChannel = new Map<string, SignedEvent[]>(channels.map((channel) => [channel, []]))
    let requests = 0
    for (let start = 0; start < filters.length; start += MAX_FILTERS_PER_QUERY) {
      requests += 1
      for (const event of await options.query(filters.slice(start, start + MAX_FILTERS_PER_QUERY))) {
        const channel = channelOf(event)
        if (channel && kinds.has(event.kind)) byChannel.get(channel)?.push(event)
      }
    }
    return { byChannel, requests }
  }

  /** Returns how many requests it sent. */
  async function run(mode: 'sync' | 'resync', onlyUnread = false): Promise<number> {
    // A `track` reads what it added and has never been read; the rest is held and kept current by the socket,
    // so a topic opened in a new Folder does not catch up every Folder held (OPT-4).
    const channels = tracked().filter((channel) => !onlyUnread || !held.has(channel))
    if (channels.length === 0) return 0
    const began = seconds()
    const horizon = began - options.horizonSeconds
    // Decided once, before the read: an eviction while it is in flight must not
    // turn a catch-up's partial answer into an authoritative one.
    const cursors = new Map(
      channels.map((channel) => [channel, mode === 'resync' ? undefined : held.get(channel)?.cursor]),
    )
    const { byChannel, requests } = await read(channels, (channel) => {
      const cursor = cursors.get(channel)
      return cursor === undefined ? horizon : Math.max(horizon, cursor - options.lookbackSeconds)
    })
    if (closed) return requests
    let moved = false
    for (const [channel, events] of byChannel) {
      if (!refs.has(channel) && !lingering.has(channel)) continue
      const before = held.get(channel)
      const cursor = cursors.get(channel)
      // Caught up, but evicted and tracked again mid-read: a partial answer is
      // not the channel. The next sync reads it whole.
      if (cursor !== undefined && !before) continue
      if (cursor === undefined || !before) {
        /*
          A full read is authoritative — it is how a deletion leaves — except
          for what the socket applied while it was in flight, which the answer
          may predate. Those are the held events dated after the read began,
          less the lookback: the same window a catch-up trusts.
        */
        const entry: Held = { events: [], ids: new Set(), cursor: began }
        for (const event of events) insert(entry, event)
        /*
          Dated at or after `began`, so the answer cannot be the reason it is
          missing. One dated earlier that the socket delivered mid-read — a
          back-dated event — is dropped here and read again by the next
          catch-up, whose cursor is `began` less the lookback.
        */
        for (const event of before?.events ?? []) if (event.created_at >= began) insert(entry, event)
        entry.events.sort(byTime)
        trim(entry)
        const same =
          before !== undefined &&
          before.events.length === entry.events.length &&
          before.events.every((event, i) => event.id === entry.events[i].id)
        held.set(channel, entry)
        if (!same) moved = true
      } else {
        const entry = before
        let added = false
        for (const event of events) if (insert(entry, event)) added = true
        entry.cursor = began
        if (added) {
          entry.events.sort(byTime)
          trim(entry)
          moved = true
        }
      }
    }
    if (moved) changed()
    return requests
  }

  const api: ChannelStore = {
    track(channels) {
      let added = false
      for (const channel of channels) {
        const count = refs.get(channel) ?? 0
        refs.set(channel, count + 1)
        // Back before it was forgotten: still watched and held, so nothing to schedule for it — unless its
        // first read had failed or not landed, which the next tracker still needs.
        const linger = lingering.get(channel)
        if (linger !== undefined) {
          clearTimeout(linger)
          lingering.delete(channel)
          if (!held.has(channel)) added = true
        } else if (count === 0) added = true
      }
      if (added) schedule()
      let released = false
      return () => {
        if (released) return
        released = true
        const idle: string[] = []
        for (const channel of channels) {
          const count = (refs.get(channel) ?? 0) - 1
          if (count > 0) refs.set(channel, count)
          else {
            refs.delete(channel)
            idle.push(channel)
          }
        }
        if (idle.length === 0 || closed) return
        if (options.lingerMs) {
          for (const channel of idle) {
            lingering.set(
              channel,
              setTimeout(() => {
                lingering.delete(channel)
                if (refs.has(channel) || closed) return
                held.delete(channel)
                rewatch()
              }, options.lingerMs),
            )
          }
          return
        }
        /*
          Forgotten a moment later, not now. React runs an effect's cleanup
          before its replacement, so a hook whose set changed releases every
          channel and tracks most of them again in the same commit; evicting on
          the spot would re-read each one over its whole horizon.
        */
        defer(() => {
          let evicted = false
          for (const channel of idle) {
            if (refs.has(channel)) continue
            held.delete(channel)
            evicted = true
          }
          if (evicted) rewatch()
        })
      }
    },

    events: (channel) => held.get(channel)?.events,
    snapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    apply(event) {
      if (closed || !kinds.has(event.kind)) return
      const channel = channelOf(event)
      // Not read yet: the first read will bring it, and holding it alone would
      // make an unread channel look read.
      const entry = channel ? held.get(channel) : undefined
      if (!entry || !insert(entry, event)) return
      entry.events.sort(byTime)
      trim(entry)
      changed()
    },

    sync(reason = 'sync') {
      return coalesce('sync', reason)
    },
    resync(reason = 'resync') {
      return coalesce('resync', reason)
    },

    close() {
      closed = true
      watch?.stop()
      watch = null
      refs.clear()
      for (const linger of lingering.values()) clearTimeout(linger)
      lingering.clear()
      held.clear()
      listeners.clear()
    },
  }

  /** A read nobody is awaiting: its failure goes to `onError`, never unhandled. */
  function background(read: Promise<void>) {
    read.catch((error: unknown) => {
      try {
        options.onError?.(error)
      } catch {
        /* the reporter's own problem */
      }
    })
  }

  /**
   * One read at a time. A call arriving while one runs queues exactly one more
   * for afterwards — a resync outranking a sync — so a burst of triggers costs
   * two reads at most, never one each. It is handed the *running* read's
   * promise: settled means that read is over, not that the queued one is.
   */
  function coalesce(mode: 'sync' | 'resync', reason: string): Promise<void> {
    if (closed) return Promise.resolve()
    if (running) {
      again = again === 'resync' || mode === 'resync' ? 'resync' : 'sync'
      return running
    }
    running = observed(mode, reason).finally(() => {
      running = null
      const next = again
      again = null
      if (next) background(coalesce(next, 'queued'))
    })
    return running
  }

  /** {@link run}, reported to `onRead` whatever its outcome. */
  async function observed(mode: 'sync' | 'resync', reason: string) {
    const started = now()
    const channels = tracked().length
    const report = (read: Omit<ChannelStoreRead, 'reason' | 'mode' | 'channels' | 'ms'>) => {
      try {
        options.onRead?.({ reason, mode, channels, ms: now() - started, ...read })
      } catch {
        /* an observer's own problem */
      }
    }
    try {
      const requests = await run(mode, reason === 'track')
      if (requests > 0) report({ requests, outcome: 'ok' })
    } catch (error) {
      report({ requests: null, outcome: 'failed', error })
      throw error
    }
  }

  return api
}
