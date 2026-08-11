/**
 * The PKCE exchange (PEEK-104).
 *
 * Two of these are security properties rather than behaviour: a code arriving
 * with the wrong `state` is the shape of a login-CSRF, and a verifier left
 * behind after a failed attempt is a second chance for someone else's code. Both
 * would pass any test that only checked the happy path.
 *
 * The rest pins the contract down, because it is genuinely surprising: the
 * request body is camelCase and the response is snake_case.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLIENT_ID, codeChallenge, completeSignIn, SignInError, storedToken } from './estivaId'

const VERIFIER_KEY = 'peek.estivaId.codeVerifier'
const STATE_KEY = 'peek.estivaId.state'
const RETURN_KEY = 'peek.estivaId.returnTo'

/** Primes the tab as if beginSignIn() had run and we came back. */
function primeTab({ verifier = 'v'.repeat(43), state = 'st4te', returnTo = '/topics/1' } = {}) {
  sessionStorage.setItem(VERIFIER_KEY, verifier)
  sessionStorage.setItem(STATE_KEY, state)
  sessionStorage.setItem(RETURN_KEY, returnTo)
}

function tokenResponse(body: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      access_token: 'header.payload.sig',
      token_type: 'Bearer',
      expires_in: 600,
      pubkey: 'a'.repeat(64),
      ...body,
    }),
  } as Response
}

beforeEach(() => sessionStorage.clear())
afterEach(() => vi.unstubAllGlobals())

describe('codeChallenge', () => {
  it('matches the RFC 7636 S256 test vector', async () => {
    // Not a self-consistent round trip: if our base64url or digest were wrong,
    // a round trip would still agree with itself and disagree with the server.
    expect(await codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    )
  })
})

describe('completeSignIn', () => {
  it('exchanges the code and keeps the token', async () => {
    primeTab()
    const fetchMock = vi.fn().mockResolvedValue(tokenResponse())
    vi.stubGlobal('fetch', fetchMock)

    const { token, returnTo } = await completeSignIn('?code=abc&state=st4te')

    expect(token.pubkey).toBe('a'.repeat(64))
    expect(returnTo).toBe('/topics/1')
    expect(storedToken()?.accessToken).toBe('header.payload.sig')

    // The contract that would otherwise only fail in production: camelCase in.
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body).toEqual({
      grantType: 'authorization_code',
      code: 'abc',
      clientId: CLIENT_ID,
      redirectUri: `${window.location.origin}/auth/callback`,
      codeVerifier: 'v'.repeat(43),
    })
  })

  it('expires the token ahead of the server, never behind it', async () => {
    primeTab()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(tokenResponse({ expires_in: 600 })))
    const before = Date.now()

    const { token } = await completeSignIn('?code=abc&state=st4te')

    // 600s minus the 30s safety margin. A token presented in that window is
    // alive by the clock and rejected by the server.
    expect(token.expiresAt).toBeLessThanOrEqual(before + 570_000)
    expect(token.expiresAt).toBeGreaterThan(before + 560_000)
  })

  it('refuses a code that comes back with the wrong state', async () => {
    primeTab({ state: 'ours' })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(completeSignIn('?code=abc&state=theirs')).rejects.toBeInstanceOf(SignInError)
    // The point: it is refused *before* the code is redeemed, not after.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('burns the verifier and state even when the attempt fails', async () => {
    primeTab({ state: 'ours' })
    vi.stubGlobal('fetch', vi.fn())

    await expect(completeSignIn('?code=abc&state=theirs')).rejects.toThrow()

    // Left behind, they are a live verifier waiting for a second code.
    expect(sessionStorage.getItem(VERIFIER_KEY)).toBeNull()
    expect(sessionStorage.getItem(STATE_KEY)).toBeNull()
  })

  it('refuses when the tab never started a sign-in', async () => {
    // No priming: someone pasted a callback URL, or the tab was reopened.
    await expect(completeSignIn('?code=abc&state=whatever')).rejects.toBeInstanceOf(SignInError)
  })

  it('surfaces an error handed back by the identity service', async () => {
    primeTab()
    await expect(completeSignIn('?error=access_denied&state=st4te')).rejects.toThrow(/access_denied/)
  })

  it('does not store a token when the exchange is refused', async () => {
    primeTab()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 } as Response))

    await expect(completeSignIn('?code=abc&state=st4te')).rejects.toBeInstanceOf(SignInError)
    expect(storedToken()).toBeNull()
  })
})
