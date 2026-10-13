// @vitest-environment jsdom
/**
 * The Estiva ID session's signed-in state and its renewal timer (PEEK-108).
 *
 * The renewal cases are REM-7's: until then the Convex client renewed the token
 * on its own schedule, which hid a timer that renewed once and never again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useEstivaIdAuth } from './useEstivaIdAuth'

const TOKEN_KEY = 'peek.estivaId.token'

function storeToken({ expiresInMs = 600_000, refreshToken = undefined as string | undefined } = {}) {
  localStorage.setItem(
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
beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})
afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
  globalThis.fetch = realFetch
})

describe('useEstivaIdAuth', () => {
  it('is authenticated when a live token is present', () => {
    storeToken()
    const { result } = renderHook(() => useEstivaIdAuth())
    // No loading window: the token is in storage before first render, so a
    // signed-in reload must never flash the signed-out screen.
    expect(result.current.isAuthenticated).toBe(true)
  })

  it('is not authenticated with no token at all', () => {
    const { result } = renderHook(() => useEstivaIdAuth())
    expect(result.current.isAuthenticated).toBe(false)
  })

  it('is not authenticated with an expired token', () => {
    storeToken({ expiresInMs: -1000, refreshToken: 'r1' })
    const { result } = renderHook(() => useEstivaIdAuth())
    expect(result.current.isAuthenticated).toBe(false)
  })

  it('renews at expiry, and again at the renewed token’s expiry', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    storeToken({ expiresInMs: 60_000, refreshToken: 'r1' })
    const calls = stubTokenEndpoint({
      ok: true,
      body: { access_token: 'fresh.token.sig', expires_in: 600, refresh_token: 'r2' },
    })
    const { result } = renderHook(() => useEstivaIdAuth())

    await act(() => vi.advanceTimersByTimeAsync(60_000))
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ grantType: 'refresh_token', refreshToken: 'r1' })
    // The rotated token replaces the spent one. Keeping the old one alongside
    // it would eventually present a spent token, which Estiva ID reads as theft.
    expect(JSON.parse(localStorage.getItem(TOKEN_KEY) as string)).toMatchObject({ refreshToken: 'r2' })
    expect(result.current.isAuthenticated).toBe(true)

    // The defect: nothing scheduled a second renewal.
    await act(() => vi.advanceTimersByTimeAsync(600_000))
    expect(calls).toHaveLength(2)
    expect(calls[1]).toMatchObject({ grantType: 'refresh_token', refreshToken: 'r2' })
    expect(result.current.isAuthenticated).toBe(true)
  })

  it('reports no identity when the refresh token is refused', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    storeToken({ expiresInMs: 60_000, refreshToken: 'spent' })
    stubTokenEndpoint({ ok: false })
    const { result } = renderHook(() => useEstivaIdAuth())

    await act(() => vi.advanceTimersByTimeAsync(60_000))
    expect(result.current.isAuthenticated).toBe(false)
    // Cleared, so the shell starts from nothing rather than retrying a token
    // Estiva ID has already revoked.
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
  })
})

describe('one session for every tab (PEE-3)', () => {
  /** What this tab sees when another tab writes the shared session. */
  function otherTabWrites(value: string | null) {
    if (value === null) localStorage.removeItem(TOKEN_KEY)
    else localStorage.setItem(TOKEN_KEY, value)
    window.dispatchEvent(new StorageEvent('storage', { key: TOKEN_KEY, newValue: value, storageArea: localStorage }))
  }

  it('another tab signing out drops this one to the shell at once', () => {
    storeToken()
    const { result } = renderHook(() => useEstivaIdAuth())
    expect(result.current.isAuthenticated).toBe(true)

    act(() => otherTabWrites(null))
    expect(result.current.isAuthenticated).toBe(false)
    // The same plain sign-in screen the signing-out tab shows, not "your session ended".
    expect(sessionStorage.getItem('peek.estivaId.shellReason')).toBe('no_session')
  })

  it('a session that appears after this tab lost it is entered by reloading, not re-mounting', () => {
    // This page's stores still hold what the last session read — perhaps somebody else's.
    const reload = vi.fn()
    const realLocation = window.location
    Object.defineProperty(window, 'location', { configurable: true, value: { ...realLocation, reload } })
    try {
      storeToken()
      const { result } = renderHook(() => useEstivaIdAuth())
      act(() => otherTabWrites(null))
      act(() => otherTabWrites(JSON.stringify({ accessToken: 'next', expiresAt: Date.now() + 600_000, pubkey: 'b'.repeat(64) })))
      expect(reload).toHaveBeenCalledTimes(1)
      expect(result.current.isAuthenticated).toBe(false)
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
    }
  })

  it('another tab renewing re-arms this tab from the new expiry instead of renewing again', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    storeToken({ expiresInMs: 60_000, refreshToken: 'r1' })
    const calls = stubTokenEndpoint({ ok: true, body: { access_token: 'x', expires_in: 600, refresh_token: 'r9' } })
    const { result } = renderHook(() => useEstivaIdAuth())

    act(() =>
      otherTabWrites(
        JSON.stringify({ accessToken: 'theirs', expiresAt: Date.now() + 600_000, pubkey: 'a'.repeat(64), refreshToken: 'r2' }),
      ),
    )
    await act(() => vi.advanceTimersByTimeAsync(60_000))
    expect(calls).toHaveLength(0)
    expect(result.current.isAuthenticated).toBe(true)
  })

  it('a session somebody else in this browser stored is not this tab’s concern', () => {
    // The control: a storage event for another key changes nothing.
    storeToken()
    const { result } = renderHook(() => useEstivaIdAuth())
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'ship.estiva-id.token', newValue: null, storageArea: localStorage }))
    })
    expect(result.current.isAuthenticated).toBe(true)
  })

  it('a tab signed in before PEE-3 keeps its session: moved from sessionStorage once', async () => {
    const own = JSON.stringify({ accessToken: 'mine', expiresAt: Date.now() + 600_000, pubkey: 'a'.repeat(64) })
    sessionStorage.setItem(TOKEN_KEY, own)
    vi.resetModules()
    const { validToken } = await import('./estivaId')
    expect(localStorage.getItem(TOKEN_KEY)).toBe(own)
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull()
    expect(validToken()?.accessToken).toBe('mine')
  })

  it('a session the tabs already share wins over the tab’s own', async () => {
    storeToken()
    const shared = localStorage.getItem(TOKEN_KEY)
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ accessToken: 'mine', expiresAt: Date.now() + 600_000, pubkey: 'a'.repeat(64) }))
    vi.resetModules()
    await import('./estivaId')
    expect(localStorage.getItem(TOKEN_KEY)).toBe(shared)
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull()
  })
})
