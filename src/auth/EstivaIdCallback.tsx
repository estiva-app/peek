/**
 * `/auth/callback` — where Estiva ID sends you back (PEEK-104).
 *
 * This path is registered **exact-string** in the identity service's allowlist
 * for `estiva-peek`, on both `https://peek.estiva.app` and
 * `http://localhost:5173`. Changing it here without re-seeding there produces a
 * `400` at `/authorize`, before any redirect happens.
 *
 * The exchange ends in a **client-side navigation** (PEEK-167).
 *
 * It used to be a full page load, and the reason given was that
 * `PeekDataProvider` picks its Convex auth provider at mount. That stopped being
 * true at PEEK-41, which deleted Convex Auth and left one provider with nothing
 * to choose. What kept the reload load-bearing after that was `usesEstivaId`, a
 * module-load snapshot of whether this tab held a token — and every caller had
 * already moved off it to `validToken()` at call time, leaving it with no
 * readers at all.
 *
 * So a cold sign-in cost three full boots of the app where two are unavoidable:
 * leaving for the identity origin and coming back are real cross-origin
 * navigations, because the session cookie is `SameSite=Lax` and rides nothing
 * else. This third hop is ours, and it is now a route change — the token is in
 * `sessionStorage` before it happens, so `useEstivaIdAuth` seeds authenticated
 * on the very first render of the tree it lands in.
 */
import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthShell } from './shell/AuthShell'
import { reasonForCallbackError } from './shell/contract'
import { completeSignIn, stashShellReason, takeReturnTo } from './estivaId'

export function EstivaIdCallback() {
  const navigate = useNavigate()
  const ran = useRef(false)

  useEffect(() => {
    // Codes are single-use and burned on any redemption attempt, successful or
    // not. StrictMode double-invokes effects in dev, so a second run would
    // always fail against an already-burned code and show a spurious error.
    if (ran.current) return
    ran.current = true

    const params = new URLSearchParams(window.location.search)
    /**
     * Where we came from, from `sessionStorage` — **not** from the query.
     *
     * Reading it off the query string was a bug: nothing ever puts it there, so
     * every refusal fell through to `/` and a deep link into a topic landed on
     * the desk (PEEK-123).
     */
    const returnTo = takeReturnTo()

    /**
     * A refusal is not this route's to render (PEEK-118).
     *
     * The silent probe comes back here too, and its expected negative answer is
     * `error=login_required`. Showing an error screen at `/auth/callback` would
     * put a second auth surface in front of people — the exact thing the shell
     * exists to remove. So the reason is stashed and the shell picks it up on
     * the other side of the load, where the whole of entry lives.
     */
    const error = params.get('error')
    if (error) {
      stashShellReason(reasonForCallbackError(error))
      navigate(returnTo || '/', { replace: true })
      return
    }

    /**
     * Neither a code nor an error: this is the return from `/logout`, which
     * lands on the registered redirect URI because that is the only URI it is
     * allowed to send anyone to (PEEK-122).
     *
     * Nothing to redeem and nothing to report — the reason was stashed before
     * leaving. Falling through to `completeSignIn` would throw on the missing
     * code and overwrite that reason with a spurious `exchange_failed`.
     */
    if (!params.get('code')) {
      navigate(returnTo || '/', { replace: true })
      return
    }

    completeSignIn(window.location.search)
      .then(() => {
        // `returnTo` was taken above, so `completeSignIn`'s own copy is already
        // gone — use the one read here for every path rather than two sources
        // that can disagree.
        navigate(returnTo || '/', { replace: true })
      })
      .catch((error: unknown) => {
        /**
         * The reason is uniform; the message is not, and it is worth saying.
         *
         * This used to swallow the error on the grounds that every refusal from
         * `/token` is a deliberately uniform `invalid_grant`. True, and beside
         * the point: the throws that never reach `/token` — a state that did
         * not match, a verifier this tab never wrote — are the diagnostic ones,
         * and they were leaving `exchange_failed` as the only trace of a
         * sign-in that died on our side of the exchange (PEEK-167).
         */
        console.error('[auth-shell] exchange failed:', error)
        stashShellReason('exchange_failed')
        navigate(returnTo || '/', { replace: true })
      })
  }, [navigate])

  // Never anything but the waiting state: this route either redeems and leaves,
  // or hands a reason to the shell and leaves.
  return <AuthShell state={{ phase: 'checking' }} onContinue={() => {}} />
}
