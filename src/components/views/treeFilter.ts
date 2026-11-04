/**
 * The column's views, its title's menu (Katerina, 5 October): Teams, what was
 * Folders, and Archive, what was archived, where Unarchive brings it back.
 * "Joined" went with TEA-5: the rail's Topics is what you joined (TOP-4).
 */
export type TreeView = 'all' | 'archive'

/** The title menu's rows, in order: each view's name is the column's title. */
export const TREE_VIEWS: { value: TreeView; label: string }[] = [
  { value: 'all', label: 'Teams' },
  { value: 'archive', label: 'Archive' },
]

/** The filter's rows, in order: Teams' All, or only the places with something unread. Archive has no filter. */
export type TreeShow = 'all' | 'unread'
export const TREE_FILTERS: { value: TreeShow; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
]
