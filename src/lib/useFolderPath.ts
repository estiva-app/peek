import { useCallback } from 'react'
import { useTopics } from '@/api'
import { topicPath } from './objectUrl'

/**
 * Where a Folder opens — the Folder page's shape, decided for FOL-21.
 *
 * **The page is three panes: the tree on the left, the Folder's channel
 * stream in the middle, a thread on the right** — the same shape as a file's
 * page (FOL-19), because RFC 0.4 §4 makes a Folder the team's one conversation
 * space and v1 says every conversation in the suite is read the same way.
 *
 * Peek can draw that page today for exactly one kind of Folder: one of its
 * own topics, whose channel stream `TopicsPage` renders behind the Convex
 * twin. So a topic's Folder opens as the topic. Every other Folder — a team
 * Folder from FOL-20, a Ship project's — has a channel Peek can read (FOL-18
 * reads every one of them for the union dot) but no page that draws it, and
 * building one now would be building a read-only pane that is empty until
 * FOL-22 moves the topics' talk into their Folders and FOL-23 lets Peek speak
 * in a channel without a Convex twin. Until then such a Folder opens on
 * `/folders/<id>`, which is the listing with its management actions.
 *
 * The topic lookup is the same one `FoldersPage` makes for its "Open topic"
 * control, and for the same reason: a topic's channel *is* its Folder
 * (`Topic.folderId`), and the relay cannot tell the two apart.
 */
export function useFolderPath(): (folderId: string) => string {
  const topics = useTopics()
  return useCallback(
    (folderId) => {
      const topic = topics?.find((t) => t.folderId === folderId)
      return topic ? topicPath(topic) : `/folders/${folderId}`
    },
    [topics],
  )
}
