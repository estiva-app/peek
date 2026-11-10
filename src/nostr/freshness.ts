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
 * `@estiva-app/identity` — the awkward paths (a renewal in flight, a relay
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
import { SignRefused, SignerTokenExpired } from '@estiva-app/identity'
import { SHELL_COPY, type ShellReason } from '@estiva-app/identity'
import type { RelayState } from '@estiva-app/protocol'
import type { RelayFailureKind } from './relayRead'

/** How long a failing credential must persist before the session is called over. */
export const CREDENTIAL_GRACE_MS = 20_000

/** Beyond this, "last synced" stops being reassuring and becomes actionable. */
export const STALE_AFTER_MS = 5 * 60_000

/**
 * A backfill has to be running this long before it is worth mentioning.
 *
 * Every topic you open starts one, and on a healthy connection it finishes in
 * well under a second. Announcing each of those put a dot on screen for a
 * moment every time somebody clicked a topic — accurate, and pure noise. A
 * progress signal that fires on every fast operation is a flicker, not
 * information.
 *
 * Raised from 1.5s after that was still flickering: a sync taking a shade over
 * the threshold showed the dot and removed it again within a frame or two,
 * which is worse than either showing it or not. Nobody needs to be told about a
 * sync that finishes in five seconds; the state exists for the ones that do not.
 */
export const CATCHING_UP_AFTER_MS = 5_000

/**
 * And it stops being "catching up" after this long.
 *
 * The claim has a shelf life because the failure it hid was real: offline, the
 * first thing a backfill awaits is `syncPlan`, a **Convex query** — and the
 * Convex client queues calls while disconnected rather than rejecting them, so
 * the promise never settles. The in-flight count never cleared and the
 * indicator sat on "catching up" indefinitely, which is the most misleading
 * state available: it says *working on it* while nothing is happening at all.
 *
 * Past this, the derivation falls through to `polling`, which is the honest
 * description of a client that cannot reach anything.
 */
export const CATCHING_UP_STALLS_AFTER_MS = 30_000

/**
 * How long a first connection may take before it is worth mentioning.
 *
 * Opening the app builds a socket, and it passes through `connecting` and
 * `authenticating` on the way to `live` — a few hundred milliseconds, during
 * which it is doing exactly what it should. That was falling through to
 * `polling` and putting an amber dot on screen for a moment on every load,
 * which is the same mistake as the one `idle` fixed: crying wolf during
 * entirely normal operation.
 *
 * A connection that has not authenticated after this long genuinely is not
 * connected, and `polling` becomes the honest description.
 *
 * Applies only to `connecting` and `authenticating`. `reconnecting` means the
 * socket **was** live and is not any more, which is worth saying at once — and
 * `@estiva-app/protocol`'s `createLiveRelay` already separates the two: the first attempt is `connecting`, a
 * later one is `reconnecting`.
 */
export const CONNECTING_GRACE_MS = 5_000

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
  /**
   * No socket; the app is running off Convex rows. Working, not broken.
   *
   * `failure` distinguishes *why* when the last read told us something: a relay
   * that refused is a different sentence from one we could not reach, and it is
   * the difference between "wait" and "something is configured wrong".
   */
  | { kind: 'polling'; lastSyncAt: number | null; stale: boolean; failure?: RelayFailureKind }
  /** The one the ticket asks for: we can no longer ask on this person's behalf. */
  | { kind: 'session_ended'; reason: ShellReason }

export interface FreshnessObservation {
  /**
   * What the browser says about connectivity.
   *
   * The one signal here a socket cannot second-guess. A WebSocket whose peer
   * has become unreachable stays `OPEN` until TCP gives up — minutes — and
   * devtools' offline mode often never closes it, so `relayState` happily
   * reported `live` while nothing could arrive. Believing it showed *no
   * indicator at all* through a total network outage, which is the worst
   * outcome this feature has available.
   *
   * Trusted in one direction only: `false` is reliable, `true` merely means the
   * machine has an interface up — a captive portal reports online. The stalled
   * bound on `backfillSince` is what covers "online and still unreachable".
   */
  online: boolean
  /** `null` when no socket has been built yet — no topic has been opened. */
  relayState: RelayState | null
  /** When `relayState` last changed, for the startup grace above. */
  relayStateSince: number | null
  /**
   * When the oldest in-flight backfill started, or `null` when none is running.
   *
   * A timestamp rather than a boolean because both bounds above need one: a
   * backfill is only worth announcing between them.
   */
  backfillSince: number | null
  /** When an HTTP backfill last completed successfully. */
  lastSyncAt: number | null
  /**
   * The most recent relay read failure that says something about reachability.
   *
   * Never `not_a_member` — that is an answer, not an outage. Present so the
   * polling copy can be specific; it deliberately does not create a state of
   * its own, because the age of the last successful sync is the signal.
   */
  lastReadFailure: { at: number; kind: RelayFailureKind } | null
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
  // Above `catching_up`: with no network we are not catching up, we are stuck,
  // and saying "loading recent history" would be a straightforwardly false
  // description of a client that cannot reach anything.
  if (!o.online) {
    // No `failure`: the browser told us there is no network, which is a better
    // explanation than whatever the last read happened to say before it went.
    return {
      kind: 'polling',
      lastSyncAt: o.lastSyncAt,
      stale: o.lastSyncAt === null || o.now - o.lastSyncAt >= STALE_AFTER_MS,
    }
  }

  // Starting up is not a fallback. A socket on its way to `live` is working,
  // and saying "not connected, showing saved data" about it is false for the
  // few hundred milliseconds it takes.
  const startingUp = o.relayState === 'connecting' || o.relayState === 'authenticating'
  if (
    startingUp &&
    (o.relayStateSince === null || o.now - o.relayStateSince < CONNECTING_GRACE_MS)
  ) {
    return { kind: 'idle' }
  }

  const backfillAge = o.backfillSince === null ? null : o.now - o.backfillSince
  if (
    backfillAge !== null &&
    backfillAge >= CATCHING_UP_AFTER_MS &&
    backfillAge < CATCHING_UP_STALLS_AFTER_MS
  ) {
    return { kind: 'catching_up' }
  }
  if (o.relayState === 'live') return { kind: 'live' }
  // No socket has ever been requested — not "unavailable". `polling` means the
  // fallback is carrying the load; nothing is being carried yet.
  if (o.relayState === null) return { kind: 'idle' }
  // Only a *recent* failure explains the current state. An hour-old refusal
  // says nothing about now, and quoting it would be worse than saying nothing.
  const recentFailure =
    o.lastReadFailure && o.now - o.lastReadFailure.at < STALE_AFTER_MS
      ? o.lastReadFailure.kind
      : undefined

  return {
    kind: 'polling',
    lastSyncAt: o.lastSyncAt,
    stale: o.lastSyncAt === null || o.now - o.lastSyncAt >= STALE_AFTER_MS,
    ...(recentFailure ? { failure: recentFailure } : {}),
  }
}

/**
 * Classify a `/sign` failure into the shell's own vocabulary.
 *
 * **Takes the error, not its message.** It used to take a string and regex
 * `POST /sign failed: (\d{3})` out of it, which worked only because Peek threw
 * that exact sentence itself. SHA-4 moved the round trip into
 * `@estiva-app/identity`, whose message is worded differently — so the regex
 * would have matched nothing and every refusal would have become `network`.
 *
 * Nothing would have failed, which is the reason this is now typed. Every test
 * here passed a literal string, so the pattern kept matching in the suite while
 * matching nothing in the app: the test and the code agreed with each other and
 * both stopped describing production. `identity` 0.2.1 puts the status on the
 * error for exactly this, because consumers classify on it and a message is not
 * an API.
 *
 * Anything that is not clearly an expiry becomes `token_rejected`, which says
 * "this is a configuration problem, signing in again will not fix it". That is
 * the safe direction: a real expiry mislabelled as a config fault is a confusing
 * message, while a config fault mislabelled as an expiry sends somebody to
 * re-authenticate against a wall — the failure the reason vocabulary exists to
 * prevent.
 */
export function reasonForSignFailure(error: unknown): ShellReason {
  // The one refusal a new token fixes, and it has its own type so it cannot be
  // confused with a policy refusal that happens to mention a token.
  if (error instanceof SignerTokenExpired) return 'session_expired'
  if (error instanceof SignRefused) {
    // An administrator has to restore the identity; nothing the person does helps.
    if (error.status === 403) return 'identity_inactive'
    return 'token_rejected'
  }

  /*
    Anything else reached us without a status: an unreachable network, an
    aborted fetch, a throw from somewhere that is not the round trip. The string
    branch is kept for those and for any caller still handing over a message,
    rather than deleted on the assumption that the two typed cases are all there
    is.
  */
  const message = error instanceof Error ? error.message : String(error)
  const status = /POST \/sign failed: (\d{3})/.exec(message)?.[1]
  if (status === '401') return 'session_expired'
  if (status === '403') return 'identity_inactive'
  if (status === undefined) return 'network'
  return 'token_rejected'
}

// --- The store ---------------------------------------------------------------

type Listener = (state: FreshnessObservation) => void

const EMPTY: FreshnessObservation = {
  online: true,
  lastReadFailure: null,
  relayState: null,
  relayStateSince: null,
  backfillSince: null,
  lastSyncAt: null,
  credentialFailing: null,
  now: 0,
}

let observation: FreshnessObservation = { ...EMPTY, now: Date.now() }
const listeners = new Set<Listener>()
/** Backfills overlap across topics; the oldest one is what the age is measured from. */
let inFlight = 0

function emit() {
  observation = { ...observation, now: Date.now() }
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

/**
 * A relay read failed (PEE-10).
 *
 * Recorded rather than only logged, which is the whole of that ticket: the app
 * keeps working off its Convex rows either way, but until now nobody could tell
 * a failure had happened.
 *
 * Deliberately does **not** move `lastSyncAt` and does not invent a new state.
 * The age of the last *successful* sync already says everything a person needs
 * — it keeps growing while reads fail — and a second alarming signal for the
 * same fact would be the crying-wolf mistake this feature has already made
 * three times. The reason is carried so the copy can be specific when it is
 * worth being.
 *
 * Callers must filter `not_a_member` out first: that is a successful answer
 * about membership, not evidence the relay is unreachable.
 */
export function recordReadFailure(kind: RelayFailureKind, at = Date.now()): void {
  observation = { ...observation, lastReadFailure: { at, kind } }
  emit()
}

/** The browser's `online`/`offline` events. See {@link FreshnessObservation.online}. */
export function recordOnline(online: boolean): void {
  if (observation.online === online) return
  observation = { ...observation, online }
  emit()
}

export function recordRelayState(relayState: RelayState, at = Date.now()): void {
  // Only a real change restarts the clock: the grace is measured from when the
  // socket entered this state, and a repeat report must not extend it.
  if (observation.relayState === relayState) return
  observation = { ...observation, relayState, relayStateSince: at }
  emit()
}

export function recordBackfillStart(at = Date.now()): void {
  inFlight += 1
  // Kept at the oldest, so a rapid series of topic switches does not keep
  // resetting the age and hide a backfill that is genuinely stuck.
  if (observation.backfillSince === null) observation = { ...observation, backfillSince: at }
  emit()
}

export function recordBackfillEnd(ok: boolean, at = Date.now()): void {
  inFlight = Math.max(0, inFlight - 1)
  observation = {
    ...observation,
    ...(inFlight === 0 ? { backfillSince: null } : {}),
    // Only a real sync moves this. A read that failed must leave the age on
    // screen growing — that is the signal, and recording it as success would
    // make "synced a few seconds ago" a lie told at the worst moment.
    ...(ok ? { lastSyncAt: at } : {}),
  }
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
  observation = { ...EMPTY, now: Date.now() }
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
      // "Refused" and "could not reach" are different sentences on purpose:
      // one is worth waiting out, the other is worth telling somebody about.
      return `${
        state.failure === 'refused'
          ? 'The relay refused the last read.'
          : 'Not connected to the relay.'
      } Showing saved data, ${describeAge(state.lastSyncAt, now)}.`
    case 'session_ended':
      return SHELL_COPY[state.reason]
  }
}
