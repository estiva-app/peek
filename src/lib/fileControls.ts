import { ARCHIVED_FIELD, type ForeignObject, type ResolvedAction } from '@estiva-app/interop'

/**
 * Which of a file's controls its manifest offers — Rename and Delete, read off
 * the resolved `actions` and nothing else (FOL-33).
 *
 * The rule FOL-31 set for the conversation view, applied to the header menu
 * and the tree row: a control is drawn because a declaration says so, never
 * because the kind is `30840`. A bare file's built-in manifest declares
 * `rename` and `delete`; Ship's declares neither for an issue, so an issue's
 * page and row get nothing here — and if Ship declared them tomorrow, the same
 * two controls would appear with no change in Peek.
 *
 * Rename is found by **field, not by id** (PEEK-18): the action that sets the
 * field the title slot reads is the rename, whatever the manifest called it,
 * and the two are one fact — a heading and the control that changes it.
 * Delete is the action resolved as `confirm`, which the runtime reserves for a
 * NIP-09 request: one button, asks first, no value.
 *
 * Neither is gated on who the viewer is. The relay decides who may delete —
 * the author, or the owner of an agent that wrote it — and a client cannot
 * evaluate the second half, so it offers the control to everyone and reports
 * the answer (SPEC §6.5). A rename is a change event, which anyone in the
 * team may publish.
 */
export interface FileControls {
  /** The action to invoke for a rename, or undefined when the manifest declares none. */
  rename?: ResolvedAction
  /** The action to invoke for a deletion, or undefined when the manifest declares none. */
  delete?: ResolvedAction
  /**
   * The action that re-parents the file (FOL-4) — found, like the rename, by
   * field: the one setting `parentField`. A bare file's manifest declares it,
   * and Ship's declares an issue's `project` (MAN-4); a project has none. Not
   * whether Move is offered — any listed file can change Folder (`canMove`).
   */
  move?: ResolvedAction
  /**
   * The action that archives the file and restores it (FOL-46) — found by
   * field, `archived`, whatever the manifest called it: Ship's
   * `archive-project` and `archive-issue`, the bare file's `archive`. The one
   * concept for every kind, so a project, an issue and a topic offer the same
   * Archive, and an app that declares none offers nothing.
   */
  archive?: ResolvedAction
}

export function fileControlsOf(
  file: Pick<ForeignObject, 'actions' | 'slots' | 'naddr' | 'parentField'> | null | undefined,
): FileControls {
  // No address, no actions: a change names its target with `a`, and the
  // runtime already resolves no actions for such an object. Said here too so a
  // caller holding a partial object gets the same answer.
  if (!file?.naddr) return {}
  const titleField = file.slots.title?.field
  const rename = titleField ? file.actions.find((a) => a.control === 'text' && a.field === titleField) : undefined
  const remove = file.actions.find((a) => a.control === 'confirm')
  const move = file.parentField ? file.actions.find((a) => a.field === file.parentField) : undefined
  const archive = file.actions.find((a) => a.field === ARCHIVED_FIELD)
  return {
    ...(rename ? { rename } : {}),
    ...(remove ? { delete: remove } : {}),
    ...(move ? { move } : {}),
    ...(archive ? { archive } : {}),
  }
}

/**
 * Whether Move is offered (FOL-45). Every file with an address can be listed in
 * another Folder — a Folder lists addresses, whatever app owns them — and one
 * whose manifest declares a parent can also be put under another file. Whether
 * a Folder may be left or entered is the move's to answer (FOL-10), with a
 * reason, not the menu's.
 */
export function canMove(file: Pick<ForeignObject, 'address' | 'naddr'> | null | undefined): boolean {
  return !!file?.address && !!file.naddr
}

/** True when the file offers at least one control, so a menu is worth drawing. */
export function hasFileControls(controls: FileControls): boolean {
  return !!controls.rename || !!controls.delete || !!controls.move || !!controls.archive
}

/**
 * Whether a topic may be started inside this file (FOL-4, SPEC §6.7).
 *
 * Not a manifest question: a bare file may sit under a file of any kind, and
 * the parent's owner neither declares nor needs to. What it does need is a team
 * — the sub-file goes in its parent's — so a file resolved without one, a
 * record with no `h`, offers nothing rather than guessing a team.
 */
export function canStartInside(file: Pick<ForeignObject, 'address' | 'folder'> | null | undefined): boolean {
  return !!file?.address && !!file.folder
}
