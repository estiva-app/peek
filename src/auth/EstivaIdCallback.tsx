/**
 * `/auth/callback` — where Estiva ID sends you back (PEEK-104).
 *
 * This path is registered **exact-string** in the identity service's allowlist
 * for `estiva-peek`, on both `https://peek.estiva.app` and
 * `http://localhost:5173`. Changing it here without re-seeding there produces a
 * `400` at `/authorize`, before any redirect happens.
 *
 * The exchange ends in a **full page load** rather than a client-side navigation.
 * That is not laziness: `PeekDataProvider` picks its Convex auth provider at
 * mount, so the app has to come up again for the Estiva ID token to be the thing
 * driving the client.
 */
import { useEffect, useRef } from 'react'
import { AuthShell } from './shell/AuthShell'
import { reasonForCallbackError } from './shell/contract'
import { completeSignIn, stashShellReason } from './estivaId'

export function EstivaIdCallback() {
  const ran = useRef(false)

  useEffect(() => {
    // Codes are single-use and burned on any redemption attempt, successful or
    // not. StrictMode double-invokes effects in dev, so a second run would
    // always fail against an already-burned code and show a spurious error.
    if (ran.current) return
    ran.current = true

    const params = new URLSearchParams(window.location.search)
    const returnTo = params.get('returnTo')

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
      window.location.replace(returnTo || '/')
      return
    }

    completeSignIn(window.location.search)
      .then(({ returnTo: stored }) => {
        // Full load, not navigate() — see the file header.
        window.location.replace(stored || '/')
      })
      .catch(() => {
        // Every refusal from `/token` is a uniform `invalid_grant`, so there is
        // nothing here worth saying that `exchange_failed` does not already say.
        stashShellReason('exchange_failed')
        window.location.replace(returnTo || '/')
      })
  }, [])

  // Never anything but the waiting state: this route either redeems and leaves,
  // or hands a reason to the shell and leaves.
  return <AuthShell state={{ phase: 'checking' }} onContinue={() => {}} />
}
