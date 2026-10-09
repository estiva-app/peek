/**
 * Every conversation this person has opened in the tab, held — so going back
 * to one draws at once and asks the relay only what changed (OPT-3).
 *
 * ## Why it exists
 *
 * A conversation's read is staged: the messages, then their replies by `#e`,
 * then what was done to each (edits, reactions, resolutions) by `#e` again —
 * about a dozen requests for a long topic, and the same dozen on every return,
 * behind a skeleton. Nothing changed in the seconds the person was elsewhere,
 * or one message did.
 *
 * ## The model
 *
 * The store holds, per conversation, the raw events its read was answered with
 * and the folded value the view draws. Three things follow:
 *
 * 1. **Draw what is held.** A return gets the folded value at once.
 * 2. **Fold again without the relay.** {@link ConversationStore.query} answers a
 *    NIP-01 filter from the held events, so the same read code that produced the
 *    value can run again over them once something new was merged — the fold is
 *    the read's own, never a second copy of it.
 * 3. **Catch up from a cursor.** What changed is asked `since` the start of the
 *    last read less a lookback — the channel store's rule (PER-8), for the same
 *    reason: Nostr has no sequence to resume from, and Buzz refuses an event
 *    dated more than its floor in the past, so the lookback covers anything that
 *    arrived after a read began.
 *
 * A deletion is applied when it is merged. `kind:5` names its targets by `e`;
 * one signed by a target's own author removes it here, as it does on the relay
 * (NIP-09). One signed by anybody else, and a NIP-29 admin's `kind:9005`, is reported back to the caller, which
 * asks the relay whether the target is still there — the relay is the judge of
 * who may delete what, not this file.
 *
 * ## Whose it is
 *
 * One store per relay and viewer, held by the app: another viewer in the same
 * tab gets a new one, so nothing one person could read is shown to the next.
 * At most {@link ConversationStoreOptions.capacity} conversations; the least
 * recently opened goes first.
 *
 * ## Written to leave (ADR 0002 §10)
 *
 * Like `channelStore` and `listingCache`: nothing here imports Peek, the clock
 * is a parameter, and what a conversation's value *is* belongs to the caller.
 */
import type { SignedEvent } from '@estiva-app/protocol'

/** NIP-01's filter, as far as this store answers it: ids, kinds, authors, `#x` tags, since, until, limit. */
export type ConversationFilter = Record<string, unknown>

/** What the read code asks with — the same shape as a relay query, answered here from what is held. */
export type ConversationQuery = (filters: ConversationFilter[]) => Promise<SignedEvent[]>

export interface ConversationStoreOptions {
  /** How many conversations are held; the least recently used goes first. */
  capacity?: number
  /** Subtracted from a cursor, in seconds — at least the relay's `created_at` floor plus clock skew. */
  lookbackSeconds: number
}

/** What merging events changed. */
export interface Merged {
  /** Events this conversation did not hold before. Empty: nothing changed. */
  added: SignedEvent[]
  /** Held events a deletion by somebody other than their author names: ask the relay whether they remain. */
  disputed: string[]
}

export interface ConversationStore<T> {
  /** What is held for `key` — the same object until it changes, so a view can take it as a snapshot. */
  value(key: string): T | undefined
  /** Unix seconds a catch-up asks `since`, or undefined when nothing is held. */
  since(key: string): number | undefined
  /** Every key held, least recently used first. */
  keys(): string[]
  /** `key` was opened: it is the last to be evicted. */
  touch(key: string): void
  /** Told when `key`'s value changes, and when it is dropped or evicted. */
  subscribe(key: string, listener: () => void): () => void
  /** A full read's answer: everything held for `key` is replaced. `startedAt` is when the read began, in ms. */
  replace(key: string, value: T, events: Iterable<SignedEvent>, startedAt: number): void
  /** Add what a catch-up found, and apply its deletions. Does not change the value: fold again, then {@link settle}. */
  merge(key: string, events: Iterable<SignedEvent>): Merged
  /** Drop held events by id — the disputed ones the relay no longer has. */
  forget(key: string, ids: Iterable<string>): void
  /**
   * A catch-up finished: the value it folded, if any, and the cursor moves to
   * when it began (ms). `null` draws the value and leaves the cursor, for a
   * catch-up that found something and then failed.
   */
  settle(key: string, startedAt: number | null, value?: T): void
  /**
   * Counts every change to what is held for `key` — a replace, a merge that
   * added something, a forget. A fold that began at one revision and ended at
   * another missed what changed meanwhile, and must not be settled (OPT-6:
   * your own message, merged while a catch-up folded, would vanish until the
   * next one).
   */
  revision(key: string): number
  /** The ids of every event held for `key` — what a catch-up asks `#e` about. */
  ids(key: string): string[]
  /** Answers filters from what is held for `key`, as the relay would have from the same events. */
  query(key: string): ConversationQuery
  drop(key: string): void
  clear(): void
}

interface Entry<T> {
  value: T
  since: number
  events: Map<string, SignedEvent>
  revision: number
}

const KIND_DELETION = 5
/** NIP-29's moderation delete, by a group admin: always the relay's to confirm. */
const KIND_ADMIN_DELETION = 9005

const isDeletion = (event: SignedEvent) => event.kind === KIND_DELETION || event.kind === KIND_ADMIN_DELETION

const byNewest = (a: SignedEvent, b: SignedEvent) => b.created_at - a.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** Whether `event` matches one NIP-01 filter. Tag filters match any value of that tag name. */
export function matchesFilter(event: SignedEvent, filter: ConversationFilter): boolean {
  for (const [field, wanted] of Object.entries(filter)) {
    if (field === 'limit') continue
    if (field === 'since') {
      if (event.created_at < (wanted as number)) return false
    } else if (field === 'until') {
      if (event.created_at > (wanted as number)) return false
    } else if (field === 'ids') {
      if (!(wanted as string[]).includes(event.id)) return false
    } else if (field === 'kinds') {
      if (!(wanted as number[]).includes(event.kind)) return false
    } else if (field === 'authors') {
      if (!(wanted as string[]).includes(event.pubkey)) return false
    } else if (field.startsWith('#') && field.length === 2) {
      const name = field.slice(1)
      const values = new Set(wanted as string[])
      if (!event.tags.some((tag) => tag[0] === name && values.has(tag[1]))) return false
    } else {
      // A field this store cannot judge (`search`, …) matches nothing, rather than everything.
      return false
    }
  }
  return true
}

export function createConversationStore<T>(options: ConversationStoreOptions): ConversationStore<T> {
  const capacity = options.capacity ?? 32
  const entries = new Map<string, Entry<T>>()
  const listeners = new Map<string, Set<() => void>>()

  const cursorAt = (startedAtMs: number) => Math.floor(startedAtMs / 1000) - options.lookbackSeconds

  const notify = (key: string) => {
    for (const listener of listeners.get(key) ?? []) {
      try {
        listener()
      } catch {
        /* a listener's own problem */
      }
    }
  }

  /**
   * Most recently used last, so the first key is the one to evict — unless
   * somebody is subscribed to it: a conversation on screen is never taken from
   * under its view, which would have nothing to read it again.
   */
  const touch = (key: string, entry: Entry<T>) => {
    entries.delete(key)
    entries.set(key, entry)
    for (const candidate of [...entries.keys()]) {
      if (entries.size <= capacity) break
      if (listeners.has(candidate)) continue
      entries.delete(candidate)
      notify(candidate)
    }
  }

  const store: ConversationStore<T> = {
    value(key) {
      return entries.get(key)?.value
    },

    since(key) {
      return entries.get(key)?.since
    },

    keys() {
      return [...entries.keys()]
    },

    touch(key) {
      const entry = entries.get(key)
      if (entry) touch(key, entry)
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

    replace(key, value, events, startedAt) {
      const held = new Map<string, SignedEvent>()
      for (const event of events) held.set(event.id, event)
      touch(key, { value, since: cursorAt(startedAt), events: held, revision: (entries.get(key)?.revision ?? 0) + 1 })
      notify(key)
    },

    merge(key, events) {
      const entry = entries.get(key)
      if (!entry) return { added: [], disputed: [] }
      const added: SignedEvent[] = []
      for (const event of events) {
        if (entry.events.has(event.id)) continue
        entry.events.set(event.id, event)
        added.push(event)
      }
      if (added.length === 0) return { added, disputed: [] }
      entry.revision += 1
      // A new deletion against what is held, and a held deletion against a new target: one that arrived before its target applies when the target does.
      const fresh = new Set(added.map((event) => event.id))
      const disputed = new Set<string>()
      for (const deletion of [...entry.events.values()].filter(isDeletion)) {
        for (const tag of deletion.tags) {
          if (tag[0] !== 'e' || !tag[1]) continue
          const target = entry.events.get(tag[1])
          if (!target || isDeletion(target)) continue
          if (!fresh.has(deletion.id) && !fresh.has(target.id)) continue
          if (target.pubkey === deletion.pubkey && deletion.kind === KIND_DELETION) entry.events.delete(target.id)
          else disputed.add(target.id)
        }
      }
      return { added, disputed: [...disputed] }
    },

    forget(key, ids) {
      const entry = entries.get(key)
      if (!entry) return
      for (const id of ids) if (entry.events.delete(id)) entry.revision += 1
    },

    settle(key, startedAt, value) {
      const entry = entries.get(key)
      if (!entry) return
      if (startedAt !== null) entry.since = cursorAt(startedAt)
      if (value === undefined) return
      entry.value = value
      notify(key)
    },

    revision(key) {
      return entries.get(key)?.revision ?? 0
    },

    ids(key) {
      const entry = entries.get(key)
      return entry ? [...entry.events.keys()] : []
    },

    query(key) {
      return async (filters) => {
        const entry = entries.get(key)
        if (!entry) return []
        const held = [...entry.events.values()]
        const answer = new Map<string, SignedEvent>()
        for (const filter of filters) {
          const matched = held.filter((event) => matchesFilter(event, filter)).sort(byNewest)
          const limit = typeof filter.limit === 'number' ? filter.limit : matched.length
          for (const event of matched.slice(0, limit)) answer.set(event.id, event)
        }
        return [...answer.values()]
      }
    },

    drop(key) {
      if (entries.delete(key)) notify(key)
    },

    clear() {
      const keys = [...entries.keys()]
      entries.clear()
      for (const key of keys) notify(key)
    },
  }
  return store
}
