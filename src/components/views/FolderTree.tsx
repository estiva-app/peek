import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconFilter, IconFolderPlus } from '@tabler/icons-react'
import { Chip, EmptyState, ListColumn, Menu, MenuItem, NavTree, NavTreeSection, SkeletonList, Toolbar, ToolbarButton } from '@estiva-app/ui'
import { nestingOf } from '@estiva-app/interop'
import type { FolderSummary, ForeignObject } from '@estiva-app/interop'
import type { FolderContentsState } from '@/api'
import { teamFolders, topLevelFolders, useFolderContents, useFolders, useForeignObjects } from '@/api'
import { FileTreeView } from '@/components/views/FileTreeView'
import type { FileControl } from '@/components/views/useFileControls'
import { TopicState } from '@/components/ui/TopicState'
import { TeamsColumn } from '@/components/views/TeamsColumn'
import { CreateFolderDialog } from '@/components/CreateFolderDialog'
import { HeaderStartTopic, NewTopicButton } from '@/components/views/HeaderStartTopic'
import { FolderActionDialog } from '@/components/views/FolderActionDialog'
import { useFolderActions } from '@/components/views/useFolderActions'
import { TREE_FILTERS, TREE_VIEWS, type TreeShow, type TreeView } from '@/components/views/treeFilter'
import { useRailClosed } from '@/layouts/railClosed'
import { useToast } from '@/lib/toast'

/**
 * The left column of the Teams rail item (`FoldersPage`) and the file page
 * (`FilePage`). Its title switches between its two views (Katerina,
 * 5 October): Teams (`TeamsColumn`, TEA-5) and Archive, every top-level Folder
 * as a fold over what is archived in it, where Unarchive brings it back.
 *
 * ## What is read, and when
 *
 * The list of Folders, once (`useFolders`, one `POST /query`); Teams reads what
 * it draws (`useTeams`). In Archive **nothing else until a fold opens**: an
 * open Folder reads what is archived in it (`useFolderContents`), and a row
 * with a chevron reads its children when it is expanded and never before
 * (`FileTreeView` → `useForeignChildren`). Every Folder starts closed there.
 *
 * ## Sections, not rows, for the Folders
 *
 * A Folder is a `NavTreeSection` — the package's group-of-rows, the same
 * thing Ship's sidebar makes of its projects and Linear's of its teams — so
 * its title folds and its rows are the files; its ⋮ holds the Folder's own
 * actions (`useFolderActions`). Since FOL-22 a topic is a channel placed in its team by address (`listedIn`), so
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
  selectedArchived,
  expandSelected = false,
  onControl,
  chatOpen = false,
}: {
  /** The open page is `currentFolder`'s team chat (TEA-5): its row is current. */
  chatOpen?: boolean
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
  /**
   * The open file is archived: Archive draws it, Teams does not.
   * `undefined` while the file is still resolving — nothing is judged on a guess.
   */
  selectedArchived?: boolean
  /** Open the selected row too, showing what is under it — a Ship project reached by its channel's link. */
  expandSelected?: boolean
  /** A row's more-menu — see `FileTreeView`. The page that owns the dialogs passes it. */
  onControl?: (control: FileControl, file: ForeignObject) => void
}) {
  const railClosed = useRailClosed()
  const navigate = useNavigate()
  const { folders, signedOut, reload } = useFolders()
  // A record channel is in `listFolders` too and is nobody's section: `topLevelFolders` says which are (FOL-22, PEE-31).
  const topLevel = useMemo(() => (folders ? topLevelFolders(folders) : null), [folders])
  // The Archive view's Folders (5 October): every top-level one, the archived included — the teams.
  const archiveLevel = useMemo(() => (folders ? teamFolders(folders) : null), [folders])
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
    The two views (Katerina, 5 October): Teams and Archive. A Folder's own
    link turns the column to where that Folder is, for this visit only.
  */
  // An archived Folder's link opens Archive, where it is; any other, Teams.
  const linkedArchived = !!folders?.find((folder) => folder.id === currentFolder)?.archived
  const { view, choose: setView, follow } = useView(showFolder ? (currentFolder ?? null) : null, linkedArchived ? 'archive' : 'all')

  /*
    One rule (Katerina, 5 October): the page beside the column only ever shows
    a file the column draws. Archive draws what is archived: the file itself,
    or the Folder it is in; Teams what is not. The filter (All / Unread) never
    hides the open file: one read is not one gone. Unknown until the file has
    resolved and the Folders are read: nothing is judged on a guess.
  */
  const openArchived =
    selectedRef && selectedArchived !== undefined && folders
      ? selectedArchived || !!folders.find((folder) => folder.id === section)?.archived
      : undefined
  const draws = (which: TreeView, file: { archived: boolean }) => (which === 'archive' ? file.archived : !file.archived)
  /*
    The column follows a file that arrives — a click, a link, a search, the
    back button, the rail coming back — to a view that draws it, for this
    visit: Archive for an archived one, Teams for a live one. A file archived
    while it is open closes ("No file selected"), as an item leaves the list
    it was in (the toast has Undo). One that is unarchived while open in
    Archive stays open, and the column goes where it now is. Set during
    render, once per change: neither the initialiser nor an effect.
  */
  const [seenFile, setSeenFile] = useState<{ ref: string; archived: boolean } | null>(null)
  const [closing, setClosing] = useState(false)
  if (selectedRef && openArchived !== undefined && (seenFile?.ref !== selectedRef || seenFile.archived !== openArchived)) {
    const now = { archived: openArchived }
    const same = seenFile?.ref === selectedRef
    setSeenFile({ ref: selectedRef, ...now })
    if (!draws(view, now)) {
      const unarchived = view === 'archive' && !now.archived
      if (same && draws(view, seenFile) && !unarchived) setClosing(true)
      else follow(now.archived ? 'archive' : null)
    }
  }
  useEffect(() => {
    if (closing) navigate('/app/folders')
  }, [closing, navigate])
  const [show, setShow] = useState<TreeShow>('all')
  const { menuFor, action, close } = useFolderActions()
  /** The header's dialogs: a new Folder, and a topic with its Folder to choose. */
  const [making, setMaking] = useState<'folder' | 'topic' | null>(null)

  return (
    <>
      <FolderColumn
        view={view}
        onViewChange={(next) => {
          setView(next)
          /*
            A view that does not draw the open file closes it, and the page
            says "No file selected" (Katerina, 5 October): a selection the
            column cannot show is a page about nothing beside it. Archive
            draws only what is archived; Teams only what is not.
          */
          if (selectedRef && next !== view && (openArchived === undefined || !draws(next, { archived: openArchived }))) {
            navigate('/app/folders')
          }
        }}
        show={show}
        onShowChange={setShow}
        railClosed={railClosed}
        signedOut={signedOut}
        onNewFolder={() => setMaking('folder')}
        onNewTopic={() => setMaking('topic')}
      >
        {view === 'all' ? (
          <TeamsColumn
            show={show}
            selectedRef={selectedRef}
            openTeam={section}
            chatOpen={chatOpen}
            onControl={onControl}
          />
        ) : (
          <ArchiveTreeView
            folders={archiveLevel}
            signedOut={signedOut}
            linkedFolder={showFolder ? currentFolder : undefined}
            currentFolder={section}
            selectedRef={selectedRef}
            selectedParent={selectedParent}
            expandSelected={expandSelected}
            menuFor={signedOut ? undefined : menuFor}
            onControl={onControl}
          />
        )}
      </FolderColumn>
      {/* Mounted only while open: the writes, and the toasts that report them, are theirs. */}
      {action && (
        <FolderActionDialog key={`${action.kind}:${action.folder.id}`} action={action} folders={folders} reload={reload} onClose={close} />
      )}
      {making === 'folder' && <NewFolderDialog reload={reload} onClose={() => setMaking(null)} />}
      {making === 'topic' && <HeaderStartTopic column="folders" defaultFolder={section ?? undefined} onClose={() => setMaking(null)} />}
    </>
  )
}

/** The header's New folder. */
function NewFolderDialog({ reload, onClose }: { reload: () => Promise<unknown>; onClose: () => void }) {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const { createFolder } = useForeignObjects()
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

const VIEW_KEY = 'peek.tree.view'

/** The Folders opened in Archive, for this visit. */
const ARCHIVE_OPEN_KEY = 'peek.tree.archive.open'
function archiveOpenSet(): Set<string> {
  try {
    return new Set(JSON.parse(window.sessionStorage.getItem(ARCHIVE_OPEN_KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}
function archiveOpenHeld(folder: string): boolean {
  return archiveOpenSet().has(folder)
}
function holdArchiveOpen(folder: string, open: boolean): void {
  const held = archiveOpenSet()
  if (open) held.add(folder)
  else held.delete(folder)
  try {
    window.sessionStorage.setItem(ARCHIVE_OPEN_KEY, JSON.stringify([...held]))
  } catch {
    // A browser that blocks storage still opens it; it forgets on the next page.
  }
}

/**
 * A Folder link's turn to Folders, held for this tab and not saved (Katerina,
 * 5 October): the column stays on Folders while the person moves between the
 * link and its files, and the next visit opens on their own choice again.
 */
const VISIT_KEY = 'peek.tree.visit'
function visitView(): TreeView | null {
  try {
    const held = window.sessionStorage.getItem(VISIT_KEY)
    return held === 'all' || held === 'archive' ? held : null
  } catch {
    return null
  }
}

/**
 * The view shown: a link's for this visit, else the person's saved choice.
 * Archive is never saved either: opening Peek on it next time would be
 * opening it on what was put away.
 */
function useView(
  linked: string | null,
  linkedView: TreeView,
): {
  /** What the column shows. */
  view: TreeView
  /** The person's own choice, Topics or Folders. */
  saved: TreeView
  /** The person picks a view from the title menu. */
  choose: (next: TreeView) => void
  /** What the open file asks of the column, for this visit: `null` is the person's own view. */
  follow: (visit: TreeView | null) => void
} {
  const [saved, save] = useRememberedView()
  const [visit, setVisit] = useState<TreeView | null>(visitView)
  const [seen, setSeen] = useState<string | null>(null)
  // Set during render, once per link (and again once it is known to be archived): neither the initialiser nor an effect.
  const arrival = linked ? `${linked}|${linkedView}` : null
  if (arrival && arrival !== seen) {
    setSeen(arrival)
    setVisit(linkedView)
  }
  useEffect(() => {
    try {
      if (visit) window.sessionStorage.setItem(VISIT_KEY, visit)
      else window.sessionStorage.removeItem(VISIT_KEY)
    } catch {
      // A browser that blocks storage still switches; it forgets on the next page.
    }
  }, [visit])
  const choose = useCallback(
    (next: TreeView) => {
      if (next === 'archive') return setVisit('archive')
      setVisit(null)
      save(next)
    },
    [save],
  )
  return { view: visit ?? saved, saved, choose, follow: setVisit }
}

/**
 * The view the column opens on: Teams, always, since Joined went (TEA-5). A
 * `mine` an older Peek saved in this browser is forgotten, not obeyed.
 */
function useRememberedView(): [TreeView, (next: TreeView) => void] {
  const [view, setState] = useState<TreeView>('all')
  useEffect(() => {
    try {
      window.localStorage.removeItem(VIEW_KEY)
    } catch {
      // A browser that blocks storage had nothing saved either.
    }
  }, [])
  return [view, setState]
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
      title={TREE_VIEWS.find((option) => option.value === view)?.label ?? 'Teams'}
      titleMenu={TREE_VIEWS.map((option) => (
        <MenuItem key={option.value} label={option.label} selected={view === option.value} onClick={() => onViewChange(option.value)} />
      ))}
      collapsed={railClosed}
      actions={
        // One strip: one Tab stop, arrows along it (UIG-14). Archive makes nothing and filters nothing.
        !signedOut && view !== 'archive' && (
          <Toolbar aria-label="Topic list actions" surface={false}>
            {view === 'all' && (
              <ToolbarButton tooltip="New team" aria-label="New team" onClick={onNewFolder}>
                <IconFolderPlus size={16} stroke={1.5} />
              </ToolbarButton>
            )}
            <NewTopicButton onClick={onNewTopic} />
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

/** Archive's body, handed what it draws — the part a story can show. */
export function ArchiveTreeView({
  folders,
  signedOut,
  linkedFolder,
  currentFolder,
  selectedRef,
  selectedParent,
  expandSelected = false,
  menuFor,
  onControl,
}: {
  /** Every top-level Folder, the archived included. `null` while the first read is in flight, or when signed out. */
  folders: FolderSummary[] | null
  signedOut: boolean
  /** The Folder a link opened (`/app/folders/<id>`): it opens, and is scrolled to. */
  linkedFolder?: string | null
  currentFolder?: string | null
  selectedRef?: string
  selectedParent?: string | null
  /** Open the selected row too — see `FolderTree`. */
  expandSelected?: boolean
  /** A Folder's heading menu — `useFolderActions`. Absent, the headings have none. */
  menuFor?: (folder: FolderSummary) => ReactNode
  onControl?: (control: FileControl, file: ForeignObject) => void
}) {
  /*
    Three states, not two: "not signed in", "still loading" and "there are
    genuinely none" are different sentences — the Folders page's lesson.
  */
  if (signedOut) return <EmptyState scope="section" message="Sign in to see teams." />
  if (folders === null) return <SkeletonList />
  if (folders.length === 0) return <EmptyState scope="section" message="No teams yet." />

  // Alphabetical: the relay's order is arrival order, which tells the person nothing.
  const ordered = [...folders].sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id, undefined, { sensitivity: 'base' }))

  return (
    // The package's tree, each Folder a section of it that reads its own rows. Given the open file, it scrolls to its row (ui 0.94);
    // given the Folder a link opened, to that Folder's heading (ui 0.99).
    <NavTree selected={selectedRef} selectedGroup={linkedFolder ?? undefined}>
      {ordered.map((folder) => (
        <ArchiveSection
          key={folder.id}
          folder={folder}
          current={folder.id === currentFolder}
          selectedRef={selectedRef}
          selectedParent={selectedParent}
          expandSelected={expandSelected}
          // Only an archived Folder has a menu here: its Unarchive.
          menu={folder.archived ? menuFor?.(folder) : undefined}
          onControl={onControl}
        />
      ))}
    </NavTree>
  )
}

/** One Folder in Archive: a fold, and what is archived in it once it is open. */
function ArchiveSection({
  folder,
  current,
  selectedRef,
  selectedParent,
  expandSelected,
  menu,
  onControl,
}: {
  folder: FolderSummary
  current: boolean
  selectedRef?: string
  selectedParent?: string | null
  expandSelected?: boolean
  /** The heading's ⋮: the Folder's own actions. */
  menu?: ReactNode
  onControl?: (control: FileControl, file: ForeignObject) => void
}) {
  /*
    Every Folder starts closed (5 October): what is archived in one is a read
    of its own, made when it opens — 160 open at once would be the relay's
    whole minute. Held for the visit (sessionStorage): the column is drawn
    again on every page, and a Folder opened in Archive shut the moment a file
    in it was clicked (5 October).
  */
  const [open, setOpenState] = useState(() => archiveOpenHeld(folder.id))
  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next)
      holdArchiveOpen(folder.id, next)
    },
    [folder.id],
  )
  /*
    A Folder's link lands on it open, and the Folder holding the open file is
    open (Katerina, 5 October): the package's `NavTree` (`selectedGroup`, ui
    0.99) and `openFor`, once per arrival — the person can close it again.
  */
  const openFor = current && selectedRef ? `archive:${selectedRef}` : undefined
  // The read is the fold: `null` while closed is the hook's "nothing to read".
  const own = useFolderContents(open ? folder.id : null, { archived: true, folderArchived: !!folder.archived })
  // The last listing drawn stays drawn while the next read of the same Folder is in flight (SID-2).
  const fresh = own.state
  const listing = typeof fresh === 'object' && 'files' in fresh ? fresh : undefined
  const [drawn, setDrawn] = useState(listing)
  // By the rows, not the wrapper: a listing rebuilt per render would set this for ever.
  if (listing && !sameRows(listing.files, drawn?.files)) setDrawn(listing)
  const state = fresh === 'loading' && drawn ? drawn : fresh
  // Opened before its listing is in, it stays shut with its arrow turned, then opens with every row (OPT-11, ui 0.99).
  const pending = open && state === 'loading'
  const listed = typeof state === 'object' && 'files' in state ? state.files : undefined
  /*
    Every row above the open file starts open, not only its parent (FOL-4).
    The chain is the listing's (`nestingOf`), so it costs no request; a file
    the listing does not hold still opens its parent's chain.
  */
  const nesting = listed ? nestingOf(listed) : undefined
  const selectedRow = listed?.find((candidate) => candidate.ref === selectedRef)
  const parentRow = selectedParent ? listed?.find((candidate) => candidate.address === selectedParent) : undefined
  const chain = nesting
    ? selectedRow
      ? nesting.ancestorsOf(selectedRow).map((row) => row.ref)
      : parentRow
        ? [...nesting.ancestorsOf(parentRow), parentRow].map((row) => row.ref)
        : undefined
    : undefined
  const expand = expandSelected && selectedRow ? [...(chain ?? []), selectedRow.ref] : chain

  return (
    <NavTreeSection
      id={folder.id}
      // The id when there is no name: a channel created by an app rather than a person may carry none.
      title={folder.name ?? folder.id}
      open={open}
      pending={pending}
      onOpenChange={setOpen}
      openFor={openFor}
      icon={<TopicState type="folder" />}
      // An archived Folder says so beside its name (Katerina, 5 October): the rest are there for what is archived inside them.
      trailing={folder.archived ? <Chip type="neutral" label="Archived" /> : undefined}
      menu={menu}
    >
      {open && <FileTreeView state={state} archive selectedRef={selectedRef} expand={expand} onControl={onControl} />}
    </NavTreeSection>
  )
}

/** The same rows, in the same order — what a re-read that changed nothing answers. */
function sameRows(a: readonly ForeignObject[], b: readonly ForeignObject[] | undefined): boolean {
  return !!b && a.length === b.length && a.every((row, i) => row === b[i])
}
