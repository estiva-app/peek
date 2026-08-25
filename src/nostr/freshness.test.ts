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
  backfillInFlight: false,
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

  it('is catching up while a backfill is in flight, even on a live socket', () => {
    // "Live" over a view that is still loading its history is the small lie
    // this ticket is about.
    expect(
      deriveFreshness(observation({ relayState: 'live', backfillInFlight: true })),
    ).toEqual({ kind: 'catching_up' })
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

  it('polls when no socket has been built at all', () => {
    // No topic opened yet, so there is no connection to describe — but the data
    // on screen is still only as fresh as the last sync.
    expect(deriveFreshness(observation({ relayState: null }))).toMatchObject({ kind: 'polling' })
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
        backfillInFlight: true,
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
    // Several topics can be backfilling at once; the indicator cares only that
    // one is running, and a boolean would clear on the first to finish.
    recordBackfillStart()
    recordBackfillStart()
    recordBackfillEnd(true)
    expect(currentObservation().backfillInFlight).toBe(true)
    recordBackfillEnd(true)
    expect(currentObservation().backfillInFlight).toBe(false)
  })

  it('moves the sync timestamp only on success', () => {
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
