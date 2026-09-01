/**
 * Live relay events into the existing Convex projection (PEE-7).
 *
 * The last missing link. PEEK-106 already split credential from projection:
 * `convex/nostr/sync.ts` exposes `importChannel`, `importReactions` and
 * `importResolutions` as actions taking **events, not tokens**, and the HTTP
 * path in `src/nostr/sync.ts` feeds exactly those. This feeds the same three
 * from the socket instead of from a query, and Convex's reactivity does the
 * rest — once a row lands, every open view updates with no further work.
 *
 * So there is deliberately almost no new logic here, and none of it is
 * projection logic. The projection is intricate, belongs next to the database,
 * and is covered by `interop/projection.test.ts`. This module batches,
 * partitions by kind, and calls three actions in a fixed order.
 *
 * ## Two keys, and they must not be confused
 *
 * A subscription is keyed by **channel uuid** — that is what Buzz scopes a REQ
 * by, and RFC 0.3 asks that a topic id never become a subscription key. The
 * import actions are keyed by **topicKey**, the client-facing topic id. Both are
 * required and they are not interchangeable, so {@link LiveProjection.watch}
 * takes both rather than looking either one up: the caller (PEE-8's
 * `useTopicView`) already holds both, and a lookup here would put a Convex
 * query in the middle of an event handler.
 *
 * ## Messages are kinds 9 **and** 1111
 *
 * This is the omission that would have broken it on day one. Ship's comments
 * moved to NIP-22 `kind:1111` with REW-10, and a Ship comment is posted into
 * the project's Folder, which *is* this topic's channel. Routing only `kind:9`
 * to `importChannel` would make every Ship comment vanish from live delivery —
 * no error, no empty state, just a conversation that stops updating. The HTTP
 * path already asks for both and says so at length; this matches it.
 *
 * Not theoretical: the first live events observed on this socket during PEE-6's
 * two-channel check were `kind:1111`, not `kind:9`.
 *
 * ## The order is load-bearing, and so is calling `importChannel` first
 *
 * Messages, then reactions and deletions, then assertions. A reaction or an
 * assertion whose target arrived in the same batch has nothing to attach to
 * until the messages are in.
 *
 * `importChannel` runs on **every** flush, even one carrying no messages,
 * because `known` and `deletable` come out of it and a reaction needs them.
 * That is safe: `syncTopic` guards on `incoming.length > 0`, and the three
 * lookups it returns run regardless.
 *
 * `known` and `deletable` are threaded straight through. They are the ids Peek
 * *already holds*, computed after the import — never the events just delivered.
 * Once the relay has a kind:5 for an event it stops returning that event, so a
 * deleted one is absent from every read and asking about the delivered ids could
 * never find its own deletion.
 *
 * ## What this does not do
 *
 * **No profiles.** `importChannel` takes them, and the HTTP path fetches
 * `kind:0` for each author alongside the messages. `kind:0` is not
 * channel-scoped, so a `#h` subscription never delivers one and there is
 * nothing to pass. A first-time author therefore appears under a placeholder
 * until `pubkeysMissingProfile`/`recordProfiles` fills it in — which is exactly
 * the gap PEEK-72 built that pair to close, and it runs on its own schedule.
 *
 * **No deduplication and no cursor arithmetic.** Live and backfill overlap by
 * design; imports are idempotent by event id and `nostrSyncedAt` only ever moves
 * forward. Adding either would be fixing something that is not broken.
 *
 * **No reordering.** `created_at` is in seconds and several events routinely
 * share one, so a sort on it is not a total order and a duplicate timestamp is
 * not a duplicate event. Arrival order is preserved and the projection does its
 * own threading from the `e` tags.
 */
import { KIND, type SignedEvent } from '@estiva-app/protocol'
import type { ChannelSubscriptions } from '@estiva-app/protocol'

/** The window a burst is coalesced into, in milliseconds. */
export const FLUSH_WINDOW_MS = 250

export interface LiveProjectionApi {
  importChannel(args: {
    topicKey: string
    events: SignedEvent[]
    profiles: SignedEvent[]
  }): Promise<{ ok: boolean; known?: string[]; deletable?: string[]; reason?: string }>
  importReactions(args: {
    topicKey: string
    reactions: SignedEvent[]
    deletions: SignedEvent[]
    known: string[]
    deletable: string[]
  }): Promise<{ ok: boolean; reason?: string }>
  importResolutions(args: {
    topicKey: string
    assertions: SignedEvent[]
  }): Promise<{ ok: boolean; imported?: number; reason?: string }>
}

export interface WatchHandle {
  /** Idempotent. Releases the subscription; a pending batch is dropped. */
  stop(): void
}

export interface LiveProjection {
  /**
   * Project everything arriving in `channelUuid` into the topic `topicKey`.
   *
   * Both keys are required and neither substitutes for the other — see the
   * header.
   */
  watch(args: { topicKey: string; channelUuid: string }): WatchHandle
  /** Flush any pending batch now. Test seam, and useful on unmount. */
  flushNow(): Promise<void>
  stopAll(): void
}

interface Batch {
  topicKey: string
  events: SignedEvent[]
  timer: unknown
}

export function createLiveProjection(options: {
  subscriptions: Pick<ChannelSubscriptions, 'subscribe'>
  api: LiveProjectionApi
  flushWindowMs?: number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  log?: (message: string, detail?: Record<string, unknown>) => void
  /**
   * Called with the channel uuid when events arrive that this does not project
   * — another app's records. Injected rather than reached for, so a test needs
   * no module state (ADR 0002 §10 constraint 2).
   */
  onForeignActivity?: (channelUuid: string) => void
}): LiveProjection {
  const {
    subscriptions,
    api,
    flushWindowMs = FLUSH_WINDOW_MS,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    log = () => {},
    onForeignActivity = () => {},
  } = options

  /** Keyed by channel uuid, which is what a subscription delivers under. */
  const batches = new Map<string, Batch>()
  const releases = new Map<string, () => void>()
  /** One flush at a time per channel: two in flight would interleave known/deletable. */
  const inFlight = new Map<string, Promise<void>>()

  function partition(events: SignedEvent[]) {
    const messages: SignedEvent[] = []
    const reactions: SignedEvent[] = []
    const deletions: SignedEvent[] = []
    const assertions: SignedEvent[] = []
    const unprojected: SignedEvent[] = []
    for (const event of events) {
      switch (event.kind) {
        // Both, permanently — see the header.
        case KIND.STREAM_MESSAGE:
        case KIND.COMMENT:
          messages.push(event)
          break
        case KIND.REACTION:
          reactions.push(event)
          break
        case KIND.DELETION:
          deletions.push(event)
          break
        case KIND.ASSERTION:
          assertions.push(event)
          break
        default:
          // A kindless subscription delivers everything in the channel, so
          // unknown kinds are expected rather than exceptional. Dropping them
          // here is what keeps a new relay kind from reaching the projection as
          // a malformed message.
          //
          // Dropped from the *projection*, and now reported: these are another
          // app's records, and something on screen may be rendering them
          // straight off the relay. Peek does not store them and should not —
          // the useful signal is "re-read now" rather than the event itself,
          // which is also what keeps this correct for a kind nobody has
          // invented yet.
          unprojected.push(event)
          log('ignoring an unprojected kind', { kind: event.kind })
      }
    }
    return { messages, reactions, deletions, assertions, unprojected }
  }

  async function runFlush(channelUuid: string, topicKey: string, events: SignedEvent[]) {
    const { messages, reactions, deletions, assertions, unprojected } = partition(events)

    /*
      Reported before the early return, and that placement is the whole point.

      A batch containing *only* another app's records — a Ship issue moved, and
      nothing said in the conversation — has no messages, no reactions, no
      deletions and no assertions, so it takes the return below. Notifying after
      it would mean the panel updates when somebody happens to speak and not
      when the thing it renders actually changes, which is the precise case this
      exists for.
    */
    if (unprojected.length > 0) onForeignActivity(channelUuid)

    if (
      messages.length === 0 &&
      reactions.length === 0 &&
      deletions.length === 0 &&
      assertions.length === 0
    ) {
      return
    }

    try {
      // Always first, even with no messages: `known` and `deletable` come from
      // here and the reactions below need them.
      const imported = await api.importChannel({ topicKey, events: messages, profiles: [] })
      if (!imported.ok) {
        log('importChannel failed', { reason: imported.reason })
        return
      }

      if (reactions.length > 0 || deletions.length > 0) {
        const result = await api.importReactions({
          topicKey,
          reactions,
          deletions,
          known: imported.known ?? [],
          deletable: imported.deletable ?? [],
        })
        if (!result.ok) log('importReactions failed', { reason: result.reason })
      }

      // Last: an assertion whose target arrived in this same batch has nothing
      // to attach to until the messages are in.
      if (assertions.length > 0) {
        const result = await api.importResolutions({ topicKey, assertions })
        if (!result.ok) log('importResolutions failed', { reason: result.reason })
      }
    } catch (error) {
      // Swallowed on purpose. A relay or a Convex blip must leave the app
      // working off the rows it already has, exactly as before.
      log('projecting a live batch failed', { reason: (error as Error).message })
    }
  }

  function flush(channelUuid: string): Promise<void> {
    const batch = batches.get(channelUuid)
    if (!batch) return Promise.resolve()
    if (batch.timer !== null) {
      clearTimer(batch.timer)
      batch.timer = null
    }
    const events = batch.events
    // Nothing new — but a previous flush may still be running, and `flushNow`
    // promising "flushed" while a call is in flight is exactly the kind of lie
    // that makes a test pass and an unmount lose the last batch.
    if (events.length === 0) return inFlight.get(channelUuid) ?? Promise.resolve()
    // Take the buffer before awaiting, so events arriving during the flush
    // collect for the next one rather than being lost or double-sent.
    batch.events = []

    const previous = inFlight.get(channelUuid) ?? Promise.resolve()
    const next = previous
      .catch(() => {})
      .then(() => runFlush(channelUuid, batch.topicKey, events))
      .finally(() => {
        if (inFlight.get(channelUuid) === next) inFlight.delete(channelUuid)
      })
    inFlight.set(channelUuid, next)
    return next
  }

  return {
    watch({ topicKey, channelUuid }) {
      const subscription = subscriptions.subscribe(channelUuid, (event) => {
        let batch = batches.get(channelUuid)
        if (!batch) {
          batch = { topicKey, events: [], timer: null }
          batches.set(channelUuid, batch)
        }
        batch.events.push(event)
        // A fixed window from the *first* event of a burst, not a trailing
        // debounce. A trailing one would keep resetting on a busy channel and
        // could starve indefinitely; this bounds latency at one window while
        // still collapsing a burst into one call per kind group.
        if (batch.timer === null) {
          batch.timer = setTimer(() => {
            const current = batches.get(channelUuid)
            if (current) current.timer = null
            void flush(channelUuid)
          }, flushWindowMs)
        }
      })

      let stopped = false
      releases.set(channelUuid, () => subscription.release())
      return {
        stop() {
          if (stopped) return
          stopped = true
          subscription.release()
          releases.delete(channelUuid)
          const batch = batches.get(channelUuid)
          if (batch?.timer != null) clearTimer(batch.timer)
          batches.delete(channelUuid)
        },
      }
    },

    async flushNow() {
      await Promise.all([...batches.keys()].map((channelUuid) => flush(channelUuid)))
    },

    stopAll() {
      for (const batch of batches.values()) if (batch.timer != null) clearTimer(batch.timer)
      for (const release of releases.values()) release()
      batches.clear()
      releases.clear()
    },
  }
}
