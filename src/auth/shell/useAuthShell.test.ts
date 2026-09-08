/**
 * The branch that had no way out (PEE-23).
 *
 * A token the app considered valid and the server refused reported
 * `token_rejected` outright — a reason `isRecoverable` deliberately gives no
 * affordance, because signing in again cannot fix a misconfigured audience. The
 * reasoning was right about configuration faults and wrong about how often it
 * was actually looking at one.
 *
 * Reported twice from production, both on a first load of the morning: the
 * console had `POST /sign failed: 401 Invalid token: "exp" claim timestamp check
 * failed` while the screen said a configuration problem that signing in again
 * would not fix. It was an expiry. Signing in again fixed it — after clearing
 * site data, which was the only way to reach the sign-in at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useAuthShell } from './useAuthShell'

const TOKEN_KEY = 'peek.estivaId.token'
const RENEWAL_KEY = 'peek.authShell.refusedTokenRenewal'

/**
 * A token the app will call valid.
 *
 * `expiresAt` in the future is the whole premise of the branch under test — the
 * app believes this token is live. Whether the *service* agrees is a separate
 * question, and the one that made this a bug.
 */
function storeLiveToken({ withRefreshToken = true } = {}) {
  sessionStorage.setItem(
    TOKEN_KEY,
    JSON.stringify({
      accessToken: 'header.payload.sig',
      expiresAt: Date.now() + 600_000,
      pubkey: 'a'.repeat(64),
      ...(withRefreshToken ? { refreshToken: 'rt' } : {}),
    }),
  )
}

/** Stand in for `/token`, counting how often the refresh grant is spent. */
function stubRefresh(response: { ok: boolean; body?: Record<string, unknown> }) {
  const calls: unknown[] = []
  globalThis.fetch = (async (_url: unknown, init: { body?: string }) => {
    calls.push(JSON.parse(init?.body ?? '{}'))
    return { ok: response.ok, status: response.ok ? 200 : 400, json: async () => response.body ?? {} }
  }) as never
  return calls
}

const reload = vi.fn()

beforeEach(() => {
  sessionStorage.clear()
  reload.mockClear()
  // jsdom implements no navigation and will not let `location.reload` be spied
  // directly, so the whole object is replaced — the same reason the package
  // takes `navigate` as a callback.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload, pathname: '/topics/abc', search: '' },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('a locally-valid token the server refuses', () => {
  it('spends one renewal and reloads when it works, rather than declaring a fault', async () => {
    storeLiveToken()
    const calls = stubRefresh({ ok: true, body: { access_token: 'fresh', expires_in: 600, refresh_token: 'rt2' } })

    const { result } = renderHook(() => useAuthShell())

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    expect(calls).toHaveLength(1)
    // Never the dead end: the token was stale, which a renewal fixes.
    expect(result.current.state.phase).not.toBe('failed')
  })

  it('offers a passkey when the renewal fails, instead of no affordance at all', async () => {
    storeLiveToken()
    stubRefresh({ ok: false })

    const { result } = renderHook(() => useAuthShell())

    await waitFor(() => expect(result.current.state.phase).toBe('authenticating'))
    // `session_expired` is recoverable and `token_rejected` is not. That is the
    // entire difference between a step and a dead end.
    expect(result.current.state).toMatchObject({ reason: 'session_expired' })
    expect(reload).not.toHaveBeenCalled()
  })

  it('offers a passkey when there is no refresh token to spend', async () => {
    storeLiveToken({ withRefreshToken: false })
    const calls = stubRefresh({ ok: true })

    const { result } = renderHook(() => useAuthShell())

    await waitFor(() => expect(result.current.state.phase).toBe('authenticating'))
    expect(calls).toHaveLength(0)
    expect(result.current.state).toMatchObject({ reason: 'session_expired' })
  })

  it('STILL reports token_rejected once a fresh token has been refused too', async () => {
    /*
      The control, and the reason this change does not simply delete a screen. A
      wrong audience or an unreachable JWKS survives a renewal, and the honest
      answer then really is that signing in again will not help. The difference
      is that it is now established rather than assumed.
    */
    storeLiveToken()
    sessionStorage.setItem(RENEWAL_KEY, String(Date.now()))
    const calls = stubRefresh({ ok: true, body: { access_token: 'fresh', expires_in: 600 } })

    const { result } = renderHook(() => useAuthShell())

    await waitFor(() => expect(result.current.state).toMatchObject({ phase: 'failed', reason: 'token_rejected' }))
    // A second renewal would spend a single-use refresh token for nothing.
    expect(calls).toHaveLength(0)
    expect(reload).not.toHaveBeenCalled()
  })

  it('lets a stale marker go, so a later skew gets a real attempt', async () => {
    // Time-boxed rather than cleared on success, because the successful path
    // reloads and has no later moment in this document to clean up in. A marker
    // that outlived its cause would make the next genuine skew a dead end
    // without even trying.
    storeLiveToken()
    sessionStorage.setItem(RENEWAL_KEY, String(Date.now() - 120_000))
    const calls = stubRefresh({ ok: true, body: { access_token: 'fresh', expires_in: 600, refresh_token: 'rt2' } })

    renderHook(() => useAuthShell())

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    expect(calls).toHaveLength(1)
  })
})
