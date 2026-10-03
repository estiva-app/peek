import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { isArchived, listedBeneath, topLevelFolders } from '@estiva-app/interop'
import type { FolderSummary, ForeignObject } from '@estiva-app/interop'
import type { RenameOutcome } from '@/api'
import { useForeignObjects } from '@/api'
import { ArchiveDialog } from '@/components/ArchiveDialog'
import { ConfirmDelete } from '@/components/ConfirmDelete'
import { FileDetailsDialog } from '@/components/FileDetailsDialog'
import { MoveDialog, type MoveChoice } from '@/components/MoveDialog'
import { StartTopicDialog } from '@/components/StartTopicDialog'
import { archiveImpactWords, kindNoun } from '@/lib/archiveWords'
import { canStartInside, fileControlsOf } from '@/lib/fileControls'
import { currentFolderOf, moveTargetsIn, type MoveTarget } from '@/lib/moveTargets'
import { useToast } from '@/lib/toast'

/**
 * What a menu asks for on a file: its details, a rename, a deletion, a move
 * to another Folder or under another file (FOL-45), or a new topic inside it
 * (FOL-4).
 */
export type FileControl = 'details' | 'rename' | 'delete' | 'move' | 'inside' | 'archive' | 'unarchive'

const titleOf = (file: ForeignObject) => file.slots.title?.value ?? 'Untitled'

interface MoveState {
  kind: 'move'
  file: ForeignObject
  /** The Folder it is in now, and whether that Folder has state — both from the read the dialog opened on. */
  from: string
  fromHasState: boolean
  /** Any other Folder with state that lists it too — after a partial move — which it leaves as well. */
  alsoIn: string[]
  /** Every file `from` lists: what is under the file moves with it. */
  listing: ForeignObject[]
  /** The top-level Folders, which are where it may go. */
  teams: FolderSummary[]
  nests: boolean
  targets?: MoveTarget[]
}

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
 * rather than on whatever the tree last drew. The team is the top-level Folder
 * that lists the file (`currentFolderOf`), not its `h`: a move between Folders
 * leaves the `h` where the file was filed. A new topic goes in that team, and
 * `hasState` comes from the same read, for the reason the delete takes it fresh.
 *
 * ## Move is one dialog, and the order of its writes is per kind (FOL-45)
 *
 * The Folder, then what it goes under there (`MoveDialog`). A topic or a
 * project changes Folder by its listing — `kind:1852` add to the new one, then
 * remove from the old, carrying everything listed under it — and a topic then
 * takes its new parent, the manifest's move action. An issue is listed by no
 * Folder: it changes Folder by changing project (Ship's `move-issue`), so the
 * parent goes first and anything listed under the issue follows. Either way,
 * a second write refused after a first one landed is said as a partial move,
 * because the file did go somewhere and "it failed" would send a person to
 * look for it where it no longer is.
 *
 * ## Archive counts first, and Unarchive does not ask (FOL-46)
 *
 * Archive opens on a read of what it would hide — interop's `archiveImpact`,
 * the numbers Ship's dialog shows — so the warning is never a guess, and a
 * read that fails says so rather than warning about nothing. Then one change,
 * the manifest's archive action with the resolution as its content. Unarchive
 * runs on the click: it only brings back what was there. The delete question
 * offers Archive as the safer answer wherever the manifest declares one.
 */
export function useFileControls({
  onRenamed,
  onDeleted,
  onMoved,
  onStarted,
  onArchived,
}: {
  /** The rename went through: re-read what shows the title. */
  onRenamed?: (file: ForeignObject) => void
  /** The delete went through, and the Folder is unlisted where it had to be. */
  onDeleted?: (file: ForeignObject) => void
  /** The move went through: re-read what shows the file's place. */
  onMoved?: (file: ForeignObject) => void
  /** A topic was started inside `parent`. */
  onStarted?: (created: { address: string; title: string }, parent: ForeignObject) => void
  /** The archive or the unarchive went through: re-read what lists or draws the file. */
  onArchived?: (file: ForeignObject, archived: boolean) => void
} = {}): {
  /** Open the control the menu asked for, on this file. */
  open: (control: FileControl, file: ForeignObject) => void
  /** The dialogs, rendered by the page that owns them. */
  dialogs: ReactNode
} {
  const { renameFile, deleteFile, resolveFolderContents, listFolders, applyAction, createTopic, archiveFile, archiveImpact, moveFile } =
    useForeignObjects()
  const { showToast } = useToast()
  const [dialog, setDialog] = useState<
    | { kind: 'details'; file: ForeignObject; editing: boolean }
    | { kind: 'confirm'; file: ForeignObject }
    | MoveState
    | { kind: 'inside'; file: ForeignObject; team: string; teamName: string; hasState: boolean }
    | { kind: 'archive'; file: ForeignObject; hides: string[]; staysVisible: string[] }
    | null
  >(null)

  const refuse = useCallback(
    (label: string) => showToast({ label, type: 'warning', leadingIcon: false, durationMs: 0, actionLabel: 'Dismiss' }),
    [showToast],
  )

  /*
    The caller's `onArchived` is an inline closure, and `open` goes to every
    tree row as `onControl`: read through a ref, so `open` stays the stable
    function it was before archive joined it.
  */
  const archivedCallback = useRef(onArchived)
  useEffect(() => {
    archivedCallback.current = onArchived
  })
  const counting = useRef(false)

  const setArchived = useCallback(
    async (file: ForeignObject, archived: boolean, resolution?: string): Promise<boolean> => {
      const action = fileControlsOf(file).archive
      if (!action || !file.naddr) {
        refuse('This file cannot be archived from here.')
        return false
      }
      /*
        A refused sign throws rather than answering (a 429 from Estiva ID under
        load, measured on production), and a rejection here would close the
        dialog with nothing written and nothing said.
      */
      const result = await archiveFile({ naddr: file.naddr, actionId: action.id, archived, resolution }).catch(
        (error: unknown) => ({ ok: false as const, reason: `Nothing was archived: ${(error as Error)?.message ?? 'the write failed'}. Try again.` }),
      )
      if (!result.ok) {
        refuse(result.reason)
        return false
      }
      archivedCallback.current?.(file, archived)
      return true
    },
    [archiveFile, refuse],
  )

  const open = useCallback(
    (control: FileControl, file: ForeignObject) => {
      if (control === 'delete') return setDialog({ kind: 'confirm', file })
      if (control === 'unarchive') return void setArchived(file, false)
      if (control === 'archive') {
        const address = file.address
        if (!address) return refuse('This file cannot be archived from here.')
        // One count at a time, and the delete question closes now: a Delete
        // pressed while the count is read would leave an archive to confirm
        // for a file that is gone.
        if (counting.current) return
        counting.current = true
        setDialog(null)
        void archiveImpact(address)
          .then((impact) => setDialog({ kind: 'archive', file, ...archiveImpactWords(impact) }))
          .catch(() => refuse('What archiving would hide could not be read, so nothing was archived. Try again.'))
          .finally(() => {
            counting.current = false
          })
        return
      }
      if (control !== 'move' && control !== 'inside') {
        return setDialog({ kind: 'details', file, editing: control === 'rename' })
      }
      const ownFolder = file.folder
      if (!ownFolder || (control === 'inside' && !canStartInside(file))) {
        return refuse('This file is in no Folder Peek can read, so nothing can be put inside it from here.')
      }
      void (async () => {
        let contents: Awaited<ReturnType<typeof resolveFolderContents>>
        let folders: FolderSummary[]
        let team: string | undefined
        try {
          /*
            The team is the top-level Folder that lists the file (SPEC §6.7),
            never assumed from its `h`. A Ship project's Folder is its own
            record channel, listed under the team that holds the project
            (`listedIn`, interop 0.28): a topic started there went where
            neither the team's tree nor Ship's Related lists it (FOL-4, on
            "Conversation standard"). And a topic moved to another Folder keeps
            the `h` it was filed with (FOL-45).
          */
          // The file's own Folder is read beside the listing, not after it: it is
          // the current one unless the file was moved, so one round trip usually does.
          const own = resolveFolderContents(ownFolder)
          own.catch(() => {})
          folders = (await listFolders()) ?? []
          team = currentFolderOf(file, folders, topLevelFolders(folders))
          if (!team) throw new Error('no team')
          contents = await (team === ownFolder ? own : resolveFolderContents(team))
        } catch {
          refuse('The Folder could not be read. Try again.')
          return
        }
        const teamName = contents.name ?? 'this Folder'
        if (control === 'inside') {
          setDialog({ kind: 'inside', file, team, teamName, hasState: contents.hasState })
          return
        }
        const here = contents.files.find((candidate) => candidate.ref === file.ref) ?? file
        const nests = !!fileControlsOf(here).move
        setDialog({
          kind: 'move',
          file: here,
          from: team,
          fromHasState: contents.hasState,
          alsoIn: folders
            .filter((folder) => folder.id !== team && folder.hasState && !!file.address && !!folder.addresses?.includes(file.address))
            .map((folder) => folder.id),
          listing: contents.files,
          teams: topLevelFolders(folders),
          nests,
          targets: nests ? moveTargetsIn(contents.files, here, { sameFolder: true }) : undefined,
        })
      })()
    },
    [refuse, resolveFolderContents, listFolders, archiveImpact, setArchived],
  )

  const move = async (state: MoveState, choice: MoveChoice): Promise<boolean> => {
    const { file, from } = state
    const to = state.teams.find((team) => team.id === choice.folder)
    if (!to) return false
    const changesFolder = to.id !== from
    const changesParent = choice.parent !== undefined && choice.parent !== (file.parentRef ?? '')
    // The file and what the listing has beneath it, planned by interop (SPEC §3.3). An issue is
    // listed by no Folder — its project is — so only what is listed under it moves.
    const target = { id: to.id, hasState: to.hasState, private: to.private }
    const listsAny = state.listing.some((listed) => listed.ref === file.ref) || listedBeneath(state.listing, file).length > 0
    type Step = () => Promise<{ ok: true } | { ok: false; reason?: string }>
    const relist: Step | undefined =
      changesFolder && listsAny
        ? async () => {
            const result = await moveFile(file, state.listing, { id: from, hasState: state.fromHasState }, target)
            if (!result.ok) return result
            // Out of every other Folder that still lists it, as Ship's move does (`placedIn`).
            for (const other of state.alsoIn.filter((id) => id !== to.id)) {
              const also = await moveFile(file, state.listing, { id: other, hasState: true }, target)
              // It did arrive: a refused clean-up is a partial move, not a failed one.
              if (!also.ok) {
                refuse(`Moved to ${to.name ?? 'the folder'}, but it is still listed in another folder too: ${also.reason}. Try moving it again.`)
                break
              }
            }
            return result
          }
        : undefined
    const action = fileControlsOf(file).move
    const reparent: Step | undefined = changesParent
      ? async () =>
          action && file.naddr
            ? applyAction({ naddr: file.naddr, actionId: action.id, value: choice.parent ?? '' }).catch((error: unknown) => ({
                ok: false as const,
                reason: (error as Error)?.message,
              }))
            : { ok: false as const, reason: 'This file cannot be put under another from here.' }
      : undefined
    const steps = (file.parentKind === undefined ? [relist, reparent] : [reparent, relist]).filter((step): step is Step => !!step)
    let moved = false
    for (const step of steps) {
      const result = await step()
      if (!result.ok) {
        if (!moved) {
          refuse(result.reason ?? 'The relay refused the move.')
          return false
        }
        refuse(`Moved to ${to.name ?? 'the folder'}, but not all of it: ${result.reason ?? 'the rest was refused'}. Try moving it again.`)
        break
      }
      moved = true
    }
    onMoved?.(file)
    return true
  }

  const targetsIn = async (state: MoveState, folder: string): Promise<MoveTarget[]> =>
    moveTargetsIn((await resolveFolderContents(folder)).files, state.file, { sameFolder: folder === state.from })

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
    // Not for a `listed` deletion (MAN-4): the runtime reads every Folder that
    // lists it and unlists from each, so this read would go unused.
    let hasState = false
    if (!action.listed) {
      try {
        hasState = (await resolveFolderContents(file.folder)).hasState
      } catch {
        refuse('The folder could not be read, so nothing was deleted. Try again.')
        return
      }
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
      <ConfirmDelete
        what="topic"
        onArchiveInstead={
          fileControlsOf(dialog.file).archive && !isArchived(dialog.file) ? () => open('archive', dialog.file) : undefined
        }
        onConfirm={() => void runDelete(dialog.file)}
        onClose={() => setDialog(null)}
      />
    ) : dialog.kind === 'archive' ? (
      <ArchiveDialog
        title={titleOf(dialog.file)}
        what={kindNoun(dialog.file.kind)}
        hides={dialog.hides}
        staysVisible={dialog.staysVisible}
        onArchive={(resolution) => setArchived(dialog.file, true, resolution || undefined)}
        onClose={() => setDialog(null)}
      />
    ) : dialog.kind === 'move' ? (
      <MoveDialog
        file={dialog.file}
        from={dialog.from}
        folders={dialog.teams.map((team) => ({ id: team.id, name: team.name ?? 'Untitled folder' }))}
        nests={dialog.nests}
        targets={dialog.targets}
        targetsIn={(folder) => targetsIn(dialog, folder)}
        onMove={(choice) => move(dialog, choice)}
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
