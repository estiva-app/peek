import { useContext, useState, type ReactNode } from 'react'
import { EmptyState, NavItem, shortcutLabel, SkeletonList, SkeletonRow, useRememberedOpen, type UnreadDotTone } from '@estiva-app/ui'
import { KIND_BARE_FILE } from '@estiva-app/interop'
import type { FolderContents, ForeignObject } from '@estiva-app/interop'
import type { FolderContentsState, RowNewsItem } from '@/api'
import { rememberFileAddress, useConversationBadges, useForeignChildren, useMayMove, useMembership, useOpenWorkFiles, useReactionsSeenOnClose } from '@/api'
import { TopicMenuItems } from '@/components/ui/TopicMoreMenu'
import { TopicState } from '@/components/ui/TopicState'
import { RowNewsCard } from '@/components/RowNewsCard'
import { listedChildrenOf, peersOf } from '@/components/views/folderListing'
import type { FileControl } from '@/components/views/useFileControls'
import { canMove, fileControlsOf } from '@/lib/fileControls'
import { fileGlyph } from '@/lib/fileGlyph'
import { copyFileLink, filePath } from '@/lib/objectUrl'
import { OPEN_WORK_KEY } from '@/lib/openWorkKey'
import { rememberOpenedFrom, TreeColumn } from '@/lib/openedFrom'

/**
 * One Folder's files as sidebar rows — the file page's left column (FOL-19).
 *
 * **Lines, not cards.** `FolderContentsView` (gone since 5 October) drew every file as a
 * card, which is right at the Folder page's full width and
 * wrong in a 290px column: a Ship project's card wraps its whole description
 * into a tower and the tree it sits in disappears (Miky, 2026-09-14). This is
 * the same listing drawn the way the Topics list drew its rows, one line each, the glyph on the left and the dot on the right — so a file in
 * the tree reads like a topic in the list, which is what it is about to
 * replace (FOL-21).
 *
 * **Same model, same reads.** Peers at the top (`peersOf`), a parent's children
 * under it when it is open (`listedChildrenOf` for what this listing already
 * holds, `useForeignChildren` for what the owner's manifest lists), one badge
 * request per level. What differs from the card view is only how a row is
 * drawn — no kind number here either, and the row's glyph is the one honest
 * distinction: Peek's bare file is a topic, and everything else is a file.
 */
export function FileTreeView({
  state,
  archive = false,
  selectedRef,
  expand,
  onControl,
}: {
  state: FolderContentsState
  /** Archive's listing: what is archived in the Folder. Its rows' folds are not remembered. */
  archive?: boolean
  /** `ref` of the file this page is showing. */
  selectedRef?: string
  /**
   * `ref`s to start expanded — the open file's parent. A default, not a lock:
   * a person who collapses a row keeps it collapsed.
   */
  expand?: readonly string[]
  /**
   * A row's more-menu asked for its details, a rename or a deletion (FOL-33).
   * The menu is drawn only on a row whose manifest declares the control —
   * `fileControlsOf` — and only when there is somebody to tell: a tree drawn
   * without this has no menus, exactly as before.
   */
  onControl?: (control: FileControl, file: ForeignObject) => void
}) {
  const files = typeof state === 'object' && 'files' in state ? state.files : undefined
  const { unread } = useConversationBadges(files ? peersOf(files) : undefined)

  if (state === 'loading') {
    return (
      <div className="py-1" data-loading="file-tree">
        <SkeletonList />
      </div>
    )
  }
  // Unreadable is not empty — the line the whole codebase holds (PEE-10).
  if ('failed' in state) {
    return <EmptyState scope="rows" message="This team could not be read." />
  }
  const folder = state as FolderContents
  if (folder.files.length === 0) {
    return <EmptyState scope="rows" message={archive ? 'Nothing archived in this team.' : 'Nothing in this team yet.'} />
  }

  // The rows straight into the Folder's section, which sets them 2px apart (`NavTreeSection`), or the Panel's body.
  return (
    <>
      {peersOf(folder.files).map((file) => (
        <TreeRow
          key={file.ref}
          file={file}
          listed={folder.files}
          unread={unread}
          selectedRef={selectedRef}
          expand={expand}
          onControl={onControl}
          remember={!archive}
        />
      ))}
    </>
  )
}

/**
 * One row, and the rows inside it when it is open: the package's `NavItem`
 * (Katerina, 2 October), drawing what Peek's own row drew — the glyph, the name,
 * the dot, the selection, the menu on hover. Its icon becomes the arrow while
 * it is pointed at, so a row with rows under it is as wide as one without.
 */
export function TreeRow({
  file,
  listed = [],
  unread,
  selectedRef,
  expand,
  onControl,
  nested = false,
  remember = false,
  under,
  space,
  leaves = false,
  news,
  tones,
}: {
  file: ForeignObject
  listed?: ForeignObject[]
  unread?: Record<string, boolean>
  selectedRef?: string
  expand?: readonly string[]
  onControl?: (control: FileControl, file: ForeignObject) => void
  nested?: boolean
  /**
   * Keep the row open or closed on this browser, as the person left it: under
   * All (Katerina, 30 October). The column is drawn again on every page, and
   * a card in another app opens a new tab. Not under a filter, whose rows open
   * for what they lead to (FOL-41), as its Folders do.
   */
  remember?: boolean
  /**
   * Rows handed in to draw under this one, in place of its own children: a
   * topic's listed files on the Topics screen (TOP-4). Open until the person
   * closes it, and kept on this browser apart from the Folder tree's.
   */
  under?: ReactNode
  /** Make it one of its team's spaces, or not (TEA-5): the Teams column passes it to a member of the topic's team. */
  space?: { action: 'mark' | 'unmark'; onToggle: () => void }
  /**
   * The row offers Leave (TOPI-7): in the Topics column, which lists only yours, and in a team's lists wherever you
   * hear from it, a team's default included (`useLeavesTopic`).
   */
  leaves?: boolean
  /** What lit each row, by ref (ACT-3): a lit row with lines opens their card while it is pointed at. */
  news?: Record<string, readonly RowNewsItem[]>
  /** A lit row's dot colour, by ref (ACT-7): orange when reactions to you are all that is new there. */
  tones?: Record<string, UnreadDotTone>
}) {
  const column = useContext(TreeColumn)
  /*
    Once `expand` has opened a row it stays open (SID-2): the selection
    moving to another branch is not the person closing this one, and closing
    it would slide the row they just clicked out from under the pointer. Set
    during render, the one place that is neither the initialiser nor an effect.
  */
  const expanded = !!expand?.includes(file.ref)
  const [held, setHeld] = useState(false)
  if (!held && expanded) setHeld(true)
  // `expand` decides until the person does; what they did last, under All, is read once from this browser (the kit's memory).
  // A topic's row on Topics starts open, kept apart from the Folder tree's (TOP-4).
  const [open, setOpen] = useRememberedOpen(
    remember ? (under !== undefined ? `peek.topics.row.${file.ref}` : `peek.tree.row.${file.ref}`) : undefined,
    under !== undefined || expanded || held,
  )
  const title = file.slots.title?.value ?? 'Untitled'
  const listedChildren = under !== undefined ? [] : listedChildrenOf(file, listed)
  /*
    A bare file's children are all in this listing — a sub-file is in its
    parent's team (SPEC §6.7) — and only the listing has them where they are
    *now*: its declared `list` is read by `#a`, which still finds a sub-topic
    moved away and never one moved in (FOL-4). So a topic's row draws the
    listing and fetches nothing, and has a chevron only when something is under
    it. Another kind's declared children (a project's issues) are not in a
    team's listing, and are fetched as before.
  */
  const fetches = under === undefined && !nested && file.listsChildren && file.kind !== KIND_BARE_FILE
  const expandable = under !== undefined || fetches || listedChildren.length > 0
  // The row's menu, from the manifest and not from the kind (FOL-33): a bare
  // file's declares rename, move and delete, a Ship issue's declares none, and
  // the glyph below is the one place this file asks what kind a row is.
  // An archived row (the Archive view) keeps what the file's own page keeps — Details, Copy link, Unarchive, Delete —
  // and nothing that changes it or adds under it (SPEC §6.5, PEEKM-2).
  const readOnly = !!file.archived
  /*
    A topic's row keeps what you do from a list — Open work, Copy link, Make it a space, Leave — and what you do to the
    topic itself (Details, Rename, Move, Archive, Delete) is on its page's ⋮ (Miky, 3 Nov; the approved stories, TOPI-7).
  */
  // An archived topic's row (the Archive view) keeps Details, Unarchive and Delete, as its page's ⋮ does.
  const isPlace = Number(file.address?.split(':')[0]) === KIND_BARE_FILE
  const listRow = isPlace && !readOnly
  const controls = onControl && !listRow ? fileControlsOf(file) : {}
  const renames = !readOnly && !!controls.rename
  // A space moves only by a member of its team (TEA-5, SPEC §3.3).
  const mayMove = useMayMove(file.address)
  const moves = !!onControl && !listRow && !readOnly && canMove(file) && mayMove
  // Details is the manifest's (FOL-33).
  const offers = !!controls.rename || !!controls.delete || !!controls.move
  /*
    Join / leave and mute on the row (SPEC §11.8): the same seam the dot is
    judged over, so a toggle here and the dot beside it agree in the same
    render. A file with no address, or no Folder to name in the change, has no
    membership to change and is offered nothing.
  */
  const membership = useMembership()
  const followKey = file.address
  const isMember = followKey ? membership.isMember(followKey) : false
  // A topic or a space is followed with the switch on its header (TEA-6); its row offers only Leave, where the list
  // says you hear from it (`leaves`: Topics, TOPI-7; a team's lists). Join is on Explore topics.
  const memberAction = followKey && file.folder && !readOnly ? (isPlace ? (leaves && onControl ? 'leave' : undefined) : isMember ? 'leave' : 'join') : undefined
  const copies = listRow && !!followKey
  // Open work on the row (FOL-34), by the same address — the file page's control.
  const openWorkFiles = useOpenWorkFiles()
  const openWorkAction = followKey && !readOnly ? (openWorkFiles.has(followKey) ? 'remove' : 'add') : undefined

  // The open file's row is brought into view by the package's `NavTree` around the Folders (ui 0.94): a long Folder can hold it below the fold (5 October).
  const selected = file.ref === selectedRef
  const isUnread = unread?.[file.ref] === true
  const type = fileGlyph(file.kind)
  /*
    Archive… on a listed row, Unarchive on an archived one (the Archive view,
    5 October). A file hidden only *with* an archived parent is brought back
    by unarchiving that parent, so it offers neither.
  */
  const archivedNow = file.archived
  const archiveAction = controls.archive && !archivedNow?.with ? (archivedNow ? 'unarchive' : 'archive') : undefined
  const hasMenu = offers || renames || copies || moves || !!space || !!(openWorkAction && followKey) || !!(memberAction && followKey && file.folder) || !!controls.delete || !!archiveAction

  const href = file.address ? filePath(file.address, file.slots.title?.value) : '#'
  // A lit row says why (ACT-3): its card lists what lit the dot. Nothing new, no dot and no card.
  const lines = isUnread ? news?.[file.ref] : undefined
  // Leaving its card, or opening the row on a touch screen, sees the reactions to you it listed (ACT-7).
  const reactionsSeen = useReactionsSeenOnClose(lines)

  return (
    <NavItem
      unreadTone={isUnread ? tones?.[file.ref] : undefined}
      onPreviewOpenChange={reactionsSeen.onPreviewOpenChange}
      data-file={file.ref}
      // The address the row's click opens, as the page writes it (FOL-37): Cmd-click opens the same in a new tab.
      href={href}
      preview={
        lines?.length ? (
          <RowNewsCard
            items={lines}
            fileRef={file.ref}
            placeHref={href}
            place="topic"
            // As the row's own click: the page needs no `#d` read, and it shows the column this row is in.
            onOpen={(listed) => {
              const address = listed ?? file.address
              if (!address) return
              rememberFileAddress(address)
              rememberOpenedFrom(address, column)
            }}
          />
        ) : undefined
      }
      label={title}
      icon={
        <TopicState
          type={type}
          status={type === 'topic' ? 'unresolved' : 'default'}
          iconClassName={selected || isUnread ? 'text-text-primary' : undefined}
        />
      }
      /* `=== true`: an unjudged file draws no dot, not a dark one. */
      unread={isUnread}
      active={selected}
      menu={
        hasMenu ? (
          <TopicMenuItems
            onOpenDetails={offers ? () => onControl?.('details', file) : undefined}
            onRename={renames ? () => onControl?.('rename', file) : undefined}
            onMove={moves ? () => onControl?.('move', file) : undefined}
            // Through the page's controls, which say so in a toast; on its own (a story, a test), straight to the clipboard.
            onCopyLink={copies ? () => (onControl ? onControl('copy-link', file) : void copyFileLink(followKey!, file.slots.title?.value)) : undefined}
            openWorkAction={openWorkAction}
            // The key acts on the open topic's page only, so only that topic's row names it.
            openWorkShortcut={listRow && selected ? shortcutLabel(OPEN_WORK_KEY) : undefined}
            onToggleOpenWork={
              followKey && openWorkAction
                ? () =>
                    // Through the page's controls, which toast with Undo as the page's button does.
                    onControl
                      ? onControl('open-work', file)
                      : openWorkAction === 'add'
                        ? openWorkFiles.add(followKey)
                        : openWorkFiles.remove(followKey)
                : undefined
            }
            memberAction={memberAction}
            onToggleMember={
              followKey && file.folder && memberAction
                ? () =>
                    // Through the page's controls, which say what happened in a toast; on its own (a story), straight to the seam.
                    onControl ? onControl(memberAction, file) : void membership.setMember(followKey, file.folder!, memberAction === 'join')
                : undefined
            }
            onDeleteTopic={controls.delete ? () => onControl?.('delete', file) : undefined}
            archiveAction={archiveAction}
            onToggleArchive={archiveAction ? () => onControl?.(archiveAction, file) : undefined}
            spaceAction={readOnly ? undefined : space?.action}
            onToggleSpace={space?.onToggle}
          />
        ) : undefined
      }
      menuLabel="More options"
      open={open}
      onOpenChange={setOpen}
      // A row above the open file opens for each file opened under it, even one closed by hand (Katerina, 30 October):
      // the package's `openFor`, once per file, so closed again it stays closed until another opens.
      openFor={expandable && expanded ? selectedRef : undefined}
      onClick={(event) => {
        // A file with no address leads nowhere, as it never did.
        if (!file.address) return event.preventDefault()
        /*
          The row has the author the short link drops, so the page needs no `#d` read to recover it (SID-2), and it
          selects the clicked row before the file resolves. The page change is the kit's: a plain click through
          Peek's router (`AppProvider`), and Cmd-, Ctrl- or Shift-click the browser's, for a new tab or window.
        */
        rememberFileAddress(file.address)
        // The file's page shows the column this row is in (TOP-4).
        rememberOpenedFrom(file.address, column)
        // A touch screen has no resting on the row: opening it sees what its card lists (ACT-7, the touch story).
        reactionsSeen.onOpenRow()
      }}
    >
      {expandable
        ? open
          ? (
              // Straight into NavItem's own column, which sets them 2px apart, as the first level is.
              <>
                {under}
                {fetches && file.naddr && (
                  <FetchedRows
                    naddr={file.naddr}
                    exclude={listedChildren}
                    selectedRef={selectedRef}
                    expand={expand}
                    onControl={onControl}
                    remember={remember}
                  />
                )}
                {listedChildren.map((child) => (
                  <TreeRow
                    key={child.ref}
                    file={child}
                    listed={listed}
                    unread={unread}
                    selectedRef={selectedRef}
                    expand={expand}
                    onControl={onControl}
                    nested
                    remember={remember}
                  />
                ))}
              </>
            )
          : // Closed: nothing is read or drawn, and the row still has its arrow.
            <></>
        : undefined}
    </NavItem>
  )
}

/** The children the owner's manifest lists, fetched when the row opens. */
function FetchedRows({
  naddr,
  exclude = [],
  selectedRef,
  expand,
  onControl,
  remember,
}: {
  naddr: string
  exclude?: ForeignObject[]
  selectedRef?: string
  expand?: readonly string[]
  onControl?: (control: FileControl, file: ForeignObject) => void
  remember?: boolean
}) {
  const { state } = useForeignChildren(naddr)
  const drawn = new Set(exclude.map((file) => file.ref))
  const children = Array.isArray(state) ? state.filter((child) => !drawn.has(child.ref)) : []
  const { unread } = useConversationBadges(Array.isArray(state) ? state : undefined)

  if (state === 'loading') return <SkeletonRow />
  if (state === 'unresolved' || (!Array.isArray(state) && 'failed' in state)) {
    return <EmptyState scope="rows" message="What is in this could not be read." />
  }
  if (children.length === 0) {
    return exclude.length === 0 ? <EmptyState scope="rows" message="Nothing in this yet." /> : null
  }
  return (
    <>
      {children.map((child) => (
        <TreeRow
          key={child.ref}
          file={child}
          unread={unread}
          selectedRef={selectedRef}
          expand={expand}
          onControl={onControl}
          nested
          remember={remember}
        />
      ))}
    </>
  )
}
