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
 *
 * ## Under the ceiling, always
 *
 * The whole-blob rule is also why the byte cap has to be here rather than at the
 * publish call (SHR-4). `/nip44/encrypt` refuses a plaintext over 65,535 bytes,
 * and because the blob is replaced or nothing is, one context too many stops
 * *every* later marker from advancing — not just that one. So `known` is held
 * inside the budget at every step, and what the cap has cost is on the
 * diagnostic rather than in a log line: `evicted.total`.
 */
import { type ReadStateBlob, MAX_CONTEXTS_BYTES, REPLY_FLOOR_CONTEXT, advanceContexts } from '@estiva-app/conversation'

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
  /**
   * The byte cap dropped markers this queue was holding (SHR-4).
   *
   * Called only for a real loss — a context that was in the map and is not any
   * more — never for a marker that arrived already too old to fit. The hook
   * exists so the loss can reach a surface a person reads; the same facts are on
   * {@link ReadStateQueue.diagnostic} for `window.__readState()`.
   */
  onEvict?: (evicted: readonly string[], bytes: number) => void
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
  /**
   * Everything this queue knows about itself, for `window.__readState()`.
   *
   * `pending` non-empty with a named `lastAttempt` is the smell — it means a
   * marker was recorded and has not reached the relay, and the outcome says
   * which gate stopped it. That is the fact no external probe can observe, and
   * it is what five bugs in this subsystem needed and nobody had.
   */
  diagnostic: () => ReadStateQueueDiagnostic
}

export type FlushOutcome =
  | 'nothing-pending'
  | 'unreachable'
  | 'unchanged'
  | 'published'
  | 'rejected'

export interface ReadStateQueueDiagnostic {
  known: Record<string, number>
  pending: Record<string, number>
  published: Record<string, number> | undefined
  hydrated: boolean
  lastAttempt: { at: number; outcome: FlushOutcome; contexts?: number } | undefined
  /**
   * What the next publish would cost against what it may spend (SHR-4).
   *
   * `bytes` is the serialized `contexts` map, not the whole plaintext: the
   * envelope is already taken out of `budgetBytes`. Both read 0 until the queue
   * has hydrated, which is the normal state before the first flush — `known` is
   * only what this tab has recorded until then, and is not the blob.
   */
  bytes: number
  budgetBytes: number
  /** Every eviction the cap has made this session. `total` 0 is the normal case. */
  evicted: { total: number; lastAt: number | undefined; lastKeys: string[] }
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
  let lastAttempt: ReadStateQueueDiagnostic['lastAttempt']
  const note = (outcome: FlushOutcome, contexts?: number) => {
    lastAttempt = { at: Date.now(), outcome, ...(contexts !== undefined ? { contexts } : {}) }
  }

  /** What the cap has cost this session, for the diagnostic and the panel. */
  let bytes = 0
  let evictedTotal = 0
  let lastEvictionAt: number | undefined
  let lastEvictedKeys: string[] = []

  /**
   * Advance through the cap, reporting only a loss that actually happened.
   *
   * `held` is what was believed before this call, and it is not always `current`:
   * hydration merges the relay's blob with what the tab has recorded, and either
   * side losing a context is a loss. A marker that arrives already older than
   * anything the budget has room for, by contrast, comes back in `evicted`
   * having never been held — reporting that as a loss would fire on every pass
   * of the re-anchor (CRO-6) rather than once. `record` reads the same
   * distinction to decide it has nothing to schedule.
   */
  function advance(
    current: Record<string, number>,
    updates: Record<string, number>,
    held: Record<string, number>,
  ): Record<string, number> {
    const result = advanceContexts(current, updates)
    bytes = result.bytes
    const lost = result.evicted.filter((key) => held[key] !== undefined)
    if (lost.length > 0) {
      evictedTotal += lost.length
      lastEvictionAt = Date.now()
      lastEvictedKeys = lost
      opts.onEvict?.(lost, result.bytes)
    }
    return result.contexts
  }

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
          // Both sides count as held: the relay's blob is this slot's history and
          // `known` is what the tab has recorded since load. A blob already over
          // budget — one written before SHR-4, or by a reader that never had the
          // cap — is trimmed here and heals on the next publish.
          // The tab's own reply floor goes in as `current`: `advanceContexts` refuses one among the updates (CON-34).
          const { [REPLY_FLOOR_CONTEXT]: floor, ...recorded } = known
          const held = floor === undefined ? contexts : { ...contexts, [REPLY_FLOOR_CONTEXT]: Math.max(floor, contexts[REPLY_FLOOR_CONTEXT] ?? 0) }
          known = advance(held, recorded, { ...contexts, ...known })
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
    const advanced = advance(known, { [contextId]: seconds }, known)
    // The advance drops what it will not publish, so an unchanged map means the
    // marker was invalid, not newer, or older than the byte budget has room for.
    // Either way there is nothing to schedule, and scheduling anyway would
    // republish an identical blob — which is what stops the re-anchor (CRO-6)
    // from re-offering an evicted context on every focus for the rest of the
    // session.
    if (advanced[contextId] === known[contextId]) return
    known = advanced
    pending = advanceContexts(pending, { [contextId]: seconds }).contexts
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
      if (Object.keys(pending).length === 0) return note('nothing-pending')
      await hydrate()
      /*
       * Hydration failed, so what the relay holds is unknown. Publishing now
       * would replace the coordinate with only what this session recorded and
       * drop every context written before it — the loss the whole-blob rule
       * exists to prevent, and one that is invisible until this is the last
       * slot standing. Keep the markers and try again on the next flush.
       */
      if (!hydrated) return note('unreachable')
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
      if (published && sameContexts(published, contexts)) return note('unchanged')
      const ok = await opts.publish(contexts)
      if (ok) {
        published = contexts
        note('published', Object.keys(contexts).length)
      } else {
        note('rejected')
        // Put them back, so a failed publish retries on the next marker or flush
        // rather than losing the markers it was carrying.
        pending = advanceContexts(pending, sending).contexts
      }
    })
    return inFlight
  }

  return {
    record,
    flush,
    snapshot: () => ({ ...known }),
    diagnostic: () => ({
      known: { ...known },
      pending: { ...pending },
      published: published ? { ...published } : undefined,
      hydrated,
      lastAttempt,
      bytes,
      budgetBytes: MAX_CONTEXTS_BYTES,
      evicted: { total: evictedTotal, lastAt: lastEvictionAt, lastKeys: [...lastEvictedKeys] },
    }),
    cancel: () => {
      if (timer !== undefined) {
        clearTimer(timer)
        timer = undefined
      }
    },
  }
}
