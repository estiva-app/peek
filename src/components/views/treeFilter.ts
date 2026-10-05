import type { ForeignObject } from '@estiva-app/interop'

/**
 * What the Folders column is showing — FOL-41's filter.
 *
 * `all` is the tree as it has always been. The other two hide, and what they
 * hide is judged at two levels with two different sources:
 *
 * - **A Folder** by `useTeamUnread` — the union of its streams for `unread`
 *   (drawn as nothing: a Folder row carries no dot, 2026-10-03), the
 *   companion verdict for `mine`: files the person is a member of. Both are read for *every* Folder before
 *   any fold opens, so this level is exact and costs nothing: a Folder is
 *   shown when something inside it matches, however deep.
 * - **A row inside an open Folder** by what that Folder's read already holds:
 *   the peer's own badge, or a listed child's. Nothing is read to filter, and
 *   no fold is opened to answer.
 *
 * ## Parents of a match are drawn
 *
 * A file three levels down does not appear on its own — it appears under the
 * Folder and the row that hold it, neither of which need match (Miky,
 * FOL-41). So a Folder with a match is shown, and a
 * peer with a matching listed child is shown and starts expanded.
 *
 * ## What it cannot reach
 *
 * A match below the rows a Folder's read returns — a Ship issue inside a
 * project, fetched only when that row is expanded — leaves its Folder shown,
 * because the Folder-level verdict sees the whole channel, but the project
 * row it is under is not itself a match and is hidden with the rest. (A
 * Folder's own messages, about no file, are not counted at all: Peek has no
 * screen for them — `teamHasUnread`.) Filtering that far
 * would mean expanding every row of every Folder, which is the cost the tree
 * exists to avoid (`FolderTree`'s header). Such a Folder is drawn open with no
 * lit row in it; `All` shows its rows.
 */
export type TreeFilter = 'all' | 'unread' | 'mine' | 'mine-unread' | 'archive'

/**
 * The column's views, its title's menu (Katerina, 5 October): Topics, the
 * files you are a member of — the filter Mine was — Folders, every Folder,
 * the explorer, and Archive, what was archived, where Unarchive brings it
 * back. The Folders page went; a Folder is managed from its heading.
 */
export type TreeView = 'mine' | 'all' | 'archive'

/** The title menu's rows, in order: each view's name is the column's title. */
export const TREE_VIEWS: { value: TreeView; label: string }[] = [
  { value: 'mine', label: 'Topics' },
  { value: 'all', label: 'Folders' },
  { value: 'archive', label: 'Archive' },
]

/** The filter's rows, in order, in either view. */
export type TreeShow = 'all' | 'unread'
export const TREE_FILTERS: { value: TreeShow; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
]

/** What the tree hides, from the view and the filter: Topics and Unread together is `mine-unread`. Archive has no filter. */
export function treeFilterOf(view: TreeView, show: TreeShow): TreeFilter {
  if (view === 'archive') return 'archive'
  if (view === 'mine') return show === 'unread' ? 'mine-unread' : 'mine'
  return show
}

/**
 * Does this Folder survive the filter — judged over the two whole-Folder
 * verdicts.
 *
 * **`=== true`.** A Folder with no entry was not judged — no viewer, a read
 * that failed, a frontier that has not landed (`useTeamUnread`) — and is not
 * shown as unread. The cost is that the column is empty for the moment before
 * the verdicts land, and that is what a filter over an unanswered question
 * honestly looks like.
 */
export function folderMatches(
  filter: TreeFilter,
  folderId: string,
  unread: Record<string, boolean>,
  member: Record<string, boolean>,
): boolean {
  // Every Folder is in Archive: what is archived in one is read when it opens.
  if (filter === 'all' || filter === 'archive') return true
  // Both verdicts, for Topics and Unread: a Folder of yours with something new.
  // Each is the whole Folder's, so its open rows may hold neither on one file.
  if (filter === 'mine-unread') return unread[folderId] === true && member[folderId] === true
  return (filter === 'unread' ? unread : member)[folderId] === true
}

/**
 * Does this row survive the filter — the row itself, or any child the Folder's
 * own read listed under it.
 *
 * `unread` is the badge map `useConversationBadges` answers, keyed by `ref`
 * and holding an entry only for a file whose conversation was read — so
 * `=== true` here is the row's dot, exactly as it is the Folder's above.
 * `isMember` is the membership seam, keyed by address; a row with no address
 * has no membership and is never one of its answers.
 */
export function fileMatches(
  filter: TreeFilter,
  file: ForeignObject,
  children: readonly ForeignObject[],
  unread: Record<string, boolean> | undefined,
  isMember: (address: string) => boolean,
): boolean {
  // Archive's listing holds only what is archived: every row of it stays.
  if (filter === 'all' || filter === 'archive') return true
  const isUnread = (candidate: ForeignObject) => unread?.[candidate.ref] === true
  const mine = (candidate: ForeignObject) => !!candidate.address && isMember(candidate.address)
  const one = (candidate: ForeignObject) =>
    filter === 'unread' ? isUnread(candidate) : filter === 'mine' ? mine(candidate) : isUnread(candidate) && mine(candidate)
  return one(file) || children.some(one)
}
