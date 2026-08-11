/**
 * Signing out, whichever way you signed in (PEEK-104).
 *
 * Peek now has two sign-ins and therefore two sign-outs, and the components that
 * offer the action should not have to know which is mounted. This is the seam.
 *
 * `useAuthActions` is called unconditionally on purpose. Outside
 * `ConvexAuthProvider` it *returns undefined* rather than throwing — which is
 * exactly how this surfaced: `TopBar` destructured it directly and crashed the
 * whole app the first time someone signed in with Estiva ID, because the app was
 * mounted under `ConvexProviderWithAuth` instead. Calling the hook every render
 * keeps hook order stable; reading it defensively keeps it honest.
 */
import { useCallback } from 'react'
import { useAuthActions } from '@convex-dev/auth/react'
import { usesEstivaId } from '@/api'
import { clearSession } from './estivaId'

export function useSignOut(): () => void {
  // Undefined under ConvexProviderWithAuth and in Storybook — never destructured.
  const actions = useAuthActions()

  return useCallback(() => {
    if (usesEstivaId) {
      clearSession()
      // A full load, not a router navigation: `PeekDataProvider` picks its auth
      // provider at mount, so the app has to come up again to hand control back
      // to Convex Auth.
      //
      // This ends the session *in Peek only*. The Estiva ID cookie outlives it,
      // so signing back in will not prompt — which is the correct behaviour for
      // an identity provider, but does mean "sign out" is narrower here than it
      // looks. A real end-session round trip belongs with PEEK-41.
      window.location.assign('/')
      return
    }
    void actions?.signOut()
  }, [actions])
}
