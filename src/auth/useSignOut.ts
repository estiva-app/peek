/**
 * Signing out.
 *
 * One sign-in, one sign-out, since PEEK-41 removed Convex Auth. This used to
 * bridge two of them and had to call `useAuthActions` unconditionally, because
 * outside `ConvexAuthProvider` it *returns undefined* rather than throwing —
 * which is how it first surfaced: `TopBar` destructured it directly and crashed
 * the app the moment anyone signed in with Estiva ID. That whole hazard is gone
 * with the second provider.
 *
 * **This ends the session in Peek only.** Clearing the token here does not touch
 * the Estiva ID cookie, so signing back in will not prompt for a passkey. That
 * is defensible for an identity provider — it is what "single sign-on" means —
 * but it does make this narrower than the word suggests, and on a shared machine
 * it is not what someone clicking *Sign out* expects.
 *
 * Estiva ID does have `POST /auth/logout`, so a real end-session round trip is
 * possible; it is deliberately not done here because it is a behaviour change to
 * the identity service's session, not part of deleting Convex Auth, and it wants
 * its own decision about whether Peek should be able to sign you out of every
 * Estiva app at once.
 */
import { useCallback } from 'react'
import { clearSession } from './estivaId'

export function useSignOut(): () => void {
  return useCallback(() => {
    clearSession()
    // A full load rather than a router navigation: the app resolves its auth
    // state at mount, so it has to come up again with the token gone.
    window.location.assign('/')
  }, [])
}
