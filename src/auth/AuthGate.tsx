import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Authenticated, Unauthenticated, AuthLoading, useConvex, useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { hasConvex } from '@/api'
import { Button } from '@/components/ui/Button'
import { PeekLogoBadge } from '@/components/ui/PeekLogo'
import { beginSignIn, clearSession, validToken } from './estivaId'
import { syncStaleProfilesFromRelay } from '@/nostr/sync'

/**
 * Router-level auth gate.
 *
 * **One sign-in since PEEK-41.** This used to fan out three ways — the password
 * screen, a dev auto-login, or the Estiva ID redirect — and had to agree
 * exactly with the provider `@/api/store` had mounted, because disagreeing
 * rendered Convex Auth's screen under the wrong provider and took the app down.
 * There is nothing left to disagree about.
 *
 * Mock mode (tests, Storybook, a checkout with no deployment) has no identity
 * server at all, so the app stays signed in as CURRENT_USER_NAME — unchanged.
 *
 * The authenticated branch binds the identity to a Peek row before rendering:
 * a token Peek has no row for is authenticated but unknown, and every query
 * below would come back empty.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  if (!hasConvex) return <>{children}</>
  return (
    <>
      <AuthLoading>
        <AuthLoadingScreen />
      </AuthLoading>
      <Unauthenticated>
        <EstivaIdSignedOut />
      </Unauthenticated>
      <Authenticated>
        <AdoptIdentity>{children}</AdoptIdentity>
      </Authenticated>
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
  const convex = useConvex()
  const relayUrl = useQuery(api.nostr.config.relayConfig, {})?.relayUrl
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true
    adopt({})
      .then(() => {
        setReady(true)
        // Fill in names and faces from Estiva ID (PEEK-72) — for everyone still
        // showing a placeholder, not just the viewer. Sync only resolves a
        // profile for authors of *newly imported* messages, so anyone already
        // past the cursor would keep `nostr:<8 chars>` forever.
        //
        // Deliberately not awaited: a slow or unreachable relay must not hold up
        // sign-in, and a name is cosmetic until it arrives.
        const token = validToken()
        if (!token || !relayUrl) return
        void syncStaleProfilesFromRelay(relayUrl, token, {
          pubkeysMissingProfile: () => convex.query(api.nostr.sync.pubkeysMissingProfile, {}),
          recordProfiles: (args) => convex.action(api.nostr.sync.recordProfiles, args as never),
        }).catch((error) => console.warn('[nostr] profile sync failed:', error))
      })
      .catch((err: unknown) => {
        setFailed(err instanceof Error ? err.message : 'Could not set up your account.')
      })
  }, [adopt, convex, relayUrl])

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

/** Blank canvas with a delayed pulsing badge — same 150ms-delayed-reveal
 *  philosophy as the skeletons (fast auth checks never flash it). */
function AuthLoadingScreen() {
  return (
    <div className="min-h-screen bg-bg-base flex items-center justify-center">
      <PeekLogoBadge size={40} className="animate-skeleton-in animate-pulse" />
    </div>
  )
}
