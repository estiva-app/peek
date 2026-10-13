/**
 * Whether this tab is signed in with Estiva ID, kept true by renewing the
 * token before it runs out (PEEK-104, PEEK-108).
 *
 * ## There is a silent refresh (PEEK-108)
 *
 * There used to not be: no `refresh_token` grant, and the session cookie that
 * would authorise a silent renewal is `SameSite=Lax`, withheld from the hidden
 * iframe such a renewal would need. So an expired token could only be replaced
 * by a top-level navigation.
 *
 * Estiva ID issues refresh tokens now, so an expiry costs a `fetch` instead of
 * the page. The cookie is still `SameSite=Lax`, but the refresh token is a
 * credential the app holds itself, so renewing it needs no cookie at all.
 *
 * When refresh fails, this reports no identity and the auth shell takes over.
 * A refresh token is revoked by signing out and by offboarding, so "refresh
 * failed" is a real state rather than a theoretical one.
 *
 * ## The timer is the only renewal (REM-7)
 *
 * Until REM-7 this was also the `useAuth` that `ConvexProviderWithAuth` read,
 * and the Convex client asked it for a token on its own schedule, renewing one
 * that had run out. That hid a defect here: the timer was keyed on
 * `isAuthenticated`, which a successful renewal does not change, so it renewed
 * once and never rescheduled. It is keyed on the token's expiry now, so each
 * renewal schedules the next.
 */
import { useEffect, useState } from 'react'
import { SESSION_KEY, refreshAccessToken, validToken } from './estivaId'

export function useEstivaIdAuth() {
  // Seeded synchronously: the token is already in storage on first render —
  // after the callback redirect, or another tab's sign-in — so there is no
  // loading window to show and no flash of the signed-out screen.
  const [expiresAt, setExpiresAt] = useState<number | null>(() => validToken()?.expiresAt ?? null)

  // Every tab shares the session (PEE-3). Another tab renewing re-arms this
  // tab's timer from the new expiry instead of renewing again; another tab
  // signing out, or its renewal being refused, drops this one to the shell at
  // once rather than at its next read. A `null` key is the store being cleared.
  useEffect(() => {
    const follow = (event: StorageEvent) => {
      if (event.key !== SESSION_KEY && event.key !== null) return
      setExpiresAt(validToken()?.expiresAt ?? null)
    }
    window.addEventListener('storage', follow)
    return () => window.removeEventListener('storage', follow)
  }, [])

  useEffect(() => {
    if (expiresAt === null) return
    // Renew at expiry rather than reacting to a refused read: the person
    // notices nothing. `refreshAccessToken` coalesces concurrent calls, so a
    // renewal the auth shell started at the same moment is shared, not spent
    // twice — a refresh token is single-use, and Estiva ID treats a second
    // presentation as theft. Across tabs the package's lock does the same.
    const timer = setTimeout(
      () => {
        void refreshAccessToken().then((next) =>
          // A token that is already out of date is no renewal: taking it would
          // spin this timer at zero delay.
          setExpiresAt(next && next.expiresAt > Date.now() ? next.expiresAt : null),
        )
      },
      Math.max(0, expiresAt - Date.now()),
    )
    return () => clearTimeout(timer)
  }, [expiresAt])

  return { isAuthenticated: expiresAt !== null }
}
