import { useNavigate } from 'react-router-dom'
import { IconDotsVertical, IconUserCheck, IconUserPlus } from '@tabler/icons-react'
import type { ForeignObject } from '@estiva-app/interop'
import { Chip, Panel, Toolbar, ToolbarButton } from '@estiva-app/ui'
import { TopicMoreMenu } from '@/components/ui/TopicMoreMenu'
import { useFileControls } from '@/components/views/useFileControls'
import type { useFileView } from '@/components/views/useFileView'
import { SidePanelButton } from '@/components/SidePanelButton'
import { Members } from '@/components/Members'
import { ArchivedNotice } from '@/components/ArchivedNotice'
import { useFileMembers, useMembership, useOpenWorkFiles, useWorkspaceDirectory } from '@/api'
import { kindNoun } from '@/lib/archiveWords'
import { canMove, canStartInside, fileControlsOf, hasFileControls } from '@/lib/fileControls'
import { filePath, shareableFileUrl } from '@/lib/objectUrl'
import { elsewhereAppName } from '@/lib/appName'

/**
 * A file's middle column with its header — the title, whose file it is, the
 * members, Join, the Overview and the file's menu — and its controls' dialogs.
 * One topic view wherever it opens (OPT-12, Miky 7 October: "It should be the
 * very same and no link to full page. There is only one page."): `FilePage`
 * draws it beside the Folder tree, and the Desk beside its lists.
 *
 * Where a write leaves the person is the caller's: the page goes to the deleted
 * file's Folder and into a new topic's page, the Desk stays on the Desk
 * (Miky, OPT-12's kickoff).
 */
export function useFilePane(
  view: ReturnType<typeof useFileView>,
  {
    onDeleted,
    onStarted,
    onListingChanged,
  }: {
    /** The open file was deleted. */
    onDeleted: (deleted: ForeignObject) => void
    /** A topic was started inside the open one: it is what was asked for. */
    onStarted: (created: { address: string; title: string }) => void
    /** An archive or a move changed where the file is listed. */
    onListingChanged?: () => Promise<unknown> | void
  },
) {
  const { file, title, reload: reloadConversation } = view
  const navigate = useNavigate()

  /*
    Rename and Delete, from the manifest and not from the kind (FOL-33) — the
    same gate as `canComment` in `useFileView`. A bare file's built-in manifest
    declares both; Ship's declares neither for an issue, so an issue's header
    keeps only what is left. The dialogs are the caller's to render, shared with
    the tree's row menu on the page so both ends open the same ones (PEE-2). A
    rename re-reads the file, whose title the header draws (the tree re-reads
    on the change event's own signal). A row's delete of some other file stays
    where it is — the person was not looking at it.
  */
  const controls = fileControlsOf(file)
  // "Details" and Copy link stay where they were: on a file with a
  // rename, a delete or a move. Archive alone (a Ship issue) adds only itself.
  const hasTopicControls = !!controls.rename || !!controls.delete || !!controls.move
  const startsInside = canStartInside(file)
  const people = useWorkspaceDirectory()

  // Who is in the file, for the members pill (REA-3): re-read after a join, a leave or an add.
  const fileMembers = useFileMembers(file?.address)
  const fileControls = useFileControls({
    onRenamed: () => void reloadConversation(),
    onMembership: () => void fileMembers.reload(),
    /*
      The pane draws the notice off the file, and a listing shows it or not —
      both re-read. An archived file stays open, since a link still opens it.
    */
    onArchived: () => void Promise.all([reloadConversation(), onListingChanged?.()]),
    onDeleted: (deleted) => {
      if (deleted.address === file?.address) onDeleted(deleted)
    },
    onMoved: () => void Promise.all([reloadConversation(), onListingChanged?.()]),
    onStarted,
  })

  /*
    Copy link (FOL-37) — the topic header's affordance (PEE-17), for a file: the
    URL `filePath` writes, which for a topic in a Folder is its short form. The
    same fallback as the topic header's, for a browser that refuses the
    clipboard off a menu.
  */
  const copyLink = file?.address
    ? () => {
        const link = shareableFileUrl(file.address!, file.slots.title?.value, window.location.origin)
        void navigator.clipboard?.writeText(link).catch(() => window.prompt('Copy this link:', link))
      }
    : undefined

  /*
    Join / leave (SPEC §11.8, CON-19): the unread dot exists only for the files
    the person is a member of, and this is where they say so for the file in
    front of them. Writing in it, being mentioned or assigned already makes
    them one; Join is for the rest, Leave is theirs alone to give. The state
    shows in the button itself (pressed = a member), not on hover. Absent while
    the relay has not said what the person is a member of — a toggle then would
    write a guess, and the seam refuses it anyway.
  */
  const membership = useMembership()
  const member = file?.address ? membership.isMember(file.address) : false
  /*
    An archived file is read-only until it is unarchived (Katerina, 7
    October): its menu keeps what reads it, the way back and Delete —
    Details, Copy link, Unarchive, Delete — and nothing that changes it or
    puts it back in a list: no Rename, Move, New topic inside, Open work, or
    Join and Leave.
  */
  const readOnly = !!file?.archived
  const toggleMember =
    file?.address && file.folder && !readOnly && membership.state !== 'unknown'
      ? () => fileControls.open(member ? 'leave' : 'join', file)
      : undefined

  /*
    Who is in it (REA-3, as Ship's SHI-31): the members pill opens the Members
    dialog — Join or Leave, and "Add members". The roles are the file's author
    and whatever person fields its owner's manifest draws ("Assignee", "Lead"),
    so Peek still knows nothing of Ship. A file that lists children (a
    project) says that leaving it does not leave them.

    The toolbar toggle stays only while nobody is in the file: the pill draws
    nothing at zero until REA-8 gives it an empty state (Miky, 7 October).
  */
  const me = membership.me
  const roles = file?.address
    ? [
        { pubkey: file.address.split(':')[1] ?? '', role: 'Author' },
        ...file.meta.filter((slot) => slot.isPubkey && slot.label && slot.value).map((slot) => ({ pubkey: slot.value, role: slot.label! })),
      ]
    : []
  const childKind = file?.listsChildren ? file.children?.[0]?.kind : undefined
  const membersNote = childKind !== undefined ? `Your ${kindNoun(childKind)}s here still notify you.` : undefined
  const nameOf = (pubkey: string) => people?.[pubkey]?.displayName ?? file?.people?.[pubkey]?.displayName ?? '—'
  const members =
    file && me ? (
      <Members
        // A new file is a new dialog: an open one must not carry over to the next file.
        key={file.address}
        members={fileMembers.members}
        me={me}
        directory={people}
        people={file.people}
        roles={roles}
        note={membersNote}
        readOnly={!toggleMember}
        onSetMine={(join) => fileControls.open(join ? 'join' : 'leave', file)}
        onAdd={(pubkeys) => fileControls.addMembers(file, pubkeys, nameOf)}
      />
    ) : undefined
  // Also when the roster could not be read: no pill then, and Join must not go with it.
  const showToggle = toggleMember && (fileMembers.members?.size === 0 || fileMembers.failed)

  /*
    Open work (FOL-34): the topic menu's Add/Remove, for a file, by its address.
    Offered for any addressable file, a Ship issue included — which is why the
    menu below opens for one, holding this and nothing else.
  */
  const openWorkFiles = useOpenWorkFiles()
  const inOpenWork = file?.address ? openWorkFiles.has(file.address) : false
  const toggleOpenWork = file?.address && !readOnly
    ? () => (inOpenWork ? openWorkFiles.remove(file.address!) : openWorkFiles.add(file.address!))
    : undefined

  /*
    Archived (FOL-46): the file is out of every list, and a link still opens
    it — so the pane says so first, with the resolution, and offers the way
    back. Its own archive is restored here; one hidden with its parent (an
    issue of an archived project) is restored on the parent, which the notice
    opens instead. The menu's item states the direction that works.
  */
  const archive = file?.archived
  const archivedWith = archive?.with
  const archiveAction = controls.archive && !archivedWith ? (archive ? 'unarchive' : 'archive') : undefined
  const notice =
    file && archive ? (
      <ArchivedNotice
        archive={archive}
        by={people?.[archive.by]?.displayName ?? `${archive.by.slice(0, 8)}…`}
        withWhat={archivedWith ? kindNoun(Number(archivedWith.split(':')[0])) : undefined}
        onUnarchive={archiveAction === 'unarchive' ? () => fileControls.open('unarchive', file) : undefined}
        onOpenParent={archivedWith ? () => navigate(filePath(archivedWith)) : undefined}
        look="card"
      />
    ) : undefined

  const pane = (
    // The file's conversation in the package's Panel: it scrolls, and the composer stays under it.
    <Panel
      {...view.panel}
      /*
        An archived file is read-only (Katerina, 7 October): no composer,
        and its notice in the composer's place, in the composer's own
        padding — under the messages, where the newest one is.
      */
      footer={notice ? <div className="p-3">{notice}</div> : view.panel.footer}
      title={
        /*
          One row: the file's name, and whose file it is (Katerina, 5
          October). No trail over it: on the page the column beside shows
          where the file sits — and a trail in one row cut every name short.
        */
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-body-2-strong text-text-primary">{title}</p>
          {/*
            Whose file this is, said plainly: the pane draws another app's
            conversation in Peek's own language, which is the point and is
            also exactly what could mislead — without it the discussion
            reads as something in Peek. A chip, never cut short.
          */}
          {elsewhereAppName(file) && <Chip type="neutral" label={elsewhereAppName(file)!} className="shrink-0" />}
        </div>
      }
      actions={
        file?.folder || view.sidePanel ? (
          <div className="flex shrink-0 items-center gap-2">
            {/* The pill before the strip, as Ship's header has it: it opens a dialog, not an action. */}
            {members}
            {/* One strip: one Tab stop, arrows along it (UIG-14). */}
            <Toolbar aria-label="File actions" surface={false}>
              {/* No Open folder: on the page the Folder is the column beside, its row open (Katerina, 5 October). */}
              {showToggle && (
                <ToolbarButton
                  tooltip={member ? 'Leave' : 'Join'}
                  aria-label={member ? 'Leave' : 'Join'}
                  pressed={member}
                  onClick={toggleMember}
                >
                  {member ? <IconUserCheck size={16} stroke={1.5} /> : <IconUserPlus size={16} stroke={1.5} />}
                </ToolbarButton>
              )}
              {/* The Overview, shown and hidden (Katerina, 7 October): before the ⋮, as Jan had it. */}
              {view.sidePanel && <SidePanelButton open={view.sidePanel.open} onToggle={view.sidePanel.toggle} />}
              {/*
                The topic's menu, when the manifest offers anything for it
                to hold (FOL-33) — and absent, not inert, when it does not:
                a Ship issue's header has nothing to put here, and a button
                that opens nothing would say otherwise.
              */}
              {file?.folder && (hasFileControls(controls) || canMove(file) || startsInside || toggleOpenWork) && (
                <TopicMoreMenu
                  trigger={
                    <ToolbarButton tooltip="More actions" aria-label="More actions">
                      <IconDotsVertical size={16} stroke={1.5} />
                    </ToolbarButton>
                  }
                  onOpenDetails={hasTopicControls ? () => fileControls.open('details', file) : undefined}
                  onCopyLink={hasTopicControls ? copyLink : undefined}
                  archiveAction={archiveAction}
                  onToggleArchive={archiveAction ? () => fileControls.open(archiveAction, file) : undefined}
                  openWorkAction={toggleOpenWork ? (inOpenWork ? 'remove' : 'add') : undefined}
                  onToggleOpenWork={toggleOpenWork}
                  onRename={controls.rename && !readOnly ? () => fileControls.open('rename', file) : undefined}
                  onNewSubTopic={startsInside && file && !readOnly ? () => fileControls.open('inside', file) : undefined}
                  onMove={canMove(file) && file && !readOnly ? () => fileControls.open('move', file) : undefined}
                  onDeleteTopic={controls.delete ? () => fileControls.open('delete', file) : undefined}
                />
              )}
            </Toolbar>
          </div>
        ) : undefined
      }
    />
  )

  return {
    pane,
    /** The controls' dialogs, rendered by the caller. */
    dialogs: fileControls.dialogs,
    /** Opens a control's dialog, for a row menu elsewhere on the page (PEE-2). */
    openControl: fileControls.open,
    /** Whether the person is a member of the open file; undefined until the relay has said. */
    member: file && membership.state !== 'unknown' ? member : undefined,
  }
}
