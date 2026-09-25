/**
 * Read state: the NIP-RS blob, written and read here (CRO-4, CRO-5).
 *
 * **The blob is the only store** (REM-5). Convex's `readState` table was a
 * mirror, then a horizon cache the merge was written back into and re-anchored
 * from, then one side of a dual-run diff; all three are gone. A failed publish
 * is a warning rather than a failed action, as for every other relay write.
 *
 * ## One queue per tab, deliberately module-level
 *
 * NIP-RS is one blob per **installation**, so there is exactly one slot and
 * exactly one queue for the whole tab, no matter how many components mark
 * something read. A per-component queue would hold a partial context map each,
 * and since the blob is a replaceable snapshot they would take turns
 * overwriting one another's contexts — the whole-blob rule violated by
 * construction rather than by a bug.
 *
 * ## What cannot be published yet, and why that is silence rather than a gap
 *
 * A context id has to be a protocol identity (SPEC §11.1), and Peek's own keys
 * are not:
 *
 *   - a **topic** contributes its channel uuid, which exists once the topic has
 *     been published to the relay;
 *   - a **DM** contributes its channel uuid too (DMS-8), the one the relay
 *     answered `kind:41010` with and its `39000` names (REM-3) —
 *     bare, like a topic's, never the Convex id and never with a prefix (the
 *     blob is grow-only, so a prefixed variant would be a second permanent key
 *     for the same conversation). Until the relay has answered, the DM has no
 *     context and nothing is recorded;
 *   - a **thread** contributes its root's event id, which for relay-synced
 *     messages is the Peek message key itself (`convex/nostr/data.ts` writes
 *     `seedKey: nostrEventId` on import);
 *   - a **huddle** contributes nothing: it is not a channel, and SPEC §11.5
 *     standardises no huddle context and reserves nothing for one.
 *
 * Anything without one is skipped rather than published under a Peek-private
 * id, because the blob is grow-only and a bad identifier in it is permanent.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { validToken } from '@/auth/estivaId'
import type { RelaySeam } from './stars'
import {
  containerContext,
  fileContext,
  loadSlotIdentity,
  rotateSlotId,
  serializeReadStateBlob,
  threadContext,
  toContextSeconds,
  type SlotIdentity,
} from './readState'
import { MAX_PLAINTEXT_BYTES } from './appData'
import { fetchOwnSlot, loadMergedReadState, publishReadState } from './readStateRelay'
import { createReadStateQueue, type ReadStateQueue } from './readStateQueue'
import { useRefreshTriggers } from '@/lib/useRefreshTriggers'
import { RELAY_URL } from '@/api/relayUrl'

/** The last merge over every slot this person owns (CRO-5). */
let previousRelayMerge: Record<string, number> | undefined

/*
 * The frontier as this tab knows it, which every unread dot is judged from
 * (FOL-16, REM-5): the last merge over every slot, advanced by whatever this
 * tab has recorded since, so a conversation just read goes quiet without
 * waiting for the next fetch. One module-level store, bumped
 * where the merge lands and where a marker is recorded, so a page can subscribe
 * without running a second relay fetch of its own — `ReadStateSync` is the one
 * place the merge happens, and relay reads are metered.
 */
let frontierVersion = 0
let frontierCache: { version: number; contexts: Record<string, number> } | undefined
const frontierListeners = new Set<() => void>()
function frontierChanged(): void {
  frontierVersion += 1
  for (const listener of frontierListeners) listener()
}
function subscribeFrontier(listener: () => void): () => void {
  frontierListeners.add(listener)
  return () => frontierListeners.delete(listener)
}
function frontierVersionNow(): number {
  return frontierVersion
}
/** The merge, advanced by this tab's own records — max of the two, never lower. */
function frontierContexts(): Record<string, number> {
  if (frontierCache?.version === frontierVersion) return frontierCache.contexts
  const contexts: Record<string, number> = { ...(previousRelayMerge ?? {}) }
  for (const [context, at] of Object.entries(queue?.snapshot() ?? {})) {
    if (contexts[context] === undefined || at > contexts[context]) contexts[context] = at
  }
  frontierCache = { version: frontierVersion, contexts }
  return contexts
}

/** What a surface reading the relay frontier gets (FOL-16). */
export interface ReadFrontier {
  /** One context's marker in unix seconds, or `undefined` for absent. */
  marker: (context: string | undefined) => number | undefined
  /** False until the first merge has landed — absent-because-unfetched is not absent. */
  ready: boolean
}

/**
 * The person's read frontier, merged across every installation and advanced by
 * this tab, for judging unread where Convex has no watermark to offer.
 *
 * Re-renders when the merge lands or a marker is recorded; nothing here fetches.
 */
export function useReadFrontier(): ReadFrontier {
  const version = useSyncExternalStore(subscribeFrontier, frontierVersionNow, frontierVersionNow)
  return useMemo(() => {
    const contexts = frontierContexts()
    return {
      marker: (context: string | undefined) => (context ? contexts[context] : undefined),
      ready: previousRelayMerge !== undefined,
    }
    // `version` is what the store hands out; the contexts are read behind it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version])
}

/** What a blob holding these contexts would hand `/nip44/encrypt`, in bytes. */
function blobBytes(clientId: string, contexts: Record<string, number>): number {
  return new TextEncoder().encode(serializeReadStateBlob({ v: 1, client_id: clientId, contexts }))
    .length
}

/** How close read state is to the ceiling, and what the cap has already cost. */
export interface ReadStateSize {
  /** Contexts in the merged frontier — every installation's, not just this one's. */
  contexts: number
  /**
   * The merged frontier serialized as a blob.
   *
   * An upper bound on what any one slot publishes rather than the slot itself,
   * and the number SHR-3 measured on production (24,379 bytes, 37.2 %). It is
   * the right one to watch: a slot grows toward it as the person keeps reading.
   */
  bytes: number
  /** `bytes` against the 65,535-byte plaintext ceiling, to one decimal place. */
  pctOfCeiling: number
  ceilingBytes: number
  /** This slot's own contexts map, once the queue has hydrated. */
  slotBytes: number | undefined
  /** Markers the byte cap has dropped this session. Non-zero means read state was lost. */
  evicted: number
}

/**
 * Read state's size, for the panel that has to make an eviction visible (SHR-4).
 *
 * Re-renders on the same store as {@link useReadFrontier} — the merge landing, a
 * marker being recorded, and an eviction, which `ensureQueue` bumps it for.
 * Nothing here fetches or measures the relay; it reads what the last merge left.
 */
export function useReadStateSize(): ReadStateSize {
  const version = useSyncExternalStore(subscribeFrontier, frontierVersionNow, frontierVersionNow)
  return useMemo(() => {
    const contexts = previousRelayMerge ?? {}
    const bytes = blobBytes(currentIdentity().clientId, contexts)
    const q = queue?.diagnostic()
    return {
      contexts: Object.keys(contexts).length,
      bytes,
      pctOfCeiling: Math.round((bytes / MAX_PLAINTEXT_BYTES) * 1000) / 10,
      ceilingBytes: MAX_PLAINTEXT_BYTES,
      slotBytes: q?.hydrated ? q.bytes : undefined,
      evicted: q?.evicted.total ?? 0,
    }
    // Read behind the version the store hands out, exactly as `useReadFrontier`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version])
}

/** Facts the diagnostic reports that live outside the queue. */
let readPathRuns = 0
let lastMergeAt: number | undefined

/** Set by the hook, read at call time. Null disables publishing entirely. */
let relayOrigin: string | null = null
let queue: ReadStateQueue | undefined

function seam(): RelaySeam | null {
  if (!relayOrigin) return null
  // Asked at call time, never cached: `validToken()` is null during every silent
  // renewal, and a snapshot taken at mount disables publishing for a whole page
  // load once it goes stale (PEEK-108).
  const token = validToken()
  if (!token) return null
  return { relayUrl: relayOrigin, accessToken: token.accessToken, pubkey: token.pubkey }
}

/** This installation's slot. Replaced only by a coordinate conflict (CRO-5). */
let identity: SlotIdentity | undefined
function currentIdentity(): SlotIdentity {
  if (!identity) identity = loadSlotIdentity()
  return identity
}

function ensureQueue(): ReadStateQueue {
  if (queue) return queue
  queue = createReadStateQueue({
    hydrate: async () => {
      const current = seam()
      // No relay or no session: "could not find out", which the queue is careful
      // to keep distinct from "the coordinate is empty".
      if (!current) return { reachable: false }
      try {
        return await fetchOwnSlot(current, currentIdentity().slotId)
      } catch (error) {
        console.warn('[read-state] could not read this slot back from the relay:', error)
        return { reachable: false }
      }
    },
    publish: async (contexts) => {
      const current = seam()
      if (!current) return false
      try {
        const { slotId, clientId } = currentIdentity()
        const result = await publishReadState({ v: 1, client_id: clientId, contexts }, slotId, current)
        if (!result.ok) {
          console.warn('[read-state] publish rejected:', result.reason)
        }
        return result.ok
      } catch (error) {
        console.warn('[read-state] publish failed:', error)
        return false
      }
    },
    /*
     * An eviction is a loss of read state, so it goes somewhere a person looks
     * rather than into the console (SHR-4). Bumping the frontier store is what
     * re-renders the "Read state" panel in the account menu, which reads the
     * count through `useReadStateSize`; `window.__readState().queue.evicted`
     * carries the same facts with the keys attached.
     */
    onEvict: () => frontierChanged(),
  })
  return queue
}

/** Test seam: drop the tab's queue so a suite can build a fresh one. */
export function resetReadStateQueueForTests(): void {
  queue?.cancel()
  queue = undefined
  identity = undefined
  relayOrigin = null
  previousRelayMerge = undefined
  readPathRuns = 0
  lastMergeAt = undefined
  frontierCache = undefined
  frontierChanged()
}

/**
 * Keep the tab's queue fed with a relay origin, and flush it before the tab goes
 * away.
 *
 * Mounted once, high in the tree. `visibilitychange` rather than `beforeunload`:
 * it is the only one mobile browsers reliably fire when a tab is backgrounded or
 * killed, and a debounce that only ever fires on a timer loses the last few
 * markers of every session.
 */
export function useReadStateSync(): void {
  // A build-time value since REM-2 (`@/api/relayUrl`), so read state reaches
  // the relay with Convex unreachable.
  const relayUrl = RELAY_URL

  useEffect(() => {
    relayOrigin = relayUrl ?? null
  }, [relayUrl])


  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') void ensureQueue().flush()
    }
    document.addEventListener('visibilitychange', onHidden)
    return () => document.removeEventListener('visibilitychange', onHidden)
  }, [])
}

/**
 * Record that a container was read, at `atMs`.
 *
 * `channelUuid` is the topic's Folder id or the DM's channel uuid. Anything
 * that is not a uuid — a Peek topic id, a DM's partner key, `undefined` — is
 * dropped by {@link containerContext} rather than published.
 */
export function recordContainerRead(channelUuid: string | null | undefined, atMs: number): void {
  const context = containerContext(channelUuid)
  if (!context) return
  ensureQueue().record(context, toContextSeconds(atMs))
  frontierChanged()
}

/**
 * Record that a file's conversation was read, at `atMs` (SPEC §11.1, FOL-16).
 *
 * `address` is the file's `<kind>:<pubkey>:<d>`, the `a` its comments carry.
 * **This must never advance the container either** (§11.2): a person reading
 * one issue's talk has not read the team's general chat, nor the sibling
 * issue's — and the channel's marker does not reach a file's stream in the
 * other direction (§11.3). Same shape as {@link recordThreadRead}: there is
 * simply no path from here to the container context.
 */
export function recordFileRead(address: string | null | undefined, atMs: number): void {
  const context = fileContext(address)
  if (!context) return
  ensureQueue().record(context, toContextSeconds(atMs))
  frontierChanged()
}

/**
 * Record that a thread was read, at `atMs`.
 *
 * **This must never advance the container** (SPEC §11.2). Advancing it when
 * somebody reads one reply silently marks every later top-level message read —
 * invisible while a container holds one topic, and four topics lost the moment
 * one holds five. The rule is enforced in `advanceContexts`; this function
 * simply has no path to the container context.
 */
export function recordThreadRead(rootEventId: string | null | undefined, atMs: number): void {
  const context = threadContext(rootEventId)
  if (!context) return
  ensureQueue().record(context, toContextSeconds(atMs))
  frontierChanged()
}

/** Publish anything pending now. Exposed for tests and for the tab-hidden flush. */
export function flushReadState(): Promise<void> {
  return ensureQueue().flush()
}

/**
 * Mount once, high in the tree, alongside the other null-rendering syncs.
 *
 * A component rather than a bare hook call so `PeekDataProvider` reads as a
 * list of what is kept in sync, which is the shape `MentionDirectorySync` and
 * `TopicDirectorySync` already established.
 */
export function ReadStateSync(): null {
  useReadStateSync()
  /*
   * **Run the read path.** Without this line nothing on it executes.
   *
   * `useMergedReadState` was written by CRO-5 and mounted by none of the three
   * tickets after it, so publishing worked while the merge every dot is judged
   * from silently never ran. `window.__readState().hasRun` says whether it has.
   *
   * There is no re-anchor any more (REM-5). CRO-6 re-published markers from
   * Convex that the 90-day horizon had dropped, but the horizon filters slot
   * *events*, not contexts: a live installation republishes its whole slot on
   * every read, and a slot old enough to fall outside it holds markers older
   * than every message the fold still judges (`PEEK_HORIZON_DAYS`), so losing
   * them changes no dot. What a slot can genuinely lose is SHR-4's eviction,
   * which the Read state panel shows.
   */
  const { refresh } = useMergedReadState()
  useEffect(() => {
    void refresh()
  }, [refresh])
  // Focus, visibility and a slow interval — the same triggers every other
  // background read in this app uses, for the same reasons.
  useRefreshTriggers(() => void refresh())
  return null
}

/** What the merged read state looks like to a caller (CRO-5). */
export interface MergedReadStateView {
  /** context id → unix seconds, maximum across every slot this person owns. */
  merged: Record<string, number>
  /** False until the first fetch settles, so "none" is distinguishable from "not yet". */
  ready: boolean
  /** Fetch and merge again. Idempotent — safe to call as often as you like. */
  refresh: () => Promise<void>
  /**
   * Other coordinates carrying our own `client_id`.
   *
   * SPEC §11 *SHOULDs* deleting these with NIP-09, and this deliberately does
   * not do it automatically. Deleting somebody's read state on a heuristic is
   * the kind of silent destructive action `useStarsSync` declined for restore,
   * and the realistic cause — a key rotation or a restore — is also the case
   * where the duplicate still holds markers nothing else has. They are merged,
   * so nothing is lost by leaving them; they are surfaced so a deliberate
   * cleanup can be built with its own review.
   */
  staleDuplicates: string[]
}

/**
 * The person's read frontier, merged across every installation (CRO-5).
 *
 * This is the half that makes read state follow the person: Peek's slot and
 * Ship's slot are different coordinates, and the frontier is the maximum over
 * both. Every unread dot is judged from it, through {@link useReadFrontier}.
 */
export function useMergedReadState(): MergedReadStateView {
  const [merged, setMerged] = useState<Record<string, number>>({})
  const [ready, setReady] = useState(false)
  const [staleDuplicates, setStaleDuplicates] = useState<string[]>([])

  const refresh = useCallback(async () => {
    const current = seam()
    // No relay or no session. Not an error and not "nothing read" — `ready`
    // stays false so a caller does not treat an empty frontier as authoritative.
    if (!current) return
    try {
      const state = await loadMergedReadState(current, currentIdentity())
      if (!state) return
      setMerged(state.merged)
      readPathRuns += 1
      lastMergeAt = Date.now()
      setStaleDuplicates(state.verdict.staleDuplicates.map((s) => s.dTag))
      /*
       * Our coordinate holds another installation's `client_id`. Publishing to
       * it would overwrite them on every write and them overwrite us on every
       * one of theirs, invisibly. Rotate before the next publish; the markers
       * already recorded are unaffected, since the queue holds them in memory
       * and re-hydrates against the new slot.
       */
      if (state.verdict.coordinateConflicted) {
        console.warn('[read-state] our slot coordinate belongs to another installation; rotating')
        identity = rotateSlotId(currentIdentity())
      }
      previousRelayMerge = state.merged
      frontierChanged()

      setReady(true)
    } catch (error) {
      console.warn('[read-state] could not merge read state from the relay:', error)
    }
  }, [])

  return { merged, ready, refresh, staleDuplicates }
}

// ---------------------------------------------------------------------------
// The diagnostic
// ---------------------------------------------------------------------------

/**
 * `window.__readState()` — what this tab believes about read state (CRO-14).
 *
 * Ship has the same (ship#72). Peek needed it more: five separate times this
 * subsystem was correct and did not run, and none of it was visible to a unit
 * suite because every case lived in the seam between the code and whatever was
 * supposed to invoke it.
 *
 * **`hasRun` is the field that matters.** `useMergedReadState` was written by
 * CRO-5, given a cache to fill by CRO-6 and a diff by CRO-7, and mounted by none
 * of them — three green tickets over a dead path. One command answering "the
 * merge has never executed this session" would have caught it the first time
 * anybody looked.
 *
 * ```
 * __readState()                    the queue, the blob's size, and whether it has run
 * __readState.flush()              publish now instead of waiting on the debounce
 * __readState.marker('<context>')  one context's merged value, as a date
 * ```
 *
 * **`blobBytes` is the other field that matters, and it is not a count.** The
 * blob is grow-only and the binding limit is `/nip44/encrypt` refusing
 * plaintext over `MAX_PLAINTEXT_BYTES`, not `MAX_CONTEXTS` — which sits 8–13×
 * beyond it at Peek's key shapes. Since SHR-4 the blob cannot get there: the
 * queue holds its context map inside `MAX_CONTEXTS_BYTES` and drops the oldest
 * markers to do it, and what that has cost is `queue.evicted` here and a line in
 * the "Read state" panel in the account menu. `blobBytes` measures the **merged**
 * frontier, which is the upper bound every slot grows toward; `queue.bytes` is
 * this slot's own, and reads 0 until the queue has hydrated.
 *
 * `relayContexts` cannot stand in for it: the four context kinds differ by more
 * than 2× in cost — a bare uuid container ~50 bytes, a `thread:`/`msg:` key
 * ~82–85, and a **file address ~107**, which is why `keySplit` reports them
 * separately rather than giving one total.
 *
 * Read-only apart from `flush()`, which does only what the debounce would.
 */
/**
 * Counts of the four context kinds `readState.ts` constructs, plus anything
 * that matches none of them — which is a defect, not a category.
 */
export interface ReadStateKeySplit {
  /** Bare channel uuid (`containerContext`). */
  container: number
  /** Bare `<kind>:<pubkey>:<d>` address (`fileContext`) — the most expensive. */
  file: number
  thread: number
  msg: number
  other: number
}

const UUID_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const ADDRESS_KEY = /^\d+:[0-9a-f]{64}:/

export function splitReadStateKeys(contexts: Record<string, number>): ReadStateKeySplit {
  const split: ReadStateKeySplit = { container: 0, file: 0, thread: 0, msg: 0, other: 0 }
  for (const key of Object.keys(contexts)) {
    if (key.startsWith('thread:')) split.thread += 1
    else if (key.startsWith('msg:')) split.msg += 1
    else if (UUID_KEY.test(key)) split.container += 1
    else if (ADDRESS_KEY.test(key)) split.file += 1
    else split.other += 1
  }
  return split
}

export interface PeekReadStateDiagnostic {
  slot: string
  clientId: string
  /** False means nothing on the read path has executed — the CRO-97 failure. */
  hasRun: boolean
  mergeRuns: number
  lastMergeAt: string | undefined
  /** Contexts in the merged frontier. */
  relayContexts: number
  /**
   * The merged frontier serialized exactly as it would be published — what
   * `/nip44/encrypt` would be handed, in bytes — and that as a percentage of
   * the limit it refuses above. Not an estimate from `relayContexts`.
   */
  blobBytes: number
  blobPctOfCeiling: number
  /** The frontier's keys by kind, because they differ by more than 2× in cost. */
  keySplit: ReadStateKeySplit
  queue: ReturnType<ReadStateQueue['diagnostic']> | 'queue not created yet'
}

function snapshot(): PeekReadStateDiagnostic {
  const id = currentIdentity()
  const contexts = previousRelayMerge ?? {}
  const bytes = blobBytes(id.clientId, contexts)
  return {
    slot: `read-state:${id.slotId}`,
    clientId: id.clientId,
    hasRun: readPathRuns > 0,
    mergeRuns: readPathRuns,
    lastMergeAt: lastMergeAt === undefined ? undefined : new Date(lastMergeAt).toISOString(),
    relayContexts: Object.keys(contexts).length,
    blobBytes: bytes,
    blobPctOfCeiling: Math.round((bytes / MAX_PLAINTEXT_BYTES) * 1000) / 10,
    keySplit: splitReadStateKeys(contexts),
    queue: queue ? queue.diagnostic() : 'queue not created yet',
  }
}

/**
 * Attach it. Called at module scope from the api barrel, so it is present before
 * anything asks — including on a page opened straight from a URL.
 *
 * Not gated on a build flag, for the reason ship#72 gives: a diagnostic that is
 * absent from production is one that is never there when it is needed.
 */
export function installReadStateDiagnostic(): void {
  if (typeof window === 'undefined') return
  const fn = () => snapshot()
  fn.flush = async () => {
    await flushReadState()
    return snapshot().queue
  }
  fn.marker = (context: string) => {
    const at = previousRelayMerge?.[context]
    return at === undefined ? 'absent' : `${at}  ${new Date(at * 1000).toISOString()}`
  }
  ;(window as unknown as Record<string, unknown>).__readState = fn
}
