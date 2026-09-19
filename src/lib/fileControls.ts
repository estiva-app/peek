import type { ForeignObject, ResolvedAction } from '@estiva-app/interop'

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
}

export function fileControlsOf(file: Pick<ForeignObject, 'actions' | 'slots' | 'naddr'> | null | undefined): FileControls {
  // No address, no actions: a change names its target with `a`, and the
  // runtime already resolves no actions for such an object. Said here too so a
  // caller holding a partial object gets the same answer.
  if (!file?.naddr) return {}
  const titleField = file.slots.title?.field
  const rename = titleField ? file.actions.find((a) => a.control === 'text' && a.field === titleField) : undefined
  const remove = file.actions.find((a) => a.control === 'confirm')
  return { ...(rename ? { rename } : {}), ...(remove ? { delete: remove } : {}) }
}

/** True when the file offers at least one control, so a menu is worth drawing. */
export function hasFileControls(controls: FileControls): boolean {
  return !!controls.rename || !!controls.delete
}
