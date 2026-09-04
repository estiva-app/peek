import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Authenticated, Unauthenticated, AuthLoading, useConvex, useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { hasConvex } from '@/api'
import { validToken } from './estivaId'
import { AuthShell } from './shell/AuthShell'
import { markEntered, useAuthShell } from './shell/useAuthShell'
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
 *
 * **The signed-out branch is no longer a screen (PEEK-118).** It used to be a
 * "Sign in with Estiva ID" page, which is an app-specific login surface for an
 * identity system the person is usually already signed into. It is now the auth
 * shell: same canvas as the loading state, which tries to enter on its own and
 * only asks for anything when it genuinely cannot.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  if (!hasConvex) return <>{children}</>
  return (
    <>
      <AuthLoading>
        <AuthShell state={{ phase: 'checking' }} onContinue={() => {}} />
      </AuthLoading>
      <Unauthenticated>
        <AuthShellHost />
      </Unauthenticated>
      <Authenticated>
        <AdoptIdentity>{children}</AdoptIdentity>
      </Authenticated>
    </>
  )
}

/** Mounted only when there is no usable identity — see `useAuthShell`. */
function AuthShellHost() {
  const { state, onContinue } = useAuthShell()
  return <AuthShell state={state} onContinue={onContinue} />
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
  const [adopted, setAdopted] = useState(false)
  const ran = useRef(false)
  const syncRan = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true
    adopt({})
      .then(() => {
        setReady(true)
        // From here a token expiring is an interruption, not a cold boot, and
        // the shell must ask before navigating away (PEEK-123).
        markEntered()
        setAdopted(true)
      })
      .catch((err: unknown) => {
        setFailed(err instanceof Error ? err.message : 'Could not set up your account.')
      })
  }, [adopt])

  /*
    Re-read names and faces from Estiva ID (PEEK-72), for the whole roster
    rather than just the viewer. `importChannel` only resolves a profile for the
    authors of *newly imported* messages, so anyone already past the sync cursor
    is never revisited — they keep `nostr:<8 chars>`, and since SHA-22 they keep
    a picture URL that no longer loads.

    **Its own effect, and this is the bug it fixes (SHA-22).** All of this used
    to sit inside the `.then()` above, which latched `ran` on the very first
    render. `relayUrl` comes from a `useQuery`, and a `useQuery` is `undefined`
    until it resolves — so on a cold page load the closure captured `undefined`,
    `!relayUrl` returned, and by the time the URL arrived the latch had already
    closed. The sync therefore never ran on a real page load, only ever looking
    like it worked because `importChannel` writes the same rows for anyone who
    had just posted.

    So the precondition is now checked *when it can be true* instead of once at
    mount. `syncRan` still keeps it to a single run per load.

    Deliberately not awaited: a slow or unreachable relay must not hold up
    sign-in, and a name is cosmetic until it arrives.
  */
  useEffect(() => {
    if (!adopted || !relayUrl || syncRan.current) return
    const token = validToken()
    if (!token) return
    syncRan.current = true
    void syncStaleProfilesFromRelay(relayUrl, token, {
      pubkeysToRefresh: () => convex.query(api.nostr.sync.pubkeysToRefresh, {}),
      recordProfiles: (args) => convex.action(api.nostr.sync.recordProfiles, args as never),
    }).catch((error) => console.warn('[nostr] profile sync failed:', error))
  }, [adopted, relayUrl, convex])

  // Binding the identity to a row is app bootstrap, not authentication: the
  // token was fine. `token_rejected` is the honest reason — signing in again
  // would not change the outcome.
  if (failed) return <AuthShell state={{ phase: 'failed', reason: 'token_rejected' }} onContinue={() => {}} />
  return ready ? <>{children}</> : <AuthShell state={{ phase: 'entering' }} onContinue={() => {}} />
}
