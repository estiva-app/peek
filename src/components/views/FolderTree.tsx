import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconArrowUpRight, IconEdit } from '@tabler/icons-react'
import { CollapsibleSection, ListColumn } from '@estiva-app/ui'
import { nestingOf } from '@estiva-app/interop'
import type { FolderSummary, ForeignObject } from '@estiva-app/interop'
import type { FolderContentsState } from '@/api'
import {
  prefetchFolderContents,
  rememberFileAddress,
  topLevelFolders,
  useFolderContents,
  useFolders,
  useForeignObjects,
  useTeamUnread,
} from '@/api'
import { EmptyState } from '@/components/ui/EmptyState'
import { IconButton } from '@/components/ui/IconButton'
import { SkeletonSidebarList } from '@/components/ui/Skeleton'
import { UnreadDot } from '@/components/ui/UnreadDot'
import { FileTreeView } from '@/components/views/FileTreeView'
import type { FileControl } from '@/components/views/useFileControls'
import { folderMatches, type TreeFilter } from '@/components/views/treeFilter'
import { useRailClosed } from '@/layouts/railClosed'
import { filePath } from '@/lib/objectUrl'
import { useRememberedOpen } from '@/lib/rememberedOpen'
import { useFolderPath } from '@/lib/useFolderPath'

/**
 * The left column: the Folders the person is in, each a fold over its first
 * level — FOL-21, the visible payoff of v1.
 *
 * **The navigation for the whole suite** — a Peek topic appears in it only by
 * what it is on the relay: a Folder, until FOL-22 sorts the twenty-five into
 * teams and files. Nothing here knows what a topic is, and nothing here knows
 * what Ship is: a Folder is a section, a file is a row, and which app owns the
 * file is the row's glyph.
 *
 * Where it is drawn: the Folders rail item (`FoldersPage`, peek#214) and the
 * file page (`FilePage`). peek#213 also put it in the Topics column in place of
 * "Your topics / Other topics", and that was taken back the same day (Miky,
 * 2026-09-14): while a topic is a Folder it is a section here, opened from a
 * hover action with no highlighted row, which is not a column to read topics
 * from. The topic list returns to the tree's place when FOL-22 makes topics
 * rows — `onNewTopic` is kept for that day.
 *
 * ## What is read, and when
 *
 * The list of Folders, once (`useFolders`, one `POST /query`), and one batched
 * read for every Folder's union dot (`useTeamUnread`, FOL-18 — two POSTs for
 * all of production's 162). **Nothing else until a fold opens.** An open
 * Folder reads its first level (`useFolderContents`, two POSTs) and its rows'
 * dots (one more); a row with a chevron reads its children when it is
 * expanded and never before (`FileTreeView` → `useForeignChildren`, **one
 * POST**, and one for the children's dots). The first Folder or row of a
 * session that meets an app pays for that app's manifest on top — that is the
 * seam's `ProjectionCache`, which this ticket's measurement made Peek start
 * passing: without it a fold was 13 POSTs and a row 8, warm or cold. Measured
 * against production by `scripts/probe-fol21-tree-cost.ts`; the seam-level
 * half — that nothing is *asked* before the fold or the row opens — is
 * `FolderTree.test.tsx`. This is why the union dot exists: the tree hides
 * things, so it must say when something hidden is new.
 *
 * ## Which folds are open
 *
 * Only the Folder holding the open page, by default — 162 Folders open at
 * once would be the whole minute's relay budget on every cold load. The
 * default is live and the person's choice beats it (`useRememberedOpen`), so a
 * Folder somebody opened stays open across reloads and one they closed stays
 * closed whatever is selected inside it, which is `CollapsibleSection`'s own
 * ruling.
 *
 * ## Sections, not rows, for the Folders
 *
 * A Folder is a `CollapsibleSection` — the package's group-of-rows, the same
 * thing Ship's sidebar makes of its projects and Linear's of its teams — so
 * its title toggles and its rows are the files. Opening the Folder *itself* is
 * the header's action; where that leads is `useFolderPath`'s decision. Since
 * FOL-22 a topic is a channel placed in its team by address (`listedIn`), so
 * it is a row in the team's section, and a `39000:` row opens the topic page
 * (`FilePage` sends it there). A Folder nothing lists is a section of its own.
 */
/**
 * The Folders column: every folder the person is in as a folding section of its
 * files and topics, with a dot where something is new.
 */
export function FolderTree({
  currentFolder,
  selectedRef,
  selectedParent,
  onNewTopic,
  onControl,
  currentContents,
}: {
  /** The Folder holding the open page. Its section starts open. */
  currentFolder?: string | null
  /** `ref` of the open file, whose row is current. */
  selectedRef?: string
  /**
   * The address the open file names as its parent, so the row it is under
   * starts expanded and the file is visible in the tree — a Ship issue is its
   * project's child, and `peersOf` hides a child whose parent is listed.
   */
  selectedParent?: string | null
  /** Offered in the header when the page can start a topic. */
  onNewTopic?: () => void
  /** A row's more-menu — see `FileTreeView`. The page that owns the dialogs passes it. */
  onControl?: (control: FileControl, file: ForeignObject) => void
  /**
   * `currentFolder`'s listing, when the page has already read it (FOL-4): the
   * file page reads its team for the breadcrumb, and the section drawing the
   * same team uses that read instead of making a second one.
   */
  currentContents?: FolderContentsState
}) {
  const railClosed = useRailClosed()
  const navigate = useNavigate()
  const { folders, signedOut } = useFolders()
  /*
    The dots are judged over every Folder, the sections drawn for the top-level
    ones (FOL-22, PEE-31). A topic is a channel placed in its team by address,
    so it is in `listFolders` like any channel, and it is a row inside the
    team's section rather than a section of its own — but its stream is one of
    the team's, and `useTeamUnread` folds its verdict into the team's dot. A
    record channel is in `listFolders` too and is nobody's section:
    `topLevelFolders` says which are.
  */
  const { unread, activity } = useTeamUnread(folders)
  const topLevel = useMemo(() => (folders ? topLevelFolders(folders) : null), [folders])
  /*
    The section a file is drawn in (SID-2). A Ship project's Folder is its own
    record channel and an issue's is the same one, and neither is a section:
    the channel is `listedIn` its team. Matched by id alone, opening either
    from inside the team made no section current, so the team shut or read its
    listing again — the flash between a topic and a project in one Folder. The
    page's read is of the record channel, so the team gets it only when the
    two are the same Folder.
  */
  const section =
    folders?.find((folder) => folder.id === currentFolder)?.listedIn?.find((id) =>
      topLevel?.some((top) => top.id === id),
    ) ?? currentFolder
  const folderPath = useFolderPath()

  return (
    <ListColumn
      title="Folders"
      collapsed={railClosed}
      actions={
        onNewTopic && (
          <IconButton tooltip="New topic" aria-label="New topic" onClick={onNewTopic}>
            <IconEdit size={16} stroke={1.5} />
          </IconButton>
        )
      }
    >
      {/*
        The list scrolls, and it is the package's bar (D40): the package's
        `ListColumn`, the same column and insets as every other list column in
        Peek (UIG-14, N9). The list column of a three-column page, so its
        empties are sections (D51): the line alone, left, no icon. Loading is a
        skeleton (§4.7).
      */}
      <FolderTreeView
        folders={topLevel}
        signedOut={signedOut}
        unread={unread}
        activity={activity}
        currentFolder={section}
        selectedRef={selectedRef}
        selectedParent={selectedParent}
        onSelect={(file) => {
          if (!file.address) return
          /*
            The row has the author the short link drops, so the page needs no
            `#d` read to recover it (SID-2) — and with the address known at
            once, it selects the clicked row before the file resolves.
          */
          rememberFileAddress(file.address)
          navigate(filePath(file.address, file.slots.title?.value))
        }}
        onOpenFolder={(id) => navigate(folderPath(id))}
        onControl={onControl}
        currentContents={section === currentFolder ? currentContents : undefined}
      />
    </ListColumn>
  )
}

/** The column's body, handed what it draws — the part a story can show. */
export function FolderTreeView({
  folders,
  signedOut,
  unread,
  activity = {},
  member = {},
  filter = 'all',
  currentFolder,
  selectedRef,
  selectedParent,
  onSelect,
  onOpenFolder,
  onControl,
  currentContents,
}: {
  /** `null` while the first read is in flight, or when signed out. */
  folders: FolderSummary[] | null
  signedOut: boolean
  /** The union dot per Folder id (FOL-18). Missing means unjudged. */
  unread: Record<string, boolean>
  /**
   * The socket's signal count per Folder id (FOL-44): an open section's rows
   * re-read their dots when theirs changes. Missing means nothing said yet.
   */
  activity?: Record<string, number>
  /** Whether each Folder holds a stream the person is a member of (FOL-41, §11.8). Missing means unjudged. */
  member?: Record<string, boolean>
  /** What the column is showing — `all` unless the header says otherwise (FOL-41). */
  filter?: TreeFilter
  currentFolder?: string | null
  selectedRef?: string
  selectedParent?: string | null
  onSelect: (file: ForeignObject) => void
  onOpenFolder: (folderId: string) => void
  onControl?: (control: FileControl, file: ForeignObject) => void
  /** `currentFolder`'s listing, already read by the page — see `FolderTree`. */
  currentContents?: FolderContentsState
}) {
  /*
    Three states, not two: "not signed in", "still loading" and "there are
    genuinely none" are different sentences — the Folders page's lesson.
  */
  if (signedOut) return <EmptyState scope="section" message="Sign in to see folders." />
  if (folders === null) return <SkeletonSidebarList />
  if (folders.length === 0) return <EmptyState scope="section" message="No folders yet." />

  // Alphabetical, as the topic list was. The relay's order is arrival order,
  // which tells the person nothing.
  const ordered = [...folders]
    .sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id, undefined, { sensitivity: 'base' }))
    .filter((folder) => folderMatches(filter, folder.id, unread, member))

  /*
    A filter that matched nothing is not an empty workspace, and the two must
    not share a sentence: the Folders are there, this view is hiding them.
  */
  if (ordered.length === 0) {
    return (
      <EmptyState
        scope="section"
        message={filter === 'unread' ? 'Nothing unread.' : 'Nothing you have joined.'}
      />
    )
  }

  return (
    <>
      {ordered.map((folder) => (
        <FolderSection
          key={folder.id}
          folder={folder}
          /* `=== true`: an unjudged Folder draws no dot, not a dark one. */
          unread={unread[folder.id] === true}
          activity={activity[folder.id] ?? 0}
          filter={filter}
          current={folder.id === currentFolder}
          selectedRef={selectedRef}
          selectedParent={selectedParent}
          onSelect={onSelect}
          onOpen={() => onOpenFolder(folder.id)}
          onControl={onControl}
          preloaded={folder.id === currentFolder ? currentContents : undefined}
        />
      ))}
    </>
  )
}

/** One Folder: a fold, and its first level once it is open. */
function FolderSection({
  folder,
  unread,
  activity,
  filter,
  current,
  selectedRef,
  selectedParent,
  onSelect,
  onOpen,
  onControl,
  preloaded,
}: {
  folder: FolderSummary
  unread: boolean
  activity: number
  filter: TreeFilter
  current: boolean
  selectedRef?: string
  selectedParent?: string | null
  onSelect: (file: ForeignObject) => void
  onOpen: () => void
  onControl?: (control: FileControl, file: ForeignObject) => void
  /** This Folder's listing, already read by the page (FOL-4) — then this section reads nothing. */
  preloaded?: FolderContentsState
}) {
  /*
    Under a filter every section that survived it starts open (FOL-41). The
    filter's whole job is to lead to the file, and a list of shut Folders leads
    nowhere — the person would open each in turn, which is the tree they asked
    to be spared. The reads stay bounded because the filter is what bounds
    them: only the Folders with a match are drawn, so only those are read.

    The remembered state is deliberately not consulted and not written: a
    Folder somebody closed under `All` is closed again the moment they go back
    to it, and closing one here is this view's, not a change of mind about the
    tree. `useRememberedOpen` is still what holds it under `All`.
  */
  const [remembered, setRemembered] = useRememberedOpen(`peek.tree.folder.${folder.id}`, current)
  const [filtered, setFiltered] = useState(true)
  const open = filter === 'all' ? remembered : filtered
  const setOpen = filter === 'all' ? setRemembered : setFiltered
  /*
    The read is the fold. `null` while closed is the hook's "nothing to read"
    — no request, no refresh trigger, no socket subscription — so a Folder
    nobody opened costs the column nothing beyond its dot.
  */
  const own = useFolderContents(open && !preloaded ? folder.id : null)
  /*
    A closed Folder is read a moment before it is opened (SID-2): when the
    pointer rests on it, or the keyboard lands on it, so the first open draws
    rows. Resting, not passing — a pointer sweeping down the column must not
    spend a read per Folder — and never for one the tab has read already
    (`prefetchFolderContents`), so it costs at most one read per Folder.
  */
  const { resolveFolderContents } = useForeignObjects()
  const intent = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const prefetch = () => {
    if (!open) prefetchFolderContents(resolveFolderContents, folder.id)
  }
  const rest = () => {
    clearTimeout(intent.current)
    intent.current = setTimeout(prefetch, PREFETCH_INTENT_MS)
  }
  const leave = () => clearTimeout(intent.current)
  useEffect(() => () => clearTimeout(intent.current), [])
  /*
    The last listing drawn stays drawn while the next read of the same Folder
    is in flight (SID-2). The read hands over between the page's and this
    section's own as the open file moves between a topic and a Ship project,
    and each hand-over starts at 'loading' — a skeleton over rows that were
    right a moment ago. Only a listing is held; a failure is said as before.
  */
  const fresh = preloaded ?? own.state
  const listing = typeof fresh === 'object' && 'files' in fresh ? fresh : undefined
  const [drawn, setDrawn] = useState(listing)
  // By the rows, not the wrapper: a listing rebuilt per render would set this for ever.
  if (listing && !sameRows(listing.files, drawn?.files)) setDrawn(listing)
  const state = fresh === 'loading' && drawn ? drawn : fresh
  const listed = typeof state === 'object' && 'files' in state ? state.files : undefined
  /*
    Every row above the open file starts open, not only its parent (FOL-4): a
    topic three levels down under a closed grandparent is a selected row nobody
    can see. The chain is the listing's (`nestingOf`), so it costs no request;
    a file the listing does not hold — an issue fetched under its project —
    still opens its parent's chain.
  */
  const nesting = listed ? nestingOf(listed) : undefined
  const selectedRow = listed?.find((candidate) => candidate.ref === selectedRef)
  const parentRow = selectedParent
    ? listed?.find((candidate) => candidate.address === selectedParent)
    : undefined
  const expand = nesting
    ? selectedRow
      ? nesting.ancestorsOf(selectedRow).map((row) => row.ref)
      : parentRow
        ? [...nesting.ancestorsOf(parentRow), parentRow].map((row) => row.ref)
        : undefined
    : undefined

  return (
    <div
      className="shrink-0"
      data-tree-folder={folder.id}
      data-open={open}
      onPointerEnter={rest}
      onPointerLeave={leave}
      onFocus={prefetch}
    >
      <CollapsibleSection
        /*
          The id when there is no name. A Folder with no state event has only
          its channel's name, and a channel created by an app rather than a
          person may carry none — the ordinary case on today's data.
        */
        title={folder.name ?? folder.id}
        open={open}
        onOpenChange={setOpen}
        /*
          The union dot in the slot for a count: information rather than an
          affordance, so it does not come and go with the hover. A collapsed
          Folder hides its rows, and this is what says one of them is new.
        */
        trailing={unread ? <UnreadDot /> : undefined}
        actions={[
          {
            icon: <IconArrowUpRight size={16} stroke={1.5} />,
            tooltip: 'Open folder',
            onClick: onOpen,
          },
        ]}
        contentClassName="pl-2"
      >
        {/*
          Rows only while open. The section keeps its panel mounted while
          closed so find-in-page can reach into it, but a closed Folder has
          nothing read, so there would be nothing to find — only a skeleton
          per Folder, 147 of them, hidden.
        */}
        {open && (
          <FileTreeView
            state={state}
            filter={filter}
            selectedRef={selectedRef}
            expand={expand}
            /*
              The rows' dots re-read on the team's signal (FOL-44). The
              section's own dot was live and its rows were not: they stay
              mounted while open, and their badge read was keyed only on the
              listing, so a comment reached them on collapse and expand.
            */
            activity={activity}
            onSelect={onSelect}
            onControl={onControl}
          />
        )}
      </CollapsibleSection>
    </div>
  )
}

/** How long the pointer rests on a closed Folder before it is read ahead (SID-2). */
export const PREFETCH_INTENT_MS = 150

/** The same rows, in the same order — what a re-read that changed nothing answers. */
function sameRows(a: readonly ForeignObject[], b: readonly ForeignObject[] | undefined): boolean {
  return !!b && a.length === b.length && a.every((row, i) => row === b[i])
}
