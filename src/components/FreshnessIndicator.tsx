/**
 * The one place Peek says whether what you are looking at is current (PEE-9).
 *
 * **Surfaced once, in the nav rail** — not a badge per panel. A per-panel
 * indicator answers the same question several times, disagrees with itself
 * while states settle, and turns a single fact into visual noise.
 *
 * Deliberately quiet. Three of the four states are working states and render as
 * a small dot with a tooltip; only `session_ended` is allowed to look like
 * something is wrong, because it is the only one a person can act on. A badge
 * that shouts during normal operation is a badge people stop seeing.
 *
 * `AuthGate` is the wrong home for this and it was considered: the gate asks
 * whether there is an identity at all, this asks whether the data on screen is
 * current. Different questions, different answers, and a topic can be perfectly
 * readable while the answer to the second one is "no".
 */
import { useEffect, useState } from 'react'
import {
  currentObservation,
  deriveFreshness,
  describeFreshness,
  observeFreshness,
  recordOnline,
  type Freshness,
} from '@/nostr/freshness'

const TONE: Record<Freshness['kind'], string> = {
  // Never rendered — `idle` returns early below, like `live`. Present so the
  // record stays exhaustive and a new state cannot be added without a colour.
  idle: '',
  // Working states, in descending order of "nothing to see here". `polling` is
  // amber rather than red on purpose: it is how Peek worked for its whole life
  // before M3, and colouring a healthy fallback as a fault trains people to
  // ignore the indicator entirely.
  live: 'bg-emerald-500',
  catching_up: 'bg-sky-500',
  polling: 'bg-amber-500',
  session_ended: 'bg-red-500',
}

export function FreshnessIndicator() {
  const [state, setState] = useState<Freshness>(() => deriveFreshness(currentObservation()))
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => observeFreshness((o) => setState(deriveFreshness(o))), [])

  // The initial connectivity reading. `liveTopics` owns the `online`/`offline`
  // listeners — it is the thing that has to act on them — but it only exists
  // once a topic has been opened, and this is mounted from the first frame.
  useEffect(() => recordOnline(window.navigator.onLine), [])

  // The age on screen has to keep moving on its own — "synced a minute ago" is
  // reassuring and "synced 40 minutes ago" is actionable, and nothing else
  // re-renders this while the relay is quiet. It is also what makes the
  // time-based states arrive at all: `session_ended` once its grace period
  // passes, and `catching_up` only once a backfill has run long enough to be
  // worth mentioning.
  //
  // Faster while a backfill is running, because both of that state's bounds are
  // seconds apart and a 15s tick would step straight over the window — showing
  // nothing for a slow sync, or leaving "catching up" on screen well past the
  // point it stopped being true.
  useEffect(() => {
    const backfilling = currentObservation().backfillSince !== null
    const timer = setInterval(
      () => {
        setNow(Date.now())
        setState(deriveFreshness(currentObservation()))
      },
      backfilling ? 500 : 15_000,
    )
    return () => clearInterval(timer)
  }, [state.kind])

  // Nothing to say when everything is working, and nothing to say before
  // anything has been asked of the relay. The quietest correct state is no
  // state: an always-visible badge is decoration that costs attention, and one
  // that appears on every app load before you have done anything is worse —
  // it teaches people that the indicator means nothing.
  if (state.kind === 'live' || state.kind === 'idle') return null

  const label = describeFreshness(state, now)
  return (
    <div
      className="mt-auto flex w-full justify-center py-2"
      title={label}
      role="status"
      aria-label={label}
      data-freshness={state.kind}
    >
      <span className={`h-2 w-2 rounded-full ${TONE[state.kind]}`} />
    </div>
  )
}
