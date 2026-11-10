/**
 * The shared Estiva ID session's context and reader (REM-2). The provider is
 * `EstivaIdSessionProvider`, which says why there is exactly one.
 */
import { createContext, useContext } from 'react'
import type { useEstivaIdAuth } from './useEstivaIdAuth'

export type EstivaIdSession = ReturnType<typeof useEstivaIdAuth>

export const EstivaIdSessionContext = createContext<EstivaIdSession | null>(null)

/** The shared session. */
export function useEstivaIdSession(): EstivaIdSession {
  const session = useContext(EstivaIdSessionContext)
  if (!session) throw new Error('useEstivaIdSession must be used within EstivaIdSessionProvider')
  return session
}
