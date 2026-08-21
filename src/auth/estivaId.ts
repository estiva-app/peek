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
import { type ShellReason, clearGuard, markGuard } from './shell/contract'

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
/** Why the last round trip came back empty, handed from the callback to the shell. */
const REASON_KEY = 'peek.estivaId.shellReason'

export interface StoredToken {
  accessToken: string
  /** Epoch ms. Derived from `expires_in` at receipt, not sent by the server. */
  expiresAt: number
  pubkey: string
  /**
   * The credential that renews the one above without a redirect (PEEK-108).
   *
   * Absent when Estiva ID issued none — a deployment predating the grant. The
   * app then behaves exactly as it did before, which is what lets the two sides
   * ship independently.
   *
   * **Single-use.** Estiva ID rotates it on every redemption and treats a
   * replay as evidence of theft, revoking the whole chain. So it is replaced,
   * never kept alongside its successor.
   */
  refreshToken?: string
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
export async function beginSignIn(
  returnTo = window.location.pathname + window.location.search,
  { silent = false }: { silent?: boolean } = {},
): Promise<void> {
  const s = store()
  if (!s) throw new Error('sign-in requires a browser')

  const verifier = randomUrlSafe()
  const state = randomUrlSafe(16)
  s.setItem(VERIFIER_KEY, verifier)
  s.setItem(STATE_KEY, state)
  s.setItem(RETURN_KEY, returnTo)

  /**
   * The guard is marked **here**, synchronously with the writes above, and not
   * further down next to the navigation (PEEK-167).
   *
   * It used to sit just before `window.location.assign`, which reads as the
   * same thing and is not: `codeChallenge` awaits a `crypto.subtle` digest in
   * between. For that whole window the verifier and state have already been
   * overwritten while `readGuard` still answers `null`, so a second `decideBoot`
   * landing in it decides to probe as well.
   *
   * Two probes then write two verifier/state pairs into one tab's
   * `sessionStorage`, and only one of the two navigations commits. When the one
   * that commits is not the one that wrote last, the code comes back matched to
   * a state that is no longer there and `completeSignIn` refuses it — an
   * `exchange_failed` for a code that was never even presented to `/token`.
   *
   * Marking it with the other single-use writes is what makes the guard cover
   * the window it exists for: they are the things this attempt has already
   * spent, and they become true together or not at all.
   */
  if (silent) markGuard(s, Date.now())

  const url = new URL('/authorize', ESTIVA_ID_ORIGIN)
  url.searchParams.set('client_id', CLIENT_ID)
  url.searchParams.set('redirect_uri', redirectUri())
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('code_challenge', await codeChallenge(verifier))
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', state)

  /**
   * A silent attempt asks not to be prompted (PEEK-117), so a browser with no
   * session comes straight back with `error=login_required` instead of landing
   * on the identity origin's sign-in page.
   */
  if (silent) url.searchParams.set('prompt', 'none')

  window.location.assign(url.toString())
}

/**
 * Where to go back to, as stashed by `beginSignIn`.
 *
 * Single-use, like the reason. The refusal path needs this as much as the
 * success path does: a silent probe that comes back `login_required` was still
 * started from somewhere, and dropping it puts people on the desk instead of
 * the link they opened (PEEK-123).
 */
export function takeReturnTo(): string | null {
  const s = store()
  const raw = s?.getItem(RETURN_KEY)
  if (raw) s?.removeItem(RETURN_KEY)
  return raw ?? null
}

/** Hand the shell a reason across the full page load the callback ends in. */
export function stashShellReason(reason: ShellReason): void {
  store()?.setItem(REASON_KEY, reason)
}

/** Read it once. Single-use: a stale reason outliving its cause is a lie. */
export function takeShellReason(): ShellReason | null {
  const s = store()
  const raw = s?.getItem(REASON_KEY)
  if (raw) s?.removeItem(REASON_KEY)
  return (raw as ShellReason | null) ?? null
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

  const body = (await response.json()) as TokenResponse
  if (!body.access_token || !body.pubkey) throw new SignInError('Estiva ID returned no token.')

  const token = tokenFrom(body, body.pubkey)
  s.setItem(TOKEN_KEY, JSON.stringify(token))
  // The attempt worked, so the next boot is entitled to a fresh silent one.
  clearGuard(s)
  return { token, returnTo }
}

interface TokenResponse {
  access_token?: string
  expires_in?: number
  pubkey?: string
  refresh_token?: string
}

/**
 * Shape a token response into what we keep.
 *
 * The expiry is deliberately pessimistic by 30s so a token is never presented
 * to Convex in the window where it is technically alive and about to not be.
 */
function tokenFrom(body: TokenResponse, pubkey: string): StoredToken {
  return {
    accessToken: body.access_token as string,
    expiresAt: Date.now() + Math.max(0, (body.expires_in ?? 600) - 30) * 1000,
    pubkey,
    ...(body.refresh_token ? { refreshToken: body.refresh_token } : {}),
  }
}

/**
 * Renew the access token without leaving the page (PEEK-108).
 *
 * This is the whole reason the grant exists. Before it, an expired token could
 * only be replaced by a top-level navigation through `/authorize`, which costs
 * whatever the person had on screen.
 *
 * Returns `null` for every failure, and the failures are not worth
 * distinguishing here: Estiva ID answers `invalid_grant` for all of them by
 * design, and the caller's only move either way is to fall back to the shell.
 * The stored token is cleared on failure so a spent refresh token is never
 * presented twice — a replay is what Estiva ID treats as theft.
 */
export async function refreshAccessToken(): Promise<StoredToken | null> {
  const s = store()
  const current = storedToken()
  if (!s || !current?.refreshToken) return null

  let response: Response
  try {
    response = await fetch(new URL('/token', ESTIVA_ID_ORIGIN), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grantType: 'refresh_token',
        refreshToken: current.refreshToken,
        clientId: CLIENT_ID,
      }),
    })
  } catch {
    // Unreachable rather than refused. The token we hold may still be fine, so
    // this deliberately does not clear the session — a flaky network must not
    // sign somebody out.
    return null
  }

  if (!response.ok) {
    clearSession()
    return null
  }

  const body = (await response.json()) as TokenResponse
  if (!body.access_token) {
    clearSession()
    return null
  }

  const next = tokenFrom(body, body.pubkey ?? current.pubkey)
  s.setItem(TOKEN_KEY, JSON.stringify(next))
  return next
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

/**
 * Leave for Estiva ID to end the session there (PEEK-122).
 *
 * Clearing the local token is not signing out. The `estiva_id_session` cookie
 * on the identity origin is untouched by it, so the shell's silent probe
 * succeeds on the next boot and puts the person straight back in — which is
 * exactly what "sign out doesn't sign me out" was.
 *
 * The cookie can only be reached by going there, for the same reason entry
 * works the way it does. The reason is stashed first so the shell offers a
 * passkey on return rather than silently probing for a session we just ended.
 */
export function beginSignOut(): void {
  clearSession()
  // Going to /logout makes any half-started sign-in moot, and this is the one
  // caller that genuinely means both.
  clearPendingSignIn()
  stashShellReason('no_session')
  const url = new URL('/logout', ESTIVA_ID_ORIGIN)
  url.searchParams.set('client_id', CLIENT_ID)
  url.searchParams.set('post_logout_redirect_uri', redirectUri())
  window.location.assign(url.toString())
}

/**
 * Forget this app's session. **Not** an in-flight sign-in — see below.
 *
 * This used to clear the verifier, state and `returnTo` as well, which reads as
 * thoroughness and is a bug (PEEK-167). Those three are not session state: they
 * are the credentials of an authorization request that is *currently in the
 * air*, owned by the `beginSignIn` that wrote them and spent by the
 * `completeSignIn` that comes back. Clearing them on somebody else's schedule
 * does not tidy anything up — it destroys a sign-in that is still happening.
 *
 * The path that made it matter: a boot whose token has expired calls
 * `fetchAccessToken`, which fails to renew and clears the session, which drops
 * the app to the shell, which probes and writes a fresh verifier. A *second*
 * `fetchAccessToken` awaiting the same in-flight renewal then resolves and
 * clears again — now deleting the verifier the probe has just written. The
 * code comes back to a tab that no longer has anything to redeem it with, and
 * `completeSignIn` refuses it before `/token` is ever called. The person is
 * told the sign-in did not complete, and the identity service has no record of
 * a failure at all, because nothing was ever asked of it.
 *
 * So the two are separated. Anything that wants both says so, and only
 * `beginSignOut` does.
 */
export function clearSession(): void {
  const s = store()
  if (!s) return
  for (const k of [TOKEN_KEY, REASON_KEY]) s.removeItem(k)
}

/**
 * Abandon a sign-in that has not come back.
 *
 * Deliberately not called on any failure path. A verifier outliving its attempt
 * is harmless — `completeSignIn` clears all three before it does anything else,
 * and a stale one cannot redeem a code that was issued against a different
 * challenge. Destroying a live one is the expensive direction, so this is only
 * for the case where we know the attempt is moot: we are leaving for `/logout`.
 */
export function clearPendingSignIn(): void {
  const s = store()
  if (!s) return
  for (const k of [VERIFIER_KEY, STATE_KEY, RETURN_KEY]) s.removeItem(k)
}
