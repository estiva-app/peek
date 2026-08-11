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

function storeToken({ expiresInMs = 600_000 } = {}) {
  sessionStorage.setItem(
    TOKEN_KEY,
    JSON.stringify({ accessToken: 'header.payload.sig', expiresAt: Date.now() + expiresInMs, pubkey: 'a'.repeat(64) }),
  )
}

beforeEach(() => sessionStorage.clear())
afterEach(() => sessionStorage.clear())

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
    // Still correct to return null here — this genuinely is the end of the
    // session, and there is no refresh grant to recover it with.
    storeToken({ expiresInMs: -1 })
    const { result } = renderHook(() => useEstivaIdAuth())

    await expect(result.current.fetchAccessToken({ forceRefreshToken: false })).resolves.toBeNull()
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull()
  })

  it('is not authenticated with no token at all', () => {
    const { result } = renderHook(() => useEstivaIdAuth())
    expect(result.current.isAuthenticated).toBe(false)
  })
})
