/**
 * Re-run something on focus, on becoming visible, and on a slow interval
 * (PEE-1, PEE-2).
 *
 * Peek had no polling of any kind: both the topic sync and the project panel
 * ran in a `useEffect` keyed on ids that never change while a topic is open, so
 * each fired **once per mount and never again**. That is the whole of "replies
 * created in Ship take time to appear" — they did not appear on a timer, they
 * appeared on remount, which is why a reload fixed it.
 *
 * One hook rather than four copies of the wiring, because the failure mode of
 * four copies is that they drift and only three of them get the cleanup right.
 *
 * ## The interval never runs in a hidden tab
 *
 * Nothing is on screen to be stale, so an interval that keeps firing there is
 * pure waste — and it is waste multiplied by every background tab somebody has
 * left open. Becoming visible triggers a refresh immediately, which covers
 * everything missed while hidden in one request instead of dozens.
 *
 * ## `interval: false` is for what the socket already covers
 *
 * M3 gave Peek a live relay socket, so polling underneath a working connection
 * would undo the thing that was just built. A caller that has live delivery
 * passes `interval: false` while the socket is live and keeps the focus and
 * visibility triggers — those are cheap, happen at human frequency, and are the
 * one moment somebody actively wants certainty about what is on screen. They
 * also cover a socket that believes it is connected and is not.
 *
 * ## One scheduler for the tab (PER-13)
 *
 * Each call used to add its own `focus` and `visibilitychange` listener, and a
 * tab switch raises both — so every read in the tab went out twice, at the same
 * millisecond. Measured in buzz's log on 2026-09-23: seconds of 40–58 requests
 * from Miky's key, against fan-outs of 20–33. The listeners, the 1 s merge of
 * the two events, and the pause after a 429 now live in `@estiva-app/platform`'s
 * scheduler, shared with Ship's `useRefresh`; this hook subscribes to the one
 * this tab holds.
 */
import { useEffect, useRef } from 'react'
import { createRefreshScheduler, type RefreshScheduler } from '@estiva-app/platform'
import { relayBudget } from '@/nostr/relayBudget'

/** Slow on purpose: this is a fallback, not the delivery mechanism. */
export const REFRESH_INTERVAL_MS = 30_000

/**
 * The tab's scheduler. The package hands out a scheduler and keeps nothing, so
 * this line is the one binding; built on first use so importing registers no
 * listener.
 */
let scheduler: RefreshScheduler | undefined
function refreshScheduler(): RefreshScheduler {
  scheduler ??= createRefreshScheduler({
    document,
    window,
    budget: relayBudget,
    intervalMs: REFRESH_INTERVAL_MS,
  })
  return scheduler
}

export interface RefreshTriggerOptions {
  /** Whether to run at all. `false` removes every listener. */
  enabled?: boolean
  /** Whether the periodic refresh runs. Focus and visibility are unaffected. */
  interval?: boolean
  intervalMs?: number
}

export function useRefreshTriggers(
  refresh: () => void,
  { enabled = true, interval = true, intervalMs = REFRESH_INTERVAL_MS }: RefreshTriggerOptions = {},
) {
  // Held in a ref so a caller may pass an inline function without every render
  // tearing the listeners down and adding them again.
  //
  // Updated in an effect rather than during render: a ref written while
  // rendering is what `react-hooks/refs` forbids, and the timing is harmless
  // here — every read happens from an event or a timer, both of which run after
  // the commit that set it.
  const latest = useRef(refresh)
  useEffect(() => {
    latest.current = refresh
  })

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return
    return refreshScheduler().subscribe(() => latest.current(), { interval, intervalMs })
  }, [enabled, interval, intervalMs])
}
