/**
 * Wiring read markers to the relay (CRO-4).
 *
 * Peek's `readState` table stays exactly where it is. This is a mirror
 * alongside it, on the same terms `src/api/actions.ts` set for every other
 * relay write: the Convex row is the user's action succeeding, and a failed
 * publish is a warning rather than a failed action. Reading *from* the relay
 * and merging every slot is CRO-5; nothing here consumes what it writes.
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
 *   - a **thread** contributes its root's event id, which for relay-synced
 *     messages is the Peek message key itself (`convex/nostr/data.ts` writes
 *     `seedKey: nostrEventId` on import);
 *   - **DMs and huddles contribute nothing.** A DM lives only in Convex until
 *     the DMs-on-Nostr work lands, and a huddle is not a channel. SPEC §11.5
 *     standardises no huddle context and reserves nothing for one.
 *
 * Anything without one is skipped rather than published under a Peek-private
 * id, because the blob is grow-only and a bad identifier in it is permanent.
 */
import { useCallback, useEffect, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { validToken } from '@/auth/estivaId'
import { hasConvex } from '@/api/store'
import type { RelaySeam } from './stars'
import {
  containerContext,
  loadSlotIdentity,
  rotateSlotId,
  threadContext,
  toContextSeconds,
  type SlotIdentity,
} from './readState'
import { fetchOwnSlot, loadMergedReadState, publishReadState } from './readStateRelay'
import { createReadStateQueue, type ReadStateQueue } from './readStateQueue'
import { buildDiffReport } from './readStateDiff'
import { useDebug } from '@/lib/debug'
import { useRefreshTriggers } from '@/lib/useRefreshTriggers'

/**
 * The previous merge, kept so a *regression* between fetches is detectable
 * (CRO-7). The merge takes a maximum, so its output can only grow — a value
 * going down is a bug in the merge, not in the data, and it is the one class
 * that blocks the cutover.
 */
let previousRelayMerge: Record<string, number> | undefined

/** Facts the diagnostic reports that live outside the queue. */
let readPathRuns = 0
let lastMergeAt: number | undefined
let lastCacheSize: number | undefined
let lastDiffSummary: { benign: number; unpublished: number; regressed: number } | undefined

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
  })
  return queue
}

/**
 * Which cached markers are worth re-anchoring onto the relay (CRO-6).
 *
 * Only the ones the relay does not already hold at least as recently. Anything
 * it has is not "forgotten by the horizon" — it is simply there, and
 * republishing it puts a context into **this installation's** slot that this
 * installation never read.
 *
 * That distinction was missing, and check 3 found it: a second browser profile
 * came up with a slot holding 67 contexts, identical to the first, because
 * Convex is per *deployment* and not per device — so every new Peek install read
 * the shared cache and republished the whole thing as its own. Nothing is lost
 * that way (the merge is a maximum) but every slot grows toward the 32,768-byte
 * plaintext limit together, and `client_id` stops meaning "the installation that
 * read this". Ship had the same shape by a different route, fixed in ship#62.
 */
export function reanchorable(
  cached: readonly { context: string; atSeconds: number }[],
  onRelay: Readonly<Record<string, number>>,
): { context: string; atSeconds: number }[] {
  return cached.filter(({ context, atSeconds }) => {
    const have = onRelay[context]
    return have === undefined || have < atSeconds
  })
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
  lastCacheSize = undefined
  lastDiffSummary = undefined
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
  // A query rather than a build-time variable, so the bundle and the backend
  // cannot disagree about where the relay is (convex/nostr/config.ts).
  const relayUrl = useQuery(api.nostr.config.relayConfig, hasConvex ? {} : 'skip')?.relayUrl

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
 * `channelUuid` is the topic's Folder id. Anything that is not a uuid — a Peek
 * topic id, a DM key, `undefined` — is dropped by {@link containerContext}
 * rather than published.
 */
export function recordContainerRead(channelUuid: string | null | undefined, atMs: number): void {
  const context = containerContext(channelUuid)
  if (!context) return
  ensureQueue().record(context, toContextSeconds(atMs))
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
/**
 * Re-anchor what the horizon has genuinely dropped, and nothing else.
 *
 * Lives here rather than in `useReadStateSync` because the decision needs the
 * merged frontier, which is this component's to read. Gated on `ready` so the
 * first pass does not compare against an empty merge and conclude the relay has
 * forgotten everything.
 */
function useCacheReanchor(merged: Record<string, number>, ready: boolean): void {
  const cached = useQuery(api.readState.cachedReadContexts, hasConvex ? {} : 'skip')
  useEffect(() => {
    if (!ready || !cached?.length) return
    const queue = ensureQueue()
    for (const { context, atSeconds } of reanchorable(cached, merged)) {
      queue.record(context, atSeconds)
    }
  }, [cached, merged, ready])
}

export function ReadStateSync(): null {
  useReadStateSync()
  /*
   * **Run the read path.** Without this line nothing on it executes.
   *
   * `useMergedReadState` was written by CRO-5, given a cache to fill by CRO-6
   * and a dual-run diff by CRO-7, and never mounted by any of them — each ticket
   * ended "nothing consumes it yet, that is the next one", and the next one
   * added to it rather than turning it on. So publishing worked, and every
   * consequence of reading — the merge, the horizon cache, the comparison the
   * cutover is gated on — silently did nothing.
   *
   * Nothing renders from it yet; that is still the cutover's job. What changes
   * here is that the cache gets filled and the diff gets data.
   */
  const { merged, ready, refresh } = useMergedReadState()
  useEffect(() => {
    void refresh()
  }, [refresh])
  // Focus, visibility and a slow interval — the same triggers every other
  // background read in this app uses, for the same reasons.
  useRefreshTriggers(() => void refresh())
  useCacheReanchor(merged, ready)
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
 * both. Nothing in Peek's unread indicators consumes it yet — dual-running it
 * against Convex and cutting over is CRO-7, and cutting over before CRO-6's
 * horizon cache exists would regress unread for every quiet conversation.
 */
export function useMergedReadState(): MergedReadStateView {
  const [merged, setMerged] = useState<Record<string, number>>({})
  const [ready, setReady] = useState(false)
  const [staleDuplicates, setStaleDuplicates] = useState<string[]>([])
  const applyToCache = useMutation(api.readState.applyRelayReadState)
  const { state: debug, setReadStateDiff } = useDebug()
  const dualRun = debug.readState.dualRun
  /*
   * The Convex side, as protocol contexts — the same query CRO-6 uses to
   * re-anchor aged-out markers, read here as side A of the comparison. The UI
   * still renders from A; this change computes B and records the difference,
   * and nothing switches until CRO-7 step 2.
   */
  const localContexts = useQuery(api.readState.cachedReadContexts, hasConvex ? {} : 'skip')

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
       * Into the horizon cache (CRO-6). Max only, on the Convex side, so this
       * cannot lower anything — and a context the relay has since forgotten
       * keeps the value cached here instead of reverting to unread.
       */
      const contexts = Object.entries(state.merged).map(([context, atSeconds]) => ({ context, atSeconds }))
      if (contexts.length > 0) {
        try {
          await applyToCache({ contexts })
        } catch (error) {
          // The relay half succeeded; the cache is an optimisation on top of it.
          console.warn('[read-state] could not write the merged state into the cache:', error)
        }
      }
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
      /*
       * Dual-run (CRO-7 step 1). Compared *before* the merge is written into
       * the cache above would be wrong — the write is what makes them agree —
       * so this reads the local side as it was when this refresh started.
       */
      if (dualRun && localContexts) {
        const local: Record<string, number> = {}
        for (const { context, atSeconds } of localContexts) local[context] = atSeconds
        const report = buildDiffReport({
          local,
          relay: state.merged,
          previousRelay: previousRelayMerge,
          nowMs: Date.now(),
        })
        lastCacheSize = Object.keys(local).length
        lastDiffSummary = {
          benign: report.divergences.filter((d) => d.kind !== 'local-ahead-persistent').length,
          unpublished: report.divergences.filter((d) => d.kind === 'local-ahead-persistent').length,
          regressed: report.regressions.length,
        }
        setReadStateDiff(report)
      }
      previousRelayMerge = state.merged

      setReady(true)
    } catch (error) {
      console.warn('[read-state] could not merge read state from the relay:', error)
    }
  }, [applyToCache, dualRun, localContexts, setReadStateDiff])

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
 * __readState()                    the queue, the cache, the diff, and whether it has run
 * __readState.flush()              publish now instead of waiting on the debounce
 * __readState.marker('<context>')  one context's merged value, as a date
 * ```
 *
 * Read-only apart from `flush()`, which does only what the debounce would.
 */
export interface PeekReadStateDiagnostic {
  slot: string
  clientId: string
  /** False means nothing on the read path has executed — the CRO-97 failure. */
  hasRun: boolean
  mergeRuns: number
  lastMergeAt: string | undefined
  /** Contexts in the merged frontier, and in Convex's horizon cache. */
  relayContexts: number
  cacheContexts: number | undefined
  /** The dual-run, without needing the debug menu. */
  diff: typeof lastDiffSummary
  queue: ReturnType<ReadStateQueue['diagnostic']> | 'queue not created yet'
}

function snapshot(): PeekReadStateDiagnostic {
  const id = currentIdentity()
  return {
    slot: `read-state:${id.slotId}`,
    clientId: id.clientId,
    hasRun: readPathRuns > 0,
    mergeRuns: readPathRuns,
    lastMergeAt: lastMergeAt === undefined ? undefined : new Date(lastMergeAt).toISOString(),
    relayContexts: Object.keys(previousRelayMerge ?? {}).length,
    cacheContexts: lastCacheSize,
    diff: lastDiffSummary,
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
