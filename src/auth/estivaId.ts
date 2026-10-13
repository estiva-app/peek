/**
 * Peek's Estiva ID client: the package, bound to Peek's choices.
 *
 * The PKCE flow, token storage, silent renewal, sign-out and the shell-reason
 * vocabulary moved into `@estiva-app/identity` with SHA-4. What is left here is
 * the configuration — and configuration is the whole reason the package is a
 * factory rather than a module of free functions. Every value below is one Ship
 * answers differently, and hardcoding any of them in the package would have made
 * it come out Peek-shaped, which is the risk SHA-4 exists to name.
 *
 * The names are re-exported so the seventeen call sites across `src/` and the
 * Convex tree did not have to change. That is not shim-for-its-own-sake: a
 * rename touching seventeen files in the same commit as an auth extraction is
 * how a real regression hides in a diff nobody can read.
 *
 * ## What did NOT move, deliberately
 *
 * `useEstivaIdAuth.ts` — the `ConvexProviderWithAuth` adapter — stays in Peek.
 * If it were in the package, Ship and every future app would inherit a Convex
 * dependency to work around. Ship needs no adapter at all, and that is the test
 * that the line held (SHA-4's seam decision).
 */
import { createEstivaId } from '@estiva-app/identity'
import type { StoredToken } from '@estiva-app/identity'

export type { StoredToken }
export { SignInError } from '@estiva-app/identity'

/** The Estiva ID issuer this app signs in with. */
export const ESTIVA_ID_ORIGIN =
  (import.meta.env.VITE_ESTIVA_ID_ORIGIN as string | undefined) || 'https://id.estiva.app'

/** Matched against the token's `aud`; the row is seeded in estiva-id's `src/db/seed.ts`. */
export const CLIENT_ID = 'estiva-peek'

/**
 * Registered exactly, on both peek.estiva.app and localhost:5173.
 *
 * Ship's equivalent is its *current pathname*, because it routes on
 * `location.hash` and a fragment cannot survive the redirect chain. Neither
 * choice is more correct, which is exactly why the package takes it as config.
 */
export const CALLBACK_PATH = '/auth/callback'

const KEY_PREFIX = 'peek.estivaId'

/** Where the session is kept, in `localStorage`: another tab writing or removing it is a `storage` event on this key. */
export const SESSION_KEY = `${KEY_PREFIX}.token`

/**
 * The session lives in `localStorage`, shared by every tab, and the in-flight
 * sign-in in `sessionStorage` — the package's defaults, which Ship and Leaf
 * use too (PEE-3, Miky, 12 Oct).
 *
 * It used to be per tab, in `sessionStorage`, to keep a bearer token off a
 * shared machine's disk. That made every new tab sign in again through
 * Estiva ID's `/authorize`, about half a second before Desk could draw. A
 * "public computer" choice belongs to the sign-in review, not to a default.
 *
 * Sharing it has two consequences handled elsewhere: renewal is locked across
 * tabs in the package (a refresh token presented twice ends the session
 * everywhere), and every tab follows the others — `useEstivaIdAuth` re-reads the
 * session when another tab renews or signs out.
 */
const client = createEstivaId({
  base: ESTIVA_ID_ORIGIN,
  clientId: CLIENT_ID,
  redirectUri: () => `${window.location.origin}${CALLBACK_PATH}`,
  keyPrefix: KEY_PREFIX,
  navigate: (url) => window.location.assign(url),
})

/**
 * A tab signed in before PEE-3 holds its session in `sessionStorage`. Moved
 * once, on its next load, so the deploy signs nobody out; a session another tab
 * already shares wins, and the tab's own is dropped.
 */
function adoptTabSession(): void {
  try {
    const own = window.sessionStorage.getItem(SESSION_KEY)
    if (own === null) return
    window.sessionStorage.removeItem(SESSION_KEY)
    if (window.localStorage.getItem(SESSION_KEY) === null) window.localStorage.setItem(SESSION_KEY, own)
  } catch {
    // No storage: there is nothing to move.
  }
}
if (typeof window !== 'undefined') adoptTabSession()

export const {
  codeChallenge,
  redirectUri,
  completeSignIn,
  refreshAccessToken,
  storedToken,
  validToken,
  beginSignOut,
  clearSession,
  hasPendingSignIn,
  clearPendingSignIn,
  takeReturnTo,
  stashShellReason,
  takeShellReason,
} = client

/**
 * Leave for the identity service, defaulting `returnTo` to where we are.
 *
 * The package requires `returnTo` explicitly rather than reading `location`
 * itself — Ship's routes live in the fragment and Peek's do not, so there is no
 * default the package could pick that is right for both. Peek's default is here.
 */
export function beginSignIn(
  returnTo = window.location.pathname + window.location.search,
  options: { silent?: boolean } = {},
): Promise<void> {
  return client.beginSignIn(returnTo, options)
}

/** True when this tab is holding a live Estiva ID token. */
export const hasEstivaIdSession = client.hasSession

/**
 * The access token to hand a Convex action that reads or writes the relay.
 *
 * Every one of those calls needs it, because Buzz answers a non-member with
 * `403 relay_membership_required` and the backend is a member of nothing. One
 * call site forgetting it is not a visible failure — the read comes back empty
 * and the widget renders nothing — so it is worth having a single name for "the
 * current user's token" rather than copies of `validToken()?.accessToken`.
 */
export const currentEstivaToken = client.currentAccessToken
