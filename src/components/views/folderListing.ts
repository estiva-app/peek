import { nestingOf } from '@estiva-app/interop'
import type { ForeignObject } from '@estiva-app/interop'

/*
  What a Folder's listing holds at the top level and under a row — the tree's
  two questions (`FileTreeView`). They were `FolderContentsView`'s, which
  drew a Folder's contents as cards on the Folders page; that page and its
  cards went on 5 October (Katerina), and the rules stayed.
*/

/**
 * The files that belong at the top level — RFC 0.4 §4.
 *
 * **A child is not also a peer.** A folder with no state event is read by
 * containment, and Ship writes the folder's `h` on an issue as well as on its
 * project, so both arrive in the listing. Before this view drew nesting that
 * was merely flat; once a project expands to its issues, every issue appears
 * twice — once under its project and once beside it. Reported on production's
 * "Feedback on Peek", which has no folder state.
 *
 * So a file whose `parentRef` names another file **in this same listing** is
 * dropped from the top level and reached by expanding its parent instead.
 *
 * The qualifier is the whole rule. An issue whose project is *not* in this
 * folder stays a peer: it is genuinely a top-level member here, and hiding it
 * would make it unreachable — a file in a folder that the folder does not show.
 * That is the disclosure bug §4.2 spends its whole argument avoiding, arrived
 * at from the other direction.
 *
 * Nesting is still fetched rather than taken from the listing. A state folder
 * may list a project and only some of its issues, and drawing that subset as
 * "the project's issues" would be a different and quieter wrong answer than
 * the one this fixes.
 */
export function peersOf(files: ForeignObject[]): ForeignObject[] {
  // `nestingOf` since FOL-4: the same rule, and a file on a cycle — A under B
  // under A — stays at the top instead of both vanishing (SPEC §6.7).
  return nestingOf(files).roots
}

/**
 * The files in this listing that name `parent` as theirs — the other half of
 * {@link peersOf}, and the half that was missing.
 *
 * `peersOf` hides a child whose parent is listed; `ChildRows` fetches the
 * children the parent's *owner declared* — a project's issues. A bare-file
 * topic started under a project (SPEC §6.7) is neither: Ship never declared
 * bare files as children of a project and never will, so it was hidden at the
 * top and absent from the expansion — in the listing and on no screen.
 *
 * So a row shows both: what its owner's manifest fetches, and what this
 * listing already holds that points at it. No request, no recursion budget —
 * these objects are resolved already — and a kind nobody has met nests under
 * whatever it names.
 */
export function listedChildrenOf(parent: ForeignObject, files: ForeignObject[]): ForeignObject[] {
  return nestingOf(files).childrenOf(parent)
}
