import { Button, ConfirmDialog } from '@estiva-app/ui'

/**
 * The question asked before a file is deleted from its menu — a topic, or
 * whatever the person is on — on the package's `ConfirmDialog` (D56,
 * 2026-09-10). Until then every Delete in Peek fired on the click
 * (PEEK-ADOPTION.md 13.7). A message and a reply are asked by the kit's card,
 * in the same words (`DELETE_NOTE`); a huddle's went with the huddles (audit
 * D4, 2 November).
 *
 * The words are plain and true to what happens (CON-3): Peek asks the relay
 * to delete, the relay decides, and copies held by other apps are untouched.
 * Escape and ✕ cancel; a press on the backdrop does not (D20).
 * @registry reusable: stays in Peek (Katerina, 18 September): estiva-ui's ConfirmDialog with Peek's words
 */
export function ConfirmDelete({
  onArchiveInstead,
  onConfirm,
  onClose,
}: {
  /**
   * The safer answer, for a topic its manifest lets you archive (FOL-46):
   * hidden from every list and restorable, where a deletion is neither.
   * Closes this question and opens the archive's.
   */
  onArchiveInstead?: () => void
  onConfirm: () => Promise<boolean | void> | boolean | void
  onClose: () => void
}) {
  return (
    <ConfirmDialog
      // Asked from the file's own menu, about the object the person is on —
      // which may be a Ship issue or project, not a topic (PEE-41). The
      // question does not name it.
      title="Delete?"
      confirmLabel="Delete"
      destructive
      onConfirm={onConfirm}
      onClose={onClose}
    >
      <p>
        Peek asks the relay to delete it. The relay decides, and copies held by other apps are unaffected.
      </p>
      <p>If the relay keeps it, Peek will say so; other apps can still read it until then.</p>
      {onArchiveInstead && (
        <div className="flex flex-col items-start gap-2">
          <p>To take it out of every list and keep it readable, archive it instead.</p>
          <Button variant="outlined" size="small" onClick={onArchiveInstead}>
            Archive instead
          </Button>
        </div>
      )}
    </ConfirmDialog>
  )
}
