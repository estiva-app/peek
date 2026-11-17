import { createContext, useContext, useEffect, useState, useMemo, type ReactNode } from 'react'
import { keepRailMemory, readRailMemory, type DeskMemory } from './railMemory'

export type { DeskMemory } from './railMemory'

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
  dmId: string | null
  /**
   * Where Initiatives last was — a file's path, or the column with none open —
   * so the rail's Initiatives returns exactly there (Katerina, 5 October), a
   * reload too (17 November, `railMemory`). A file the person closed is never
   * brought back.
   */
  topicsPath: string | null
  /** Where Folders last was, the same way (TOP-4): the Folder tree, or a file opened from it. */
  foldersPath: string | null
  /**
   * Which column the open file's page shows, and so which rail item is lit
   * (TOP-4): the one it was opened from; opened by link, Topics when a topic
   * of yours lists it, else Folders. Null until that is known.
   */
  fileColumn: 'topics' | 'folders' | null
  /** What Desk had open: the rail's Desk returns to it. */
  desk: DeskMemory | null
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
  setLastDmId: (id: string | null) => void
  setLastTopicsPath: (path: string | null) => void
  setLastFoldersPath: (path: string | null) => void
  setFileColumn: (column: 'topics' | 'folders' | null) => void
  setLastDesk: (desk: DeskMemory | null) => void
  setPendingTopicMessage: (v: PendingTopicMessage | null) => void
}

const LastSelectionContext = createContext<LastSelectionValue | null>(null)

export function LastSelectionProvider({ children }: { children: ReactNode }) {
  /*
    Where the rail's items come back to starts from what this tab kept — in a
    new tab, what the browser kept last — so a reload and a new tab keep every
    item's place (Katerina, 17 November: "no matter what"), and is kept again
    each time it changes. The file's column and the one-shot
    are this page's own and start empty.
  */
  const [kept] = useState(readRailMemory)
  const [dmId, setLastDmId] = useState<string | null>(kept.dmId)
  const [topicsPath, setLastTopicsPath] = useState<string | null>(kept.topicsPath)
  const [foldersPath, setLastFoldersPath] = useState<string | null>(kept.foldersPath)
  const [fileColumn, setFileColumn] = useState<'topics' | 'folders' | null>(null)
  const [desk, setLastDesk] = useState<DeskMemory | null>(kept.desk)
  const [pendingTopicMessage, setPendingTopicMessage] = useState<PendingTopicMessage | null>(null)
  useEffect(() => {
    // Kept once a page writes its place: drawing the app and only reading costs no write (INT-3: asking writes nothing).
    if (dmId === kept.dmId && topicsPath === kept.topicsPath && foldersPath === kept.foldersPath && desk === kept.desk) return
    keepRailMemory({ dmId, topicsPath, foldersPath, desk })
  }, [kept, dmId, topicsPath, foldersPath, desk])

  const value = useMemo<LastSelectionValue>(
    () => ({
      dmId,
      topicsPath,
      foldersPath,
      fileColumn,
      desk,
      pendingTopicMessage,
      setLastDmId,
      setLastTopicsPath,
      setLastFoldersPath,
      setFileColumn,
      setLastDesk,
      setPendingTopicMessage,
    }),
    [dmId, topicsPath, foldersPath, fileColumn, desk, pendingTopicMessage],
  )

  return <LastSelectionContext.Provider value={value}>{children}</LastSelectionContext.Provider>
}

export function useLastSelection(): LastSelectionValue {
  const ctx = useContext(LastSelectionContext)
  if (!ctx) throw new Error('useLastSelection must be used within LastSelectionProvider')
  return ctx
}
