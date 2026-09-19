import { useCallback, useState, type ReactNode } from 'react'
import type { ForeignObject } from '@estiva-app/interop'
import type { RenameOutcome } from '@/api'
import { useForeignObjects } from '@/api'
import { ConfirmDelete } from '@/components/ConfirmDelete'
import { FileDetailsDialog } from '@/components/FileDetailsDialog'
import { fileControlsOf } from '@/lib/fileControls'
import { useToast } from '@/lib/toast'

/** What a menu asks for on a file: its details, a rename, or a deletion. */
export type FileControl = 'details' | 'rename' | 'delete'

/**
 * The dialogs behind a file's more-menu, wherever the menu is (FOL-33).
 *
 * The header of a file's page and its row in the tree offer the same three
 * items, and both must open the same dialogs and run the same writes — one
 * menu, both places (PEE-2). The page owns the dialogs, as `TopicsPage` does;
 * this hook is what it owns, so the two entry points share one state and one
 * set of rules rather than two copies that drift.
 *
 * ## Delete asks first, then two writes, then the team
 *
 * D56: the menu item opens the question and the delete runs on Yes. On Yes the
 * Folder is **read again** for `hasState` rather than remembered from the
 * page's earlier read — a `kind:1852` against a Folder with no state empties
 * it on every surface (peek#192), so the fact is taken fresh, seconds before
 * the write that depends on it. Then the manifest's `delete` action (NIP-09,
 * adjudicated by the relay) and, where the Folder has state, the `1852`
 * `remove`, in `deleteFileAsViewer`. What the relay refused is said in the
 * package toast, kept up until dismissed (PEEK-170, D50) — a non-author's
 * attempt reads the relay's own reason, because the client did not pre-judge
 * it (SPEC §6.5). On success the caller is told, and lands on the team.
 *
 * ## Rename is the details dialog, open on the field
 *
 * "Rename" and "Details → Rename" are one control reached two ways, so the
 * outcome has the same place to land either way: the dialog's own line under
 * the field, as the topic dialog does it.
 */
export function useFileControls({
  onRenamed,
  onDeleted,
}: {
  /** The rename went through: re-read what shows the title. */
  onRenamed?: (file: ForeignObject) => void
  /** The delete went through, and the Folder is unlisted where it had to be. */
  onDeleted?: (file: ForeignObject) => void
} = {}): {
  /** Open the control the menu asked for, on this file. */
  open: (control: FileControl, file: ForeignObject) => void
  /** The dialogs, rendered by the page that owns them. */
  dialogs: ReactNode
} {
  const { renameFile, deleteFile, resolveFolderContents } = useForeignObjects()
  const { showToast } = useToast()
  const [dialog, setDialog] = useState<
    { kind: 'details'; file: ForeignObject; editing: boolean } | { kind: 'confirm'; file: ForeignObject } | null
  >(null)

  const open = useCallback((control: FileControl, file: ForeignObject) => {
    if (control === 'delete') setDialog({ kind: 'confirm', file })
    else setDialog({ kind: 'details', file, editing: control === 'rename' })
  }, [])

  const rename = async (file: ForeignObject, title: string): Promise<RenameOutcome> => {
    const action = fileControlsOf(file).rename
    if (!action || !file.naddr) return { kind: 'error', message: 'This file cannot be renamed from here.' }
    const result = await renameFile({ naddr: file.naddr, actionId: action.id, title })
    if (!result.ok) return { kind: 'error', message: result.reason }
    // The dialog holds the file as it was opened; the relay has accepted the
    // new name, so the row shows it now rather than on the next open. The
    // page's own copy is re-read by `onRenamed`.
    setDialog((current) =>
      current?.kind === 'details' && current.file === file
        ? { ...current, file: { ...file, slots: { ...file.slots, title: { ...file.slots.title, value: title } } } }
        : current,
    )
    onRenamed?.(file)
    return null
  }

  const runDelete = async (file: ForeignObject) => {
    const action = fileControlsOf(file).delete
    const refuse = (label: string) =>
      showToast({ label, type: 'warning', leadingIcon: false, durationMs: 0, actionLabel: 'Dismiss' })
    if (!action || !file.naddr || !file.address || !file.folder) {
      refuse('This file cannot be deleted from here.')
      return
    }
    // The fact the second write depends on, read now rather than remembered.
    let hasState: boolean
    try {
      hasState = (await resolveFolderContents(file.folder)).hasState
    } catch {
      refuse('The folder could not be read, so the topic was not deleted. Try again.')
      return
    }
    const result = await deleteFile({ naddr: file.naddr, actionId: action.id, address: file.address, folder: file.folder, hasState })
    if (!result.ok) {
      refuse(result.reason)
      return
    }
    onDeleted?.(file)
  }

  const dialogs = dialog ? (
    dialog.kind === 'confirm' ? (
      <ConfirmDelete what="topic" onConfirm={() => void runDelete(dialog.file)} onClose={() => setDialog(null)} />
    ) : (
      <FileDetailsDialog
        file={dialog.file}
        onRename={fileControlsOf(dialog.file).rename ? (title) => rename(dialog.file, title) : undefined}
        initialEditing={dialog.editing}
        onClose={() => setDialog(null)}
      />
    )
  ) : null

  return { open, dialogs }
}
