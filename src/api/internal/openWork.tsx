/**
 * Runtime Open-work overrides (seam-internal).
 *
 * Topics the user added to / removed from Open work THIS SESSION, from the
 * Desk "+" picker or the topic-side menus. Same dual role as the other
 * internal stores (Phase 2 close-out ruling): in mock mode this layer over
 * the static OPEN_WORK_ITEMS is the whole truth; with Convex it covers only
 * the optimistic window until the reactive openWorkList query catches up.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

interface OpenWorkOverridesValue {
  /** Topic ids added this session, in add order (newest last). */
  addedTopicIds: string[]
  /** Topic ids removed this session (also hides static/mock rows). */
  removedTopicIds: Set<string>
  addTopics: (topicIds: string[]) => void
  removeTopic: (topicId: string) => void
}

const OpenWorkContext = createContext<OpenWorkOverridesValue | null>(null)

export function OpenWorkProvider({ children }: { children: ReactNode }) {
  const [addedTopicIds, setAddedTopicIds] = useState<string[]>([])
  const [removedTopicIds, setRemovedTopicIds] = useState<Set<string>>(new Set())

  const value = useMemo<OpenWorkOverridesValue>(
    () => ({
      addedTopicIds,
      removedTopicIds,
      addTopics: (topicIds) => {
        setAddedTopicIds((prev) => [...prev, ...topicIds.filter((id) => !prev.includes(id))])
        setRemovedTopicIds((prev) => {
          const next = new Set(prev)
          for (const id of topicIds) next.delete(id)
          return next
        })
      },
      removeTopic: (topicId) => {
        setAddedTopicIds((prev) => prev.filter((id) => id !== topicId))
        setRemovedTopicIds((prev) => new Set([...prev, topicId]))
      },
    }),
    [addedTopicIds, removedTopicIds],
  )

  return <OpenWorkContext.Provider value={value}>{children}</OpenWorkContext.Provider>
}

/** Seam-internal. Components never call this. */
export function useOpenWorkOverrides(): OpenWorkOverridesValue {
  const ctx = useContext(OpenWorkContext)
  if (!ctx) throw new Error('useOpenWorkOverrides must be used within PeekDataProvider')
  return ctx
}
