/**
 * One answer to "is what I am looking at current?" (PEE-9).
 *
 * M3 made Peek update live. It did not make the *absence* of an update legible,
 * and those are different problems: "nothing new has happened" and "I stopped
 * being able to ask" render identically today, which is precisely the confusion
 * this ticket exists to end.
 *
 * Everything here is a pure function of what the app observed, plus a tiny
 * store that collects those observations. That is deliberately the shape of
 * `auth/shell/contract.ts` — the awkward paths (a renewal in flight, a relay
 * that refuses us, a token that will never work again) are exactly the ones
 * that are hard to reach in a browser and easy to assert as data.
 *
 * ## Four states, and the tone matters as much as the words
 *
 * `polling` is a **working state**, not an error: the app is running off Convex
 * rows and refreshing on a timer, which is what it did for its whole life
 * before M3. Anything alarming is reserved for `session_ended`. A red badge for
 * a healthy fallback trains people to ignore the badge.
 *
 * ## Why `session_ended` is delayed rather than immediate
 *
 * `validToken()` is null during **every** silent renewal (PEEK-108), which
 * happens shortly before each expiry. Reporting the session over the instant it
 * reads null would flash "signed out" at everyone, several times a day, while
 * nothing was wrong. So the observation is *when the credential started
 * failing*, and the state only escalates once that has held past
 * {@link CREDENTIAL_GRACE_MS} — long enough that a renewal would have finished.
 *
 * ## Never "session expired" for a configuration fault
 *
 * `contract.ts` carries the rule and a test pins it: `token_rejected` must
 * never read as "signed out", because telling somebody their session expired
 * sends them to re-authenticate against a wall. This maps onto that vocabulary
 * rather than inventing a second one, and errs toward `token_rejected` when the
 * cause is not clearly an expiry — the honest failure is the one that does not
 * send somebody to a login screen that cannot help them.
 */
import { SHELL_COPY, type ShellReason } from '@/auth/shell/contract'
import type { RelayState } from './liveRelay'

/** How long a failing credential must persist before the session is called over. */
export const CREDENTIAL_GRACE_MS = 20_000

/** Beyond this, "last synced" stops being reassuring and becomes actionable. */
export const STALE_AFTER_MS = 5 * 60_000

export type Freshness =
  /**
   * Nothing has asked for a connection yet, so there is nothing to report.
   *
   * A socket is built when a topic is opened, not at boot — so on the Desk,
   * before anything is selected, there is no connection to describe and no
   * stale data to warn about. Reporting `polling` there said "not connected to
   * the relay" on every single app load, which is true and useless: it is the
   * indicator crying wolf during entirely normal operation, and that is how an
   * indicator gets ignored.
   *
   * Renders nothing, like `live`. When PEE-11 subscribes outside topics this
   * state becomes rare, and the derivation needs no change for it.
   */
  | { kind: 'idle' }
  /** Socket open and authenticated. Nothing to say. */
  | { kind: 'live' }
  /** A backfill is in flight — history is still arriving. */
  | { kind: 'catching_up' }
  /** No socket; the app is running off Convex rows. Working, not broken. */
  | { kind: 'polling'; lastSyncAt: number | null; stale: boolean }
  /** The one the ticket asks for: we can no longer ask on this person's behalf. */
  | { kind: 'session_ended'; reason: ShellReason }

export interface FreshnessObservation {
  /** `null` when no socket has been built yet — no topic has been opened. */
  relayState: RelayState | null
  backfillInFlight: boolean
  /** When an HTTP backfill last completed successfully. */
  lastSyncAt: number | null
  /**
   * When the live path first reported it could not get a usable credential,
   * and the reason it gave. Cleared the moment one works again.
   */
  credentialFailing: { since: number; reason: ShellReason } | null
  now: number
}

/**
 * Derive the one state.
 *
 * Order is the design. `session_ended` outranks everything because it is the
 * only state a person can act on; `catching_up` outranks `live` because a
 * socket that is up while history is still loading is honestly described as
 * catching up, and saying "live" over an incomplete view is the small lie this
 * ticket is about.
 */
export function deriveFreshness(o: FreshnessObservation): Freshness {
  if (o.credentialFailing && o.now - o.credentialFailing.since >= CREDENTIAL_GRACE_MS) {
    return { kind: 'session_ended', reason: o.credentialFailing.reason }
  }
  if (o.backfillInFlight) return { kind: 'catching_up' }
  if (o.relayState === 'live') return { kind: 'live' }
  // No socket has ever been requested — not "unavailable". `polling` means the
  // fallback is carrying the load; nothing is being carried yet.
  if (o.relayState === null) return { kind: 'idle' }
  return {
    kind: 'polling',
    lastSyncAt: o.lastSyncAt,
    stale: o.lastSyncAt === null || o.now - o.lastSyncAt >= STALE_AFTER_MS,
  }
}

/**
 * Classify a `/sign` failure into the shell's own vocabulary.
 *
 * `signViaEstivaId` throws `POST /sign failed: <status> <body>`. The status is
 * the honest signal; the body is not something to pattern-match on.
 *
 * Anything that is not clearly an expiry becomes `token_rejected`, which says
 * "this is a configuration problem, signing in again will not fix it". That is
 * the safe direction: a real expiry mislabelled as a config fault is a confusing
 * message, while a config fault mislabelled as an expiry sends somebody to
 * re-authenticate against a wall — the failure `contract.ts` exists to prevent.
 */
export function reasonForSignFailure(message: string): ShellReason {
  const status = /POST \/sign failed: (\d{3})/.exec(message)?.[1]
  if (status === '401') return 'session_expired'
  if (status === '403') return 'identity_inactive'
  if (status === undefined) return 'network'
  return 'token_rejected'
}

// --- The store ---------------------------------------------------------------

type Listener = (state: FreshnessObservation) => void

let observation: FreshnessObservation = {
  relayState: null,
  backfillInFlight: false,
  lastSyncAt: null,
  credentialFailing: null,
  now: Date.now(),
}
const listeners = new Set<Listener>()
/** Backfills can overlap across topics; the indicator cares only that one is running. */
let inFlight = 0

function emit() {
  observation = { ...observation, backfillInFlight: inFlight > 0, now: Date.now() }
  for (const listener of [...listeners]) listener(observation)
}

export function observeFreshness(listener: Listener): () => void {
  listeners.add(listener)
  listener(observation)
  return () => listeners.delete(listener)
}

export function currentObservation(): FreshnessObservation {
  return { ...observation, now: Date.now() }
}

export function recordRelayState(relayState: RelayState): void {
  observation = { ...observation, relayState }
  emit()
}

export function recordBackfillStart(): void {
  inFlight += 1
  emit()
}

export function recordBackfillEnd(ok: boolean, at = Date.now()): void {
  inFlight = Math.max(0, inFlight - 1)
  if (ok) observation = { ...observation, lastSyncAt: at }
  emit()
}

/**
 * The live path could not get a usable credential.
 *
 * Idempotent on `since`: repeated reports keep the *first* timestamp, because
 * the grace period is measured from when it started failing, not from the most
 * recent attempt. A reconnect loop reporting every few seconds would otherwise
 * reset the clock forever and the state would never escalate.
 */
export function recordCredentialFailure(reason: ShellReason, at = Date.now()): void {
  if (observation.credentialFailing) return
  observation = { ...observation, credentialFailing: { since: at, reason } }
  emit()
}

/** A credential worked. Clears any pending failure. */
export function recordCredentialOk(): void {
  if (!observation.credentialFailing) return
  observation = { ...observation, credentialFailing: null }
  emit()
}

/** Test seam. */
export function resetFreshnessForTests(): void {
  inFlight = 0
  observation = {
    relayState: null,
    backfillInFlight: false,
    lastSyncAt: null,
    credentialFailing: null,
    now: Date.now(),
  }
  listeners.clear()
}

// --- What it says ------------------------------------------------------------

/** "a few seconds ago" / "3 minutes ago" / "over an hour ago". */
export function describeAge(lastSyncAt: number | null, now: number): string {
  if (lastSyncAt === null) return 'not yet synced'
  const seconds = Math.max(0, Math.round((now - lastSyncAt) / 1000))
  if (seconds < 45) return 'synced a few seconds ago'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `synced ${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  return `synced over ${hours} hour${hours === 1 ? '' : 's'} ago`
}

/**
 * What the indicator says, per state.
 *
 * Lives here rather than beside the component so the meaning and the wording
 * are one module: the copy *is* the feature — the done-when is that somebody
 * who has not read the ticket can say why their data might not be current — and
 * a pure function is what lets it be asserted rather than reviewed.
 */
export function describeFreshness(state: Freshness, now: number): string {
  switch (state.kind) {
    case 'idle':
      return 'Not connected yet — open a topic to start receiving updates'
    case 'live':
      return 'Live — updates arrive as they happen'
    case 'catching_up':
      return 'Catching up — loading recent history'
    case 'polling':
      return `Not connected to the relay. Showing saved data, ${describeAge(state.lastSyncAt, now)}.`
    case 'session_ended':
      return SHELL_COPY[state.reason]
  }
}
