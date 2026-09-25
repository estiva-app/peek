/**
 * The one Estiva ID session a page load holds (REM-2).
 *
 * `useEstivaIdAuth` renews the token on a timer and guards against two
 * renewals in flight — a refresh token is single-use, and presenting a spent
 * one makes Estiva ID revoke the whole chain. So there must be exactly one
 * instance of it, read through `useEstivaIdSession` by `AuthGate`, which
 * decides signed in or out from it. `ConvexProviderWithAuth` was its second
 * reader until REM-7.
 */
import type { ReactNode } from 'react'
import { useEstivaIdAuth } from './useEstivaIdAuth'
import { EstivaIdSessionContext } from './useEstivaIdSession'

/** Holds the page load's one Estiva ID session. */
export function EstivaIdSessionProvider({ children }: { children: ReactNode }) {
  const session = useEstivaIdAuth()
  return <EstivaIdSessionContext.Provider value={session}>{children}</EstivaIdSessionContext.Provider>
}
