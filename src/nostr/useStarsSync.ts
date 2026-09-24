/**
 * Keeping the person's starred set on the relay, where they own it (CRO-11),
 * and reading it back from there (SHR-6).
 *
 * The set is theirs, so it lives on the relay as a SPEC §12 blob. The *rendering*
 * of a star — a topic's title and resolved state, a person's name and avatar —
 * is derived from workspace data, so it keeps coming from Convex. That split is
 * the layering working rather than a compromise: §12.1's layer 3 is legitimate
 * for an index, and resolving ids to titles is an index.
 *
 * So Convex stops being where the stars *are* and becomes how they *render*.
 * CRO-11 wrote the first half of that sentence and left Convex as the read;
 * SHR-6 made it true.
 *
 * ## `state` is the whole design
 *
 * Once the blob is the set, the only question that matters on load is whether
 * the relay has answered. {@link StarsSync.state} is that answer and nothing
 * else reads it out of the other fields:
 *
 * - `unknown` — not asked (no relay origin, no token in this tab yet) or asked
 *   and not answered. **Nothing may be published**, because there is no way to
 *   tell a set that is genuinely empty from one that has not arrived, and
 *   last-write-wins makes the wrong guess permanent.
 * - `absent` — answered, and holds no set this version can use. The caller
 *   starts from an empty set and publishes once the person toggles one.
 * - `present` — answered with a set. That set is the truth.
 *
 * Convex is in none of the three since REM-4: it neither seeds `absent` nor
 * stands in for `unknown`.
 *
 * ## Publishing is best-effort, and says so out loud
 *
 * A failed publish never fails the user's action — the star still appears *for
 * this session*, on the optimistic overlay. It does not survive a reload, which
 * reads the relay, and since REM-4 there is no Convex copy to recover it from.
 * It is logged with the reason, the rule `src/api/actions.ts` established after
 * silence made a session that published nothing indistinguishable from one that
 * published everything; that line is the only warning before a star reverts.
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

/** Whether the relay has answered what it holds, and what it said. */
export type StarsState = 'unknown' | 'absent' | 'present'

export interface StarsSync {
  /** The set the relay holds. Defined exactly when `state` is `present`. */
  relayBlob: StarsBlob | undefined
  /** See the `state` section above — this is what decides the read and the publish. */
  state: StarsState
  /** Publish a set if it differs from what the relay holds. Never throws. */
  publish: (set: StarsSet) => Promise<void>
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
  const [state, setState] = useState<StarsState>('unknown')
  /** Guards against two publishes racing on one coordinate from one tab. */
  const publishing = useRef(false)

  useEffect(() => {
    const seam = seamFrom(relayUrl)
    if (!seam) {
      // No relay or no session. Not an error and not "no stars" — `state` stays
      // `unknown` so a caller does not render an empty set as authoritative,
      // and nothing is published over a blob nobody has read.
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const read = await fetchStars(seam)
        if (cancelled) return
        if (read.state === 'present') {
          setRelayBlob(read.blob)
          setState('present')
        } else if (read.state === 'absent') {
          setState('absent')
        } else {
          // Every unreachable case stays `unknown` on purpose: a relay that did
          // not answer and one that has not been asked license exactly the same
          // thing, which is nothing.
          console.warn('[stars] the relay did not say what starred set it holds')
        }
      } catch (error) {
        if (!cancelled) {
          console.warn('[stars] could not read the starred set from the relay:', error)
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
      // The guard the read flip turns from a nicety into the load-bearing one.
      // `starsToPublish` compares against `relayBlob`, and an undefined one
      // means "publish whatever you were given" — which is right for a first
      // publish and catastrophic for a set assembled while the relay's answer
      // is still unknown. Checked here as well as at the caller, because this
      // is the only place that knows the answer has not arrived.
      if (state === 'unknown') {
        console.warn('[stars] not published: the relay has not said what set it holds')
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
          // A successful publish is also an answer about what the relay holds:
          // this. Without it a first publish would leave the coordinate
          // `absent` for the rest of the load.
          setState('present')
        } else {
          console.warn('[stars] publish failed:', result.reason)
        }
      } catch (error) {
        console.warn('[stars] publish threw:', error)
      } finally {
        publishing.current = false
      }
    },
    [relayUrl, relayBlob, state],
  )

  return { relayBlob, state, publish }
}
