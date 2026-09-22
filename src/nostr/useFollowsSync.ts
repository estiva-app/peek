/**
 * The viewer's followed set, read from the relay and written back to it (FOL-30).
 *
 * `useStarsSync`'s shape minus seeding — there is no Convex copy of this set
 * and there must never be one — and with the toggle inside, because the only
 * writer is a toggle. A caller reads `followed` and `state`, and calls
 * `setFollowed(key, on)`.
 *
 * ## Two reads, one set
 *
 * What a person follows is the union of what they *said* — the blob's `keys`
 * — and what the relay *implies*: the files they were named in, read by one
 * `#p` filter (`impliedFollows.ts`), less the blob's `muted`, the implied keys
 * they unfollowed. The blob is the person's; the implied set is recomputed on
 * every load and on the refresh triggers, so a mention that arrived while no
 * tab was open is a follow the moment one opens, on every device, with no
 * write.
 *
 * ## `state`
 *
 * - `unknown` — not asked (no relay origin, no token in this tab) or not yet
 *   answered. A gate on `followed` must judge nothing here: an empty set taken
 *   as authoritative would put out every dot in the sidebar until the relay
 *   answers, and then light them all at once. Both reads have to land: a blob
 *   without the implied set would draw a person's explicit follows lit and
 *   their mentions dark for a moment, which is a different wrong answer.
 * - `absent` — the relay answered and holds no blob. The implied set still
 *   counts; the first toggle writes the coordinate.
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
 * A follow adds the key and clears any mute; an unfollow removes the key and,
 * when the relay implies it, mutes it — otherwise the next load would follow
 * it again. Following an implied key writes it explicitly, so it outlives the
 * horizon the implied read is bounded by.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { validToken } from '@/auth/estivaId'
import { useRefreshTriggers } from '@/lib/useRefreshTriggers'
import type { RelaySeam } from './stars'
import { type FollowsBlob, fetchFollows, followsToPublish, publishFollows } from './follows'
import { fetchImpliedFollows } from './impliedFollows'

export type FollowsState = 'unknown' | 'absent' | 'present'

export interface FollowsSync {
  /** Followed keys — explicit and implied, less muted. Empty until `state` leaves `unknown`. */
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

/** The three lists a set is made of. */
interface Lists {
  keys: Set<string>
  muted: Set<string>
  implied: Set<string>
}

function union({ keys, muted, implied }: Lists): Set<string> {
  const out = new Set(keys)
  for (const key of implied) if (!muted.has(key)) out.add(key)
  return out
}

/** What this tab last saw, for `window.__follows()`. Module scope, like `__readState`. */
let lastSnapshot: { state: FollowsState; keys: string[]; muted: string[]; implied: string[]; updatedAt?: string } = {
  state: 'unknown',
  keys: [],
  muted: [],
  implied: [],
}

export function useFollowsSync(relayUrl: string | null | undefined): FollowsSync {
  const [followed, setFollowedSet] = useState<ReadonlySet<string>>(() => new Set())
  const [state, setState] = useState<FollowsState>('unknown')
  /** The relay's blob as last read or written; what a publish is diffed against. */
  const relayBlob = useRef<FollowsBlob | undefined>(undefined)
  /** What this tab wants: the blob's two lists as they should be on the relay, and the implied set as last read. */
  const lists = useRef<Lists>({ keys: new Set(), muted: new Set(), implied: new Set() })
  /** Whether each read has answered at least once — `state` leaves `unknown` only when both have. */
  const landed = useRef({ blob: false, implied: false })
  /** Publishes in flight, chained so none is dropped and none overtakes another. */
  const chain = useRef<Promise<void>>(Promise.resolve())
  /** A read that lands after a newer local change must not undo it. */
  const generation = useRef(0)

  const apply = useCallback((next: Partial<Lists>, nextState: FollowsState, blob?: FollowsBlob) => {
    lists.current = { ...lists.current, ...next }
    setFollowedSet(union(lists.current))
    setState(nextState)
    lastSnapshot = {
      state: nextState,
      keys: [...lists.current.keys].sort(),
      muted: [...lists.current.muted].sort(),
      implied: [...lists.current.implied].sort(),
      ...(blob ? { updatedAt: new Date(blob.updatedAt).toISOString() } : {}),
    }
  }, [])

  /** The state both reads together license: `unknown` until both have answered. */
  const blobState = useRef<FollowsState>('unknown')
  const settled = () => (landed.current.blob && landed.current.implied ? blobState.current : 'unknown')

  const read = useCallback(async (): Promise<void> => {
    const seam = seamFrom(relayUrl)
    if (!seam) return
    const mine = ++generation.current
    const [blob, implied] = await Promise.all([
      fetchFollows(seam).catch((error: unknown) => {
        console.warn('[follows] could not read the followed set from the relay:', error)
        return undefined
      }),
      fetchImpliedFollows(seam).catch((error: unknown) => {
        console.warn('[follows] could not read what the relay implies:', error)
        return undefined
      }),
    ])
    if (mine !== generation.current) return
    const next: Partial<Lists> = {}
    if (blob?.state === 'present') {
      relayBlob.current = blob.blob
      blobState.current = 'present'
      landed.current.blob = true
      next.keys = new Set(blob.blob.keys)
      next.muted = new Set(blob.blob.muted)
    } else if (blob?.state === 'absent') {
      relayBlob.current = undefined
      blobState.current = 'absent'
      landed.current.blob = true
      next.keys = new Set()
      next.muted = new Set()
    } else {
      // Unreachable stays as it was on purpose: a relay that did not answer
      // and one that has not been asked license the same thing — nothing.
      console.warn('[follows] the relay did not say what followed set it holds')
    }
    if (implied) {
      landed.current.implied = true
      next.implied = implied
    }
    apply(next, settled(), relayBlob.current)
  }, [relayUrl, apply])

  useEffect(() => {
    void read()
  }, [read])

  // The implied half changes under the person — a mention lands, an issue is
  // assigned — so it is re-read on the same triggers the listings use. The
  // blob is re-read with it; both are one POST each.
  useRefreshTriggers(() => void read(), { enabled: !!relayUrl })

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
      const before = { keys: new Set(lists.current.keys), muted: new Set(lists.current.muted) }
      if (union(lists.current).has(key) === on) return
      generation.current++
      const keys = new Set(before.keys)
      const muted = new Set(before.muted)
      if (on) {
        keys.add(key)
        muted.delete(key)
      } else {
        keys.delete(key)
        if (lists.current.implied.has(key)) muted.add(key)
      }
      apply({ keys, muted }, state, relayBlob.current)

      const run = async () => {
        const blob = followsToPublish(lists.current, relayBlob.current, Date.now())
        // Unchanged against the relay — an earlier write in the chain already
        // carried this toggle, or a toggle and its undo cancelled out.
        if (!blob) return
        try {
          const result = await publishFollows(blob, seam)
          if (result.ok) {
            relayBlob.current = blob
            blobState.current = 'present'
            apply({}, 'present', blob)
            return
          }
          console.warn('[follows] publish failed:', result.reason)
        } catch (error) {
          console.warn('[follows] publish threw:', error)
        }
        // Refused: the control said something the relay does not hold. Undo
        // this toggle alone — a later one in the chain is its own write.
        const reverted = { keys: new Set(lists.current.keys), muted: new Set(lists.current.muted) }
        if (on) {
          reverted.keys.delete(key)
          if (before.muted.has(key)) reverted.muted.add(key)
        } else {
          if (before.keys.has(key)) reverted.keys.add(key)
          if (!before.muted.has(key)) reverted.muted.delete(key)
        }
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
 * the list reads back off the relay from a second device). `keys` and `muted`
 * are the blob; `implied` is what the relay named this person in. Installed at
 * module scope from the api barrel, as `__readState` is, and not gated on a
 * build flag for the same reason: a diagnostic absent from production is never
 * there when it is needed.
 */
export function installFollowsDiagnostic(): void {
  if (typeof window === 'undefined') return
  ;(window as unknown as Record<string, unknown>).__follows = () => ({ ...lastSnapshot })
}
