import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Authenticated, Unauthenticated, AuthLoading, useMutation } from 'convex/react'
import { useAuthActions } from '@convex-dev/auth/react'
import { api } from '../../convex/_generated/api'
import { hasConvex, usesEstivaId } from '@/api'
import { Button } from '@/components/ui/Button'
import { PeekLogoBadge } from '@/components/ui/PeekLogo'
import { AuthScreen } from './AuthScreen'
import { beginSignIn, clearSession, validToken } from './estivaId'
import { devAutoLogin, isDevAutoLoginOptedOut } from './devAutoLogin'

/**
 * Router-level auth gate (Phase 3). Convex mode: unauthenticated visitors
 * see the AuthScreen, the app renders only once authenticated. Mock mode
 * (tests, Storybook, checkouts without a deployment) has no identity
 * server — the app stays auto-signed-in as CURRENT_USER_NAME, unchanged.
 *
 * Local dev only: with `VITE_DEV_AUTOLOGIN=1` the demo user signs in
 * automatically instead of showing the screen (see ./devAutoLogin — it is
 * dead code in any production build).
 *
 * Estiva ID mode (PEEK-104): when this tab holds an identity-service token the
 * signed-out branch offers the redirect instead of the password screen, and the
 * signed-in branch first binds the identity to a Peek row. Which provider is
 * mounted is decided in `@/api/store` — this only has to agree with it.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  if (!hasConvex) return <>{children}</>
  return (
    <>
      <AuthLoading>
        <AuthLoadingScreen />
      </AuthLoading>
      <Unauthenticated>
        {usesEstivaId ? <EstivaIdSignedOut /> : devAutoLogin ? <DevAutoSignIn /> : <AuthScreen />}
      </Unauthenticated>
      <Authenticated>{usesEstivaId ? <AdoptIdentity>{children}</AdoptIdentity> : children}</Authenticated>
    </>
  )
}

/**
 * Bind the signed-in pubkey to a Peek user row, once, before rendering the app.
 *
 * `viewer()` runs inside queries and a query cannot write, so this is the only
 * place the row can be created or adopted. It gates rendering because the app
 * below assumes a viewer exists: an Estiva ID token Peek has no row for is
 * authenticated but unknown, and every query would return empty.
 *
 * Idempotent server-side, so a re-run costs a no-op mutation rather than a
 * duplicate person.
 */
function AdoptIdentity({ children }: { children: ReactNode }) {
  const adopt = useMutation(api.users.adoptIdentity)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true
    adopt({})
      .then(() => setReady(true))
      .catch((err: unknown) => {
        setFailed(err instanceof Error ? err.message : 'Could not set up your account.')
      })
  }, [adopt])

  if (failed) return <EstivaIdSignedOut message={failed} />
  return ready ? <>{children}</> : <AuthLoadingScreen />
}

/**
 * The signed-out screen in Estiva ID mode.
 *
 * Deliberately a button rather than an automatic redirect. `fetchAccessToken`
 * cannot mint a new token — there is no refresh grant — so an expired token
 * lands here, and auto-bouncing would loop indefinitely whenever the identity
 * session had expired too. A loop is a far worse failure than one click.
 *
 * **Two very different failures land here and they must not read the same.**
 * Either there is no live token — genuinely signed out — or there is one and
 * Convex refused it, which is a configuration fault (issuer, audience or JWKS
 * reachability) that signing in again cannot fix. Calling the second one "your
 * session has expired" sends people to re-authenticate against a wall; it cost
 * a real debugging detour the first time this screen appeared.
 */
function EstivaIdSignedOut({ message }: { message?: string }) {
  const live = validToken()
  const explanation =
    message ??
    (live
      ? 'Signed in to Estiva ID, but Peek could not verify the token. This is a configuration problem rather than an expired session — check that Convex trusts the issuer and can reach its JWKS.'
      : 'Your session has expired.')
  return (
    <div className="min-h-screen bg-bg-base flex items-center justify-center p-6">
      <div className="max-w-sm text-center space-y-4">
        <PeekLogoBadge size={40} className="mx-auto" />
        <p className="text-body-2 text-text-secondary">{explanation}</p>
        <Button
          variant="primary"
          type="button"
          onClick={() => {
            clearSession()
            void beginSignIn(window.location.pathname)
          }}
        >
          Sign in with Estiva ID
        </Button>
      </div>
    </div>
  )
}

/**
 * Signs the configured dev user in once per mount, then hands over to the
 * normal Authenticated branch. Falls back to the real sign-in screen if the
 * attempt fails (e.g. the account was wiped and not reseeded yet) or if the
 * user deliberately signed out in this tab.
 */
function DevAutoSignIn() {
  const { signIn } = useAuthActions()
  const [showScreen, setShowScreen] = useState(() => isDevAutoLoginOptedOut())
  const attempted = useRef(false)

  useEffect(() => {
    if (attempted.current || showScreen || !devAutoLogin) return
    attempted.current = true
    void signIn('password', {
      email: devAutoLogin.email,
      password: devAutoLogin.password,
      flow: 'signIn',
    }).catch((err) => {
      console.warn('[peek] dev auto-login failed — falling back to the sign-in screen.', err)
      setShowScreen(true)
    })
  }, [signIn, showScreen])

  return showScreen ? <AuthScreen /> : <AuthLoadingScreen />
}

/** Blank canvas with a delayed pulsing badge — same 150ms-delayed-reveal
 *  philosophy as the skeletons (fast auth checks never flash it). */
function AuthLoadingScreen() {
  return (
    <div className="min-h-screen bg-bg-base flex items-center justify-center">
      <PeekLogoBadge size={40} className="animate-skeleton-in animate-pulse" />
    </div>
  )
}
