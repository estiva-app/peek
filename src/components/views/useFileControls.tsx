import { useCallback, useState, type ReactNode } from 'react'
import { nestingOf } from '@estiva-app/interop'
import type { ForeignObject } from '@estiva-app/interop'
import type { RenameOutcome } from '@/api'
import { useFollows, useForeignObjects } from '@/api'
import { ConfirmDelete } from '@/components/ConfirmDelete'
import { FileDetailsDialog } from '@/components/FileDetailsDialog'
import { MoveUnderDialog, type MoveTarget } from '@/components/MoveUnderDialog'
import { StartTopicDialog } from '@/components/StartTopicDialog'
import { canStartInside, fileControlsOf } from '@/lib/fileControls'
import { useToast } from '@/lib/toast'

/**
 * What a menu asks for on a file: its details, a rename, a deletion, a move
 * under another file, or a new topic inside it (FOL-4).
 */
export type FileControl = 'details' | 'rename' | 'delete' | 'move' | 'inside'

const titleOf = (file: ForeignObject) => file.slots.title?.value ?? 'Untitled'

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
 *
 * ## Move and "New topic inside" read the team first (FOL-4)
 *
 * Both are questions about the whole team, so both open on a fresh read of
 * its listing — the one read that folds every `parent` change (SPEC §6.7) —
 * rather than on whatever the tree last drew. Move offers
 * `nestingOf(...).moveTargetsOf`, each as its path; a new topic goes in the
 * parent's own team, which is the file's `h`, and `hasState` comes from the
 * same read, for the reason the delete takes it fresh.
 */
export function useFileControls({
  onRenamed,
  onDeleted,
  onMoved,
  onStarted,
}: {
  /** The rename went through: re-read what shows the title. */
  onRenamed?: (file: ForeignObject) => void
  /** The delete went through, and the Folder is unlisted where it had to be. */
  onDeleted?: (file: ForeignObject) => void
  /** The move went through: re-read what shows the file's place. */
  onMoved?: (file: ForeignObject) => void
  /** A topic was started inside `parent`. */
  onStarted?: (created: { address: string; title: string }, parent: ForeignObject) => void
} = {}): {
  /** Open the control the menu asked for, on this file. */
  open: (control: FileControl, file: ForeignObject) => void
  /** The dialogs, rendered by the page that owns them. */
  dialogs: ReactNode
} {
  const { renameFile, deleteFile, resolveFolderContents, applyAction, createTopic } = useForeignObjects()
  const follows = useFollows()
  const { showToast } = useToast()
  const [dialog, setDialog] = useState<
    | { kind: 'details'; file: ForeignObject; editing: boolean }
    | { kind: 'confirm'; file: ForeignObject }
    | { kind: 'move'; file: ForeignObject; teamName: string; targets: MoveTarget[] }
    | { kind: 'inside'; file: ForeignObject; team: string; teamName: string; hasState: boolean }
    | null
  >(null)

  const refuse = useCallback(
    (label: string) => showToast({ label, type: 'warning', leadingIcon: false, durationMs: 0, actionLabel: 'Dismiss' }),
    [showToast],
  )

  const open = useCallback(
    (control: FileControl, file: ForeignObject) => {
      if (control === 'delete') return setDialog({ kind: 'confirm', file })
      if (control !== 'move' && control !== 'inside') {
        return setDialog({ kind: 'details', file, editing: control === 'rename' })
      }
      const team = file.folder
      if (!team || (control === 'inside' && !canStartInside(file))) {
        return refuse('This file is in no team Peek can read, so nothing can be put inside it from here.')
      }
      void (async () => {
        let contents: Awaited<ReturnType<typeof resolveFolderContents>>
        try {
          contents = await resolveFolderContents(team)
        } catch {
          refuse('The team could not be read. Try again.')
          return
        }
        const teamName = contents.name ?? 'this team'
        if (control === 'inside') {
          setDialog({ kind: 'inside', file, team, teamName, hasState: contents.hasState })
          return
        }
        const nesting = nestingOf(contents.files)
        const here = contents.files.find((candidate) => candidate.ref === file.ref) ?? file
        const targets = nesting.moveTargetsOf(here).map((target) =>
          target ? { file: target, path: [...nesting.ancestorsOf(target), target].map(titleOf) } : { path: [] },
        )
        setDialog({ kind: 'move', file: here, teamName, targets })
      })()
    },
    [refuse, resolveFolderContents],
  )

  const move = async (file: ForeignObject, parent: string): Promise<boolean> => {
    const action = fileControlsOf(file).move
    if (!action || !file.naddr) {
      refuse('This file cannot be moved from here.')
      return false
    }
    const result = await applyAction({ naddr: file.naddr, actionId: action.id, value: parent })
    if (!result.ok) {
      refuse(result.reason ?? 'The relay refused the move.')
      return false
    }
    onMoved?.(file)
    return true
  }

  const startInside = async (
    parent: ForeignObject,
    team: string,
    hasState: boolean,
    title: string,
  ): Promise<boolean> => {
    /*
      The parent's team, never the page's (SPEC §6.7): a sub-file is readable by
      exactly its parent's readers. For a bare parent that is its `h`, which is
      `team` here; any other kind reached this dialog only with an `h` of its own.
    */
    const result = await createTopic({ folder: team, title, parent: parent.address, hasState })
    if (!result.ok) {
      showToast({ label: result.reason, type: 'error' })
      return false
    }
    // You follow what you create (FOL-30), as the Folder page's start does.
    void follows.setFollowed(result.address, true)
    onStarted?.({ address: result.address, title }, parent)
    return true
  }

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
    ) : dialog.kind === 'move' ? (
      <MoveUnderDialog
        file={dialog.file}
        teamName={dialog.teamName}
        targets={dialog.targets}
        onMove={(parent) => move(dialog.file, parent)}
        onClose={() => setDialog(null)}
      />
    ) : dialog.kind === 'inside' ? (
      <StartTopicDialog
        folderName={dialog.teamName}
        parent={dialog.file}
        onCreate={(title) => startInside(dialog.file, dialog.team, dialog.hasState, title)}
        onClose={() => setDialog(null)}
      />
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
