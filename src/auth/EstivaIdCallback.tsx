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
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { PeekLogoBadge } from '@/components/ui/PeekLogo'
import { beginSignIn, completeSignIn, SignInError } from './estivaId'

export function EstivaIdCallback() {
  const [error, setError] = useState<string | null>(null)
  const ran = useRef(false)

  useEffect(() => {
    // Codes are single-use and burned on any redemption attempt, successful or
    // not. StrictMode double-invokes effects in dev, so a second run would
    // always fail against an already-burned code and show a spurious error.
    if (ran.current) return
    ran.current = true

    completeSignIn(window.location.search)
      .then(({ returnTo }) => {
        // Full load, not navigate() — see the file header.
        window.location.replace(returnTo || '/')
      })
      .catch((err: unknown) => {
        setError(err instanceof SignInError ? err.message : 'Could not complete sign-in.')
      })
  }, [])

  if (error) {
    return (
      <div className="min-h-screen bg-bg-base flex items-center justify-center p-6">
        <div className="max-w-sm text-center space-y-4">
          <PeekLogoBadge size={40} className="mx-auto" />
          <p className="text-body-2 text-text-primary">{error}</p>
          <Button variant="primary" type="button" onClick={() => void beginSignIn('/')}>
            Try again
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg-base flex items-center justify-center">
      <PeekLogoBadge size={40} className="animate-skeleton-in animate-pulse" />
    </div>
  )
}
