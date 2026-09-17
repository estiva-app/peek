/**
 * Keeping the two Screener decisions on the relay, and reading them back (SHR-10).
 *
 * `useOpenWorkSync`'s shape, one blob over. What differs is what `unknown`
 * costs, and it is worth stating because it is the reason this hook exists
 * rather than the provider calling `fetchScreener` itself.
 *
 * ## `state` decides the render here, not just the publish
 *
 * For open work, `unknown` meant "do not publish": the list itself came from
 * Convex in the meantime and the person saw something correct. Here the blob is
 * *subtractive* — it says which rows to take away — so rendering before it
 * arrives shows rows the person has already dismissed or snoozed. Worse, the
 * obvious reaction to a row that should not be there is to dismiss it, and that
 * writes a watermark the person did not mean. So the Screener stays under its
 * loading state until `state !== 'unknown'`, and `DeskPage` reads that through
 * `useDeskLoading`.
 *
 * - `unknown` — not asked (no relay origin, no token in this tab yet) or asked
 *   and not answered. **Nothing may be published and nothing may be rendered.**
 * - `absent` — answered, and holds nothing this version can read. The caller
 *   seeds it from the Convex rows that still carry every snooze, and a person
 *   with no decisions yet simply publishes their first one.
 * - `present` — answered. Those two maps are the truth.
 *
 * ## The publish is best-effort and says so out loud
 *
 * A failed publish never fails the person's action — the row still leaves the
 * list for this session on the optimistic overlay. It does not survive a reload
 * though, so the log line is the only warning before a dismissed row comes back.
 * `src/api/actions.ts`'s rule, and the reason an eviction is logged too: a
 * dropped snooze is a promise the app made and then broke, and the person has
 * no other way to find out.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { validToken } from '@/auth/estivaId'
import type { RelaySeam } from './openWork'
import { type InstantMap, type ScreenerBlob, fetchScreener, publishScreener, screenerToPublish } from './screener'

/** Whether the relay has answered what decisions it holds, and what it said. */
export type ScreenerState = 'unknown' | 'absent' | 'present'

export interface ScreenerSync {
  /** The decisions the relay holds. Defined exactly when `state` is `present`. */
  relayBlob: ScreenerBlob | undefined
  /** See the `state` section above — this decides the read, the render and the publish. */
  state: ScreenerState
  /**
   * Whether a read was even attempted — a relay origin *and* a live token.
   *
   * `state` alone cannot say this: "not asked" and "asked, no answer yet" are
   * both `unknown`, and they want opposite renders. Asked means wait, because
   * the answer is seconds away and showing rows the person dismissed and then
   * pulling them back is a flicker on every load. Not asked means render now,
   * because the answer is never coming and a Screener stuck under a skeleton
   * for everyone without a relay token is a broken feature rather than a
   * careful one.
   */
  asked: boolean
  /** Publish the two maps if they differ from what the relay holds. Never throws. */
  publish: (next: { snoozed: InstantMap; dismissed: InstantMap }) => Promise<void>
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

export function useScreenerSync(relayUrl: string | null | undefined): ScreenerSync {
  const [relayBlob, setRelayBlob] = useState<ScreenerBlob | undefined>(undefined)
  const [state, setState] = useState<ScreenerState>('unknown')
  const [asked, setAsked] = useState(false)
  /** Guards against two publishes racing on one coordinate from one tab. */
  const publishing = useRef(false)

  useEffect(() => {
    const seam = seamFrom(relayUrl)
    if (!seam) return
    let cancelled = false
    void (async () => {
      // Set inside the async body, not in the effect's synchronous part: a bare
      // `setState` in an effect body is the pattern the React Compiler lint
      // refuses, and every other state write in this hook is already a commit
      // from the same promise.
      setAsked(true)
      try {
        const read = await fetchScreener(seam)
        if (cancelled) return
        if (read.state === 'present') {
          setRelayBlob(read.blob)
          setState('present')
        } else if (read.state === 'absent') {
          setState('absent')
        } else {
          // A relay that did not answer and one that has not been asked license
          // exactly the same thing, which is nothing.
          console.warn('[screener] the relay did not say what screener decisions it holds')
        }
      } catch (error) {
        if (!cancelled) console.warn('[screener] could not read screener decisions from the relay:', error)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [relayUrl])

  const publish = useCallback(
    async (next: { snoozed: InstantMap; dismissed: InstantMap }) => {
      const seam = seamFrom(relayUrl)
      if (!seam) {
        console.warn('[screener] not published: no relay origin or no live Estiva ID token in this tab')
        return
      }
      // The load-bearing guard. `screenerToPublish` compares against
      // `relayBlob`, and an undefined one means "publish whatever you were
      // given" — right for a first publish and catastrophic for maps assembled
      // while the relay's answer is still unknown, because last-write-wins would
      // make an empty `dismissed` permanent and every dismissed row would return.
      if (state === 'unknown') {
        console.warn('[screener] not published: the relay has not said what decisions it holds')
        return
      }
      if (publishing.current) return
      const candidate = screenerToPublish(next, relayBlob, Date.now())
      if (!candidate) return
      publishing.current = true
      try {
        // Never silent. An evicted dismissal brings a stale row back, which the
        // person can act on; an evicted snooze breaks a promise they made, which
        // they cannot otherwise discover. SHR-4 logs its eviction for the same
        // reason and SHR-10 records that this is the map that gives way last.
        if (candidate.evictedSnoozed.length > 0) {
          console.warn(
            `[screener] the decisions blob is full: ${candidate.evictedSnoozed.length} snooze(s) dropped and will reappear now`,
            candidate.evictedSnoozed,
          )
        }
        if (candidate.evictedDismissed.length > 0) {
          console.warn(
            `[screener] the decisions blob is full: ${candidate.evictedDismissed.length} dismissal(s) dropped; those conversations may screen again`,
          )
        }
        const result = await publishScreener(candidate.blob, seam)
        if (result.ok) {
          setRelayBlob(candidate.blob)
          // A successful publish is also an answer about what the relay holds.
          // Without it a seeded coordinate would stay `absent` for the rest of
          // the load and the caller would keep reading Convex.
          setState('present')
        } else {
          console.warn('[screener] publish failed:', result.reason)
        }
      } catch (error) {
        console.warn('[screener] publish threw:', error)
      } finally {
        publishing.current = false
      }
    },
    [relayUrl, relayBlob, state],
  )

  return { relayBlob, state, asked, publish }
}
