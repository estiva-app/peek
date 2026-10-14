/**
 * The last answer to a keyed read, held past the component that asked (SID-2).
 *
 * ## Why it exists
 *
 * Peek's listings — the Folders, a Folder's contents, a file's resolve — lived
 * in component state. Collapsing a Folder and opening it again read it from
 * cold, and so did every page change, since each page mounts its own sidebar:
 * a skeleton over rows that had been right a second before, and a read for an
 * answer the tab already had.
 *
 * ## The model
 *
 * Stale-while-revalidate, with the relay's meter in mind (300 `POST /query` a
 * minute per pubkey, shared by every Estiva tab):
 *
 * 1. **Serve what is held.** A reader gets the last answer at once, however
 *    old; the read that brings a newer one is the caller's to start.
 * 2. **One read per key at a time.** A second reader of a key with a read in
 *    flight shares it, so the page and a section asking for the same Folder in
 *    one render pay once.
 * 3. **A fresh answer is not asked again.** {@link ListingCacheOptions.freshMs}
 *    after an answer, a {@link ListingCache.revalidate} is a no-op — the
 *    hand-over between two readers of one key within a click costs nothing.
 *    {@link ListingCache.read} always asks: it is the refresh triggers' and the
 *    socket's, which mean "something changed".
 * 4. **A failure after an answer keeps the answer** (FOL-40). The failure is
 *    worth reporting only when there is nothing else to show.
 *
 * ## Written to leave (ADR 0002 §10)
 *
 * Like `channelStore`: nothing here imports Peek, the clock is a parameter,
 * and what a failure *is* belongs to the caller.
 */

/** What a load answered: a value, or the caller's word for why not. */
export type ListingLoad<T, F> = { ok: true; value: T } | { ok: false; failure: F }

/**
 * One key's state. Replaced, never mutated, so it is a stable snapshot for
 * `useSyncExternalStore` between changes.
 */
export interface ListingEntry<T, F> {
  /** The last answer, if any read has succeeded. */
  value?: T
  /** Why the last read failed — only when there is no value to keep, or the value is a seed. */
  failure?: F
  /** When `value` or `failure` was set; 0 while the first read is in flight. */
  at: number
  /** The read in flight, shared by everyone who asks meanwhile. */
  inflight?: Promise<void>
  /** `value` is the copy on the device's, not yet the relay's (PEE-4). */
  seeded?: true
}

export interface ListingCacheOptions {
  /** How long an answer is fresh enough that a revalidate does not ask again. */
  freshMs?: number
  now?: () => number
}

export interface ListingCache<T, F> {
  peek(key: string): ListingEntry<T, F> | undefined
  /** Ask now, unless a read of this key is already in flight — then share it. */
  read(key: string, load: () => Promise<ListingLoad<T, F>>): Promise<void>
  /** Ask unless the held answer is fresh or a read is in flight. */
  revalidate(key: string, load: () => Promise<ListingLoad<T, F>>): Promise<void>
  subscribe(key: string, listener: () => void): () => void
  /**
   * Draw `value` until a read answers (PEE-4): the copy on the device's answer,
   * taken only while nothing is held. It is never fresh, so the next revalidate
   * asks; a read that fails after it keeps it, as after any answer.
   */
  seed(key: string, value: T): void
  /** Drop everything held — for a viewer who is no longer there, and for tests. */
  clear(): void
}

const every = new Set<ListingCache<unknown, unknown>>()

/** Empty every cache made here. Tests call it between cases. */
export function clearListingCaches(): void {
  for (const cache of every) cache.clear()
}

export function createListingCache<T, F>(options: ListingCacheOptions = {}): ListingCache<T, F> {
  const freshMs = options.freshMs ?? 5_000
  const now = options.now ?? Date.now
  const entries = new Map<string, ListingEntry<T, F>>()
  const listeners = new Map<string, Set<() => void>>()
  /* Bumped by `clear`, so a read that was in flight across it cannot write the
     old viewer's answer back. */
  let generation = 0

  const set = (key: string, entry: ListingEntry<T, F>) => {
    entries.set(key, entry)
    for (const listener of listeners.get(key) ?? []) listener()
  }

  const read: ListingCache<T, F>['read'] = (key, load) => {
    const held = entries.get(key)
    if (held?.inflight) return held.inflight
    const started = generation
    const inflight = load()
      .catch((error: unknown) => {
        // A load is meant to classify its own failures; one that throws is a bug, not an answer.
        console.warn('[listingCache] a load threw rather than answering:', error)
        return null
      })
      .then((answer) => {
        if (started !== generation) return
        const before = entries.get(key)
        if (answer?.ok) set(key, { value: answer.value, at: now() })
        // A seed is not an answer: the failure is kept beside it, for a reader that must not draw over a refusal.
        else if (before?.value !== undefined)
          set(key, { value: before.value, at: before.at, ...(before.seeded ? { seeded: true as const, failure: answer?.failure } : {}) })
        else set(key, { failure: answer?.failure, at: now() })
      })
    set(key, { ...held, at: held?.at ?? 0, inflight })
    return inflight
  }

  const cache: ListingCache<T, F> = {
    peek: (key) => entries.get(key),
    read,
    revalidate(key, load) {
      const held = entries.get(key)
      if (held?.inflight) return held.inflight
      if (held?.value !== undefined && !held.seeded && now() - held.at < freshMs) return Promise.resolve()
      return read(key, load)
    },
    seed(key, value) {
      const held = entries.get(key)
      if (held?.value !== undefined || held?.failure !== undefined) return
      set(key, { ...held, value, at: held?.at ?? 0, seeded: true })
    },
    subscribe(key, listener) {
      const set = listeners.get(key) ?? new Set()
      set.add(listener)
      listeners.set(key, set)
      return () => {
        set.delete(listener)
        if (set.size === 0) listeners.delete(key)
      }
    },
    clear() {
      generation += 1
      const keys = [...entries.keys()]
      entries.clear()
      for (const key of keys) for (const listener of listeners.get(key) ?? []) listener()
    },
  }
  every.add(cache as ListingCache<unknown, unknown>)
  return cache
}
