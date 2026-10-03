import { useEffect, useMemo, useState, type ComponentProps, type ReactNode } from 'react'
import {
  IconArchive,
  IconArrowUpRight,
  IconEdit,
  IconFilter,
  IconFolderPlus,
  IconMessagePlus,
  IconTrash,
} from '@tabler/icons-react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ListColumn,
  Menu,
  MenuItem,
  Panel,
  Toolbar,
  ToolbarButton,
  ToolbarLink,
} from '@estiva-app/ui'
import { AppShell } from '@/layouts/AppShell'
import { useRailClosed } from '@/layouts/railClosed'
import { EmptyState } from '@/components/ui/EmptyState'
import { FolderContentsView, peersOf } from '@/components/views/FolderContentsView'
import { FolderTreeView } from '@/components/views/FolderTree'
import {
  topLevelFolders,
  useConversationBadges,
  useFolderContents,
  useFolders,
  useCurrentUser,
  useForeignObjects,
  useTeamUnread,
  useWorkspaceDirectory,
} from '@/api'
import { KIND_BARE_FILE } from '@estiva-app/interop'
import type { ForeignObject } from '@estiva-app/interop'
import { EditableText } from '@/components/ui/EditableText'
import { ArchiveDialog } from '@/components/ArchiveDialog'
import { ArchivedNotice } from '@/components/ArchivedNotice'
import { archiveImpactWords, kindNoun } from '@/lib/archiveWords'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { CreateFolderDialog } from '@/components/CreateFolderDialog'
import { useFileControls } from '@/components/views/useFileControls'
import { StartTopicDialog } from '@/components/StartTopicDialog'
import { TREE_FILTERS, type TreeFilter } from '@/components/views/treeFilter'
import { useToast } from '@/lib/toast'
import { filePath } from '@/lib/objectUrl'
import { followInApp } from '@/lib/followInApp'
import { useFolderPath } from '@/lib/useFolderPath'
import { channelDestination, legacyTopicByChannel } from '@/lib/legacyTopicLinks'

/**
 * `/app/folders` and `/app/folders/:id` — navigation by Folder (RFC 0.4 §4).
 *
 * It was added beside the Convex topic model; that model is gone (FOL-26
 * retired its view, FOL-23 its code), and a topic is a file under a Folder
 * (RFC 0.4 §11.1). This page reads Folders and draws what is in them.
 *
 * The left pane lists Folders by name; the right draws one Folder's contents,
 * whichever apps own them.
 */
export function FoldersPage() {
  const railClosed = useRailClosed()
  const { folders, signedOut, failed: foldersFailed, reload } = useFolders()
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { state, reload: reloadContents } = useFolderContents(id)
  const { createFolder, createTopic, renameFolder, folderDeletable, deleteFolder, archiveFolder, archiveImpact } =
    useForeignObjects()
  const { showToast } = useToast()
  /** The New folder dialog, open or not — the header's first action (FOL-41). */
  const [creatingFolder, setCreatingFolder] = useState(false)
  /** What the column is showing — the header's third action (FOL-41). */
  const [filter, setFilter] = useState<TreeFilter>('all')
  /*
    Move is the file menu's own dialog (FOL-45), so the pane and the file page
    move the same way. The file left this Folder, or went under another file
    in it: both reads are stale.
  */
  const fileControls = useFileControls({ onMoved: () => void Promise.all([reload(), reloadContents()]) })
  /*
    A topic being started — SPEC §6.7. `parent` is the file it will sit under
    when it was started from a row; `undefined` from the folder header means a
    topic at the top of the Folder. Two different sentences in the dialog and
    one different tag on the wire.
  */
  const [startingTopic, setStartingTopic] = useState<{ parent?: ForeignObject; choose?: boolean } | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  /*
    One request for the whole listing's badges, made here rather than inside
    the view so the view stays a pure render of what it is handed — and so a
    folder nobody has opened costs nothing.
  */
  const { counts, unread } = useConversationBadges(
    // Peers only. A nested child gets its own count when its parent is
    // expanded, so counting it here is a request for a badge nothing draws.
    typeof state === 'object' && 'files' in state ? peersOf(state.files) : undefined,
  )
  /*
    The dot on each Folder row: the union of its streams (SPEC §11.3, FOL-18).
    One batched read for every row, judged against the same frontier as the
    listing's per-file dots, so a Folder lights while a file nobody read has a
    new comment and goes dark only when that file's stream is read — never
    because somebody read the team's chat, and never because this page was
    opened, which reads nothing.
  */
  const { unread: teamUnread, member: teamMember } = useTeamUnread(folders)
  /* Where a Folder's own control leads — its topic when it is one (FOL-21). */
  const folderPath = useFolderPath()
  /*
    The five teams, and any Folder somebody makes beside them (PEE-31). The
    list the relay answers is every channel; the dots above are judged over
    all of them, because a hidden channel's stream is still one of its team's.
  */
  const topLevel = useMemo(() => (folders ? topLevelFolders(folders) : null), [folders])

  const selected = folders?.find((folder) => folder.id === id)
  /*
    The Folder that was one of Peek's old topics.

    A topic's channel *is* its Folder, so the channels that outlived the topics
    — the project channels and two test ones FOL-25 kept — are in the list on
    the left beside the Folders people made on purpose, and the relay cannot
    tell them apart. Renaming or deleting one here used to reach only the
    relay while the Convex twin kept the topic, and fourteen topics were lost
    that way. The twin is gone (FOL-23), but the channel still holds that
    topic's conversation and a file now carries it, so it stays managed from
    there: its name is shown rather than edited, and "Open" leads to where its
    conversation went. `legacyTopicLinks` says which channels those are.
  */
  const topic = id ? legacyTopicByChannel(id) : undefined

  /*
    A DM's channel is not a Folder (PEE-36). Its uuid reached this page from a
    link to one of its messages, and the page drew an empty Folder called "DM"
    with a Delete that would have hidden the conversation from both people.
    The viewer's own DM opens as the DM; any other DM channel — a group DM —
    is shown without the Folder's actions. They wait for the answer, so Delete
    is never offered on a channel not yet known to be a Folder.
  */
  const { dmForChannel } = useForeignObjects()
  const [dmCheck, setDmCheck] = useState<{ id: string; isFolder: boolean } | null>(null)
  useEffect(() => {
    if (!id || topic) return
    let cancelled = false
    dmForChannel(id)
      .then((dm) => {
        if (cancelled) return
        if (dm && dm !== 'not-a-person') navigate(`/app/people/${dm}`, { replace: true })
        else setDmCheck({ id, isFolder: dm === null })
      })
      .catch(() => {
        // Unanswered is not "a Folder": Delete stays hidden, which is the safe side.
      })
    return () => {
      cancelled = true
    }
  }, [id, topic, dmForChannel, navigate])
  /*
    "Not a DM" is not "a Folder" (PEE-42). A DM the viewer is not in hides its
    `39000` from them, so the check above answers null for it, and the page
    offered to rename it, start a topic in it and follow it. A Folder is one
    the relay lists to this viewer — `selected` — and nothing else is.
  */
  const isFolder = dmCheck != null && dmCheck.id === id && dmCheck.isFolder && !!selected
  // Said only on an answer: a listing that failed is empty without meaning it.
  const notAFolder =
    !topic &&
    ((dmCheck != null && dmCheck.id === id && !dmCheck.isFolder) || (folders != null && !foldersFailed && !selected))

  /*
    Delete only where it loses nothing but the Folder (FOL-9). A `kind:9008`
    hides everything carrying the Folder's `h` — Ship issues included, which is
    how FOL-1…FOL-24 vanished on 2026-09-14 — so a Folder with state (every
    team, QA, anything made with New folder) never offers it, and any other is
    asked of the relay first: see `folderDeletableAsViewer`. Hidden until that
    answers yes for this Folder; unanswered is a no. Asked again when what the
    Folder holds changes, so a file filed in it takes Delete away — and the
    delete itself asks once more before it signs anything.
  */
  const contentsHasState = typeof state === 'object' && 'hasState' in state ? state.hasState : undefined
  const contentsCount = typeof state === 'object' && 'files' in state ? state.files.length : undefined
  const [deleteCheck, setDeleteCheck] = useState<{ id: string; count?: number; ok: boolean } | null>(null)
  useEffect(() => {
    if (!id || !isFolder || contentsHasState !== false) return
    let cancelled = false
    folderDeletable(id)
      .then((result) => {
        if (!cancelled) setDeleteCheck({ id, count: contentsCount, ok: result.ok })
      })
      .catch(() => {
        // Unanswered: Delete stays hidden, the safe side.
      })
    return () => {
      cancelled = true
    }
  }, [id, isFolder, contentsHasState, contentsCount, folderDeletable])
  // An answer about what the Folder held before is no answer (see above).
  const canDelete =
    contentsHasState === false &&
    deleteCheck != null &&
    deleteCheck.id === id &&
    deleteCheck.count === contentsCount &&
    deleteCheck.ok

  /*
    Archive the Folder (FOL-46) — the change on its channel address that every
    reader folds, never a `kind:9008`: its contents, its state and its channel
    are untouched, so Unarchive brings back exactly what was there. Offered
    only to the Folder's owners and admins (SPEC §3.2): every reader ignores
    an archive from anybody else. It opens on a read of what it would hide. An
    archived Folder leaves the list on the left and stays open here, under its
    notice.
  */
  const people = useWorkspaceDirectory()
  const me = useCurrentUser()?.id
  const [archivingFolder, setArchivingFolder] = useState<{ hides: string[]; staysVisible: string[] } | null>(null)
  const folderArchive = selected?.archived
  const canArchive = !topic && isFolder && !!selected?.channel && !!me && !!selected.admins?.includes(me)
  // One count at a time: a second click would read the whole Folder again.
  const [countingArchive, setCountingArchive] = useState(false)
  const startArchive = () => {
    if (!selected?.channel || countingArchive) return
    setCountingArchive(true)
    archiveImpact(selected.channel, folders ?? undefined)
      .then((impact) => setArchivingFolder(archiveImpactWords(impact)))
      .catch(() =>
        showToast({ label: 'What archiving would hide could not be read, so nothing was archived. Try again.', type: 'error' }),
      )
      .finally(() => setCountingArchive(false))
  }
  async function setFolderArchived(archived: boolean, resolution?: string): Promise<boolean> {
    if (!id || !selected?.channel) return false
    // A refused sign throws (a 429 under load); say so rather than closing silently.
    const result = await archiveFolder({
      folder: id,
      channel: selected.channel,
      archived,
      resolution,
    }).catch((error: unknown) => ({
      ok: false as const,
      reason: `Nothing was archived: ${(error as Error)?.message ?? 'the write failed'}. Try again.`,
    }))
    if (!result.ok) {
      showToast({ label: result.reason, type: 'error' })
      return false
    }
    await Promise.all([reload(), reloadContents()])
    return true
  }
  const archivedWith = folderArchive?.with
  const folderNotice =
    // Everyone reads that it is archived; only its owners and admins are offered Unarchive.
    folderArchive && !topic && isFolder && selected?.channel ? (
      <ArchivedNotice
        archive={folderArchive}
        by={people?.[folderArchive.by]?.displayName ?? `${folderArchive.by.slice(0, 8)}…`}
        withWhat={archivedWith ? kindNoun(Number(archivedWith.split(':')[0])) : undefined}
        onUnarchive={archivedWith || !canArchive ? undefined : () => void setFolderArchived(false)}
        onOpenParent={archivedWith ? () => navigate(filePath(archivedWith)) : undefined}
      />
    ) : undefined

  async function create(trimmed: string) {
    const result = await createFolder(trimmed)
    if (!result.ok) {
      showToast({ label: result.reason, type: 'error' })
      return false
    }
    /*
      Re-read before navigating. The relay emits the `kind:39000` this list
      reads as a side effect of accepting the create, so it exists by the time
      the publish returns — but the list in this component does not, and
      navigating first would land on a Folder the sidebar cannot show.
    */
    await reload()
    navigate(`/app/folders/${result.id}`)
    return true
  }

  /*
    The dialogs sit beside the shell, not inside a panel: a row is unmounted by
    the re-read that follows a successful write, and a dialog unmounted
    mid-flight takes its own "did this work" reporting with it. `AppShell` takes
    three panels and nothing else, and `DialogShell` portals itself, so where
    these sit in the tree does not affect where they draw.
  */
  return (
    <>
      <FoldersPageView
        banner={folderNotice}
        railClosed={railClosed}
        signedOut={signedOut}
        folders={topLevel}
        unread={teamUnread}
        member={teamMember}
        filter={filter}
        onFilterChange={setFilter}
        onNewFolder={() => setCreatingFolder(true)}
        onNewTopic={() => setStartingTopic({ choose: true })}
        currentFolder={id}
        onSelect={(file) => file.address && navigate(filePath(file.address, file.slots.title?.value))}
        onOpenFolder={(folder: string) => navigate(folderPath(folder))}
        rightPanel={
        id ? (
          <Panel
            /*
              The name is edited where it is shown — `EditableText`'s own
              "When", and the reason there is no rename dialog. `ContainerHeader`
              takes a node for its title since 2026-09-11, so this pane is
              headed by the same component as every other pane rather than by a
              row of its own: 48px tall, inset 20px, with the hairline under it.
              It had been `px-3 py-2` with no height and no rule, so its title
              sat eight pixels left of "Folders" in the column beside it and
              nothing separated it from the list (Katerina, 2026-09-11).
              Since estiva-ui 0.37.0 it is a Panel: the same header, and the
              listing under it scrolls in the Panel's own body.
            */
              title={
                topic ? (
                  /*
                    An old topic's name is not changed here — see `topic`
                    above. A string title wears the same `text-body-2-strong`
                    as the editable one below.
                  */
                  topic.title
                ) : !isFolder ? (
                  // Never the uuid, and never a name field on what is not a Folder.
                  notAFolder ? 'Not a folder' : ''
                ) : (
                <div className="-ml-2 min-w-0 text-body-2-strong">
                <EditableText
                  /*
                    A pane title is `text-body-2-strong` everywhere else in
                    Peek, and `EditableText` takes its size from where it sits (the box above, UIG-9) —
                    so with nothing passed the folder name rendered at the
                    base font, larger than every other header (Katerina,
                    2026-09-11). `-ml-2` cancels the component's own `px-2`
                    so the text starts on the header's 20px inset, while the
                    hover border keeps its padding.
                  */
                  value={selected?.name ?? ''}
                  placeholder={id}
                  label="Folder name"
                  onCommit={async (next) => {
                    const trimmed = next.trim()
                    if (!trimmed) return false
                    const result = await renameFolder(id, trimmed)
                    if (!result.ok) {
                      showToast({ label: result.reason, type: 'error' })
                      return false
                    }
                    await reload()
                    return true
                  }}
                />
                </div>
                )
              }
              actions={
                // One strip: one Tab stop, arrows along it (UIG-14). None on a
                // channel not known to be a Folder — see `isFolder`.
                (topic || isFolder) && (
                <Toolbar aria-label="Folder actions" surface={false}>
                  <ToolbarButton
                    tooltip="Start a topic"
                    aria-label="Start a topic in this folder"
                    onClick={() => setStartingTopic({})}
                  >
                    <IconMessagePlus size={16} stroke={1.5} />
                  </ToolbarButton>
                  {canArchive && !folderArchive && (
                    <ToolbarButton tooltip="Archive folder" aria-label="Archive folder" onClick={startArchive}>
                      <IconArchive size={16} stroke={1.5} />
                    </ToolbarButton>
                  )}
                  {topic ? (
                    /*
                      Not a delete: the channel holds an old topic's
                      conversation — see `topic` above. Where that
                      conversation went is the only thing offered.

                      A link that looks like the strip's buttons (UIG-14, F3):
                      a new tab works, and the arrow keys still reach it.
                    */
                    <ToolbarLink
                      tooltip="Open topic"
                      aria-label="Open this folder's topic"
                      href={channelDestination(topic.channel)}
                      onClick={(event) => followInApp(event, () => navigate(channelDestination(topic.channel)))}
                    >
                      <IconArrowUpRight size={16} stroke={1.5} />
                    </ToolbarLink>
                  ) : (
                    canDelete && (
                      <ToolbarButton
                        tooltip="Delete folder"
                        aria-label="Delete folder"
                        onClick={() => setConfirmingDelete(true)}
                      >
                        <IconTrash size={16} stroke={1.5} />
                      </ToolbarButton>
                    )
                  )}
                </Toolbar>
                )
              }
          >
              {notAFolder ? (
                <EmptyState message="This is not a folder." />
              ) : (
              <FolderContentsView
                state={state}
                /*
                  A row's conversation opens at the file's own address, not in a
                  pane beside this listing — `/topic/<address>`, FOL-19. The
                  pane that used to be here could only show a file the listing
                  held, so a Ship issue (its project's child, never a peer in
                  the Folder) had no way to open at all.
                */
                onSelect={(file) => file.address && navigate(filePath(file.address, file.slots.title?.value))}
                /*
                  Only from a Folder with state (FOL-10). Out of one without,
                  the `remove` would emit state listing nothing and hide the
                  rest of the Folder, so the planner refuses — and an action
                  that cannot succeed is not offered.
                */
                onMove={
                  typeof state === 'object' && 'hasState' in state && state.hasState
                    ? (file) => fileControls.open('move', file)
                    : undefined
                }
                onStartTopic={(file) => setStartingTopic({ parent: file })}
                counts={counts}
                unread={unread}
              />
              )}
          </Panel>
        ) : (
          <EmptyState message="Select a folder." />
        )
        }
      />
<>
          {creatingFolder && (
            <CreateFolderDialog onClose={() => setCreatingFolder(false)} onCreate={create} />
          )}
          {startingTopic && (id || startingTopic.choose) && (
            <StartTopicDialog
              folderName={selected?.name ?? id}
              /*
                Started from the column header there is no Folder in hand, so
                the dialog asks — the Folders the tree draws, which are the ones
                `topLevelFolders` selects, every one of which has folder state.
                Started from a row or the folder pane, the Folder is the open
                one and the dialog only names it.
              */
              folders={startingTopic.choose ? (topLevel ?? []) : undefined}
              defaultFolder={id}
              parent={startingTopic.parent}
              onClose={() => setStartingTopic(null)}
              onCreate={async (title, chosen) => {
                /*
                  Under a topic, in that topic's team (SPEC §6.7, FOL-4): a
                  sub-file is readable by exactly its parent's readers. The
                  open Folder is the same team in every ordinary case; a topic
                  placed here from another team is where the two differ.
                */
                const parent = startingTopic.parent
                const folder = (parent?.kind === KIND_BARE_FILE ? parent.folder : undefined) ?? chosen ?? id
                if (!folder) return false
                /*
                  `hasState` from a read, never guessed — the same argument as
                  the rename: a `kind:1852` against a Folder with no state
                  empties it on every surface. For the open Folder that is this
                  page's contents read; for one picked in the dialog it is the
                  summary `listFolders` already answered, which carries every
                  Folder's state and is what `topLevelFolders` filters on — so
                  a chosen Folder is `true` by construction and this reads it
                  rather than assuming it.
                */
                const hasState =
                  folder === id && typeof state === 'object' && 'hasState' in state
                    ? state.hasState
                    : (folders?.find((candidate) => candidate.id === folder)?.hasState ?? false)
                const result = await createTopic({
                  folder,
                  title,
                  parent: startingTopic.parent?.address,
                  hasState,
                })
                if (!result.ok) {
                  showToast({ label: result.reason, type: 'error' })
                  return false
                }
                /*
                  Into the topic when it was made from the header, because that
                  is the only report there is: the tree may not be showing the
                  Folder it went into, and under a filter it may not be showing
                  the row either. From a row or the folder pane the listing is
                  on screen and re-reading it is enough — the row appears where
                  the person was already looking.
                */
                if (startingTopic.choose) navigate(filePath(result.address, title))
                else await reloadContents()
                return true
              }}
            />
          )}
          {fileControls.dialogs}
          {archivingFolder && selected && (
            <ArchiveDialog
              title={selected.name ?? 'Untitled folder'}
              what="folder"
              hides={archivingFolder.hides}
              staysVisible={archivingFolder.staysVisible}
              onClose={() => setArchivingFolder(null)}
              onArchive={(resolution) => setFolderArchived(true, resolution || undefined)}
            />
          )}
          {confirmingDelete && id && (
            <ConfirmDialog
              title="Delete this folder?"
              confirmLabel="Delete"
              destructive
              onClose={() => setConfirmingDelete(false)}
              onConfirm={async () => {
                const result = await deleteFolder(id)
                if (!result.ok) {
                  showToast({ label: result.reason, type: 'error' })
                  return false
                }
                await reload()
                navigate('/app/folders')
                return true
              }}
            >
              {/*
                What a `kind:9008` does, and only that. It used to say "the
                files in it are not deleted", true of the relay's rows and false
                of what anyone could see (FOL-9). Delete is offered only on a
                Folder with nothing filed in it, so what goes is the Folder and
                its messages — and nothing in Peek brings them back.
              */}
              <p className="text-body-2 text-text-secondary">
                The folder and every message in it disappear for everyone. Nothing
                is filed in it. This can’t be undone.
              </p>
            </ConfirmDialog>
          )}
        </>
    </>
  )
}



/**
 * The Folders page's body, handed everything it draws — the half a story can
 * show (UIG-17). `FoldersPage` above reads, creates, renames and routes; this
 * one only draws, and takes the pane beside the list as a node.
 *
 * No third pane here any more. A file's conversation is a page of its own —
 * `/topic/<address>`, FOL-19 — because a pane on this page could only ever show
 * a file this listing holds, and the files people most want to open are the
 * ones it does not: a Ship issue is its project's child, resolved by address
 * rather than found among peers. The three panes moved wholesale to `FilePage`,
 * which is why this one lost its conversation rather than gaining a second way
 * in.
 */
export function FoldersPageView({
  railClosed,
  signedOut,
  folders,
  unread,
  member,
  filter,
  onFilterChange,
  onNewFolder,
  onNewTopic,
  currentFolder,
  onSelect,
  onOpenFolder,
  rightPanel,
  banner,
}: {
  /** An archived Folder's notice (FOL-46), at the top of the content area. */
  banner?: ReactNode
  railClosed: boolean
  /** Nobody is signed in. A different sentence from "still loading". */
  signedOut: boolean
  /** `null` while the first read is in flight, or when signed out. */
  folders: ComponentProps<typeof FolderTreeView>['folders']
  unread: ComponentProps<typeof FolderTreeView>['unread']
  member: ComponentProps<typeof FolderTreeView>['member']
  filter: TreeFilter
  onFilterChange: (next: TreeFilter) => void
  onNewFolder: () => void
  onNewTopic: () => void
  currentFolder?: string | null
  onSelect: ComponentProps<typeof FolderTreeView>['onSelect']
  onOpenFolder: ComponentProps<typeof FolderTreeView>['onOpenFolder']
  rightPanel?: ReactNode
}) {
  return (
    <AppShell
      banner={banner}
      leftPanel={
        <ListColumn
          title="Folders"
          collapsed={railClosed}
          /*
            Three actions in the header, and the create row is gone from above
            the list (Miky, FOL-41) — the Topics column's shape (`TopicsPage`),
            which is what this column replaces. One strip: one Tab stop, arrows
            along it (UIG-14). Absent when signed out, because all three of them
            act as somebody.
          */
          actions={
            !signedOut && (
              <Toolbar aria-label="Folder list actions" surface={false}>
                <ToolbarButton tooltip="New folder" aria-label="New folder" onClick={onNewFolder}>
                  <IconFolderPlus size={16} stroke={1.5} />
                </ToolbarButton>
                <ToolbarButton tooltip="New topic" aria-label="New topic" onClick={onNewTopic}>
                  <IconEdit size={16} stroke={1.5} />
                </ToolbarButton>
                <Menu
                  align="right"
                  trigger={
                    /*
                      Pressed while anything but `All` is chosen: the tree is
                      hiding Folders, and nothing else on screen says so — a
                      person who filters, navigates away and comes back would
                      otherwise read a short column as a small workspace.
                    */
                    <ToolbarButton tooltip="Filter" aria-label="Filter folders" pressed={filter !== 'all'}>
                      <IconFilter size={16} stroke={1.5} />
                    </ToolbarButton>
                  }
                >
                  {TREE_FILTERS.map((option) => (
                    <MenuItem
                      key={option.value}
                      label={option.label}
                      selected={filter === option.value}
                      onClick={() => onFilterChange(option.value)}
                    />
                  ))}
                </Menu>
              </Toolbar>
            )
          }
        >
          {/*
            The same tree the Topics column draws (FOL-21), so the two rail
            items navigate the same way: a Folder is a fold over its first
            level, the one open on the right starts open, and a row opens its
            file in three panes. The body rather than `FolderTree` because the
            page above already holds the Folder list — it re-reads it after a
            create, a rename and a delete.

            Three states, not two: "not signed in", "still loading" and "there
            are genuinely none" are different sentences, and the first version
            of this page told a signed-out viewer "No folders yet" about a
            workspace holding eighty-one of them.

            The list scrolls, and it is the package's bar (D40). It had none at
            all: `AppShell`'s list panel was `overflow-hidden`, so a workspace
            of eighty-one Folders simply had the ones past the fold clipped
            away, with nothing to scroll (Katerina, 2026-09-11). The package's
            `ListColumn` scrolls its rows itself now, with the insets every list
            column in Peek shares (UIG-14, N9).
          */}
          <FolderTreeView
            folders={folders}
            signedOut={signedOut}
            unread={unread}
            member={member}
            filter={filter}
            currentFolder={currentFolder}
            onSelect={onSelect}
            onOpenFolder={onOpenFolder}
          />
        </ListColumn>
      }
      rightPanel={rightPanel}
    />
  )
}
