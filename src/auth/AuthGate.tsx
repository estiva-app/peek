import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useConvex, useConvexAuth, useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { RELAY_URL, hasConvex, hasRelay } from '@/api'
import { validToken } from './estivaId'
import { useEstivaIdSession } from './useEstivaIdSession'
import { AuthShell } from './shell/AuthShell'
import { markEntered, useAuthShell } from './shell/useAuthShell'
import { syncStaleProfilesFromRelay } from '@/nostr/sync'

/**
 * Router-level auth gate.
 *
 * **Estiva ID's session decides, not Convex (REM-2).** This used to render
 * Convex's `<AuthLoading>` / `<Unauthenticated>` / `<Authenticated>`, and then
 * hold everything on "entering" until `users.adoptIdentity` had made a row — so
 * a Convex outage was a Peek outage, including for the Folder tree and a file's
 * conversation, which read nothing from Convex at all. Now the app renders as
 * soon as this tab holds an Estiva ID session, and the Convex bootstrap runs
 * beside it for the screens that still read Convex (DMs, the Desk), which show
 * their own loading state until `users.me` answers.
 *
 * Mock mode (tests, Storybook, a checkout with neither a deployment nor a
 * relay) has no identity server at all, so the app stays signed in as
 * CURRENT_USER_NAME — unchanged.
 *
 * **The signed-out branch is no longer a screen (PEEK-118).** It used to be a
 * "Sign in with Estiva ID" page, which is an app-specific login surface for an
 * identity system the person is usually already signed into. It is now the auth
 * shell: same canvas as the loading state, which tries to enter on its own and
 * only asks for anything when it genuinely cannot.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  if (!hasConvex && !hasRelay) return <>{children}</>
  return <SessionGate>{children}</SessionGate>
}

function SessionGate({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useEstivaIdSession()

  // From here a token expiring is an interruption, not a cold boot, and the
  // shell must ask before navigating away (PEEK-123).
  useEffect(() => {
    if (isAuthenticated) markEntered()
  }, [isAuthenticated])

  if (!isAuthenticated) return <AuthShellHost />
  return (
    <>
      {hasConvex && <AdoptIdentity />}
      {children}
    </>
  )
}

/** Mounted only when there is no usable identity — see `useAuthShell`. */
function AuthShellHost() {
  const { state, onContinue } = useAuthShell()
  return <AuthShell state={state} onContinue={onContinue} />
}

/**
 * Bind the signed-in pubkey to a Peek user row, once, without holding up the
 * app (REM-2). Draws nothing.
 *
 * `viewer()` runs inside queries and a query cannot write, so this is the only
 * place the row can be created or adopted. Until it has, `users.me` answers
 * null and `useCurrentUser()` answers undefined, which every Convex-backed
 * screen already reads as loading. Nothing relay-only waits for it.
 *
 * It waits for Convex to confirm the token rather than firing on mount: the
 * provider hands the client its auth in an effect, and a child's effect runs
 * before its parent's, so a mutation sent at mount could leave unauthenticated.
 *
 * Idempotent server-side, so a re-run costs a no-op mutation rather than a
 * duplicate person.
 */
function AdoptIdentity() {
  const adopt = useMutation(api.users.adoptIdentity)
  const convex = useConvex()
  const { isAuthenticated: convexAuthenticated } = useConvexAuth()
  const [adopted, setAdopted] = useState(false)
  const ran = useRef(false)
  const syncRan = useRef(false)

  useEffect(() => {
    if (!convexAuthenticated || ran.current) return
    ran.current = true
    adopt({})
      .then(() => setAdopted(true))
      .catch((err: unknown) => {
        // No longer a sign-in failure: the relay screens are unaffected, and
        // the Convex ones stay on their loading state.
        console.warn('[auth] could not bind the identity to a Peek row:', err)
      })
  }, [adopt, convexAuthenticated])

  /*
    Re-read names and faces from Estiva ID (PEEK-72), for the whole roster
    rather than just the viewer. `importChannel` only resolves a profile for the
    authors of *newly imported* messages, so anyone already past the sync cursor
    is never revisited — they keep `nostr:<8 chars>`, and since SHA-22 they keep
    a picture URL that no longer loads.

    Its own effect, gated on the adoption having landed: both functions it calls
    resolve the viewer and answer nothing without a row (SHA-22). `syncRan`
    keeps it to a single run per load.

    Deliberately not awaited: a slow or unreachable relay must not hold up
    anything, and a name is cosmetic until it arrives.
  */
  useEffect(() => {
    if (!adopted || !RELAY_URL || syncRan.current) return
    const token = validToken()
    if (!token) return
    syncRan.current = true
    void syncStaleProfilesFromRelay(RELAY_URL, token, {
      pubkeysToRefresh: () => convex.query(api.nostr.sync.pubkeysToRefresh, {}),
      recordProfiles: (args) => convex.action(api.nostr.sync.recordProfiles, args as never),
    }).catch((error) => console.warn('[nostr] profile sync failed:', error))
  }, [adopted, convex])

  return null
}
