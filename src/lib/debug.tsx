import { createContext, useContext, useState, type ReactNode } from 'react'
import type { ReadStateDiffReport } from '@/nostr/readStateDiff'

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

export type HuddleVariant = 1 | 2 | 3

interface HuddlesDebug {
  variant: HuddleVariant
}

/** CRO-7 step 1: compute merged NIP-RS read state alongside Convex, render the
 *  existing one, and record where they disagree. */
interface ReadStateDebug {
  /** On by default — it is a comparison, not a behaviour change, and the point
   *  is to leave it running across idle time where a bug would show up. */
  dualRun: boolean
}

export interface DebugState {
  desk: DeskDebug
  unreads: UnreadsDebug
  huddles: HuddlesDebug
  readState: ReadStateDebug
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
  huddles: {
    variant: 3,
  },
  readState: {
    dualRun: true,
  },
}

interface DebugContextValue {
  state: DebugState
  setDesk: <K extends keyof DeskDebug>(key: K, value: DeskDebug[K]) => void
  setUnreads: <K extends keyof UnreadsDebug>(key: K, value: UnreadsDebug[K]) => void
  setHuddles: <K extends keyof HuddlesDebug>(key: K, value: HuddlesDebug[K]) => void
  setReadState: <K extends keyof ReadStateDebug>(key: K, value: ReadStateDebug[K]) => void
  /**
   * The most recent dual-run comparison, or null before the first fetch.
   *
   * Lives here rather than in a `console.log` because CRO-7 asks for it to be
   * left on: a log line scrolls away, and the interesting classes only appear
   * after idle time.
   */
  readStateDiff: ReadStateDiffReport | null
  setReadStateDiff: (report: ReadStateDiffReport | null) => void
}

const DebugContext = createContext<DebugContextValue | null>(null)

export function DebugProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DebugState>(DEFAULT_DEBUG)
  const [readStateDiff, setReadStateDiff] = useState<ReadStateDiffReport | null>(null)

  const setDesk = <K extends keyof DeskDebug>(key: K, value: DeskDebug[K]) => {
    setState((prev) => ({ ...prev, desk: { ...prev.desk, [key]: value } }))
  }

  const setUnreads = <K extends keyof UnreadsDebug>(key: K, value: UnreadsDebug[K]) => {
    setState((prev) => ({ ...prev, unreads: { ...prev.unreads, [key]: value } }))
  }

  const setHuddles = <K extends keyof HuddlesDebug>(key: K, value: HuddlesDebug[K]) => {
    setState((prev) => ({ ...prev, huddles: { ...prev.huddles, [key]: value } }))
  }

  const setReadState = <K extends keyof ReadStateDebug>(key: K, value: ReadStateDebug[K]) => {
    setState((prev) => ({ ...prev, readState: { ...prev.readState, [key]: value } }))
  }

  return (
    <DebugContext.Provider
      value={{ state, setDesk, setUnreads, setHuddles, setReadState, readStateDiff, setReadStateDiff }}
    >
      {children}
    </DebugContext.Provider>
  )
}

export function useDebug() {
  const ctx = useContext(DebugContext)
  if (!ctx) throw new Error('useDebug must be used inside DebugProvider')
  return ctx
}
