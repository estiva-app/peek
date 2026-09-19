import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconArrowUpRight, IconEdit } from '@tabler/icons-react'
import { CollapsibleSection } from '@estiva-app/ui'
import type { FolderSummary, ForeignObject } from '@estiva-app/interop'
import { topLevelFolders, useFolderContents, useFolders, useTeamUnread } from '@/api'
import { EmptyState } from '@/components/ui/EmptyState'
import { IconButton } from '@/components/ui/IconButton'
import { SkeletonSidebarList } from '@/components/ui/Skeleton'
import { UnreadDot } from '@/components/ui/UnreadDot'
import { FileTreeView } from '@/components/views/FileTreeView'
import { PageListColumn } from '@/layouts/PageListColumn'
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
}) {
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
  const { unread } = useTeamUnread(folders)
  const topLevel = useMemo(() => (folders ? topLevelFolders(folders) : null), [folders])
  const folderPath = useFolderPath()

  return (
    <PageListColumn
      title="Folders"
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
        currentFolder={currentFolder}
        selectedRef={selectedRef}
        selectedParent={selectedParent}
        onSelect={(file) => {
          if (file.address) navigate(filePath(file.address))
        }}
        onOpenFolder={(id) => navigate(folderPath(id))}
      />
    </PageListColumn>
  )
}

/** The column's body, handed what it draws — the part a story can show. */
export function FolderTreeView({
  folders,
  signedOut,
  unread,
  currentFolder,
  selectedRef,
  selectedParent,
  onSelect,
  onOpenFolder,
}: {
  /** `null` while the first read is in flight, or when signed out. */
  folders: FolderSummary[] | null
  signedOut: boolean
  /** The union dot per Folder id (FOL-18). Missing means unjudged. */
  unread: Record<string, boolean>
  currentFolder?: string | null
  selectedRef?: string
  selectedParent?: string | null
  onSelect: (file: ForeignObject) => void
  onOpenFolder: (folderId: string) => void
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
  const ordered = [...folders].sort((a, b) =>
    (a.name ?? a.id).localeCompare(b.name ?? b.id, undefined, { sensitivity: 'base' }),
  )

  return (
    <>
      {ordered.map((folder) => (
        <FolderSection
          key={folder.id}
          folder={folder}
          /* `=== true`: an unjudged Folder draws no dot, not a dark one. */
          unread={unread[folder.id] === true}
          current={folder.id === currentFolder}
          selectedRef={selectedRef}
          selectedParent={selectedParent}
          onSelect={onSelect}
          onOpen={() => onOpenFolder(folder.id)}
        />
      ))}
    </>
  )
}

/** One Folder: a fold, and its first level once it is open. */
function FolderSection({
  folder,
  unread,
  current,
  selectedRef,
  selectedParent,
  onSelect,
  onOpen,
}: {
  folder: FolderSummary
  unread: boolean
  current: boolean
  selectedRef?: string
  selectedParent?: string | null
  onSelect: (file: ForeignObject) => void
  onOpen: () => void
}) {
  const [open, setOpen] = useRememberedOpen(`peek.tree.folder.${folder.id}`, current)
  /*
    The read is the fold. `null` while closed is the hook's "nothing to read"
    — no request, no refresh trigger, no socket subscription — so a Folder
    nobody opened costs the column nothing beyond its dot.
  */
  const { state } = useFolderContents(open ? folder.id : null)
  const listed = typeof state === 'object' && 'files' in state ? state.files : undefined
  const parentRow = selectedParent
    ? listed?.find((candidate) => candidate.address === selectedParent)
    : undefined

  return (
    <div className="shrink-0" data-tree-folder={folder.id} data-open={open}>
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
            selectedRef={selectedRef}
            expand={parentRow ? [parentRow.ref] : undefined}
            onSelect={onSelect}
          />
        )}
      </CollapsibleSection>
    </div>
  )
}
