import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { KIND_BARE_FILE, SUMMARY_FIELD, isArchived, topLevelFolders } from '@estiva-app/interop'
import type { FolderRef, FolderSummary, ForeignObject } from '@estiva-app/interop'
import type { RenameOutcome } from '@/api'
import { ArchiveDialog, MoveDialog, type MoveChoice, type MovePlace } from '@estiva-app/ui'
import { fileArchiveChanged, folderLoad, reloadFoldersOnScreen, topicFollowTarget, useForeignObjects, useMembership, usePeekActions, useReloadHeldObject, useTeams, entryNames } from '@/api'
import { ConfirmDelete } from '@/components/ConfirmDelete'
import { FileDetailsDialog } from '@/components/FileDetailsDialog'
import { StartTopicDialog } from '@/components/StartTopicDialog'
import { ARCHIVE_WORDS, archiveImpactWords, kindNoun } from '@/lib/archiveWords'
import { canStartInside, fileControlsOf } from '@/lib/fileControls'
import { currentFolderOf, moveTargetsIn, type MoveTarget } from '@/lib/moveTargets'
import { useToast } from '@/lib/toast'


/**
 * What a menu asks for on a file: its details, a rename, a deletion, a move
 * to another Folder or under another file (FOL-45), or a new topic inside it
 * (FOL-4).
 */
export type FileControl = 'details' | 'rename' | 'delete' | 'move' | 'inside' | 'archive' | 'unarchive' | 'join' | 'leave'

const titleOf = (file: ForeignObject) => file.slots.title?.value ?? 'Untitled'

/** Where a file may go, as the kit's Move lists it: what it goes under, by address (`''` for the top), and its path. */
const placeOf = (target: MoveTarget): MovePlace => ({ id: target.file?.address ?? '', path: target.path })

/** A topic: the one kind a team marks as a space (§3.3). */
const isTopic = (file: ForeignObject) => Number(file.address?.split(':')[0]) === KIND_BARE_FILE

interface MoveState {
  kind: 'move'
  file: ForeignObject
  /** The Folder it is in now, from the read the dialog opened on. */
  from: string
  /**
   * Every Folder it leaves: `from`, with `hasState` from that read, and any
   * other Folder with state that lists it too — after a partial move — each
   * with what its state lists (`addresses`).
   */
  sources: (FolderRef & { name: string })[]
  /** The top-level Folders, which are where it may go. */
  teams: FolderSummary[]
  nests: boolean
  targets?: MoveTarget[]
}

/** The Move dialog on `file`, from a read of where it is: its team's contents and every Folder. */
function moveStateOf(
  file: ForeignObject,
  { contents, folders, team }: { contents: { name?: string; hasState: boolean; files: ForeignObject[] }; folders: FolderSummary[]; team: string },
): MoveState {
  const here = contents.files.find((candidate) => candidate.ref === file.ref) ?? file
  const nests = !!fileControlsOf(here).move
  return {
    kind: 'move',
    file: here,
    from: team,
    sources: [
      { id: team, name: contents.name ?? 'Untitled team', hasState: contents.hasState, addresses: folders.find((folder) => folder.id === team)?.addresses ?? [] },
      ...folders
        .filter((folder) => folder.id !== team && folder.hasState && !!file.address && !!folder.addresses?.includes(file.address))
        .map((folder) => ({ id: folder.id, name: folder.name ?? 'Untitled team', hasState: true, addresses: folder.addresses ?? [] })),
    ],
    teams: topLevelFolders(folders),
    nests,
    targets: nests ? moveTargetsIn(contents.files, here, { sameFolder: true }) : undefined,
  }
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
 * project changes Folder by its listing — one `kind:1852` move from each Folder
 * that lists it into the new one, carrying everything listed under it,
 * archived or not, through interop's `planMoveFromFolders` — and a topic then
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
  onMembership,
}: {
  /** The rename or a summary change went through: re-read what shows the title and the summary. */
  onRenamed?: (file: ForeignObject) => void
  /** The delete went through, and the Folder is unlisted where it had to be. */
  onDeleted?: (file: ForeignObject) => void
  /** The move went through: re-read what shows the file's place. */
  onMoved?: (file: ForeignObject) => void
  /** A topic was started inside `parent`. */
  onStarted?: (created: { address: string; title: string }, parent: ForeignObject) => void
  /** The archive or the unarchive went through: re-read what lists or draws the file. */
  onArchived?: (file: ForeignObject, archived: boolean) => void
  /** A join, a leave or an add went through: re-read who is in the file. */
  onMembership?: (file: ForeignObject) => void
} = {}): {
  /** Open the control the menu asked for, on this file. */
  open: (control: FileControl, file: ForeignObject) => void
  /**
   * Add these people to the file (the Members dialog's "Add members", REA-3),
   * one at a time, stopping at the first refusal, which a toast says.
   * Resolves `true` once the relay has taken every one.
   */
  addMembers: (file: ForeignObject, pubkeys: string[], nameOf: (pubkey: string) => string) => Promise<boolean>
  /** The dialogs, rendered by the page that owns them. */
  dialogs: ReactNode
} {
  const { renameFile, deleteFile, resolveFolderContents, listFolders, applyAction, createTopic, archiveFile, archiveImpact, moveFile } =
    useForeignObjects()
  // The Desk's Open work draws this tab's held copy of a file: asked again after a rename or a summary change, its row shows it.
  const reloadHeld = useReloadHeldObject()
  const { showToast } = useToast()
  const membership = useMembership()
  /*
    Read through a ref, like `onArchived` below: `open` stays the stable
    function every row holds, and still joins with the membership of now —
    held in its closure, it kept the first render's, which had not read what
    the person is a member of, so every Join said "not read yet" (5 October).
  */
  const membershipNow = useRef(membership)
  useEffect(() => {
    membershipNow.current = membership
  })
  const [dialog, setDialog] = useState<
    | { kind: 'details'; file: ForeignObject; editing: boolean }
    | { kind: 'confirm'; file: ForeignObject }
    // Move pressed, its teams still read: the dialog is up at once, saying so.
    | { kind: 'move-reading'; file: ForeignObject }
    | MoveState
    | { kind: 'inside'; file: ForeignObject; team: string; teamName: string; hasState: boolean }
    | { kind: 'archive'; file: ForeignObject; hides: string[]; staysVisible: string[] }
    | null
  >(null)
  /*
    Which team marks a file a space, and which teams the person is in (TEA-5):
    read once Move is pressed, beside the Folder's own read, since from the
    Topics rail or a link none may be held yet. Move opens at once and says
    "Reading…" until they and the file's own team are read, so no team can be
    picked before a topic's "Keep it a space" box is there, ticked.
  */
  const [teamsWanted, setTeamsWanted] = useState(false)
  const { teams, failed: teamsFailed } = useTeams({ read: teamsWanted })
  const teamsPending = (file: ForeignObject) => !teams && !teamsFailed && isTopic(file)
  // Read through a ref, as membership is: `open` stays the one stable function every row holds.
  const teamsNow = useRef({ teams, teamsFailed })
  useEffect(() => {
    teamsNow.current = { teams, teamsFailed }
  })
  const { leavePlace } = usePeekActions()

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
  const membershipCallback = useRef(onMembership)
  useEffect(() => {
    membershipCallback.current = onMembership
  })
  const counting = useRef(false)

  /*
    Worded as Join and Leave are, and as Ship's dialog words it (SHI-31): what
    did not change, then why. One change per person, in order; the roster is
    re-read whatever happened, so what did go through shows.
  */
  const addMembers = useCallback(
    async (file: ForeignObject, pubkeys: string[], nameOf: (pubkey: string) => string): Promise<boolean> => {
      const title = file.slots.title?.value ?? 'this file'
      if (!file.address || !file.folder) {
        refuse(`“${title}” is in no team Peek can read, so nobody can be added from here.`)
        return false
      }
      let added = true
      for (const pubkey of pubkeys) {
        const outcome = await membershipNow.current.setMember(file.address, file.folder, true, pubkey)
        if (outcome !== true) {
          showToast({ label: `Nothing changed: ${nameOf(pubkey)} could not be added to “${title}”. ${outcome}`, type: 'error' })
          added = false
          break
        }
      }
      membershipCallback.current?.(file)
      return added
    },
    [refuse, showToast],
  )

  // Undo calls back into the same function, through a ref: it is still being defined.
  const setArchivedRef = useRef<(file: ForeignObject, archived: boolean) => Promise<boolean>>(async () => false)
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
      // Whatever is drawn re-reads, whichever page asked: an Undo pressed after its page closed has no page to ask.
      void reloadFoldersOnScreen()
      if (file.address) void fileArchiveChanged(file.address)
      /*
        Said, and Archive undone from the toast (Katerina, 5 October): the row
        leaves its list, and Undo — or Unarchive in the Archive view — brings
        it back.
      */
      const title = file.slots.title?.value ?? 'Untitled'
      showToast(
        archived
          ? { label: `Archived “${title}”`, type: 'success', actionLabel: 'Undo', onAction: () => void setArchivedRef.current(file, false) }
          : { label: `Unarchived “${title}”`, type: 'success' },
      )
      return true
    },
    [archiveFile, refuse, showToast],
  )
  useEffect(() => {
    setArchivedRef.current = setArchived
  })

  /*
    The team is the top-level Folder that lists the file (SPEC §6.7), never
    assumed from its `h`: it is where a topic started inside is listed. A Ship
    project's Folder is its own record channel, listed under the team that holds
    the project (`listedIn`, interop 0.28): a topic listed there went where
    neither the team's tree nor Ship's Related lists it (FOL-4, on "Conversation
    standard"). And a topic moved to another Folder keeps the `h` it was filed
    with (FOL-45). The new topic is stored in the parent's own Folder all the same.
  */
  const readPlace = useCallback(
    async (file: ForeignObject, ownFolder: string) => {
      // The file's own Folder is read beside the listing, not after it: it is
      // the current one unless the file was moved, so one round trip usually does.
      // One load (APP-2): the three ask for each file's changes once between them.
      const read = folderLoad()
      const own = resolveFolderContents(ownFolder, undefined, read)
      own.catch(() => {})
      const folders = (await listFolders(read)) ?? []
      const team = currentFolderOf(file, folders, topLevelFolders(folders))
      if (!team) throw new Error('no team')
      const contents = await (team === ownFolder ? own : resolveFolderContents(team, undefined, read))
      return { contents, folders, team }
    },
    [resolveFolderContents, listFolders],
  )

  const open = useCallback(
    (control: FileControl, file: ForeignObject) => {
      /*
        Join and Leave say what happened, at the bottom left like every toast
        (Katerina, 5 October), and what it means for what lights up (SPEC
        §11.8): a member hears every new message; anyone else only what names
        them. Said only once the relay holds it — a refused change undoes
        itself, and the toast says so instead.
      */
      /*
        Leave on a topic's row (TOPI-7): the topic page's switch at Not following, so the column, the switch and Ship
        agree on what is yours. Said once the relay holds it, and the column re-reads, so the row goes.
        why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-persons-level-on-a-place-is-theirs-alone.md
      */
      if (control === 'leave' && isTopic(file)) {
        const title = file.slots.title?.value ?? 'this topic'
        const target = topicFollowTarget(file, teamsNow.current.teams, teamsNow.current.teamsFailed)
        if (!target) return refuse(`Peek has not read your teams yet, so “${title}” cannot be left from here. Try again.`)
        void leavePlace({
          place: target.place,
          folder: target.folder,
          archived: target.archived,
          muted: membershipNow.current.termsOf(target.place.address).muted,
        }).then(async (result) => {
          if (!result.ok) return showToast({ label: `Nothing changed: “${title}” could not be left. ${result.reason}`, type: 'error' })
          await membershipNow.current.refresh()
          membershipCallback.current?.(file)
          showToast({ label: `Left “${title}”`, type: 'success' })
        })
        return
      }
      if (control === 'join' || control === 'leave') {
        const joining = control === 'join'
        const title = file.slots.title?.value ?? 'this file'
        if (!file.address || !file.folder) return refuse(`“${title}” is in no team Peek can read, so it cannot be ${joining ? 'joined' : 'left'} from here.`)
        void membershipNow.current.setMember(file.address, file.folder, joining).then((outcome) => {
          if (outcome === true) membershipCallback.current?.(file)
          showToast(
            outcome === true
              ? {
                  label: joining
                    ? `Joined “${title}”: every new message shows as unread.`
                    : `Left “${title}”: only messages that mention you show as unread.`,
                  type: 'success',
                }
              : { label: `Nothing changed: “${title}” could not be ${joining ? 'joined' : 'left'}. ${outcome}`, type: 'error' },
          )
        })
        return
      }
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
        return refuse('This file is in no team Peek can read, so nothing can be put inside it from here.')
      }
      if (control === 'move') {
        setTeamsWanted(true)
        setDialog({ kind: 'move-reading', file })
      }
      // Only over the Move that is still waiting for it: closed meanwhile, it stays closed.
      const replaceReading = (next: typeof dialog) =>
        setDialog((current) => (current?.kind === 'move-reading' && current.file.ref === file.ref ? next : current))
      void (async () => {
        let place: Awaited<ReturnType<typeof readPlace>>
        try {
          place = await readPlace(file, ownFolder)
        } catch {
          replaceReading(null)
          refuse('The team could not be read. Try again.')
          return
        }
        const { contents, team } = place
        const teamName = contents.name ?? 'this team'
        if (control === 'inside') {
          setDialog({ kind: 'inside', file, team, teamName, hasState: contents.hasState })
          return
        }
        replaceReading(moveStateOf(file, place))
      })()
    },
    [refuse, readPlace, archiveImpact, setArchived, showToast, leavePlace],
  )

  /*
    After a move the relay refused with nothing moved: where the file is is
    read again, so Move pressed again asks with what the Folders list now — a
    "the Folders changed" refusal says Try again, and a retry on the read the
    dialog opened on would be refused the same way.
  */
  const reread = async (state: MoveState) => {
    const ownFolder = state.file.folder
    if (!ownFolder) return
    try {
      const fresh = moveStateOf(state.file, await readPlace(state.file, ownFolder))
      setDialog((current) => (current?.kind === 'move' && current.file.ref === state.file.ref ? fresh : current))
    } catch {
      // The refusal is already said; Move pressed again asks with the read it has.
    }
  }

  const move = async (state: MoveState, choice: MoveChoice): Promise<boolean> => {
    const { file, from } = state
    const to = state.teams.find((team) => team.id === choice.folder)
    if (!to) return false
    const changesFolder = to.id !== from
    // A topic may be a space, and whether to keep it one is asked only once its teams are read: never a guess.
    if (changesFolder && !teams && isTopic(file)) {
      refuse(teamsFailed ? 'Its team could not be read, so nothing was moved. Try again.' : 'Its team is still being read. Try again in a moment.')
      return false
    }
    const changesParent = choice.parent !== undefined && choice.parent !== (file.parentRef ?? '')
    // The file and what each Folder it is in lists beneath it, archived files included, planned by
    // interop as Ship's move is (SPEC §3.3, SHI-37). An issue is listed by no Folder — its project
    // is — so only what is listed under it moves, and with nothing under it nothing is sent.
    const target = { id: to.id, hasState: to.hasState, private: to.private, company: to.company }
    /*
      Said once something did move: the Folders that still list it besides the
      new one — named as still listing it, never as refusing, since those after
      the refused move were never asked — and why, in Peek's words.
    */
    const partly = (stillIn: readonly string[], why: string | undefined, retry?: false) => {
      const names = [...new Set(stillIn)].map((id) => state.sources.find((source) => source.id === id)?.name ?? 'another team')
      // A reason code Peek has no words for (TEA-9): say what did move, never to try again.
      return `Moved to ${to.name ?? 'the team'}, but ${names.join(' and ')} still list${names.length > 1 ? '' : 's'} it too${why ? `: ${why}` : retry === false ? '.' : '. Try moving it again.'}`
    }
    type Step = () => Promise<{ ok: true } | { ok: false; reason?: string; why?: string; stillIn?: string[]; retry?: false }>
    const relist: Step | undefined = changesFolder
      ? async () => {
          // "Keep it a space in <team>" — answered only when the dialog asked it (TEA-5).
          const result = await moveFile(file, state.sources, target, choice.checked === true)
          if (result.ok || !('landed' in result)) return result
          // It did arrive, so the move goes on.
          refuse(partly(result.stillIn, result.why, result.retry))
          return { ok: true as const }
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
          refuse(result.reason ?? 'Nothing was moved. Try again.')
          // Refused at the relay: the next Move asks with the Folders as they are now.
          if (result.stillIn) await reread(state)
          return false
        }
        // The issue took its new project, and what is listed under it was not moved with it.
        if (result.stillIn?.length) refuse(partly(result.stillIn, result.why, result.retry))
        else refuse(`Moved to ${to.name ?? 'the team'}, but not all of it: ${result.reason?.replace(/\.$/, '') ?? 'the rest was refused'}. Try moving it again.`)
        break
      }
      moved = true
    }
    onMoved?.(file)
    return true
  }

  /*
    A space's mark does not travel by itself (SPEC §3.3): moving one of a
    team's spaces asks "Keep it a space in <team>", ticked, and only where the
    mover may mark one — a member of the team it goes to. A topic that was not
    a space is not asked.
  */
  const keepSpaceCheck = (state: MoveState) => {
    const source = teams?.find((team) => team.id === state.from)
    const address = state.file.address
    const wasSpace = !!address && !!source?.listed.some((entry) => entry.space && entryNames(entry, address))
    if (!wasSpace) return undefined
    return {
      label: (folder: string) => {
        const team = teams?.find((candidate) => candidate.id === folder)
        return team?.isMember ? `Keep it a space in ${team.name}` : undefined
      },
      checked: true,
    }
  }

  const targetsIn = async (state: MoveState, folder: string): Promise<MoveTarget[]> =>
    moveTargetsIn((await resolveFolderContents(folder)).files, state.file, { sameFolder: folder === state.from })

  const startInside = async (
    parent: ForeignObject,
    team: string,
    hasState: boolean,
    teamName: string,
    title: string,
    summary: string,
  ): Promise<boolean> => {
    /*
      Listed in the parent's team, never the page's, and stored in the parent's
      own Folder (SPEC §6.7): a sub-file is readable by exactly its parent's
      readers. `createTopic` takes that Folder from `parent.folder` — its `h`,
      or a Ship project's `buzz-channel`.
    */
    const result = await createTopic({ folder: team, title, summary, parent: parent.address, hasState, folderName: teamName, parentFile: parent })
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
    if (file.address) void reloadHeld(file.address)
    onRenamed?.(file)
    return null
  }

  /*
    The summary (SPEC §6.12), through the manifest's own action as Rename is.
    The dialog's copy takes the new value at once, in the slot a card reads and
    the action's `current`, and the page re-reads, so a Desk row or a card
    behind the dialog shows it on the same signal a rename does.
  */
  const summarize = async (file: ForeignObject, summary: string): Promise<RenameOutcome> => {
    const action = fileControlsOf(file).summarize
    if (!action || !file.naddr) return { kind: 'error', message: 'This file’s summary cannot be changed from here.' }
    const result = await applyAction({ naddr: file.naddr, actionId: action.id, value: summary })
    if (!result.ok) return { kind: 'error', message: result.reason || 'The relay gave no reason.' }
    setDialog((current) => {
      if (current?.kind !== 'details' || current.file !== file) return current
      const slots = { ...file.slots }
      if (summary) slots.subtitle = { ...file.slots.subtitle, field: SUMMARY_FIELD, value: summary }
      else delete slots.subtitle
      const actions = file.actions.map((a) => (a === action ? { ...a, current: summary } : a))
      return { ...current, file: { ...file, slots, actions } }
    })
    if (file.address) void reloadHeld(file.address)
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
        refuse('The team could not be read, so nothing was deleted. Try again.')
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
        apps={ARCHIVE_WORDS.apps}
        getBack={ARCHIVE_WORDS.getBack}
        onArchive={(resolution) => setArchived(dialog.file, true, resolution || undefined)}
        onClose={() => setDialog(null)}
      />
    ) : dialog.kind === 'move-reading' ? (
      <MoveDialog
        key="reading"
        title={dialog.file.slots.title?.value ?? 'this file'}
        description="Everyone who can read it now still can."
        from=""
        folders={undefined}
        onMove={() => false}
        onClose={() => setDialog(null)}
      />
    ) : dialog.kind === 'move' ? (
      /*
        The kit's Move (C11): the Folder first, then what it goes under there,
        read when a Folder is picked. Only a file that may sit under any file
        (no `parentKind`) is put at the top for the person; for one whose move
        names a kind (a Ship issue's project, MAN-4) the empty place takes it
        out of its parent, and Move waits for a pick (FOL-45).
      */
      <MoveDialog
        // The kit ticks its box only as it opens: drawn again once the teams are read, before any team could be picked.
        key={teamsPending(dialog.file) ? 'reading' : 'ready'}
        title={dialog.file.slots.title?.value ?? 'this file'}
        description="Everyone who can read it now still can."
        from={dialog.from}
        folders={teamsPending(dialog.file) ? undefined : dialog.teams.map((team) => ({ id: team.id, name: team.name ?? 'Untitled team' }))}
        places={dialog.targets?.map(placeOf)}
        placesIn={dialog.nests ? async (folder) => (await targetsIn(dialog, folder)).map(placeOf) : undefined}
        startAtTop={dialog.file.parentKind === undefined}
        topLabel={dialog.file.parentKind === undefined ? undefined : 'None — under none of these'}
        check={keepSpaceCheck(dialog)}
        onMove={(choice) => move(dialog, choice)}
        onClose={() => setDialog(null)}
      />
    ) : dialog.kind === 'inside' ? (
      <StartTopicDialog
        folderName={dialog.teamName}
        parent={dialog.file}
        onCreate={(title, _chosen, summary) => startInside(dialog.file, dialog.team, dialog.hasState, dialog.teamName, title, summary)}
        onClose={() => setDialog(null)}
      />
    ) : (
      <FileDetailsDialog
        file={dialog.file}
        onRename={fileControlsOf(dialog.file).rename ? (title) => rename(dialog.file, title) : undefined}
        summary={fileControlsOf(dialog.file).summarize?.current}
        onSummarize={fileControlsOf(dialog.file).summarize ? (summary) => summarize(dialog.file, summary) : undefined}
        initialEditing={dialog.editing}
        onClose={() => setDialog(null)}
      />
    )
  ) : null

  return { open, addMembers, dialogs }
}
