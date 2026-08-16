/**
 * The auth source `ConvexProviderWithAuth` reads when Peek is signed in with
 * Estiva ID (PEEK-104).
 *
 * ## There is a silent refresh now (PEEK-108)
 *
 * There used to not be, and this file explained at length why: no
 * `refresh_token` grant, and the session cookie that would authorise a silent
 * renewal is `SameSite=Lax`, withheld from the hidden iframe such a renewal
 * would need. So an expired token could only be replaced by a top-level
 * navigation, and this hook's honest answer was `null`.
 *
 * Estiva ID issues refresh tokens now, so an expiry costs a `fetch` instead of
 * the page. The constraint that shaped the old design has not gone away — the
 * cookie is still `SameSite=Lax` — but the refresh token is a credential the
 * app holds itself, so renewing it needs no cookie at all.
 *
 * The fallback is unchanged and still matters: when refresh fails, this reports
 * no identity and the auth shell takes over. A refresh token is revoked by
 * signing out and by offboarding, so "refresh failed" is a real state rather
 * than a theoretical one.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { clearSession, refreshAccessToken, validToken } from './estivaId'

export function useEstivaIdAuth() {
  // Seeded synchronously: the token is already in sessionStorage on first
  // render after the callback redirect, so there is no loading window to show
  // and no flash of the signed-out screen.
  const [isAuthenticated, setIsAuthenticated] = useState(() => validToken() !== null)
  // Guards against two refreshes in flight at once. A refresh token is
  // single-use, so the second would present a spent one — which Estiva ID
  // treats as theft and answers by revoking the whole chain.
  const refreshing = useRef<Promise<string | null> | null>(null)

  useEffect(() => {
    if (!isAuthenticated) return
    const token = validToken()
    if (!token) return

    /**
     * Renew shortly *before* expiry rather than reacting to it.
     *
     * The old timer flipped straight to signed-out, which was the only thing it
     * could do. Now the same moment is a renewal, and the person notices
     * nothing — which is the entire point of the ticket. Only a failed renewal
     * ends the session.
     */
    const timer = setTimeout(
      () => {
        void refreshAccessToken().then((next) => {
          if (!next) setIsAuthenticated(false)
          // On success the state does not change; the effect re-runs because
          // `validToken()` now returns a later expiry, rescheduling this timer.
          else setIsAuthenticated(true)
        })
      },
      Math.max(0, token.expiresAt - Date.now()),
    )
    return () => clearTimeout(timer)
    // `isAuthenticated` alone is not enough to re-run this after a successful
    // renewal, since it does not change — the token's expiry is what moved.
  }, [isAuthenticated])

  /**
   * `forceRefreshToken` is still deliberately not honoured when the held token
   * is live, and getting this wrong broke sign-in completely.
   *
   * Convex asks for a fresher token **the instant the server confirms the first
   * one** — `onTransition` calls `refetchToken()` immediately unless
   * `initialAuthTokenReuse` is set. Answering `null` there is not read as "the
   * token you have is still fine"; `refetchToken` treats a null as *"refetching
   * token failed"*, calls `clearAuth()` and reports auth failed. So a perfectly
   * valid session was torn down milliseconds after it was established.
   *
   * Honouring the flag literally would now be worse than null, not better: it
   * would spend a single-use refresh token on every mount, for a token that has
   * ten minutes left. Returning the one we hold is honest and safe — Convex
   * compares it, sees nothing new, and settles into `notRefetching`.
   */
  const fetchAccessToken = useCallback<(args: { forceRefreshToken: boolean }) => Promise<string | null>>(
    async () => {
      const token = validToken()
      if (token) return token.accessToken

      // Expired or absent. Try to renew before declaring the session over —
      // this is the path that used to end at the sign-in screen.
      refreshing.current ??= refreshAccessToken()
        .then((next) => next?.accessToken ?? null)
        .finally(() => {
          refreshing.current = null
        })

      const renewed = await refreshing.current
      if (renewed) {
        setIsAuthenticated(true)
        return renewed
      }

      // Nothing left to try. Drop the remains so a stale token cannot be
      // presented later, and tell Convex plainly that there is no identity.
      clearSession()
      setIsAuthenticated(false)
      return null
    },
    [],
  )

  return { isLoading: false, isAuthenticated, fetchAccessToken }
}
