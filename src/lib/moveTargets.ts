import { nestingOf, type FolderSummary, type ForeignObject } from '@estiva-app/interop'

const titleOf = (file: ForeignObject) => file.slots.title?.value ?? 'Untitled'

/** One place a file may be put under, in the Folder the move dialog is showing. */
export interface MoveTarget {
  /** Absent for the top of the Folder — or, for a file whose parent is one kind, for none. */
  file?: ForeignObject
  /** The target's breadcrumb, outermost first, ending in the target's own title. */
  path: string[]
}

/**
 * The Folder a file is in now (FOL-45) — the one the tree draws it under: a
 * team, or a Folder nested in one.
 *
 * **The listing, not the file's own `h`.** A move between Folders re-lists a
 * file and leaves its `h` where it was filed (FOL-7), so after one move a
 * topic's `folder` names the Folder it left. The Folder whose state lists it is
 * where a person sees it.
 *
 * **An issue is where its project is.** No state lists an issue; it is drawn
 * under its project (`parentRef`), and its project is listed. Last, a file no
 * state lists falls back to its own Folder and the team that Folder is in
 * (`listedIn`, interop 0.28), which is where a Ship project's record channel
 * sits.
 */
export function currentFolderOf(
  file: Pick<ForeignObject, 'address' | 'parentRef' | 'parentKind' | 'folder'>,
  folders: readonly FolderSummary[],
  teams: readonly FolderSummary[],
): string | undefined {
  // A team first, then any Folder with state: a file in a nested Folder is listed
  // by that Folder, not by the team it sits in, and removing it from the team
  // would leave it where it was.
  const listing = (address: string | undefined) =>
    address
      ? (teams.find((team) => team.addresses?.includes(address)) ??
          folders.find((folder) => folder.hasState && folder.addresses?.includes(address)))?.id
      : undefined
  const own = folders.find((folder) => folder.id === file.folder)
  return (
    listing(file.address) ??
    (file.parentKind !== undefined ? listing(file.parentRef) : undefined) ??
    own?.listedIn?.[0] ??
    file.folder
  )
}

/**
 * Where `file` may go in a Folder whose listing is `files` (FOL-45).
 *
 * `nestingOf`'s `moveTargetsOf`: never the file itself or what is under it,
 * only the kind a Ship issue's `project` holds, and — in the Folder it is in —
 * never where it already is, so every row is a move that does something.
 *
 * **In another Folder the top is a topic's, not an issue's.** A topic may sit
 * at the top of any Folder, and that is where a move lands it unless the
 * person picks a parent. An issue's empty value is "under no project", which
 * takes it out of every Folder rather than into this one — so there it is
 * offered only in the Folder the issue is in, as it was before.
 */
export function moveTargetsIn(
  files: readonly ForeignObject[],
  file: ForeignObject,
  { sameFolder }: { sameFolder: boolean },
): MoveTarget[] {
  const nesting = nestingOf(files)
  const here = files.find((candidate) => candidate.ref === file.ref) ?? file
  const targets = nesting.moveTargetsOf(here)
  const under = targets
    .filter((target): target is ForeignObject => !!target)
    .map((target) => ({ file: target, path: [...nesting.ancestorsOf(target), target].map(titleOf) }))
  const top = sameFolder ? targets.includes(undefined) : file.parentKind === undefined
  return top ? [{ path: [] }, ...under] : under
}
