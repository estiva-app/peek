import { createContext, useContext, useState, useMemo, type ReactNode } from 'react'

/**
 * A message to open a topic at: the one that opened the conversation, and a reply in it if that is the target.
 * @registry reusable: stays in Peek (Katerina, 18 September): it remembers Peek's topics and messages
 */
export interface PendingTopicMessage {
  folder: string
  eventId: string
  reply?: string
}

interface LastSelectionState {
  topicId: string | null
  dmId: string | null
  /** The file last open under Topics, as its path: the rail's Topics returns to it (Katerina, 5 October). */
  filePath: string | null
  /** One-shot: when set, the next mounted DM view should auto-open this thread, then clear. */
  pendingDmThreadId: string | null
  /** One-shot: when set, the topic view matching topicId should auto-open this thread, then clear.
   *  Used by launcher search results and fact-check "view source" links. */
  pendingTopicThread: { topicId: string; convId: string } | null
  /** One-shot: when set, the topic view for this Folder should open the conversation
   *  holding this message and scroll to it, then clear (RIC-16). Set by `ObjectPage`
   *  for a `/message/<id>` link, which knows the event and its Folder but neither
   *  Peek's topic id nor its conversation id — the topic view resolves those.
   *  `reply` is a reply inside that conversation to land on instead (the launcher's
   *  message results, R13). A file's page answers the same one-shot for a comment
   *  whose thread is the file's (FOL-36): `eventId` is the thread's root, `reply`
   *  the comment when it is not the root. */
  pendingTopicMessage: PendingTopicMessage | null
}

interface LastSelectionValue extends LastSelectionState {
  setLastTopicId: (id: string | null) => void
  setLastDmId: (id: string | null) => void
  setLastFilePath: (path: string | null) => void
  setPendingDmThreadId: (id: string | null) => void
  setPendingTopicThread: (v: { topicId: string; convId: string } | null) => void
  setPendingTopicMessage: (v: PendingTopicMessage | null) => void
}

const LastSelectionContext = createContext<LastSelectionValue | null>(null)

export function LastSelectionProvider({ children }: { children: ReactNode }) {
  const [topicId, setLastTopicId] = useState<string | null>(null)
  const [dmId, setLastDmId] = useState<string | null>(null)
  const [filePath, setLastFilePath] = useState<string | null>(null)
  const [pendingDmThreadId, setPendingDmThreadId] = useState<string | null>(null)
  const [pendingTopicThread, setPendingTopicThread] = useState<{ topicId: string; convId: string } | null>(null)
  const [pendingTopicMessage, setPendingTopicMessage] = useState<PendingTopicMessage | null>(null)

  const value = useMemo<LastSelectionValue>(
    () => ({
      topicId,
      dmId,
      filePath,
      pendingDmThreadId,
      pendingTopicThread,
      pendingTopicMessage,
      setLastTopicId,
      setLastDmId,
      setLastFilePath,
      setPendingDmThreadId,
      setPendingTopicThread,
      setPendingTopicMessage,
    }),
    [topicId, dmId, filePath, pendingDmThreadId, pendingTopicThread, pendingTopicMessage],
  )

  return <LastSelectionContext.Provider value={value}>{children}</LastSelectionContext.Provider>
}

export function useLastSelection(): LastSelectionValue {
  const ctx = useContext(LastSelectionContext)
  if (!ctx) throw new Error('useLastSelection must be used within LastSelectionProvider')
  return ctx
}
