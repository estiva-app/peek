/**
 * The viewer's followed set, read from the relay and written back to it (FOL-30).
 *
 * `useStarsSync`'s shape minus seeding — there is no Convex copy of this set
 * and there must never be one — and with the toggle inside, because the only
 * writer is a toggle. A caller reads `followed` and `state`, and calls
 * `setFollowed(key, on)`.
 *
 * ## `state`
 *
 * - `unknown` — not asked (no relay origin, no token in this tab) or not yet
 *   answered. A gate on `followed` must judge nothing here: an empty set taken
 *   as authoritative would put out every dot in the sidebar until the relay
 *   answers, and then light them all at once.
 * - `absent` — the relay answered and holds no blob. Nothing is followed, and
 *   the first toggle writes the coordinate.
 * - `present` — the relay said what it holds.
 *
 * ## Writes are optimistic and serialized
 *
 * The local set moves the moment the person clicks, so the row's control and
 * its dot answer at once (the ticket: "a file you unfollow stops contributing
 * at once"); the publish follows, and a refused publish puts the key back.
 * Publishes are chained rather than dropped — two quick toggles are two
 * writes in order, the second carrying both — because a dropped toggle is a
 * control that lied. Last write wins on the relay (§12.3, as stars).
 *
 * A second device's change is reflected on the next load, the rule the
 * starred set lives by. `refresh()` is there for a caller that has a reason
 * to ask sooner.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { validToken } from '@/auth/estivaId'
import type { RelaySeam } from './stars'
import { type FollowsBlob, fetchFollows, followsToPublish, publishFollows } from './follows'

export type FollowsState = 'unknown' | 'absent' | 'present'

export interface FollowsSync {
  /** Followed keys — file addresses and Folder uuids. Empty until `state` leaves `unknown`. */
  followed: ReadonlySet<string>
  state: FollowsState
  /** Follow or unfollow one key: local at once, then published. Resolves when the relay has answered. */
  setFollowed: (key: string, on: boolean) => Promise<void>
  /** Re-read the relay's set, discarding nothing that is still being published. */
  refresh: () => Promise<void>
}

function seamFrom(relayUrl: string | null | undefined): RelaySeam | null {
  if (!relayUrl) return null
  // At call time, never cached: `validToken()` is null during every silent
  // renewal, and a snapshot taken at mount goes stale (PEEK-108).
  const token = validToken()
  if (!token) return null
  return { relayUrl, accessToken: token.accessToken, pubkey: token.pubkey }
}

/** What this tab last saw, for `window.__follows()`. Module scope, like `__readState`. */
let lastSnapshot: { state: FollowsState; keys: string[]; updatedAt?: string } = { state: 'unknown', keys: [] }

export function useFollowsSync(relayUrl: string | null | undefined): FollowsSync {
  const [followed, setFollowedSet] = useState<ReadonlySet<string>>(() => new Set())
  const [state, setState] = useState<FollowsState>('unknown')
  /** The relay's blob as last read or written; what a publish is diffed against. */
  const relayBlob = useRef<FollowsBlob | undefined>(undefined)
  /** The set this tab wants on the relay — the local set, read at publish time. */
  const wanted = useRef<Set<string>>(new Set())
  /** Publishes in flight, chained so none is dropped and none overtakes another. */
  const chain = useRef<Promise<void>>(Promise.resolve())
  /** A read that lands after a newer local change must not undo it. */
  const generation = useRef(0)

  const apply = useCallback((next: Set<string>, nextState: FollowsState, blob?: FollowsBlob) => {
    wanted.current = next
    setFollowedSet(new Set(next))
    setState(nextState)
    lastSnapshot = {
      state: nextState,
      keys: [...next].sort(),
      ...(blob ? { updatedAt: new Date(blob.updatedAt).toISOString() } : {}),
    }
  }, [])

  const read = useCallback(async (): Promise<void> => {
    const seam = seamFrom(relayUrl)
    if (!seam) return
    const mine = ++generation.current
    try {
      const result = await fetchFollows(seam)
      if (mine !== generation.current) return
      if (result.state === 'present') {
        relayBlob.current = result.blob
        apply(new Set(result.blob.keys), 'present', result.blob)
      } else if (result.state === 'absent') {
        relayBlob.current = undefined
        apply(new Set(), 'absent')
      } else {
        // Unreachable stays `unknown` on purpose: a relay that did not answer
        // and one that has not been asked license the same thing — nothing.
        console.warn('[follows] the relay did not say what followed set it holds')
      }
    } catch (error) {
      if (mine === generation.current) console.warn('[follows] could not read the followed set from the relay:', error)
    }
  }, [relayUrl, apply])

  useEffect(() => {
    void read()
  }, [read])

  const setFollowed = useCallback(
    async (key: string, on: boolean) => {
      const seam = seamFrom(relayUrl)
      if (!seam) {
        console.warn('[follows] not changed: no relay origin or no live Estiva ID token in this tab')
        return
      }
      // The load-bearing guard, as in stars: with the relay's answer unknown,
      // a publish would write this tab's guess over the person's real list.
      if (state === 'unknown') {
        console.warn('[follows] not changed: the relay has not said what set it holds')
        return
      }
      if (wanted.current.has(key) === on) return
      generation.current++
      const next = new Set(wanted.current)
      if (on) next.add(key)
      else next.delete(key)
      apply(next, state, relayBlob.current)

      const run = async () => {
        const blob = followsToPublish(wanted.current, relayBlob.current, Date.now())
        // Unchanged against the relay — an earlier write in the chain already
        // carried this toggle, or a toggle and its undo cancelled out.
        if (!blob) return
        try {
          const result = await publishFollows(blob, seam)
          if (result.ok) {
            relayBlob.current = blob
            apply(wanted.current, 'present', blob)
            return
          }
          console.warn('[follows] publish failed:', result.reason)
        } catch (error) {
          console.warn('[follows] publish threw:', error)
        }
        // Refused: the control said something the relay does not hold. Put it back.
        const reverted = new Set(wanted.current)
        if (on) reverted.delete(key)
        else reverted.add(key)
        apply(reverted, state, relayBlob.current)
      }
      chain.current = chain.current.then(run, run)
      await chain.current
    },
    [relayUrl, state, apply],
  )

  return { followed, state, setFollowed, refresh: read }
}

/**
 * `window.__follows()` — what this tab believes it follows (FOL-30's done-when:
 * the list reads back off the relay from a second device). Installed at module
 * scope from the api barrel, as `__readState` is, and not gated on a build
 * flag for the same reason: a diagnostic absent from production is never there
 * when it is needed.
 */
export function installFollowsDiagnostic(): void {
  if (typeof window === 'undefined') return
  ;(window as unknown as Record<string, unknown>).__follows = () => ({ ...lastSnapshot })
}
