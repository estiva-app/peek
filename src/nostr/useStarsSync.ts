/**
 * Keeping the person's starred set on the relay, where they own it (CRO-11).
 *
 * The set is theirs, so it lives on the relay as a SPEC §12 blob. The *rendering*
 * of a star — a topic's title and resolved state, a person's name and avatar —
 * is derived from workspace data, so it keeps coming from Convex. That split is
 * the layering working rather than a compromise: §12.1's layer 3 is legitimate
 * for an index, and resolving ids to titles is an index.
 *
 * So Convex stops being where the stars *are* and becomes how they *render*.
 *
 * ## What this deliberately does not do
 *
 * **It does not restore from the relay automatically.** {@link restoreFromRelay}
 * exists and is not called on load. Auto-restoring would resurrect stars a
 * person deliberately cleared whenever the blob were stale — and a blob goes
 * stale exactly when a publish failed, which is the case least likely to be
 * noticed. Wiring it to something the person asks for is a follow-up with its own
 * review; making it silent is the kind of decision that reads as data loss in
 * reverse.
 *
 * ## Publishing is best-effort, and says so out loud
 *
 * A failed publish never fails the user's action — the star still appears,
 * because Convex is written either way. But it is logged with the reason, which
 * is the rule `src/api/actions.ts` established after silence made a session that
 * published nothing indistinguishable from one that published everything.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { validToken } from '@/auth/estivaId'
import {
  type RelaySeam,
  type StarredPersonRef,
  type StarredTopicRef,
  type StarsBlob,
  fetchStars,
  publishStars,
  starsToPublish,
} from './stars'

export interface StarsSet {
  topics: StarredTopicRef[]
  people: StarredPersonRef[]
}

export interface StarsSync {
  /** What the relay holds, or undefined while unknown or unreachable. */
  relayBlob: StarsBlob | undefined
  /** False until the first read settles, so a caller can tell "none" from "not yet". */
  ready: boolean
  /** Publish a set if it differs from what the relay holds. Never throws. */
  publish: (set: StarsSet) => Promise<void>
  /**
   * The ids the relay holds that a caller has not got locally.
   *
   * Exposed rather than applied — see the note above on why restoring is not
   * automatic. A caller that wants to offer "restore my stars" has the list.
   */
  restoreFromRelay: (localTopicIds: string[], localPersonKeys: string[]) => StarsSet
}

function seamFrom(relayUrl: string | null | undefined): RelaySeam | null {
  if (!relayUrl) return null
  // Asked at call time, never cached: `validToken()` is null during every silent
  // renewal, and a snapshot taken at mount disables publishing for a whole page
  // load once it goes stale (PEEK-108).
  const token = validToken()
  if (!token) return null
  return { relayUrl, accessToken: token.accessToken, pubkey: token.pubkey }
}

export function useStarsSync(relayUrl: string | null | undefined): StarsSync {
  const [relayBlob, setRelayBlob] = useState<StarsBlob | undefined>(undefined)
  const [ready, setReady] = useState(false)
  /** Guards against two publishes racing on one coordinate from one tab. */
  const publishing = useRef(false)

  useEffect(() => {
    const seam = seamFrom(relayUrl)
    if (!seam) {
      // No relay or no session. Not an error and not "no stars" — `ready` stays
      // false so a caller does not render an empty set as authoritative.
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const blob = await fetchStars(seam)
        if (!cancelled) {
          setRelayBlob(blob)
          setReady(true)
        }
      } catch (error) {
        if (!cancelled) {
          console.warn('[stars] could not read the starred set from the relay:', error)
          setReady(true)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [relayUrl])

  const publish = useCallback(
    async (set: StarsSet) => {
      const seam = seamFrom(relayUrl)
      if (!seam) {
        console.warn('[stars] not published: no relay origin or no live Estiva ID token in this tab')
        return
      }
      if (publishing.current) return
      const next = starsToPublish(set, relayBlob, Date.now())
      // Unchanged set, nothing to say. This is what stops a re-render
      // republishing, and why the blob is serialized with sorted keys.
      if (!next) return
      publishing.current = true
      try {
        const result = await publishStars(next, seam)
        if (result.ok) {
          setRelayBlob(next)
        } else {
          console.warn('[stars] publish failed:', result.reason)
        }
      } catch (error) {
        console.warn('[stars] publish threw:', error)
      } finally {
        publishing.current = false
      }
    },
    [relayUrl, relayBlob],
  )

  const restoreFromRelay = useCallback(
    (localTopicIds: string[], localPersonKeys: string[]): StarsSet => {
      const haveTopic = new Set(localTopicIds)
      const havePerson = new Set(localPersonKeys)
      return {
        topics: (relayBlob?.topics ?? []).filter((t) => !haveTopic.has(t.id)),
        people: (relayBlob?.people ?? []).filter((p) => !havePerson.has(p.key)),
      }
    },
    [relayBlob],
  )

  return { relayBlob, ready, publish, restoreFromRelay }
}
