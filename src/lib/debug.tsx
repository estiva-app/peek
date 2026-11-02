import { createContext, useContext, useState, type ReactNode } from 'react'

interface DeskDebug {
  showScreener: boolean
  screenerItemsCount: 1 | 2
  showUrgent: boolean
  urgentItemsCount: 1 | 2
  openWorkHasData: boolean
  starredHasData: boolean
}

interface UnreadsDebug {
  topics: boolean
  people: boolean
}

export interface DebugState {
  desk: DeskDebug
  unreads: UnreadsDebug
}

const DEFAULT_DEBUG: DebugState = {
  desk: {
    showScreener: true,
    screenerItemsCount: 2,
    showUrgent: true,
    urgentItemsCount: 2,
    openWorkHasData: true,
    starredHasData: true,
  },
  // Unread is real now (readState, §4.3) — on by default; the toggles remain
  // so the demo can be shown without dots.
  unreads: {
    topics: true,
    people: true,
  },
}

interface DebugContextValue {
  state: DebugState
}

const DebugContext = createContext<DebugContextValue | null>(null)

/**
 * Gives every part below it the test switches for the Desk and unread dots, at
 * their defaults. Nothing sets them any more: the setters had no caller and
 * went (audit D10, 2 November).
 * @registry reusable: stays in Peek (Katerina, 18 September): Peek's test switches
 */
export function DebugProvider({ children }: { children: ReactNode }) {
  const [value] = useState<DebugContextValue>({ state: DEFAULT_DEBUG })

  return (
    <DebugContext.Provider value={value}>
      {children}
    </DebugContext.Provider>
  )
}

export function useDebug() {
  const ctx = useContext(DebugContext)
  if (!ctx) throw new Error('useDebug must be used inside DebugProvider')
  return ctx
}
