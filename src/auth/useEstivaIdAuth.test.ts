/**
 * The auth source Convex reads (PEEK-104).
 *
 * This exists because of one specific regression, and it is worth naming: an
 * earlier version returned `null` whenever Convex passed `forceRefreshToken`,
 * on the reasoning that we cannot mint a fresher token and should say so.
 *
 * That reasoning was wrong about what `null` *means* to Convex. It asks for a
 * fresh token the instant the server confirms the first one, and reads `null`
 * as "refetching token failed" — `clearAuth()`, auth reported failed. The
 * result was a valid session torn down milliseconds after being established,
 * with the app dropping back to the signed-out screen and no error anywhere.
 * Every unit test passed, because none of them called it the way Convex does.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useEstivaIdAuth } from './useEstivaIdAuth'

const TOKEN_KEY = 'peek.estivaId.token'

function storeToken({ expiresInMs = 600_000, refreshToken = undefined as string | undefined } = {}) {
  sessionStorage.setItem(
    TOKEN_KEY,
    JSON.stringify({
      accessToken: 'header.payload.sig',
      expiresAt: Date.now() + expiresInMs,
      pubkey: 'a'.repeat(64),
      ...(refreshToken ? { refreshToken } : {}),
    }),
  )
}

/** Stand in for Estiva ID's `/token`, counting how often it is asked. */
function stubTokenEndpoint(response: { ok: boolean; body?: Record<string, unknown> }) {
  const calls: unknown[] = []
  globalThis.fetch = (async (_url: unknown, init: { body?: string }) => {
    calls.push(JSON.parse(init?.body ?? '{}'))
    return {
      ok: response.ok,
      json: async () => response.body ?? {},
    } as Response
  }) as typeof fetch
  return calls
}

const realFetch = globalThis.fetch
beforeEach(() => sessionStorage.clear())
afterEach(() => {
  sessionStorage.clear()
  globalThis.fetch = realFetch
})

describe('useEstivaIdAuth', () => {
  it('returns the token when Convex forces a refresh', async () => {
    // The regression. Convex calls this immediately after the server confirms
    // the token; a null here ends the session it just established.
    storeToken()
    const { result } = renderHook(() => useEstivaIdAuth())

    await expect(result.current.fetchAccessToken({ forceRefreshToken: true })).resolves.toBe('header.payload.sig')
  })

  it('returns the token on a normal fetch', async () => {
    storeToken()
    const { result } = renderHook(() => useEstivaIdAuth())

    await expect(result.current.fetchAccessToken({ forceRefreshToken: false })).resolves.toBe('header.payload.sig')
  })

  it('is authenticated when a live token is present', () => {
    storeToken()
    const { result } = renderHook(() => useEstivaIdAuth())

    expect(result.current.isAuthenticated).toBe(true)
    // No loading window: the token is in storage before first render, so a
    // signed-in reload must never flash the signed-out screen.
    expect(result.current.isLoading).toBe(false)
  })

  it('returns null and clears storage once the token has expired', async () => {
    // Still null, but for a narrower reason since PEEK-108: this token carries
    // no `refreshToken`, so there is nothing to renew it with. An expired token
    // that *does* carry one is renewed instead — see below.
    storeToken({ expiresInMs: -1 })
    const { result } = renderHook(() => useEstivaIdAuth())

    await expect(result.current.fetchAccessToken({ forceRefreshToken: false })).resolves.toBeNull()
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull()
  })

  it('is not authenticated with no token at all', () => {
    const { result } = renderHook(() => useEstivaIdAuth())
    expect(result.current.isAuthenticated).toBe(false)
  })

  /**
   * The point of PEEK-108: an expired token is renewed rather than ending the
   * session. Before the refresh grant this returned null and dropped the person
   * into the shell, losing whatever they had on screen.
   */
  it('renews an expired token instead of reporting no identity', async () => {
    storeToken({ expiresInMs: -1000, refreshToken: 'r1' })
    const calls = stubTokenEndpoint({
      ok: true,
      body: { access_token: 'fresh.token.sig', expires_in: 600, refresh_token: 'r2' },
    })

    const { result } = renderHook(() => useEstivaIdAuth())
    await expect(result.current.fetchAccessToken({ forceRefreshToken: false })).resolves.toBe(
      'fresh.token.sig',
    )
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ grantType: 'refresh_token', refreshToken: 'r1' })

    // The rotated token replaces the spent one. Keeping the old one alongside
    // it would eventually present a spent token, which Estiva ID reads as theft.
    expect(JSON.parse(sessionStorage.getItem(TOKEN_KEY) as string)).toMatchObject({
      refreshToken: 'r2',
    })
  })

  /**
   * A refresh token is single-use, so two concurrent renewals would present the
   * same one twice — and the second presentation is exactly what Estiva ID
   * treats as a stolen credential, revoking the entire chain. Convex calls this
   * from several places at once, so the guard is not hypothetical.
   */
  it('never runs two renewals at once', async () => {
    storeToken({ expiresInMs: -1000, refreshToken: 'r1' })
    const calls = stubTokenEndpoint({
      ok: true,
      body: { access_token: 'fresh.token.sig', expires_in: 600, refresh_token: 'r2' },
    })

    const { result } = renderHook(() => useEstivaIdAuth())
    const [a, b] = await Promise.all([
      result.current.fetchAccessToken({ forceRefreshToken: false }),
      result.current.fetchAccessToken({ forceRefreshToken: false }),
    ])

    expect(a).toBe('fresh.token.sig')
    expect(b).toBe('fresh.token.sig')
    expect(calls).toHaveLength(1)
  })

  it('reports no identity when the refresh token is refused', async () => {
    storeToken({ expiresInMs: -1000, refreshToken: 'spent' })
    stubTokenEndpoint({ ok: false })

    const { result } = renderHook(() => useEstivaIdAuth())
    await expect(result.current.fetchAccessToken({ forceRefreshToken: false })).resolves.toBeNull()
    // Cleared, so the shell starts from nothing rather than retrying a token
    // Estiva ID has already revoked.
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull()
  })

  /** A deployment with no refresh grant behaves exactly as it did before. */
  it('reports no identity when there is no refresh token at all', async () => {
    storeToken({ expiresInMs: -1000 })
    const calls = stubTokenEndpoint({ ok: true, body: {} })

    const { result } = renderHook(() => useEstivaIdAuth())
    await expect(result.current.fetchAccessToken({ forceRefreshToken: false })).resolves.toBeNull()
    expect(calls).toHaveLength(0)
  })
})
