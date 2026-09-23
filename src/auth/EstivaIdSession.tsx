/**
 * The one Estiva ID session a page load holds (REM-2).
 *
 * `useEstivaIdAuth` renews the token on a timer and guards against two
 * renewals in flight — a refresh token is single-use, and presenting a spent
 * one makes Estiva ID revoke the whole chain. So there must be exactly one
 * instance of it, and both of its readers share it through
 * `useEstivaIdSession`: `AuthGate`, which decides signed in or out from it, and
 * `ConvexProviderWithAuth`, which still hands its token to the Convex-backed
 * screens until they move.
 */
import type { ReactNode } from 'react'
import { useEstivaIdAuth } from './useEstivaIdAuth'
import { EstivaIdSessionContext } from './useEstivaIdSession'

/** Holds the page load's one Estiva ID session for the gate and the Convex client to share. */
export function EstivaIdSessionProvider({ children }: { children: ReactNode }) {
  const session = useEstivaIdAuth()
  return <EstivaIdSessionContext.Provider value={session}>{children}</EstivaIdSessionContext.Provider>
}
