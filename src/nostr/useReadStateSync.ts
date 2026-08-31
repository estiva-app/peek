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
import { useEffect } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { validToken } from '@/auth/estivaId'
import { hasConvex } from '@/api/store'
import type { RelaySeam } from './stars'
import { containerContext, loadSlotIdentity, threadContext, toContextSeconds } from './readState'
import { fetchOwnSlot, publishReadState } from './readStateRelay'
import { createReadStateQueue, type ReadStateQueue } from './readStateQueue'

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

function ensureQueue(): ReadStateQueue {
  if (queue) return queue
  const { slotId, clientId } = loadSlotIdentity()
  queue = createReadStateQueue({
    hydrate: async () => {
      const current = seam()
      // No relay or no session: "could not find out", which the queue is careful
      // to keep distinct from "empty".
      if (!current) return undefined
      try {
        return await fetchOwnSlot(current, slotId)
      } catch (error) {
        console.warn('[read-state] could not read this slot back from the relay:', error)
        return undefined
      }
    },
    publish: async (contexts) => {
      const current = seam()
      if (!current) return false
      try {
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

/** Test seam: drop the tab's queue so a suite can build a fresh one. */
export function resetReadStateQueueForTests(): void {
  queue?.cancel()
  queue = undefined
  relayOrigin = null
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
export function ReadStateSync(): null {
  useReadStateSync()
  return null
}
