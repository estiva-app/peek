// @vitest-environment jsdom
/**
 * The Estiva ID session's signed-in state and its renewal timer (PEEK-108).
 *
 * The renewal cases are REM-7's: until then the Convex client renewed the token
 * on its own schedule, which hid a timer that renewed once and never again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { RENEWAL_WAIT_MS, useEstivaIdAuth } from './useEstivaIdAuth'
import { useSessionResumed } from './heldSession'

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
    calls.push(Object.fromEntries(new URLSearchParams(init?.body ?? '')))
    return {
      ok: response.ok,
      status: response.ok ? 200 : 400,
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

  it('is not authenticated with an expired token and nothing to renew it with', () => {
    storeToken({ expiresInMs: -1000 })
    const { result } = renderHook(() => useEstivaIdAuth())
    expect(result.current.isAuthenticated).toBe(false)
    expect(result.current.renewing).toBe(false)
  })

  it('coming back with an expired token renews it in place, without leaving the page (AUT-3)', async () => {
    storeToken({ expiresInMs: -1000, refreshToken: 'r1' })
    const calls = stubTokenEndpoint({
      ok: true,
      body: { access_token: 'fresh.token.sig', expires_in: 600, refresh_token: 'r2' },
    })
    const { result } = renderHook(() => useEstivaIdAuth())
    // Nothing is decided while the renewal is out: the shell must not flash.
    expect(result.current).toMatchObject({ isAuthenticated: false, renewing: true })

    await act(async () => {})
    expect(calls).toEqual([{ grant_type: 'refresh_token', refresh_token: 'r1', client_id: 'estiva-peek' }])
    expect(result.current).toMatchObject({ isAuthenticated: true, renewing: false })
  })

  it('a refused renewal on the way in hands the shell "session ended", to ask on this page', async () => {
    storeToken({ expiresInMs: -1000, refreshToken: 'spent' })
    stubTokenEndpoint({ ok: false })
    const { result } = renderHook(() => useEstivaIdAuth())

    await act(async () => {})
    expect(result.current).toMatchObject({ isAuthenticated: false, renewing: false })
    expect(sessionStorage.getItem('peek.estivaId.shellReason')).toBe('session_expired')
  })

  it('opened while Estiva ID cannot be reached, it enters on what the device holds and renews once the network is back', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    storeToken({ expiresInMs: -1000, refreshToken: 'r1' })
    let online = false
    const calls: unknown[] = []
    globalThis.fetch = (async (_url: unknown, init: { body?: string }) => {
      calls.push(Object.fromEntries(new URLSearchParams(init?.body ?? '')))
      if (!online) throw new TypeError('Failed to fetch')
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'fresh.token.sig', expires_in: 600, refresh_token: 'r2' }),
      } as Response
    }) as typeof fetch
    const { result } = renderHook(() => useEstivaIdAuth())
    const resumed = renderHook(() => useSessionResumed())
    const before = resumed.result.current

    await act(() => vi.advanceTimersByTimeAsync(0))
    // In, on the expired token, with no sign-in screen and nothing cleared.
    expect(result.current).toMatchObject({ isAuthenticated: true, renewing: false })
    expect(sessionStorage.getItem('peek.estivaId.shellReason')).toBeNull()
    expect(JSON.parse(localStorage.getItem(TOKEN_KEY) as string)).toMatchObject({ refreshToken: 'r1' })

    online = true
    await act(async () => {
      window.dispatchEvent(new Event('online'))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(calls.at(-1)).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'r1' })
    expect(JSON.parse(localStorage.getItem(TOKEN_KEY) as string)).toMatchObject({
      accessToken: 'fresh.token.sig',
      refreshToken: 'r2',
    })
    expect(result.current.isAuthenticated).toBe(true)
    // The reads that ran once on the expired token are told to read the relay again.
    expect(resumed.result.current).toBe(before + 1)
  })

  it('a token that ran out while offline mid-session tells the reads to ask the relay again once it renews', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    storeToken({ expiresInMs: 60_000, refreshToken: 'r1' })
    let online = false
    globalThis.fetch = (async () => {
      if (!online) throw new TypeError('Failed to fetch')
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'fresh.token.sig', expires_in: 600, refresh_token: 'r2' }),
      } as Response
    }) as typeof fetch
    const { result } = renderHook(() => useEstivaIdAuth())
    const resumed = renderHook(() => useSessionResumed())
    const before = resumed.result.current

    // Due, then a minute with no network: the token's real end has passed.
    await act(() => vi.advanceTimersByTimeAsync(120_000))
    expect(result.current.isAuthenticated).toBe(true)
    online = true
    await act(async () => {
      window.dispatchEvent(new Event('online'))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(JSON.parse(localStorage.getItem(TOKEN_KEY) as string)).toMatchObject({ refreshToken: 'r2' })
    expect(resumed.result.current).toBe(before + 1)
  })

  it('a routine renewal before the token runs out does not make the reads ask again', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    storeToken({ expiresInMs: 60_000, refreshToken: 'r1' })
    stubTokenEndpoint({ ok: true, body: { access_token: 'fresh.token.sig', expires_in: 600, refresh_token: 'r2' } })
    renderHook(() => useEstivaIdAuth())
    const resumed = renderHook(() => useSessionResumed())
    const before = resumed.result.current

    await act(() => vi.advanceTimersByTimeAsync(60_000))
    expect(JSON.parse(localStorage.getItem(TOKEN_KEY) as string)).toMatchObject({ refreshToken: 'r2' })
    expect(resumed.result.current).toBe(before)
  })

  it('a renewal the network never answers does not hold a blank page: it enters on what the device holds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    storeToken({ expiresInMs: -1000, refreshToken: 'r1' })
    let fail: (error: Error) => void = () => {}
    globalThis.fetch = (() => new Promise((_, reject) => (fail = reject))) as typeof fetch
    const { result, unmount } = renderHook(() => useEstivaIdAuth())

    await act(() => vi.advanceTimersByTimeAsync(RENEWAL_WAIT_MS - 1))
    expect(result.current).toMatchObject({ isAuthenticated: false, renewing: true })
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(result.current).toMatchObject({ isAuthenticated: true, renewing: false })
    expect(sessionStorage.getItem('peek.estivaId.shellReason')).toBeNull()

    // Settled, or the client's one renewal in flight starves the next test's.
    unmount()
    await act(async () => fail(new TypeError('Failed to fetch')))
    await act(() => vi.advanceTimersByTimeAsync(500))
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
    expect(calls[0]).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'r1' })
    // The rotated token replaces the spent one. Keeping the old one alongside
    // it would eventually present a spent token, which Estiva ID reads as theft.
    expect(JSON.parse(localStorage.getItem(TOKEN_KEY) as string)).toMatchObject({ refreshToken: 'r2' })
    expect(result.current.isAuthenticated).toBe(true)

    // The defect: nothing scheduled a second renewal.
    await act(() => vi.advanceTimersByTimeAsync(600_000))
    expect(calls).toHaveLength(2)
    expect(calls[1]).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'r2' })
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

  it('an expired token another tab writes does not sign in a tab that is out', () => {
    const { result } = renderHook(() => useEstivaIdAuth())
    expect(result.current.isAuthenticated).toBe(false)
    act(() =>
      otherTabWrites(JSON.stringify({ accessToken: 'old.token.sig', expiresAt: Date.now() - 60_000, pubkey: 'a'.repeat(64) })),
    )
    expect(result.current.isAuthenticated).toBe(false)
  })

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

  it('a tab’s own session is not moved after a sign-out on this device', async () => {
    localStorage.setItem('peek-device-copy-owner', 'signed-out')
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ accessToken: 'mine', expiresAt: Date.now() + 600_000, pubkey: 'a'.repeat(64) }))
    vi.resetModules()
    const { validToken } = await import('./estivaId')
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull()
    expect(validToken()).toBeNull()
  })

  it('somebody else’s session replacing this one is entered by reloading', () => {
    const reload = vi.fn()
    const realLocation = window.location
    Object.defineProperty(window, 'location', { configurable: true, value: { ...realLocation, reload } })
    try {
      storeToken()
      renderHook(() => useEstivaIdAuth())
      act(() => otherTabWrites(JSON.stringify({ accessToken: 'y', expiresAt: Date.now() + 600_000, pubkey: 'b'.repeat(64) })))
      expect(reload).toHaveBeenCalledTimes(1)
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
    }
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
