/**
 * The viewer's hidden-DM set, read from the relay and written through it (DMS-6).
 *
 * The same shape as `useStarsSync`, minus everything about seeding: there is
 * no Convex copy of this set to seed from and there must never be one, so the
 * relay's answer is the only source and `state` is only "has it answered".
 *
 * ## `state`
 *
 * - `unknown` — not asked (no relay origin, no token in this tab) or not yet
 *   answered. Nothing is hidden *yet*: a sidebar that hid rows on a guess
 *   would hide the wrong ones, so unknown draws everything.
 * - `present` — the relay said what it holds. An empty set is a real answer.
 *
 * ## Writes re-read
 *
 * A hide is applied to the local set the moment the relay accepts it, so the
 * row leaves the sidebar without waiting, and then the snapshot is re-read:
 * the relay republishes `30622` *after* answering the `41012` (post-commit,
 * best-effort, `handle_dm_hide` step 5), so the re-read is what makes the
 * local set the relay's set rather than this tab's belief about it. A re-open
 * is the same in reverse.
 *
 * ## What this does not do
 *
 * It does not watch the relay. A second device that hid a DM is reflected on
 * the next load, which is the rule the starred set already lives by. Nothing
 * here is more urgent than a star.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { heldToken, useSessionResumed } from '@/auth/heldSession'
import type { RelaySeam } from './stars'
import { fetchHiddenDms } from './dmVisibility'

export type DmVisibilityState = 'unknown' | 'present'

export interface DmVisibilitySync {
  /** Hidden DM channel uuids. Empty until `state` is `present`. */
  hidden: ReadonlySet<string>
  state: DmVisibilityState
  /** The seam a publish should use right now, or null when none is possible. */
  seam: () => RelaySeam | null
  /** Apply a channel locally, then re-read the relay's snapshot. */
  applyHidden: (channelUuid: string, hidden: boolean) => Promise<void>
}

function seamFrom(relayUrl: string | null | undefined): RelaySeam | null {
  if (!relayUrl) return null
  // At call time, never cached: a snapshot taken at mount goes stale
  // (PEEK-108). The held token, so a page opened offline on an expired one
  // still reads the device copy; its relay read fails at `/sign` and counts as
  // unreachable (AUT-3).
  const token = heldToken()
  if (!token) return null
  return { relayUrl, accessToken: token.accessToken, pubkey: token.pubkey }
}

export function useDmVisibilitySync(relayUrl: string | null | undefined): DmVisibilitySync {
  // Read again once a renewal ends a stretch on an expired token (AUT-3).
  const resumed = useSessionResumed()
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set())
  const [state, setState] = useState<DmVisibilityState>('unknown')
  /** A re-read that lands after a newer local change must not undo it. */
  const generation = useRef(0)

  const read = useCallback(async (): Promise<void> => {
    const seam = seamFrom(relayUrl)
    if (!seam) return
    const mine = ++generation.current
    try {
      const result = await fetchHiddenDms(seam)
      if (mine !== generation.current) return
      if (result.state === 'present') {
        setHidden(result.hidden)
        setState('present')
      } else {
        console.warn('[dms] the relay did not say which DMs are hidden')
      }
    } catch (error) {
      if (mine === generation.current) console.warn('[dms] could not read the hidden set from the relay:', error)
    }
  }, [relayUrl])

  useEffect(() => {
    void read()
  }, [read, resumed])

  const applyHidden = useCallback(
    async (channelUuid: string, isHidden: boolean) => {
      generation.current++
      setHidden((prev) => {
        const next = new Set(prev)
        if (isHidden) next.add(channelUuid)
        else next.delete(channelUuid)
        return next
      })
      await read()
    },
    [read],
  )

  const seam = useCallback(() => seamFrom(relayUrl), [relayUrl])

  return { hidden, state, seam, applyHidden }
}
