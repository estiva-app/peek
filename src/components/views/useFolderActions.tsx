import { useState, type ReactNode } from 'react'
import { MenuItem } from '@estiva-app/ui'
import type { FolderSummary } from '@estiva-app/interop'
import { useCurrentUser } from '@/api'
import { legacyTopicByChannel } from '@/lib/legacyTopicLinks'

/** One of a Folder's actions, chosen from its heading's ⋮. */
export type FolderAction = { kind: 'topic' | 'rename' | 'archive'; folder: FolderSummary }

/**
 * A Folder's own actions, on its heading's ⋮ (Katerina, 5 October: the
 * Folders page went, and what its pane offered moved onto the Folder in the
 * tree). The rules are the page's, unchanged:
 *
 * - **Start a topic** — anyone in it; the Folder is one the tree draws, so it
 *   has state (`topLevelFolders`), and the topic opens once made.
 * - **Rename** — its owners and admins only: the relay takes a `kind:9002`
 *   from nobody else, so a member is not offered one that would fail. The
 *   page renamed in place; the pane is gone, so it is the New folder dialog's
 *   rename.
 * - **Archive…** — its owners and admins only (SPEC §3.2: every reader
 *   ignores an archive from anybody else), and it opens on a read of what it
 *   would hide (FOL-46).
 * - **A channel that was one of Peek's old topics** offers Start a topic only:
 *   it holds that topic's conversation, and renaming or deleting one from here
 *   once lost fourteen topics (FOL-23) — it is managed from where the topic went.
 * - **Delete** is not here: the page offered it only on a Folder with no state
 *   (FOL-9 — a `kind:9008` hides everything in the Folder), and every Folder
 *   the tree draws has state.
 *
 * The menu is here; the dialog is `FolderActionDialog` (its own file), mounted only while one
 * is open — it is where the writes and their toasts are.
 */
export function useFolderActions() {
  const me = useCurrentUser()?.id
  const [action, setAction] = useState<FolderAction | null>(null)
  const isAdmin = (folder: FolderSummary) => !!me && !!folder.admins?.includes(me) && !legacyTopicByChannel(folder.id)

  /** The heading's menu: `MenuItem`s, only what this person may do here. */
  const menuFor = (folder: FolderSummary): ReactNode => (
    <>
      <MenuItem label="Start a topic" onClick={() => setAction({ kind: 'topic', folder })} />
      {isAdmin(folder) && <MenuItem label="Rename" onClick={() => setAction({ kind: 'rename', folder })} />}
      {isAdmin(folder) && folder.channel && <MenuItem label="Archive…" onClick={() => setAction({ kind: 'archive', folder })} />}
    </>
  )

  return { menuFor, action, close: () => setAction(null) }
}
