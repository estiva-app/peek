/**
 * The auth source `ConvexProviderWithAuth` reads when Peek is signed in with
 * Estiva ID (PEEK-104).
 *
 * ## There is no silent refresh, and that is a property of the system
 *
 * Estiva ID issues 10-minute tokens (`JWT_TTL_SECONDS=600`) and its discovery
 * document advertises exactly two grants — `authorization_code` and
 * `client_credentials`. **There is no `refresh_token`.** So when a token dies
 * there is nothing to exchange for a new one, and the only way to get another is
 * to visit `/authorize` again as a top-level navigation, because the session
 * cookie that authorises it is `SameSite=Lax`.
 *
 * A hidden iframe cannot do it either — Lax withholds the cookie from cross-site
 * subresources, which is the whole point of Lax.
 *
 * So `fetchAccessToken` reports expiry honestly by returning null. Convex then
 * renders `Unauthenticated`, and `AuthGate` offers the redirect. It deliberately
 * does **not** auto-redirect: a bounce triggered from inside a token fetch is
 * how you get a redirect loop when the identity session has also expired, and a
 * loop is a much worse failure than a button.
 *
 * The 10-minute window is short for a browser app. Raising `JWT_TTL_SECONDS`, or
 * adding a refresh grant, is a change on the identity side — worth doing before
 * anyone relies on a long uninterrupted session.
 */
import { useCallback, useEffect, useState } from 'react'
import { clearSession, validToken } from './estivaId'

export function useEstivaIdAuth() {
  // Seeded synchronously: the token is already in sessionStorage on first
  // render after the callback redirect, so there is no loading window to show
  // and no flash of the signed-out screen.
  const [isAuthenticated, setIsAuthenticated] = useState(() => validToken() !== null)

  useEffect(() => {
    if (!isAuthenticated) return
    const token = validToken()
    // Nothing to schedule: the initial state already reflects an absent token,
    // and a token that vanishes mid-session is caught by `fetchAccessToken`.
    if (!token) return
    // Flip to signed-out exactly when the token dies, rather than waiting for
    // the next query to fail. Without this the app looks authenticated while
    // every request is quietly refused.
    const timer = setTimeout(() => setIsAuthenticated(false), Math.max(0, token.expiresAt - Date.now()))
    return () => clearTimeout(timer)
  }, [isAuthenticated])

  const fetchAccessToken = useCallback(async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
    const token = validToken()
    if (!token) {
      // Expired or absent. Drop the remains so a stale token cannot be
      // presented later, and tell Convex plainly that there is no identity.
      clearSession()
      setIsAuthenticated(false)
      return null
    }
    // `forceRefreshToken` asks for a *newer* token than the one Convex holds.
    // We have no way to mint one (see the header), so the honest answers are
    // the token we have, or nothing — never a token we know Convex just rejected.
    if (forceRefreshToken) return null
    return token.accessToken
  }, [])

  return { isLoading: false, isAuthenticated, fetchAccessToken }
}
