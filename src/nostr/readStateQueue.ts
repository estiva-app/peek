/**
 * The debounce in front of read-state publishing (CRO-4).
 *
 * Kept apart from `readState.ts` because it is the half with the timing bugs,
 * and none of them need a relay to reproduce: hydration racing the first write,
 * a flush landing while a publish is already in flight, and markers arriving
 * during a publish being dropped by the write that was already on its way.
 *
 * ## Why a queue at all
 *
 * Opening five topics must not publish five events. `kind:30078` is
 * parameterized-replaceable so a rapid series would merely overwrite, but each
 * one costs a `/sign` and a `/nip44/encrypt` round trip against a budget of 120
 * operations per minute per app per person.
 *
 * ## Whole blob, always
 *
 * Every publish sends the complete context map, because the coordinate is
 * replaced rather than patched. That is why the queue hydrates from its own slot
 * before its first write and holds the full map in memory afterwards: a partial
 * blob does not fail, it silently drops every context it omitted.
 */
import type { ReadStateBlob } from './readState'
import { advanceContexts } from './readState'

/** Long enough to batch a burst of navigation, short enough to survive a tab close. */
export const READ_STATE_DEBOUNCE_MS = 3000

export interface ReadStateQueueOptions {
  /**
   * Read this slot's current state.
   *
   * `reachable: false` means "could not find out"; `reachable: true` with no
   * blob means the coordinate is genuinely empty, which is every installation's
   * first run and must not block the first publish.
   */
  hydrate: () => Promise<{ reachable: boolean; blob?: ReadStateBlob }>
  /** Publish the whole blob. Resolves `false` when the relay did not accept it. */
  publish: (contexts: Record<string, number>) => Promise<boolean>
  debounceMs?: number
  /** Injectable for tests; production passes nothing and gets real timers. */
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void
}

export interface ReadStateQueue {
  /** Record one read marker. Cheap, synchronous, and safe to call on every dwell. */
  record: (contextId: string, seconds: number) => void
  /** Publish now if anything is pending. Awaits the publish. */
  flush: () => Promise<void>
  /** Everything this queue believes, published or not. For tests and debugging. */
  snapshot: () => Record<string, number>
  /** Cancel the pending timer. Does not flush — see `dispose` in the hook. */
  cancel: () => void
}

export function createReadStateQueue(opts: ReadStateQueueOptions): ReadStateQueue {
  const debounceMs = opts.debounceMs ?? READ_STATE_DEBOUNCE_MS
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = opts.clearTimer ?? ((handle) => clearTimeout(handle))

  /** Everything known for this slot: hydrated + recorded. */
  let known: Record<string, number> = {}
  /** Recorded but not yet in an accepted publish. */
  let pending: Record<string, number> = {}
  /** What the relay is believed to hold: hydrated, then each accepted publish. */
  let published: Record<string, number> | undefined
  let hydrated = false
  let hydrating: Promise<void> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  /** Serializes publishes, so a flush during a publish queues behind it. */
  let inFlight: Promise<void> = Promise.resolve()

  async function hydrate(): Promise<void> {
    if (hydrated) return
    if (!hydrating) {
      hydrating = (async () => {
        const result = await opts.hydrate()
        // Unreachable is not empty. Staying unhydrated means the next attempt
        // tries again; treating it as empty would publish a blob that drops
        // every context recorded before this session. An empty *coordinate*, by
        // contrast, is the ordinary first run and hydrates to nothing.
        if (result.reachable) {
          const contexts = result.blob?.contexts ?? {}
          known = advanceContexts(contexts, known)
          published = contexts
          hydrated = true
        }
      })().finally(() => {
        hydrating = undefined
      })
    }
    await hydrating
  }

  const sameContexts = (a: Record<string, number>, b: Record<string, number>): boolean => {
    const keys = Object.keys(a)
    return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k])
  }

  function record(contextId: string, seconds: number): void {
    const advanced = advanceContexts(known, { [contextId]: seconds })
    // `advanceContexts` drops what it will not publish, so an unchanged map
    // means the marker was invalid or not newer. Either way there is nothing to
    // schedule, and scheduling anyway would republish an identical blob.
    if (advanced[contextId] === known[contextId]) return
    known = advanced
    pending = advanceContexts(pending, { [contextId]: seconds })
    schedule()
  }

  function schedule(): void {
    if (timer !== undefined) clearTimer(timer)
    timer = setTimer(() => {
      timer = undefined
      void flush()
    }, debounceMs)
  }

  function flush(): Promise<void> {
    if (timer !== undefined) {
      clearTimer(timer)
      timer = undefined
    }
    inFlight = inFlight.then(async () => {
      if (Object.keys(pending).length === 0) return
      await hydrate()
      /*
       * Hydration failed, so what the relay holds is unknown. Publishing now
       * would replace the coordinate with only what this session recorded and
       * drop every context written before it — the loss the whole-blob rule
       * exists to prevent, and one that is invisible until this is the last
       * slot standing. Keep the markers and try again on the next flush.
       */
      if (!hydrated) return
      // Snapshot before awaiting: markers recorded while the publish is in
      // flight belong to the *next* publish, and clearing `pending` afterwards
      // would swallow them.
      const sending = pending
      const contexts = { ...known }
      pending = {}
      /*
       * Hydration can supersede everything that was pending — a marker recorded
       * before the relay's own newer one is not a change. Republishing an
       * identical blob costs a `/sign` and a `/nip44/encrypt` against a
       * 120-per-minute budget and changes nothing.
       */
      if (published && sameContexts(published, contexts)) return
      const ok = await opts.publish(contexts)
      if (ok) {
        published = contexts
      } else {
        // Put them back, so a failed publish retries on the next marker or flush
        // rather than losing the markers it was carrying.
        pending = advanceContexts(pending, sending)
      }
    })
    return inFlight
  }

  return {
    record,
    flush,
    snapshot: () => ({ ...known }),
    cancel: () => {
      if (timer !== undefined) {
        clearTimer(timer)
        timer = undefined
      }
    },
  }
}
