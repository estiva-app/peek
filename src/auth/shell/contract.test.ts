/**
 * Pins the auth shell contract (PEEK-115/116).
 *
 * This file exists for the same reason `src/nostr/event.test.ts` does: the
 * implementation is duplicated in another repo on purpose, and a test that
 * fails when the copies drift is what keeps independence from becoming
 * divergence. Ship carries the same assertions against its own copy.
 *
 * The awkward paths are the interesting ones. A shell that enters when it
 * should is easy; a shell that refuses to bounce forever is the feature.
 */
import { describe, expect, it } from 'vitest'
import {
  CONTINUE_LABEL,
  GUARD_TTL_MS,
  PROBE_TIMEOUT_MS,
  SHELL_COPY,
  type ShellReason,
  decideBoot,
  isRecoverable,
  reasonForCallbackError,
} from './contract'

const NOW = 1_700_000_000_000

const observation = (o: Partial<Parameters<typeof decideBoot>[0]> = {}) =>
  decideBoot({ callback: null, hasValidToken: false, guardAttemptedAt: null, now: NOW, ...o })

describe('the boot decision', () => {
  it('enters on a live token without touching the network', () => {
    expect(observation({ hasValidToken: true })).toEqual({ do: 'enter' })
  })

  it('probes silently on a cold load with nothing held', () => {
    expect(observation()).toEqual({ do: 'probe_silently' })
  })

  it('redeems a code that came back', () => {
    expect(observation({ callback: { code: 'abc' } })).toEqual({ do: 'complete_callback' })
  })

  /**
   * The point of `prompt=none`: a miss is an answer, and it lands the person in
   * the app's own shell rather than on the identity origin's sign-in page.
   */
  it('turns login_required into the passkey affordance, in place', () => {
    expect(observation({ callback: { error: 'login_required' } })).toEqual({
      do: 'prompt_passkey',
      reason: 'no_session',
    })
  })

  it('does not offer a passkey to a suspended identity', () => {
    const action = observation({ callback: { error: 'access_denied' } })
    expect(action).toEqual({ do: 'prompt_passkey', reason: 'identity_inactive' })
    expect(isRecoverable('identity_inactive')).toBe(false)
  })

  /**
   * The loop guard. Without this, an app that redirects whenever it has no
   * session, against a service that redirects straight back, is an infinite
   * bounce — which is exactly why Peek's old screen was a button.
   */
  it('never probes twice in one page-load chain', () => {
    const action = observation({ guardAttemptedAt: NOW - 500 })
    expect(action).toEqual({ do: 'prompt_passkey', reason: 'loop_guard' })
  })

  it('calls a slow round trip a timeout rather than a loop', () => {
    const action = observation({ guardAttemptedAt: NOW - PROBE_TIMEOUT_MS - 1 })
    expect(action).toEqual({ do: 'prompt_passkey', reason: 'timeout' })
  })

  it('lets a stale guard go, so a returning tab gets a real attempt', () => {
    expect(observation({ guardAttemptedAt: NOW - GUARD_TTL_MS - 1 })).toEqual({
      do: 'probe_silently',
    })
  })

  /**
   * A code and a tripped guard arrive together on every successful silent
   * entry — the guard was set on the way out. The code has to win, or a
   * successful probe would be discarded at the last step.
   */
  it('prefers a returned code over a guard set on the way out', () => {
    expect(observation({ callback: { code: 'abc' }, guardAttemptedAt: NOW - 500 })).toEqual({
      do: 'complete_callback',
    })
  })
})

describe('the copy', () => {
  const reasons: ShellReason[] = [
    'no_session',
    'session_expired',
    'identity_inactive',
    'token_rejected',
    'exchange_failed',
    'network',
    'timeout',
    'loop_guard',
  ]

  it('covers every reason', () => {
    for (const reason of reasons) expect(SHELL_COPY[reason]).toBeTruthy()
    expect(Object.keys(SHELL_COPY).sort()).toEqual([...reasons].sort())
  })

  /**
   * The distinction that cost a debugging detour: a live token the backend
   * refuses is a configuration fault, and telling somebody their session
   * expired sends them to re-authenticate against a wall.
   */
  it('never tells a token_rejected user their session expired', () => {
    expect(SHELL_COPY.token_rejected).toMatch(/configuration/i)
    // It may *contrast* with expiry — "rather than an expired session" is the
    // point. What it must never do is assert it, or offer signing in as the fix.
    expect(SHELL_COPY.token_rejected).not.toMatch(/your session (has )?(expired|ended)/i)
    expect(SHELL_COPY.token_rejected).toMatch(/will not fix/i)
  })

  it('offers a passkey rather than naming the identity provider', () => {
    // "Sign in with Estiva ID" is the surface this milestone exists to delete.
    expect(CONTINUE_LABEL).not.toMatch(/sign in/i)
    expect(CONTINUE_LABEL).toMatch(/passkey/i)
  })
})

describe('callback errors', () => {
  it('maps anything unrecognised to a retryable failure', () => {
    expect(reasonForCallbackError('server_error')).toBe('exchange_failed')
    expect(isRecoverable('exchange_failed')).toBe(true)
  })
})
