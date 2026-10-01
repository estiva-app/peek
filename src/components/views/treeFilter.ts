import type { ForeignObject } from '@estiva-app/interop'

/**
 * What the Folders column is showing — FOL-41's filter.
 *
 * `all` is the tree as it has always been. The other two hide, and what they
 * hide is judged at two levels with two different sources:
 *
 * - **A Folder** by `useTeamUnread` — the union dot for `unread`, the
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
 * FOL-41). So a Folder with a match is shown whatever its own dot says, and a
 * peer with a matching listed child is shown and starts expanded.
 *
 * ## What it cannot reach
 *
 * A match below the rows a Folder's read returns — a Ship issue inside a
 * project, fetched only when that row is expanded — leaves its Folder shown
 * and lit, because the Folder-level verdict sees the whole channel, but the
 * project row it is under is not itself a match and is hidden with the rest.
 * Filtering that far would mean expanding every row of every Folder, which is
 * the cost the tree exists to avoid (`FolderTree`'s header). The Folder still
 * says something is in there, and `All` opens it.
 */
export type TreeFilter = 'all' | 'unread' | 'mine'

/** The dropdown's rows, in order. */
export const TREE_FILTERS: { value: TreeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: 'mine', label: 'Mine' },
]

/**
 * Does this Folder survive the filter — judged over the two whole-Folder
 * verdicts.
 *
 * **`=== true`, the dot's own rule.** A Folder with no entry was not judged —
 * no viewer, a read that failed, a frontier that has not landed — and it draws
 * no dot for exactly that reason (`useTeamUnread`). So `Unread` shows the
 * Folders with a dot and nothing else, which is the only reading of the word a
 * person can check against what is on screen. The cost is that the column is
 * empty for the moment before the dots land, and that is what a filter over an
 * unanswered question honestly looks like.
 */
export function folderMatches(
  filter: TreeFilter,
  folderId: string,
  unread: Record<string, boolean>,
  member: Record<string, boolean>,
): boolean {
  if (filter === 'all') return true
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
  if (filter === 'all') return true
  const one = (candidate: ForeignObject) =>
    filter === 'unread' ? unread?.[candidate.ref] === true : !!candidate.address && isMember(candidate.address)
  return one(file) || children.some(one)
}
