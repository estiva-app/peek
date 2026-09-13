import { createContext, useContext, useState, useMemo, type ReactNode } from 'react'

interface LastSelectionState {
  topicId: string | null
  dmId: string | null
  /** One-shot: when set, the next mounted DM view should auto-open this thread, then clear. */
  pendingDmThreadId: string | null
  /** One-shot: when set, the topic view matching topicId should auto-open this thread, then clear.
   *  Used by launcher search results and fact-check "view source" links. */
  pendingTopicThread: { topicId: string; convId: string } | null
  /** One-shot: when set, the topic view for this Folder should open the conversation
   *  holding this message and scroll to it, then clear (RIC-16). Set by `ObjectPage`
   *  for a `/message/<id>` link, which knows the event and its Folder but neither
   *  Peek's topic id nor its conversation id — the topic view resolves those. */
  pendingTopicMessage: { folder: string; eventId: string } | null
}

interface LastSelectionValue extends LastSelectionState {
  setLastTopicId: (id: string | null) => void
  setLastDmId: (id: string | null) => void
  setPendingDmThreadId: (id: string | null) => void
  setPendingTopicThread: (v: { topicId: string; convId: string } | null) => void
  setPendingTopicMessage: (v: { folder: string; eventId: string } | null) => void
}

const LastSelectionContext = createContext<LastSelectionValue | null>(null)

export function LastSelectionProvider({ children }: { children: ReactNode }) {
  const [topicId, setLastTopicId] = useState<string | null>(null)
  const [dmId, setLastDmId] = useState<string | null>(null)
  const [pendingDmThreadId, setPendingDmThreadId] = useState<string | null>(null)
  const [pendingTopicThread, setPendingTopicThread] = useState<{ topicId: string; convId: string } | null>(null)
  const [pendingTopicMessage, setPendingTopicMessage] = useState<{ folder: string; eventId: string } | null>(null)

  const value = useMemo<LastSelectionValue>(
    () => ({
      topicId,
      dmId,
      pendingDmThreadId,
      pendingTopicThread,
      pendingTopicMessage,
      setLastTopicId,
      setLastDmId,
      setPendingDmThreadId,
      setPendingTopicThread,
      setPendingTopicMessage,
    }),
    [topicId, dmId, pendingDmThreadId, pendingTopicThread, pendingTopicMessage],
  )

  return <LastSelectionContext.Provider value={value}>{children}</LastSelectionContext.Provider>
}

export function useLastSelection(): LastSelectionValue {
  const ctx = useContext(LastSelectionContext)
  if (!ctx) throw new Error('useLastSelection must be used within LastSelectionProvider')
  return ctx
}
