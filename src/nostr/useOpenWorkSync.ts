/**
 * Keeping the person's open work on the relay, where they own it, and reading it
 * back from there (SHR-9).
 *
 * `useStarsSync`'s shape, one table over, and for the same reason: the *list* is
 * theirs, so it lives on the relay as a SPEC §12 blob; the *rendering* of a row
 * — a topic's title and resolved state, a partner's name and avatar — is derived
 * from workspace data and keeps coming from Convex. §12.1's layer 3 is
 * legitimate for an index, and resolving ids to titles is an index.
 *
 * ## `state` is the whole design
 *
 * Once the blob is the list, the only question that matters on load is whether
 * the relay has answered. {@link OpenWorkSync.state} is that answer and nothing
 * else reads it out of the other fields:
 *
 * - `unknown` — not asked (no relay origin, no token in this tab yet) or asked
 *   and not answered. **Nothing may be published**, because there is no way to
 *   tell a list that is genuinely empty from one that has not arrived, and
 *   last-write-wins makes the wrong guess permanent.
 * - `absent` — answered, and holds no list this version can use. The caller
 *   seeds it from Convex, which still carries every row.
 * - `present` — answered with a list. That list is the truth, in that order, and
 *   Convex is out of the path.
 *
 * ## What this deliberately does not do
 *
 * **It does not restore automatically, in either direction.** A person's open
 * work being *dropped* is what the `absent` seed covers. A row Convex has and
 * the relay does not — a publish that failed — is deliberately not healed here:
 * silently republishing from a source that is no longer the truth would
 * resurrect something cleared on another device.
 *
 * ## Publishing is best-effort, and says so out loud
 *
 * A failed publish never fails the person's action; the row still appears for
 * this session on the optimistic overlay, because the Convex mutation is written
 * either way. It no longer survives a reload, though, because the reload reads
 * the relay — so the log line is the only warning before a row quietly reverts.
 * That is `src/api/actions.ts`'s rule, established after silence made a session
 * that published nothing indistinguishable from one that published everything.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { validToken } from '@/auth/estivaId'
import {
  type OpenWorkBlob,
  type OpenWorkRef,
  type RelaySeam,
  fetchOpenWork,
  openWorkToPublish,
  publishOpenWork,
} from './openWork'

/** Whether the relay has answered what it holds, and what it said. */
export type OpenWorkState = 'unknown' | 'absent' | 'present'

export interface OpenWorkSync {
  /** The list the relay holds. Defined exactly when `state` is `present`. */
  relayBlob: OpenWorkBlob | undefined
  /** See the `state` section above — this is what decides the read and the publish. */
  state: OpenWorkState
  /** Publish a list if it differs from what the relay holds. Never throws. */
  publish: (entries: OpenWorkRef[]) => Promise<void>
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

export function useOpenWorkSync(relayUrl: string | null | undefined): OpenWorkSync {
  const [relayBlob, setRelayBlob] = useState<OpenWorkBlob | undefined>(undefined)
  const [state, setState] = useState<OpenWorkState>('unknown')
  /** Guards against two publishes racing on one coordinate from one tab. */
  const publishing = useRef(false)

  useEffect(() => {
    const seam = seamFrom(relayUrl)
    if (!seam) {
      // No relay or no session. Not an error and not "no open work" — `state`
      // stays `unknown` so a caller does not render an empty list as
      // authoritative, and nothing is published over a blob nobody has read.
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const read = await fetchOpenWork(seam)
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
          console.warn('[open-work] the relay did not say what open work it holds')
        }
      } catch (error) {
        if (!cancelled) {
          console.warn('[open-work] could not read open work from the relay:', error)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [relayUrl])

  const publish = useCallback(
    async (entries: OpenWorkRef[]) => {
      const seam = seamFrom(relayUrl)
      if (!seam) {
        console.warn('[open-work] not published: no relay origin or no live Estiva ID token in this tab')
        return
      }
      // The load-bearing guard. `openWorkToPublish` compares against
      // `relayBlob`, and an undefined one means "publish whatever you were
      // given" — right for a first publish and catastrophic for a list
      // assembled while the relay's answer is still unknown. Checked here as
      // well as at the caller, because this is the only place that knows the
      // answer has not arrived.
      if (state === 'unknown') {
        console.warn('[open-work] not published: the relay has not said what list it holds')
        return
      }
      if (publishing.current) return
      const next = openWorkToPublish(entries, relayBlob, Date.now())
      // Unchanged list, nothing to say. This is what stops a re-render
      // republishing.
      if (!next) return
      publishing.current = true
      try {
        const result = await publishOpenWork(next, seam)
        if (result.ok) {
          setRelayBlob(next)
          // A successful publish is also an answer about what the relay holds:
          // this. Without it a seeded coordinate would stay `absent` for the
          // rest of the load and the caller would keep reading Convex.
          setState('present')
        } else {
          console.warn('[open-work] publish failed:', result.reason)
        }
      } catch (error) {
        console.warn('[open-work] publish threw:', error)
      } finally {
        publishing.current = false
      }
    },
    [relayUrl, relayBlob, state],
  )

  return { relayBlob, state, publish }
}
