import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconEdit, IconFilter, IconFolderPlus } from '@tabler/icons-react'
import { ListColumn, Menu, MenuItem, NavTree, NavTreeSection, Toolbar, ToolbarButton } from '@estiva-app/ui'
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
import { SkeletonSidebarList } from '@/components/ui/Skeleton'
import { FileTreeView } from '@/components/views/FileTreeView'
import type { FileControl } from '@/components/views/useFileControls'
import { TopicState } from '@/components/ui/TopicState'
import { CreateFolderDialog } from '@/components/CreateFolderDialog'
import { StartTopicDialog } from '@/components/StartTopicDialog'
import { FolderActionDialog } from '@/components/views/FolderActionDialog'
import { useFolderActions } from '@/components/views/useFolderActions'
import {
  folderMatches,
  treeFilterOf,
  TREE_FILTERS,
  TREE_VIEWS,
  type TreeFilter,
  type TreeShow,
  type TreeView,
} from '@/components/views/treeFilter'
import { useRailClosed } from '@/layouts/railClosed'
import { filePath } from '@/lib/objectUrl'
import { useRememberedOpen } from '@/lib/rememberedOpen'
import { useToast } from '@/lib/toast'

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
 * read for every Folder's union of streams (`useTeamUnread`, FOL-18 — two POSTs for
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
 * `FolderTree.test.tsx`. The union draws no dot — a Folder row carries none
 * (Miky, 2026-10-03), only its files do. It decides what the Unread filter
 * keeps, and its socket signal (`activity`) is what re-reads an open
 * Folder's row dots.
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
  showFolder = false,
  selectedRef,
  selectedParent,
  onControl,
  currentContents,
}: {
  /** The Folder holding the open page. Its section starts open. */
  currentFolder?: string | null
  /**
   * The page is a Folder's own link (`/app/folders/<id>`): the column turns to
   * Folders, where every Folder is, with that one open.
   */
  showFolder?: boolean
  /** `ref` of the open file, whose row is current. */
  selectedRef?: string
  /**
   * The address the open file names as its parent, so the row it is under
   * starts expanded and the file is visible in the tree — a Ship issue is its
   * project's child, and `peersOf` hides a child whose parent is listed.
   */
  selectedParent?: string | null
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
  const { folders, signedOut, reload } = useFolders()
  /*
    The verdicts are judged over every Folder, the sections drawn for the
    top-level ones (FOL-22, PEE-31). A topic is a channel placed in its Folder
    by address, so it is in `listFolders` like any channel, and it is a row
    inside that Folder's section rather than a section of its own — but its
    stream is one of the Folder's, and `useTeamUnread` folds its verdict into
    the Folder's. A
    record channel is in `listFolders` too and is nobody's section:
    `topLevelFolders` says which are.
  */
  const { unread, activity, member } = useTeamUnread(folders)
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

  /*
    The two views (Katerina, 5 October): Topics, what you are a member of, and
    Folders, every Folder. The person's choice is remembered in this browser;
    a Folder's own link turns the column to Folders, where that Folder is.
  */
  const [view, setView] = useRememberedView()
  useEffect(() => {
    if (showFolder) setView('all')
  }, [showFolder, currentFolder, setView])
  const [show, setShow] = useState<TreeShow>('all')
  const { menuFor, action, close } = useFolderActions()
  /** The header's dialogs: a new Folder, and a topic with its Folder to choose. */
  const [making, setMaking] = useState<'folder' | 'topic' | null>(null)

  return (
    <>
      <FolderColumn
        view={view}
        onViewChange={setView}
        show={show}
        onShowChange={setShow}
        railClosed={railClosed}
        signedOut={signedOut}
        onNewFolder={() => setMaking('folder')}
        onNewTopic={() => setMaking('topic')}
      >
        <FolderTreeView
          folders={topLevel}
          signedOut={signedOut}
          unread={unread}
          activity={activity}
          member={member}
          view={view}
          filter={treeFilterOf(view, show)}
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
          menuFor={signedOut ? undefined : menuFor}
          onControl={onControl}
          currentContents={section === currentFolder ? currentContents : undefined}
        />
      </FolderColumn>
      {/* Mounted only while open: the writes, and the toasts that report them, are theirs. */}
      {action && <FolderActionDialog action={action} folders={folders} reload={reload} onClose={close} />}
      {making && (
        <HeaderDialog
          making={making}
          folders={folders}
          topLevel={topLevel}
          section={section ?? undefined}
          reload={reload}
          onClose={() => setMaking(null)}
        />
      )}
    </>
  )
}

/** The header's dialogs: a new Folder, and a topic with its Folder to choose. */
function HeaderDialog({
  making,
  folders,
  topLevel,
  section,
  reload,
  onClose,
}: {
  making: 'folder' | 'topic'
  folders: FolderSummary[] | null
  topLevel: FolderSummary[] | null
  section?: string
  reload: () => Promise<unknown>
  onClose: () => void
}) {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const { createFolder, createTopic } = useForeignObjects()
  if (making === 'folder') {
    return (
      <CreateFolderDialog
        onClose={onClose}
        onCreate={async (name) => {
          const result = await createFolder(name)
          if (!result.ok) {
            showToast({ label: result.reason, type: 'error' })
            return false
          }
          /*
            Re-read before navigating: the relay emits the `kind:39000` this
            list reads as a side effect of accepting the create, but the list in
            hand does not have it yet. The new Folder's link opens it, in Folders.
          */
          await reload()
          navigate(`/app/folders/${result.id}`)
          return true
        }}
      />
    )
  }
  return (
    <StartTopicDialog
      /*
        Started from the header there is no Folder in hand, so the dialog asks —
        the Folders the tree draws, every one of which has state.
      */
      folders={topLevel ?? []}
      defaultFolder={section}
      onClose={onClose}
      onCreate={async (title, chosen) => {
        const folder = chosen ?? section
        if (!folder) return false
        // `hasState` from the summary `listFolders` answered, never guessed: a `kind:1852` against a Folder with no state empties it.
        const hasState = folders?.find((candidate) => candidate.id === folder)?.hasState ?? false
        const result = await createTopic({ folder, title, hasState })
        if (!result.ok) {
          showToast({ label: result.reason, type: 'error' })
          return false
        }
        // Into the topic: under a filter the tree may not be showing it.
        navigate(filePath(result.address, title))
        return true
      }}
    />
  )
}

const VIEW_KEY = 'peek.tree.view'

/** The view, remembered in this browser; Topics until the person chooses. */
function useRememberedView(): [TreeView, (next: TreeView) => void] {
  const [view, setState] = useState<TreeView>(() => {
    try {
      return window.localStorage.getItem(VIEW_KEY) === 'all' ? 'all' : 'mine'
    } catch {
      return 'mine'
    }
  })
  const setView = useMemo(
    () => (next: TreeView) => {
      setState(next)
      try {
        window.localStorage.setItem(VIEW_KEY, next)
      } catch {
        // A browser that blocks storage still switches; it forgets.
      }
    },
    [],
  )
  return [view, setView]
}

/**
 * The column's frame, handed what it shows — the half a story can draw. Its
 * title is the view, and opens a menu of the views (Katerina, 5 October: a
 * menu, because it scales — an archive view is next); its header holds New
 * folder (in Folders only: a Folder is made where Folders are), New topic, and
 * the filter. The rows are its children.
 */
export function FolderColumn({
  view,
  onViewChange,
  show,
  onShowChange,
  railClosed,
  signedOut,
  onNewFolder,
  onNewTopic,
  children,
}: {
  view: TreeView
  onViewChange: (next: TreeView) => void
  show: TreeShow
  onShowChange: (next: TreeShow) => void
  railClosed: boolean
  /** Nobody is signed in: no header actions, since every one of them acts as somebody. */
  signedOut: boolean
  onNewFolder: () => void
  onNewTopic: () => void
  children: ReactNode
}) {
  return (
    <ListColumn
      title={TREE_VIEWS.find((option) => option.value === view)?.label ?? 'Topics'}
      titleMenu={TREE_VIEWS.map((option) => (
        <MenuItem key={option.value} label={option.label} selected={view === option.value} onClick={() => onViewChange(option.value)} />
      ))}
      collapsed={railClosed}
      actions={
        // One strip: one Tab stop, arrows along it (UIG-14).
        !signedOut && (
          <Toolbar aria-label="Topic list actions" surface={false}>
            {view === 'all' && (
              <ToolbarButton tooltip="New folder" aria-label="New folder" onClick={onNewFolder}>
                <IconFolderPlus size={16} stroke={1.5} />
              </ToolbarButton>
            )}
            <ToolbarButton tooltip="New topic" aria-label="New topic" onClick={onNewTopic}>
              <IconEdit size={16} stroke={1.5} />
            </ToolbarButton>
            <Menu
              align="right"
              trigger={
                /*
                  Pressed while Unread is chosen: the tree is hiding rows, and
                  nothing else on screen says so.
                */
                <ToolbarButton tooltip="Filter" aria-label="Filter" pressed={show !== 'all'}>
                  <IconFilter size={16} stroke={1.5} />
                </ToolbarButton>
              }
            >
              {TREE_FILTERS.map((option) => (
                <MenuItem key={option.value} label={option.label} selected={show === option.value} onClick={() => onShowChange(option.value)} />
              ))}
            </Menu>
          </Toolbar>
        )
      }
    >
      {/*
        The list scrolls, and it is the package's bar (D40): the package's
        `ListColumn`, the same column and insets as every other list column in
        Peek (UIG-14, N9). Its empties are sections (D51); loading is a skeleton.
      */}
      {children}
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
  view = 'all',
  filter = 'all',
  currentFolder,
  selectedRef,
  selectedParent,
  onSelect,
  menuFor,
  onControl,
  currentContents,
}: {
  /** `null` while the first read is in flight, or when signed out. */
  folders: FolderSummary[] | null
  signedOut: boolean
  /**
   * Whether each Folder holds something unread — the union of its streams
   * (FOL-18). Drawn as nothing; it is what the Unread filter keeps. Missing
   * means unjudged.
   */
  unread: Record<string, boolean>
  /**
   * The socket's signal count per Folder id (FOL-44): an open section's rows
   * re-read their dots when theirs changes. Missing means nothing said yet.
   */
  activity?: Record<string, number>
  /** Whether each Folder holds a stream the person is a member of (FOL-41, §11.8). Missing means unjudged. */
  member?: Record<string, boolean>
  /** Which view: in Folders, every heading wears the folder icon (Katerina, 5 October). */
  view?: TreeView
  /** What the column is showing — `all` unless the header says otherwise (FOL-41). */
  filter?: TreeFilter
  currentFolder?: string | null
  selectedRef?: string
  selectedParent?: string | null
  onSelect: (file: ForeignObject) => void
  /** A Folder's heading menu — `useFolderActions`. Absent, the headings have none. */
  menuFor?: (folder: FolderSummary) => ReactNode
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
    // The Folder holding the open file stays whatever the filter: a file opened
    // from a link, a search or a notification is shown where it is (5 October).
    .filter((folder) => folder.id === currentFolder || folderMatches(filter, folder.id, unread, member))

  /*
    A filter that matched nothing is not an empty workspace, and the two must
    not share a sentence: the Folders are there, this view is hiding them.
  */
  if (ordered.length === 0) {
    return (
      <EmptyState
        scope="section"
        message={filter === 'unread' || filter === 'mine-unread' ? 'Nothing unread.' : 'Nothing yours yet. Join a file to hear about it.'}
      />
    )
  }

  return (
    // The package's tree, each Folder a section of it that reads its own rows.
    <NavTree>
      {ordered.map((folder) => (
        <FolderSection
          key={folder.id}
          folder={folder}
          activity={activity[folder.id] ?? 0}
          filter={filter}
          current={folder.id === currentFolder}
          selectedRef={selectedRef}
          selectedParent={selectedParent}
          onSelect={onSelect}
          icon={view === 'all'}
          menu={menuFor?.(folder)}
          onControl={onControl}
          preloaded={folder.id === currentFolder ? currentContents : undefined}
        />
      ))}
    </NavTree>
  )
}

/** One Folder: a fold, and its first level once it is open. */
function FolderSection({
  folder,
  activity,
  filter,
  current,
  selectedRef,
  selectedParent,
  onSelect,
  icon,
  menu,
  onControl,
  preloaded,
}: {
  folder: FolderSummary
  activity: number
  filter: TreeFilter
  current: boolean
  selectedRef?: string
  selectedParent?: string | null
  onSelect: (file: ForeignObject) => void
  /** The folder icon before the name — in Folders, not in Topics. */
  icon: boolean
  /** The heading's ⋮: the Folder's own actions. */
  menu?: ReactNode
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
  const prefetch = () => {
    if (!open) prefetchFolderContents(resolveFolderContents, folder.id)
  }
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
    <NavTreeSection
      id={folder.id}
      /*
        The id when there is no name. A Folder with no state event has only
        its channel's name, and a channel created by an app rather than a
        person may carry none — the ordinary case on today's data.
      */
      title={folder.name ?? folder.id}
      open={open}
      onOpenChange={setOpen}
      /*
        No dot on a Folder, open or collapsed (Miky, 2026-10-03): read state
        is the file's, and only a file row carries one. What is new inside a
        shut Folder is what the header's Unread filter is for.
      */
      /*
        The Folder's own actions on its heading's ⋮ — Start a topic, Rename,
        Archive… (Katerina, 5 October): the Folders page and its "Open folder"
        are gone, and a click on the heading only folds it.
      */
      icon={icon ? <TopicState type="folder" /> : undefined}
      menu={menu}
      // The pointer resting on a closed Folder, or the keyboard reaching it,
      // reads it ahead (SID-2): resting, not passing, and never twice.
      onIntent={prefetch}
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
    </NavTreeSection>
  )
}

/** How long the pointer rests on a closed Folder before it is read ahead (SID-2). */
export const PREFETCH_INTENT_MS = 150

/** The same rows, in the same order — what a re-read that changed nothing answers. */
function sameRows(a: readonly ForeignObject[], b: readonly ForeignObject[] | undefined): boolean {
  return !!b && a.length === b.length && a.every((row, i) => row === b[i])
}
