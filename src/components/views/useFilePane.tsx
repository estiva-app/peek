import { useNavigate } from 'react-router-dom'
import { IconDotsVertical, IconExternalLink, IconHash, IconUsers } from '@tabler/icons-react'
import { KIND_BARE_FILE, type ForeignObject } from '@estiva-app/interop'
import { Breadcrumb, Button, Chip, ConversationLayout, KindIcon, PageHeader, Panel, Toolbar, ToolbarButton, WithTooltip, ArchivedNotice, DeletedNotice, isPlainClick, thingKindOf, useShortcut } from '@estiva-app/ui'
import { useToggleOpenWork } from '@/components/views/useToggleOpenWork'
import { OPEN_WORK_KEY } from '@/lib/openWorkKey'
import { TopicMoreMenu } from '@/components/ui/TopicMoreMenu'
import { useFileControls } from '@/components/views/useFileControls'
import type { useFileView } from '@/components/views/useFileView'
import { SidePanelButton } from '@/components/SidePanelButton'
import { OpenWorkButton } from '@/components/OpenWorkButton'
import { Members } from '@/components/Members'
import { usePlaceFollowControls } from '@/components/PlaceFollow'
import { listingOf, mayMove, useFileMembers, useForeignObjects, useMembership, useOpenWorkFiles, useResolvedReferences, useTeams, useTopicPageDot, useWorkspaceDirectory } from '@/api'
import { rememberOpenedFrom } from '@/lib/openedFrom'
import { PageDot, type PageLine } from '@/components/PageListDot'
import { useToast } from '@/lib/toast'
import { archivedLineOf, kindNoun } from '@/lib/archiveWords'
import { ClosedBox } from '@/components/ui/ConversationBox'
import { canMove, fileControlsOf, hasFileControls, restoreActionOf } from '@/lib/fileControls'
import { copyFileLink, filePath } from '@/lib/objectUrl'
import { elsewhereAppName, openInAppUrl } from '@/lib/appName'
import { formatDateLabel } from '@/api'

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
/** No references, for a hook that reads none: one array, so it does not read again each time. */
const NO_REFERENCES: readonly string[] = []

export function useFilePane(
  view: ReturnType<typeof useFileView>,
  {
    onDeleted,
    onListingChanged,
    openLineHere,
  }: {
    /** The open file was deleted. */
    onDeleted: (deleted: ForeignObject) => void
    /** An archive or a move changed where the file is listed. */
    onListingChanged?: () => Promise<unknown> | void
    /** A line in its title dot's list opens here, not at its link: the Desk's panel (Katerina, 17 November; ACT-9). */
    openLineHere?: (line: PageLine) => void
  },
) {
  const { file, title, reload: reloadConversation } = view
  const navigate = useNavigate()
  const { restoreFile } = useForeignObjects()

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
  /*
    The topic's team (TEA-5): Move only where it can succeed, since a space
    moves only by a member of its team (SPEC §3.3). A topic reads its teams, so
    one opened from a link offers it; any other file reads none. Make it a
    space is on the topic's row now (TOPI-7).
  */
  const isTopic = Number(file?.address?.split(':')[0]) === KIND_BARE_FILE
  // A topic's kind, and another app's file's team (its trail) and initiatives (its chips): the tab's one teams read.
  const { teams } = useTeams({ read: !!file })
  const { showToast } = useToast()
  const moves = canMove(file) && mayMove(teams, file?.address ?? undefined)
  const listing = isTopic ? listingOf(teams, file?.address ?? undefined) : undefined
  const pageDot = useTopicPageDot(file ?? undefined, (file?.address && filePath(file.address, file.slots.title?.value)) || '')
  // "Details" and Copy link stay where they were: on a file with a
  // rename, a delete or a move. Archive alone (a Ship issue) adds only itself.
  const hasTopicControls = !!controls.rename || !!controls.delete || !!controls.move
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
      // A deleted file has nothing left to work on: out of Open work, or Desk keeps a "File" row that opens nothing.
      if (deleted.address && openWorkFiles.has(deleted.address)) openWorkFiles.remove(deleted.address)
      if (deleted.address === file?.address) onDeleted(deleted)
    },
    onMoved: () => void Promise.all([reloadConversation(), onListingChanged?.()]),
  })

  /*
    Copy link (FOL-37) — the topic header's affordance (PEE-17), for a file: the
    URL `filePath` writes, which for a topic in a Folder is its short form. The
    same fallback as the topic header's, for a browser that refuses the
    clipboard off a menu.
  */
  const copyLink = file?.address
    ? () =>
        void copyFileLink(file.address!, file.slots.title?.value).then((copied) => {
          if (copied) showToast({ label: 'Link copied', type: 'success' })
        })
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

  /*
    A topic or an initiative (TEA-6; the navigation prototype, Katerina 16 November, step 5): the bell, in it or not
    (Important or Everything joins: Katerina, 17 November), and Who follows in the members pill's place with your own
    Leave or Join in it. They take the
    place of the Members pill and Join/Leave; every other file keeps those. The place is read by the view
    (`topicFollowTarget`).
  */
  const follow = usePlaceFollowControls({
    follow: view.follow,
    target: view.followTarget,
    title,
    me,
    directory: people,
    people: file?.people,
  })
  /*
    Its kind, before its title, in the icon its rows wear (PL-02; Katerina, 16 November: one icon per kind): # a team's
    topic (today's space), ◎ an initiative (today's topic). Its room is held while the teams are read, so the title does
    not jump when it lands.
  */
  const kindIcon = isTopic
    ? teams
      ? listing?.space
        ? <IconHash size={16} stroke={1.5} aria-hidden />
        : <KindIcon kind="topic" tone="inherit" />
      : <span aria-hidden="true" className="size-4" data-kind-pending />
    : undefined

  /*
    Open work (FOL-34): the topic menu's Add/Remove, for a file, by its address.
    Offered for any addressable file, a Ship issue included — which is why the
    menu below opens for one, holding this and nothing else.
  */
  const openWorkFiles = useOpenWorkFiles()
  const openWork = useToggleOpenWork()
  const inOpenWork = file?.address ? openWork.has(file.address) : false
  const toggleOpenWork = file?.address && !readOnly ? () => openWork.toggle(file.address!) : undefined
  /*
    A topic's Open work is a button in its header, and Ctrl/Cmd+O anywhere on its page, in place of the browser's Open
    file (Miky, 3 and 6 Nov; the approved story, TOPI-7). Another app's file keeps it in its ⋮.
  */
  // On every file's page (Katerina, 16 November, F-08): Open work is the header's button for another app's file too.
  useShortcut(OPEN_WORK_KEY, () => toggleOpenWork?.(), !!toggleOpenWork)
  const openWorkButton =
    toggleOpenWork ? <OpenWorkButton inIt={inOpenWork} onToggle={toggleOpenWork} /> : undefined

  /*
    Archived (FOL-46): the file is out of every list, and a link still opens
    it — so the pane says so first, with the resolution, and offers the way
    back. Its own archive is restored here; one hidden with a file above it
    (an issue of an archived project, a page under an archived page) is
    restored there: `with` is the closest archived one at any depth (interop's
    walk, SPEC §6.5), which the notice names by its kind and opens instead.
    The menu's item states the direction that works.
    why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-file-is-archived-with-the-closest-archived-file-above-it.md
  */
  const archive = file?.archived
  const archivedWith = archive?.with
  const archiveAction = controls.archive && !archivedWith ? (archive ? 'unarchive' : 'archive') : undefined
  /*
    Deleted (SPEC §6.5, ALO-6): gone from every list, and a link still opens it — so the page says who deleted it and
    when, first, with Restore: its Delete action with the empty value. Ahead of an archive: a deleted file is not work.
  */
  const deleted = file?.deleted
  // The same action the Deleted list's row restores with: a topic's or a page's Delete is declared with no field.
  const restore = restoreActionOf(file)
  const notice =
    file && deleted ? (
      <DeletedNotice
        // A dash for a person nobody has named, as the kit's Person draws one: never their key.
        by={people?.[deleted.by]?.displayName ?? file.people?.[deleted.by]?.displayName ?? '—'}
        when={formatDateLabel(deleted.at * 1000)}
        onRestore={
          restore && file.naddr
            ? () =>
                restoreFile({ naddr: file.naddr!, actionId: restore.id }).then((result) => {
                  if (!result.ok) showToast({ label: result.reason, type: 'error', failure: 'not-restored' })
                  return Promise.all([reloadConversation(), onListingChanged?.()])
                })
            : undefined
        }
      />
    ) : file && archive ? (
      <ArchivedNotice
        // A dash for a person nobody has named, as the kit's Person draws one: never their key.
        by={people?.[archive.by]?.displayName ?? '—'}
        when={formatDateLabel(archive.at * 1000)}
        resolution={archive.resolution}
        withWhat={archivedWith ? (kindNoun(Number(archivedWith.split(':')[0])) ?? 'parent') : undefined}
        onUnarchive={archiveAction === 'unarchive' ? () => fileControls.open('unarchive', file) : undefined}
        onOpenParent={archivedWith && filePath(archivedWith) ? () => navigate(filePath(archivedWith)!) : undefined}
      />
    ) : undefined

  /*
    Another app's file (Katerina, 16–17 November, F-04 to F-06): its title is a trail, its project / its kind's icon and
    its name, the project opening in place; after it one chip, the team it belongs to, and no other ("we agreed to only
    have the team it belongs to": no chips for the initiatives that list it); then Open, into its own app. A topic keeps
    its own title, with no trail.
  */
  const elsewhere = !!file && !isTopic
  const parentAddress = elsewhere ? (file?.parentRef ?? undefined) : undefined
  const parent = useResolvedReferences(parentAddress ? [parentAddress] : NO_REFERENCES)[parentAddress ?? ''] ?? undefined
  const home = elsewhere && teams && file?.address
    ? (listingOf(teams, file.address)?.team ?? (parentAddress ? listingOf(teams, parentAddress)?.team : undefined) ?? teams.find((team) => team.id === file.folder))
    : undefined
  const go = (href: string, column?: 'topics' | 'folders', address?: string) => (event: React.MouseEvent) => {
    if (!isPlainClick(event)) return
    event.preventDefault()
    if (column && address) rememberOpenedFrom(address, column)
    navigate(href)
  }
  const parentHref = parentAddress && parent && typeof parent === 'object' ? filePath(parentAddress, parent.slots.title?.value) : null
  const trail =
    elsewhere && file ? (
      <Breadcrumb
        items={[
          // No team in the trail: the team is the chip after the name (Katerina, 17 November).
          ...(parentAddress && parentHref && parent && typeof parent === 'object'
            ? [{ label: parent.slots.title?.value ?? 'Untitled', href: parentHref, onClick: go(parentHref, 'folders', parentAddress) }]
            : []),
          { label: title, icon: <KindIcon kind={thingKindOf(file.kind)} tone="inherit" /> },
        ]}
      />
    ) : undefined

  /*
    The team it belongs to, a chip right after its name, opening the team's page (Katerina, 17 November, as the 6 November
    prototype drew it; its icon at a chip's 12px, R-15): an initiative's, and another app's file's, whose trail then holds
    no team ("make sure the breadcrumbs now dont show the team"). A team's topic needs none: it sits under its team.
  */
  const chipTeam = isTopic ? (listing && !listing.space ? listing.team : undefined) : elsewhere ? home : undefined
  const teamChip = chipTeam ? (
    <Chip
      label={chipTeam.name}
      leadingIcon={<IconUsers size={12} stroke={1.5} aria-hidden />}
      href={`/app/teams/${chipTeam.id}`}
      onClick={go(`/app/teams/${chipTeam.id}`)}
    />
  ) : undefined

  const header = (
        /*
          The kit's PageHeader. One row: the file's name, and whose file it is
          (Katerina, 5 October). No trail over it: on the page the column beside
          shows where the file sits — and a trail in one row cut every name short.
        */
        <PageHeader
          title={trail ?? title}
          leading={kindIcon}
          after={
            /*
            Another app's file: one way into the app that owns it, "Open" —
            the way to its text, which Peek shows and never edits for a Leaf
            document (Miky, 14 October). No chip: *"I would simplify and just
            say Open. Less words is better. it's more clear."* (Miky, 14
            October), in place of the app-name chip that said whose file it
            was (Katerina, 5 October). The kit's own Button with a real icon,
            quiet, and a link to a new tab (Katerina, 30 October: Peek and
            Leaf alike, in place of a text link with a typed arrow). Which
            app is in its name and tooltip ("Open in Leaf"), the one place an
            app is named (PRO-24). A file of Peek's own gets nothing. The
            address is the manifest's, a web page only (`openInAppUrl`).
            */
            /*
              A topic's or a space's dot beside its title (ACT-4): what is new there, then what was about you
              earlier, when you rest on it or tap it. A file of another app has its Open here instead.
            */
            pageDot ? (
              <>
                {teamChip}
                <PageDot dot={pageDot} {...(openLineHere ? { openHere: openLineHere } : {})} />
              </>
            ) : file && elsewhereAppName(file) && openInAppUrl(file) ? (
              <>
              {/* Its team, the one chip, then Open (Katerina, 17 November). */}
              {teamChip}
              <WithTooltip label={`Open in ${elsewhereAppName(file)}`}>
                <Button
                  href={openInAppUrl(file)}
                  external
                  size="small"
                  className="shrink-0"
                  leadingIcon={<IconExternalLink size={14} stroke={1.5} />}
                  aria-label={`Open in ${elsewhereAppName(file)}`}
                >
                  Open
                </Button>
              </WithTooltip>
              </>
            ) : (
              teamChip
            )
          }
          // The pill in PageHeader's own place, 12px clear of the buttons, as in Leaf (Katerina, 2 November: it was 8px
          // in the actions). Shown where the buttons are, as before: it opens a dialog, not an action.
          members={file?.folder || view.sidePanel ? (isTopic ? follow.pill : members) : undefined}
          /*
            The header's one button with words (PL-09): Add to Open work, whether you are in the topic or not (Katerina,
            17 November: "add to open work even if I haven't joined … I dont think the join needs to be in the header").
            You join with the bell beside it, or on your own row in Who follows.
          */
          button={file?.folder || view.sidePanel ? openWorkButton : undefined}
          actions={
            file?.folder || view.sidePanel ? (
              // One strip: one Tab stop, arrows along it (UIG-14).
              <Toolbar aria-label="File actions" surface={false}>
                {/* No Open folder: on the page the Folder is the column beside, its row open (Katerina, 5 October). */}
                {/* The bell, before the side panel, in the topic or not: Important or Everything on it joins (PL-02, PL-13; Katerina, 17 November). */}
                {isTopic && follow.bell}
                {/* The Overview, shown and hidden (Katerina, 7 October): before the ⋮, as Jan had it. */}
                {view.sidePanel && <SidePanelButton open={view.sidePanel.open} onToggle={view.sidePanel.toggle} />}
                {/*
                  The topic's menu, when the manifest offers anything for it
                  to hold (FOL-33) — and absent, not inert, when it does not:
                  a Ship issue's header has nothing to put here, and a button
                  that opens nothing would say otherwise. A topic's ⋮ is
                  what you do to the topic itself — Details, Rename, Move,
                  Copy link, Archive, Delete (Miky, 3 Nov; Details for its
                  summary, 9 Nov). Open work is the button beside it, Make it
                  a space is on its row, Add is in Who follows (TOPI-7).
                */}
                {file?.folder && (hasFileControls(controls) || moves) && (
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
                    onRename={controls.rename && !readOnly ? () => fileControls.open('rename', file) : undefined}
                    onMove={moves && file && !readOnly ? () => fileControls.open('move', file) : undefined}
                    onDeleteTopic={controls.delete ? () => fileControls.open('delete', file) : undefined}
                    // As the prototype has it (Q-27, F-10): Details, Rename, Move…, Copy link, then Archive… and Delete apart.
                    archiveApart
                  />
                )}
              </Toolbar>
            ) : undefined
          }
        />
  )

  /*
    An archived file is read-only (Katerina, 7 October). Its card goes above the messages, where Ship's issue page
    puts it, and the comment box's own line takes the composer's place, as every app says it (Miky, 25 October,
    PEEKM-3).
  */
  const closedLine = notice && <ClosedBox reason={archivedLineOf(archive) ?? ''} />
  const pane =
    'layout' in view.list ? (
      // Peek's own file: the kit's ConversationLayout, two columns, under the page's bar. It scrolls the messages and keeps the composer under them.
      <ConversationLayout threads="beside" title={title} header={header} top={notice} {...view.list.layout} box={closedLine || view.list.layout.box} />
    ) : (
      // Another app's file: its list as it was, in the kit's Panel under the same bar.
      <Panel
        title={title}
        header={header}
        footer={closedLine && <div className="p-3">{closedLine}</div>}
      >
        {notice && <div className="shrink-0 px-4 pt-4">{notice}</div>}
        {view.list.panel.children}
      </Panel>
    )

  return {
    pane,
    /** The controls' dialogs, rendered by the caller; Who follows among them. */
    dialogs: (
      <>
        {fileControls.dialogs}
        {follow.dialog}
      </>
    ),
    /** Opens a control's dialog, for a row menu elsewhere on the page (PEE-2). */
    openControl: fileControls.open,
    /** Whether the person is a member of the open file; undefined until the relay has said. */
    member: file && membership.state !== 'unknown' ? member : undefined,
  }
}
