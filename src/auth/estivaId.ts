/**
 * Signing in with Estiva ID — authorization code + PKCE (PEEK-104).
 *
 * Peek does not hold a password or a key; it sends you to the identity service
 * and gets back a token whose `sub` is your Nostr pubkey. `convex/auth.config.ts`
 * already trusts that issuer, and `convex/users.ts` already keys the viewer on
 * that pubkey — this file is the missing middle, the part that actually obtains
 * a token.
 *
 * ## Why a redirect rather than a fetch
 *
 * `POST /token` is reachable cross-origin, but the *session* that authorises the
 * redirect is a `SameSite=Lax` cookie on the identity origin. Lax cookies ride
 * top-level navigations and nothing else, so the only way to prove who you are
 * is to actually go there. That is deliberate on their side (PEEK-90): the
 * origin holding every custodied key does not relax its cookie or send
 * `Access-Control-Allow-Credentials`.
 *
 * ## The bits that must match exactly
 *
 * `redirect_uri` is compared **exact-string** against the app's registered list
 * — a trailing slash is a different URI and gets a 400 before anything else
 * happens. `/auth/callback` is the registered path on both origins.
 *
 * The request body is **camelCase JSON** (`codeVerifier`, not `code_verifier`),
 * while the response is snake_case (`access_token`). That is genuinely the
 * contract, not a typo here — see `docs/API.md` in estiva-id.
 */

/** Must equal `domain` in `convex/auth.config.ts` and `ESTIVA_ID_ISSUER` in `convex/users.ts`. */
export const ESTIVA_ID_ORIGIN =
  (import.meta.env.VITE_ESTIVA_ID_ORIGIN as string | undefined) || 'https://id.estiva.app'

/** Matched against the token's `aud`; the row is seeded in estiva-id's `src/db/seed.ts`. */
export const CLIENT_ID = 'estiva-peek'

/** Registered exactly, on both peek.estiva.app and localhost:5173. */
export const CALLBACK_PATH = '/auth/callback'

const VERIFIER_KEY = 'peek.estivaId.codeVerifier'
const STATE_KEY = 'peek.estivaId.state'
const RETURN_KEY = 'peek.estivaId.returnTo'
const TOKEN_KEY = 'peek.estivaId.token'

export interface StoredToken {
  accessToken: string
  /** Epoch ms. Derived from `expires_in` at receipt, not sent by the server. */
  expiresAt: number
  pubkey: string
}

/**
 * Tokens live in `sessionStorage`, not `localStorage`.
 *
 * Neither survives a determined XSS, but sessionStorage is scoped to the tab and
 * dies with it, which keeps a bearer token off a shared machine's disk. The
 * token is short-lived anyway (see `fetchAccessToken`), so persistence buys
 * little. Revisit if PEEK-41 makes this the only sign-in and the tab-scoping
 * becomes annoying rather than prudent.
 */
const store = (): Storage | null => (typeof window === 'undefined' ? null : window.sessionStorage)

function randomUrlSafe(bytes = 32): string {
  const raw = new Uint8Array(bytes)
  crypto.getRandomValues(raw)
  return base64Url(raw)
}

function base64Url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** `base64url(sha256(verifier))` — the S256 challenge. `plain` is refused upstream. */
export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64Url(new Uint8Array(digest))
}

export function redirectUri(): string {
  return `${window.location.origin}${CALLBACK_PATH}`
}

/**
 * Leave for the identity service. Never returns — the browser navigates away.
 *
 * `returnTo` is kept locally rather than smuggled through `state`: `state` is a
 * CSRF token and widening it into a general-purpose payload invites treating
 * whatever comes back as trustworthy. What comes back is only ever compared.
 */
export async function beginSignIn(returnTo = window.location.pathname + window.location.search): Promise<void> {
  const s = store()
  if (!s) throw new Error('sign-in requires a browser')

  const verifier = randomUrlSafe()
  const state = randomUrlSafe(16)
  s.setItem(VERIFIER_KEY, verifier)
  s.setItem(STATE_KEY, state)
  s.setItem(RETURN_KEY, returnTo)

  const url = new URL('/authorize', ESTIVA_ID_ORIGIN)
  url.searchParams.set('client_id', CLIENT_ID)
  url.searchParams.set('redirect_uri', redirectUri())
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('code_challenge', await codeChallenge(verifier))
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', state)
  window.location.assign(url.toString())
}

export class SignInError extends Error {}

/**
 * Finish the round trip: verify `state`, redeem the code, keep the token.
 *
 * Returns where to send the person next. Throws `SignInError` with something a
 * human can read — every refusal from `/token` is a deliberately uniform
 * `invalid_grant`, so the useful detail is on our side of the exchange.
 */
export async function completeSignIn(search: string): Promise<{ token: StoredToken; returnTo: string }> {
  const s = store()
  if (!s) throw new SignInError('sign-in requires a browser')

  const params = new URLSearchParams(search)
  const error = params.get('error')
  if (error) throw new SignInError(`Estiva ID refused the sign-in (${error}).`)

  const code = params.get('code')
  const state = params.get('state')
  const expectedState = s.getItem(STATE_KEY)
  const verifier = s.getItem(VERIFIER_KEY)
  const returnTo = s.getItem(RETURN_KEY) || '/'

  // Clear first: these are single-use, and a failed attempt must not leave a
  // verifier lying around for a second code to be redeemed against.
  s.removeItem(STATE_KEY)
  s.removeItem(VERIFIER_KEY)
  s.removeItem(RETURN_KEY)

  if (!code) throw new SignInError('Estiva ID sent no authorization code back.')
  if (!verifier || !expectedState) {
    throw new SignInError('This sign-in did not start in this tab. Try signing in again.')
  }
  if (state !== expectedState) {
    // The one check that is not about ergonomics: a code arriving with someone
    // else's state is the shape of a login-CSRF, and it is refused outright.
    throw new SignInError('Sign-in state did not match. Try signing in again.')
  }

  const response = await fetch(new URL('/token', ESTIVA_ID_ORIGIN), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // camelCase — see the file header.
    body: JSON.stringify({
      grantType: 'authorization_code',
      code,
      clientId: CLIENT_ID,
      redirectUri: redirectUri(),
      codeVerifier: verifier,
    }),
  })

  if (!response.ok) {
    throw new SignInError(
      response.status === 400
        ? 'Estiva ID rejected this sign-in code. It may have expired — codes last 60 seconds.'
        : `Estiva ID returned ${response.status} exchanging the code.`,
    )
  }

  const body = (await response.json()) as { access_token?: string; expires_in?: number; pubkey?: string }
  if (!body.access_token || !body.pubkey) throw new SignInError('Estiva ID returned no token.')

  const token: StoredToken = {
    accessToken: body.access_token,
    // Deliberately pessimistic by 30s so a token is never presented to Convex in
    // the window where it is technically alive and about to not be.
    expiresAt: Date.now() + Math.max(0, (body.expires_in ?? 600) - 30) * 1000,
    pubkey: body.pubkey,
  }
  s.setItem(TOKEN_KEY, JSON.stringify(token))
  return { token, returnTo }
}

export function storedToken(): StoredToken | null {
  const raw = store()?.getItem(TOKEN_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as StoredToken
    return parsed.accessToken && parsed.expiresAt ? parsed : null
  } catch {
    return null
  }
}

/** A token that is present *and* still usable. */
export function validToken(now = Date.now()): StoredToken | null {
  const t = storedToken()
  return t && t.expiresAt > now ? t : null
}

/** True when this tab is holding a live Estiva ID token. */
export function hasEstivaIdSession(): boolean {
  return validToken() !== null
}

/**
 * The access token to hand a Convex action that reads or writes the relay.
 *
 * Every one of those calls needs it, because Buzz answers a non-member with
 * `403 relay_membership_required` and the backend is a member of nothing. One
 * call site forgetting it is not a visible failure — the read comes back empty
 * and the widget renders nothing — so it is worth having a single name for
 * "the current user's token" rather than six copies of `validToken()?.accessToken`.
 */
export function currentEstivaToken(): string | undefined {
  return validToken()?.accessToken
}

export function clearSession(): void {
  const s = store()
  if (!s) return
  for (const k of [TOKEN_KEY, VERIFIER_KEY, STATE_KEY, RETURN_KEY]) s.removeItem(k)
}
