import { useEffect, useMemo, useState } from 'react'
import { EmptyState, NavItem } from '@estiva-app/ui'
import { KIND_BARE_FILE } from '@estiva-app/interop'
import type { FolderContents, ForeignObject } from '@estiva-app/interop'
import type { FolderContentsState } from '@/api'
import { useConversationBadges, useForeignChildren, useMembership, useOpenWorkFiles, useResolvedReferences } from '@/api'
import { TopicMenuItems } from '@/components/ui/TopicMoreMenu'
import { TopicState } from '@/components/ui/TopicState'
import { SkeletonSidebarList, SkeletonRow } from '@/components/ui/Skeleton'
import { listedChildrenOf, peersOf } from '@/components/views/folderListing'
import type { FileControl } from '@/components/views/useFileControls'
import { fileMatches, type TreeFilter } from '@/components/views/treeFilter'
import { canMove, canStartInside, fileControlsOf } from '@/lib/fileControls'
import { fileGlyph } from '@/lib/fileGlyph'
import { filePath } from '@/lib/objectUrl'

/**
 * A line where the tree's rows would be: empty, or unreadable. Level with the
 * rows (Katerina, 2026-09-14): each row pads itself, so the line takes a
 * row's inset here, and EmptyState is never padded.
 */
function TreeLine({ message }: { message: string }) {
  return (
    <div className="px-2 py-1">
      <EmptyState scope="section" message={message} />
    </div>
  )
}

/**
 * One Folder's files as sidebar rows — the file page's left column (FOL-19).
 *
 * **Lines, not cards.** `FolderContentsView` (gone since 5 October) drew every file as a
 * `ForeignObjectCard`, which is right at the Folder page's full width and
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
  filter = 'all',
  selectedRef,
  expand,
  onSelect,
  onControl,
  holdsJoined,
}: {
  state: FolderContentsState
  /**
   * What the column is showing (FOL-41). A peer survives when it matches or
   * one of the children this same read listed does, and a peer kept for a
   * child's sake starts expanded — the parents of a match are drawn.
   */
  filter?: TreeFilter
  /** `ref` of the file this page is showing. */
  selectedRef?: string
  /**
   * `ref`s to start expanded — the open file's parent. A default, not a lock:
   * a person who collapses a row keeps it collapsed.
   */
  expand?: readonly string[]
  onSelect: (file: ForeignObject) => void
  /**
   * A row's more-menu asked for its details, a rename or a deletion (FOL-33).
   * The menu is drawn only on a row whose manifest declares the control —
   * `fileControlsOf` — and only when there is somebody to tell: a tree drawn
   * without this has no menus, exactly as before.
   */
  onControl?: (control: FileControl, file: ForeignObject) => void
  /**
   * Parents of joined files this listing does not hold — a Ship project, for
   * an issue of yours (`useTeamUnread`): Topics keeps the row, closed.
   */
  holdsJoined?: ReadonlySet<string>
}) {
  const files = typeof state === 'object' && 'files' in state ? state.files : undefined
  const { unread } = useConversationBadges(files ? peersOf(files) : undefined)
  /*
    The same seam the rows' own join controls read, so a row kept by the
    `Mine` filter and the bell drawn on it cannot disagree in one render.
  */
  const membership = useMembership()
  // Yours is a file you are a member of, or one that holds a file of yours the listing does not (5 October).
  const isMember = (address: string) => membership.isMember(address) || !!holdsJoined?.has(address)

  if (state === 'loading') {
    return (
      <div className="py-1" data-loading="file-tree">
        <SkeletonSidebarList />
      </div>
    )
  }
  // Unreadable is not empty — the line the whole codebase holds (PEE-10).
  if ('failed' in state) {
    return <TreeLine message="This folder could not be read." />
  }
  const folder = state as FolderContents
  if (folder.files.length === 0) {
    return <TreeLine message={filter === 'archive' ? 'Nothing archived in this folder.' : 'Nothing in this folder yet.'} />
  }

  /*
    Filtered here rather than inside the row, so the rows kept for a child's
    sake can be started expanded in the same pass — a match one level down is
    reached without a click, which is the point of the filter.
  */
  const peers = peersOf(folder.files)
  // The open file, and every row above it, stay whatever the filter: the open
  // file is where the tree says it is (FOL-4), in Topics too (5 October).
  const kept = peers.filter((file) =>
    file.ref === selectedRef ||
    !!expand?.includes(file.ref) ||
    fileMatches(filter, file, listedChildrenOf(file, folder.files), unread, isMember),
  )
  /*
    Opened for a child's sake only under Unread, so what is new is in view
    without a click (FOL-41) — a closed row carries no dot for what is under it.
    In Topics a row kept for a child's sake starts closed like any other
    (Katerina, 5 October: a project opened for one topic of yours under it
    showed every one of its issues). The open file's chain opens either way.
  */
  const openForChild =
    filter !== 'unread' && filter !== 'mine-unread'
      ? []
      : kept
          .filter((file) => !fileMatches(filter, file, [], unread, isMember))
          .map((file) => file.ref)

  /*
    Empty because of the filter, not because the Folder is: the Folder-level
    verdict sees the whole channel and this listing is only its first level, so
    a Folder can survive the filter on something below the rows drawn here
    (`treeFilter`'s "What it cannot reach"). Saying "nothing in this folder"
    would be a lie about the Folder.
  */
  if (kept.length === 0) {
    return <TreeLine message="Nothing here matches — the match is deeper in." />
  }

  return (
    <div className="flex flex-col gap-0.5" data-folder={folder.id} data-source={folder.source}>
      {kept.map((file) => (
        <TreeRow
          key={file.ref}
          file={file}
          listed={folder.files}
          unread={unread}
          selectedRef={selectedRef}
          expand={[...(expand ?? []), ...openForChild]}
          onSelect={onSelect}
          onControl={onControl}
        />
      ))}
    </div>
  )
}

/**
 * One Folder's files in Topics: every file the person is a member of, one row
 * each, none under another (Katerina and Miky, 7 October: "get rid of the
 * tree structure" — a topic, a Ship project and a Ship issue are on the same
 * level, however deep the issue is). The Folders view keeps the tree.
 *
 * **What is drawn.** The files this listing holds — at any depth, since a
 * sub-topic is in its parent's listing — that the person joined or made; and
 * the joined files no listing holds, a Ship issue under its project, read by
 * address in one request (`useResolvedReferences`) and drawn right after the
 * row of their parent, whether that row is drawn or not. The open file stays
 * whatever the filter, as everywhere in the column (5 October).
 *
 * **What it costs.** One more read per open Folder that holds an issue of
 * yours, for all of them at once — where Topics used to read the project's
 * every issue when its row was opened.
 */
export function JoinedFileRows({
  state,
  filter,
  joinedUnder = {},
  selectedRef,
  selectedParent,
  onSelect,
  onControl,
}: {
  state: FolderContentsState
  /** `mine`, or `mine-unread`: Topics, or Topics filtered to Unread. */
  filter: TreeFilter
  /** Joined files no listing holds, by the address of the parent that does — `useTeamUnread`. */
  joinedUnder?: Readonly<Record<string, readonly string[]>>
  selectedRef?: string
  /** The open file's parent: the open file is read with the rest when this listing holds its parent. */
  selectedParent?: string | null
  onSelect: (file: ForeignObject) => void
  onControl?: (control: FileControl, file: ForeignObject) => void
}) {
  const listed = useMemo(() => (typeof state === 'object' && 'files' in state ? state.files : []), [state])
  /* The joined files under this listing's rows, and the open file if it is one of those: read together. */
  const asked = useMemo(() => {
    const out = listed.flatMap((file) => (file.address ? (joinedUnder[file.address] ?? []) : []))
    const opensHere = !!selectedParent && listed.some((file) => file.address === selectedParent)
    if (selectedRef && opensHere && !listed.some((file) => file.ref === selectedRef)) out.push(selectedRef)
    return [...new Set(out)]
  }, [listed, joinedUnder, selectedParent, selectedRef])
  const resolved = useResolvedReferences(asked)
  /* In the listing's order, each read file after its parent's place. */
  const candidates = useMemo(() => {
    const out: ForeignObject[] = []
    const seen = new Set<string>()
    const add = (file: ForeignObject | null | undefined) => {
      if (!file || seen.has(file.ref)) return
      seen.add(file.ref)
      out.push(file)
    }
    for (const file of listed) {
      add(file)
      if (!file.address) continue
      for (const address of joinedUnder[file.address] ?? []) add(resolved[address])
      if (selectedParent === file.address && selectedRef) add(resolved[selectedRef])
    }
    return out
  }, [listed, joinedUnder, resolved, selectedParent, selectedRef])
  const { unread } = useConversationBadges(candidates.length ? candidates : undefined)
  const membership = useMembership()
  return (
    <JoinedFileRowsView
      state={state}
      files={candidates}
      waiting={asked.some((address) => !(address in resolved))}
      filter={filter}
      isMember={membership.isMember}
      unread={unread}
      selectedRef={selectedRef}
      onSelect={onSelect}
      onControl={onControl}
    />
  )
}

/** `JoinedFileRows` handed what it draws — the half a story can show. */
export function JoinedFileRowsView({
  state,
  files,
  waiting = false,
  filter,
  isMember,
  unread,
  selectedRef,
  onSelect,
  onControl,
}: {
  state: FolderContentsState
  /** Every file that could be drawn, in order: the listing's, each read file after its parent's place. */
  files: ForeignObject[]
  /** A joined file no listing holds is still being read. */
  waiting?: boolean
  filter: TreeFilter
  isMember: (address: string) => boolean
  unread: Record<string, boolean>
  selectedRef?: string
  onSelect: (file: ForeignObject) => void
  onControl?: (control: FileControl, file: ForeignObject) => void
}) {
  if (state === 'loading') {
    return (
      <div className="py-1" data-loading="file-tree">
        <SkeletonSidebarList />
      </div>
    )
  }
  if ('failed' in state) return <TreeLine message="This folder could not be read." />

  // An archived file is Archive's, joined or not (PEE-58): the listing leaves it out, and so does a joined issue read by address.
  const rows = files.filter(
    (file) =>
      file.ref === selectedRef ||
      (!file.archived && !!file.address && isMember(file.address) && (filter !== 'mine-unread' || unread[file.ref] === true)),
  )
  if (rows.length === 0) {
    // A joined issue still on its way is a row coming, not an empty Folder.
    if (waiting) return <SkeletonRow />
    return <TreeLine message={filter === 'mine-unread' ? 'Nothing unread here.' : 'Nothing of yours here.'} />
  }
  return (
    <div className="flex flex-col gap-0.5" data-folder={(state as FolderContents).id} data-flat>
      {rows.map((file) => (
        // `nested`: a row of its own, never one that opens onto others.
        <TreeRow key={file.ref} file={file} unread={unread} selectedRef={selectedRef} onSelect={onSelect} onControl={onControl} nested />
      ))}
    </div>
  )
}

/**
 * One row, and the rows inside it when it is open: the package's `NavItem`
 * (Katerina, 2 October), drawing what Peek's own row drew — the glyph, the name,
 * the dot, the selection, the menu on hover. Its icon becomes the arrow while
 * it is pointed at, so a row with rows under it is as wide as one without.
 */
function TreeRow({
  file,
  listed = [],
  unread,
  selectedRef,
  expand,
  onSelect,
  onControl,
  nested = false,
}: {
  file: ForeignObject
  listed?: ForeignObject[]
  unread?: Record<string, boolean>
  selectedRef?: string
  expand?: readonly string[]
  onSelect: (file: ForeignObject) => void
  onControl?: (control: FileControl, file: ForeignObject) => void
  nested?: boolean
}) {
  // `expand` decides until the person does — see `FileRow` for why this is
  // not an initialiser and not an effect.
  const [toggled, setToggled] = useState<boolean | null>(null)
  /*
    And once `expand` has opened a row it stays open (SID-2): the selection
    moving to another branch is not the person closing this one, and closing
    it would slide the row they just clicked out from under the pointer. Set
    during render, the one place that is neither the initialiser nor an effect.
  */
  const expanded = !!expand?.includes(file.ref)
  if (toggled === null && expanded) setToggled(true)
  const open = toggled ?? expanded
  const title = file.slots.title?.value ?? 'Untitled'
  const listedChildren = listedChildrenOf(file, listed)
  /*
    A bare file's children are all in this listing — a sub-file is in its
    parent's team (SPEC §6.7) — and only the listing has them where they are
    *now*: its declared `list` is read by `#a`, which still finds a sub-topic
    moved away and never one moved in (FOL-4). So a topic's row draws the
    listing and fetches nothing, and has a chevron only when something is under
    it. Another kind's declared children (a project's issues) are not in a
    team's listing, and are fetched as before.
  */
  const fetches = !nested && file.listsChildren && file.kind !== KIND_BARE_FILE
  const expandable = fetches || listedChildren.length > 0
  // The row's menu, from the manifest and not from the kind (FOL-33): a bare
  // file's declares rename, move and delete, a Ship issue's declares none, and
  // the glyph below is the one place this file asks what kind a row is.
  // An archived row (the Archive view) keeps what the file's own page keeps — Details, Copy link, Unarchive, Delete —
  // and nothing that changes it or adds under it (SPEC §6.5, PEEKM-2).
  const readOnly = !!file.archived
  const controls = onControl ? fileControlsOf(file) : {}
  const renames = !readOnly && !!controls.rename
  const inside = !!onControl && !readOnly && canStartInside(file)
  const moves = !!onControl && !readOnly && canMove(file)
  // Details is the manifest's (FOL-33); a topic inside is the protocol's, and opens no details.
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
  const memberAction = followKey && file.folder && !readOnly ? (isMember ? 'leave' : 'join') : undefined
  // Open work on the row (FOL-34), by the same address — the file page's control.
  const openWorkFiles = useOpenWorkFiles()
  const openWorkAction = followKey && !readOnly ? (openWorkFiles.has(followKey) ? 'remove' : 'add') : undefined

  const selected = file.ref === selectedRef
  // The open file's row is brought into view when it is drawn: a long Folder can hold it below the fold (5 October).
  useEffect(() => {
    if (selected) document.querySelector(`[data-file="${CSS.escape(file.ref)}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [selected, file.ref])
  const isUnread = unread?.[file.ref] === true
  const type = fileGlyph(file.kind)
  /*
    Archive… on a listed row, Unarchive on an archived one (the Archive view,
    5 October). A file hidden only *with* an archived parent is brought back
    by unarchiving that parent, so it offers neither.
  */
  const archivedNow = file.archived
  const archiveAction = controls.archive && !archivedNow?.with ? (archivedNow ? 'unarchive' : 'archive') : undefined
  const hasMenu = offers || renames || inside || moves || !!(openWorkAction && followKey) || !!(memberAction && followKey && file.folder) || !!controls.delete || !!archiveAction

  return (
    <NavItem
      data-file={file.ref}
      href={file.address ? filePath(file.address, title) : '#'}
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
            onNewSubTopic={inside ? () => onControl?.('inside', file) : undefined}
            onMove={moves ? () => onControl?.('move', file) : undefined}
            openWorkAction={openWorkAction}
            onToggleOpenWork={
              followKey && openWorkAction
                ? () => (openWorkAction === 'add' ? openWorkFiles.add(followKey) : openWorkFiles.remove(followKey))
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
          />
        ) : undefined
      }
      menuLabel="More options"
      open={open}
      onOpenChange={(next) => setToggled(next)}
      onClick={(event) => {
        // The page navigates: it remembers the address first (SID-2).
        event.preventDefault()
        onSelect(file)
      }}
    >
      {expandable
        ? open
          ? (
              // Peek's 2px between rows, as the first level has them, and the
              // marker its tests find a row's children by.
              <div className="flex flex-col gap-0.5" data-children-of={file.ref}>
                {fetches && file.naddr && (
                  <FetchedRows
                    naddr={file.naddr}
                    exclude={listedChildren}
                    selectedRef={selectedRef}
                    expand={expand}
                    onSelect={onSelect}
                    onControl={onControl}
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
                    onSelect={onSelect}
                    onControl={onControl}
                    nested
                  />
                ))}
              </div>
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
  onSelect,
  onControl,
}: {
  naddr: string
  exclude?: ForeignObject[]
  selectedRef?: string
  expand?: readonly string[]
  onSelect: (file: ForeignObject) => void
  onControl?: (control: FileControl, file: ForeignObject) => void
}) {
  const { state } = useForeignChildren(naddr)
  const drawn = new Set(exclude.map((file) => file.ref))
  const children = Array.isArray(state) ? state.filter((child) => !drawn.has(child.ref)) : []
  const { unread } = useConversationBadges(Array.isArray(state) ? state : undefined)

  if (state === 'loading') return <SkeletonRow />
  if (state === 'unresolved' || (!Array.isArray(state) && 'failed' in state)) {
    return <TreeLine message="What is in this could not be read." />
  }
  if (children.length === 0) {
    return exclude.length === 0 ? <TreeLine message="Nothing in this yet." /> : null
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
          onSelect={onSelect}
          onControl={onControl}
          nested
        />
      ))}
    </>
  )
}
