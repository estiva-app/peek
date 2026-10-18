import { useEffect, type ReactNode } from 'react'
import { hasRelay } from '@/api'
import { useEstivaIdSession } from './useEstivaIdSession'
import { AuthShell } from './shell/AuthShell'
import { markEntered, useAuthShell } from './shell/useAuthShell'
import { revealLivePage } from '@/lib/pagePicture'

/**
 * Router-level auth gate.
 *
 * **Estiva ID's session decides, not Convex (REM-2).** This used to render
 * Convex's `<AuthLoading>` / `<Unauthenticated>` / `<Authenticated>`, and then
 * hold everything on "entering" until `users.adoptIdentity` had made a row — so
 * a Convex outage was a Peek outage, including for the Folder tree and a file's
 * conversation, which read nothing from Convex at all. Now the app renders as
 * soon as this tab holds an Estiva ID session.
 *
 * **Nothing is bootstrapped beside it (REM-6).** The viewer is the token's
 * pubkey and names and faces are read from the relay, so there is no Peek user
 * row to adopt and no Convex copy of `kind:0` to refresh. There are no Convex
 * screens left at all since REM-7.
 *
 * Mock mode (tests, Storybook, a checkout with no relay) has no identity server at all, so the app stays signed in as
 * CURRENT_USER_NAME — unchanged.
 *
 * **The signed-out branch is no longer a screen (PEEK-118).** It used to be a
 * "Sign in with Estiva ID" page, which is an app-specific login surface for an
 * identity system the person is usually already signed into. It is now the auth
 * shell: same canvas as the loading state, which tries to enter on its own and
 * only asks for anything when it genuinely cannot.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  if (!hasRelay) return <>{children}</>
  return <SessionGate>{children}</SessionGate>
}

function SessionGate({ children }: { children: ReactNode }) {
  const { isAuthenticated, renewing } = useEstivaIdSession()

  // From here a token expiring is an interruption, not a cold boot, and the
  // shell must ask before navigating away (PEEK-123).
  useEffect(() => {
    if (isAuthenticated) markEntered()
  }, [isAuthenticated])

  // A renewal in place is one `fetch`: whatever stands on the page meanwhile (a
  // saved Desk) stays, rather than the shell flashing over it (AUT-3).
  if (renewing) return null
  if (!isAuthenticated) return <AuthShellHost />
  return <>{children}</>
}

/** Mounted only when there is no usable identity — see `useAuthShell`. */
function AuthShellHost() {
  const { state, onContinue } = useAuthShell()
  // A saved Desk a new tab showed must not stand over the sign-in screen.
  useEffect(() => revealLivePage(), [])
  return <AuthShell state={state} onContinue={onContinue} />
}
