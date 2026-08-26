/**
 * PEE-9 — the four states, as data.
 *
 * The whole reason the derivation is a pure function over observations is that
 * the states worth getting right are the awkward ones: a renewal in flight, a
 * token that will never work again, a relay that refuses us for a reason that
 * is not an outage. Each is a nuisance to reach in a browser and a line here.
 *
 * The `token_rejected` rule is the one with a history. `auth/shell/contract.ts`
 * carries it and its own test pins it: telling somebody their session expired
 * when the real fault is configuration sends them to re-authenticate against a
 * wall. It is asserted again here because this is a second surface that could
 * reintroduce it.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  CATCHING_UP_AFTER_MS,
  CATCHING_UP_STALLS_AFTER_MS,
  CREDENTIAL_GRACE_MS,
  STALE_AFTER_MS,
  deriveFreshness,
  observeFreshness,
  reasonForSignFailure,
  recordBackfillEnd,
  recordBackfillStart,
  recordCredentialFailure,
  recordCredentialOk,
  recordRelayState,
  currentObservation,
  resetFreshnessForTests,
  type FreshnessObservation,
} from './freshness'

const NOW = 1_756_000_000_000

const observation = (o: Partial<FreshnessObservation> = {}): FreshnessObservation => ({
  relayState: null,
  backfillSince: null,
  lastSyncAt: null,
  credentialFailing: null,
  now: NOW,
  ...o,
})

beforeEach(() => resetFreshnessForTests())

describe('the four states', () => {
  it('is live when the socket is authenticated and nothing is loading', () => {
    expect(deriveFreshness(observation({ relayState: 'live' }))).toEqual({ kind: 'live' })
  })

  it('is catching up while a slow backfill runs, even on a live socket', () => {
    // "Live" over a view that is still loading its history is the small lie
    // this ticket is about.
    expect(
      deriveFreshness(
        observation({ relayState: 'live', backfillSince: NOW - CATCHING_UP_AFTER_MS }),
      ),
    ).toEqual({ kind: 'catching_up' })
  })

  it('says nothing about a backfill that finishes quickly', () => {
    // Every topic you open starts one and it finishes in well under a second.
    // Announcing each put a dot on screen for a moment on every click —
    // accurate, and pure noise. Reported from production.
    expect(
      deriveFreshness(
        observation({ relayState: 'live', backfillSince: NOW - (CATCHING_UP_AFTER_MS - 1) }),
      ),
    ).toEqual({ kind: 'live' })
  })

  it('stops claiming to be catching up once a backfill has stalled', () => {
    // The failure this hid: offline, the first thing a backfill awaits is
    // `syncPlan`, a Convex query — and the Convex client *queues* calls while
    // disconnected instead of rejecting, so the promise never settles. The
    // indicator sat on "catching up" for minutes, which is the most misleading
    // state available: it says "working on it" while nothing is happening.
    expect(
      deriveFreshness(
        observation({
          relayState: 'reconnecting',
          backfillSince: NOW - CATCHING_UP_STALLS_AFTER_MS,
          lastSyncAt: NOW - 60_000,
        }),
      ),
    ).toMatchObject({ kind: 'polling' })
  })

  it('is polling with no socket, and says when it last synced', () => {
    const state = deriveFreshness(
      observation({ relayState: 'reconnecting', lastSyncAt: NOW - 30_000 }),
    )
    expect(state).toEqual({ kind: 'polling', lastSyncAt: NOW - 30_000, stale: false })
  })

  it('marks polling stale once the last sync is old enough to act on', () => {
    // "a minute ago" is reassuring and "40 minutes ago" is actionable — the
    // difference is the entire reason the timestamp is shown.
    const state = deriveFreshness(
      observation({ relayState: 'reconnecting', lastSyncAt: NOW - STALE_AFTER_MS }),
    )
    expect(state).toMatchObject({ kind: 'polling', stale: true })
  })

  it('treats never-synced as stale rather than fresh', () => {
    expect(deriveFreshness(observation({ relayState: 'connecting' }))).toMatchObject({
      kind: 'polling',
      lastSyncAt: null,
      stale: true,
    })
  })

  it('says nothing at all before a connection has been asked for', () => {
    // Found on production: the Desk showed an amber dot on every app load,
    // because no topic was open so no socket existed. That reads as "not
    // connected to the relay" during entirely normal operation, which is how
    // an indicator teaches people to ignore it.
    //
    // `polling` means the fallback is carrying the load. Nothing is being
    // carried before anything has been opened.
    expect(deriveFreshness(observation({ relayState: null }))).toEqual({ kind: 'idle' })
  })

  it('polls once a socket has existed and is not live', () => {
    // The distinction that makes `idle` safe: a connection that was wanted and
    // is not there is still worth reporting.
    expect(deriveFreshness(observation({ relayState: 'reconnecting' }))).toMatchObject({
      kind: 'polling',
    })
  })

  it('still reports a dead credential with no socket', () => {
    // `idle` must not swallow the one state a person can act on.
    expect(
      deriveFreshness(
        observation({
          relayState: null,
          credentialFailing: { since: NOW - CREDENTIAL_GRACE_MS, reason: 'session_expired' },
        }),
      ),
    ).toEqual({ kind: 'session_ended', reason: 'session_expired' })
  })
})

describe('session_ended is delayed, not immediate', () => {
  it('says nothing while a credential failure is inside the grace period', () => {
    // `validToken()` is null during every silent renewal. Reporting the session
    // over the instant it reads null would flash "signed out" at everyone,
    // several times a day, with nothing wrong.
    const state = deriveFreshness(
      observation({
        relayState: 'reconnecting',
        credentialFailing: { since: NOW - (CREDENTIAL_GRACE_MS - 1), reason: 'session_expired' },
      }),
    )
    expect(state.kind).toBe('polling')
  })

  it('escalates once the failure has outlasted a renewal', () => {
    const state = deriveFreshness(
      observation({
        relayState: 'reconnecting',
        credentialFailing: { since: NOW - CREDENTIAL_GRACE_MS, reason: 'session_expired' },
      }),
    )
    expect(state).toEqual({ kind: 'session_ended', reason: 'session_expired' })
  })

  it('outranks a backfill in flight', () => {
    // It is the only state a person can act on, so it must not be hidden behind
    // a spinner that will never finish.
    const state = deriveFreshness(
      observation({
        backfillSince: NOW - CATCHING_UP_AFTER_MS,
        credentialFailing: { since: NOW - CREDENTIAL_GRACE_MS, reason: 'session_expired' },
      }),
    )
    expect(state.kind).toBe('session_ended')
  })
})

describe('classifying a /sign failure', () => {
  it('calls a 401 an expiry', () => {
    expect(reasonForSignFailure('POST /sign failed: 401 unauthenticated')).toBe('session_expired')
  })

  it('calls a 403 an inactive identity, which signing in cannot fix', () => {
    expect(reasonForSignFailure('POST /sign failed: 403 forbidden')).toBe('identity_inactive')
  })

  it('never calls a policy refusal an expiry', () => {
    // A 422 is `policy_violation` — a missing grant, a relay outside the
    // allowlist. Signing in again cannot fix any of it, and saying "your
    // session expired" sends somebody to a wall. This is the rule
    // `contract.ts` exists to hold, asserted on a second surface.
    for (const message of [
      'POST /sign failed: 422 policy_violation',
      'POST /sign failed: 500 internal',
      'POST /sign returned no event',
    ]) {
      expect(reasonForSignFailure(message), message).not.toBe('session_expired')
    }
    expect(reasonForSignFailure('POST /sign failed: 422 policy_violation')).toBe('token_rejected')
  })

  it('calls an unrecognisable failure a network problem', () => {
    expect(reasonForSignFailure('Failed to fetch')).toBe('network')
  })
})

describe('the store', () => {
  it('notifies a subscriber immediately and on every change', () => {
    const seen: FreshnessObservation[] = []
    observeFreshness((o) => seen.push(o))
    expect(seen).toHaveLength(1)

    recordRelayState('live')
    expect(seen[seen.length - 1]?.relayState).toBe('live')
  })

  it('stops notifying after unsubscribe', () => {
    const seen: unknown[] = []
    const off = observeFreshness((o) => seen.push(o))
    off()
    recordRelayState('live')
    expect(seen).toHaveLength(1)
  })

  it('counts overlapping backfills rather than toggling a flag', () => {
    // Several topics can be backfilling at once, and a boolean would clear on
    // the first to finish.
    recordBackfillStart()
    recordBackfillStart()
    recordBackfillEnd(true)
    expect(currentObservation().backfillSince).not.toBeNull()
    recordBackfillEnd(true)
    expect(currentObservation().backfillSince).toBeNull()
  })

  it('measures the age from the oldest backfill, not the newest', () => {
    // Clicking through topics starts a new one each time. Resetting the clock
    // on every start would let a genuinely stuck backfill hide behind a stream
    // of fast ones and never reach the stalled bound.
    recordBackfillStart(NOW)
    recordBackfillStart(NOW + 10_000)
    expect(currentObservation().backfillSince).toBe(NOW)
  })

  it('moves the sync timestamp only on a real sync', () => {
    // `syncTopicFromRelay` returns normally on most failures — a `{ ok: false }`
    // from the relay, a topic with no channel — so "did not throw" is not
    // "synced". It reports which, and only the real thing moves this.
    recordBackfillStart()
    recordBackfillEnd(true, NOW)
    expect(currentObservation().lastSyncAt).toBe(NOW)

    recordBackfillStart()
    recordBackfillEnd(false, NOW + 60_000)
    // Unchanged on purpose: the age on screen should keep growing while syncs
    // are failing, which is exactly the signal worth showing.
    expect(currentObservation().lastSyncAt).toBe(NOW)
  })

  it('keeps the first timestamp when a credential keeps failing', () => {
    // The grace period is measured from when it started failing. A reconnect
    // loop reporting every few seconds would otherwise reset the clock forever
    // and the state would never escalate.
    recordCredentialFailure('session_expired', NOW)
    recordCredentialFailure('session_expired', NOW + 5_000)
    recordCredentialFailure('session_expired', NOW + 10_000)
    expect(currentObservation().credentialFailing?.since).toBe(NOW)
  })

  it('clears the failure once a credential works', () => {
    recordCredentialFailure('session_expired', NOW)
    recordCredentialOk()
    expect(currentObservation().credentialFailing).toBeNull()
  })

  it('does not escalate after a renewal succeeds', () => {
    // The full renewal path: null token during the window, then a working one.
    recordCredentialFailure('session_expired', NOW)
    recordCredentialOk()
    const state = deriveFreshness({
      ...currentObservation(),
      relayState: 'live',
      now: NOW + CREDENTIAL_GRACE_MS * 10,
    })
    expect(state).toEqual({ kind: 'live' })
  })
})
