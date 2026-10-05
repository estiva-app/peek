import { useEffect, useState, type ReactNode } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useLastSelection } from '@/lib/lastSelection'
import { IconTrash } from '@tabler/icons-react'
import { Panel, Toolbar, ToolbarButton } from '@estiva-app/ui'
import { AppShell } from '@/layouts/AppShell'
import { EmptyState } from '@/components/ui/EmptyState'
import { FolderTree } from '@/components/views/FolderTree'
import type { ForeignObject } from '@estiva-app/interop'
import { FileTreeView } from '@/components/views/FileTreeView'
import { rememberFileAddress, reloadFoldersOnScreen, useCurrentUser, useFolderContents, useFolders, useForeignObjects, useWorkspaceDirectory } from '@/api'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { ArchivedNotice } from '@/components/ArchivedNotice'
import { kindNoun } from '@/lib/archiveWords'
import { useFileControls } from '@/components/views/useFileControls'
import { useToast } from '@/lib/toast'
import { filePath } from '@/lib/objectUrl'
import { channelDestination, legacyTopicByChannel } from '@/lib/legacyTopicLinks'

/**
 * `/app/folders` and `/app/folders/:id` — the Topics column, with no file open.
 *
 * It was the Folders page: the Folders on the left and one Folder's contents
 * on the right, as cards with buttons beside them. That went on 5 October
 * (Katerina, direction A of her proposal): the column is one place, its title
 * switches between Topics (what you are a member of) and Folders (every
 * Folder), and a Folder is managed from its heading's ⋮ — Start a topic,
 * Rename, Archive… (`useFolderActions`). A file opens on the file page, as it
 * already did; this route is the column with nothing open beside it.
 *
 * A Folder's own link still lands here — notifications, other apps, old
 * bookmarks — and opens the column on Folders with that Folder open. What the
 * route still decides for itself: a DM's channel opens the DM (PEE-36), an old
 * topic's channel opens its file, and an archived Folder shows its notice
 * (FOL-46), where its owners and admins can unarchive it.
 */
export function FoldersPage() {
  const { folders, failed: foldersFailed, reload } = useFolders()
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  /*
    Where Topics is, for the rail to come back to (Katerina, 5 October): here,
    with no file open. A file closed on the way here is not brought back.
  */
  const location = useLocation()
  const { setLastTopicsPath } = useLastSelection()
  useEffect(() => {
    setLastTopicsPath(`${location.pathname}${location.search}`)
  }, [location.pathname, location.search, setLastTopicsPath])
  const { archiveFolder, dmForChannel, folderDeletable, deleteFolder, resolveFolderProject } = useForeignObjects()
  const { showToast } = useToast()
  const people = useWorkspaceDirectory()
  const me = useCurrentUser()?.id
  /*
    A row's menu, the file page's own (FOL-45): the same dialogs from either
    page, and the column re-read after each, since the rows are the only place
    the change shows here. A new topic opens, as the header's New topic does.
  */
  const refreshRows = () => void reloadFoldersOnScreen()
  const fileControls = useFileControls({
    onRenamed: refreshRows,
    onArchived: refreshRows,
    onDeleted: refreshRows,
    onMoved: () => void Promise.all([reload(), reloadFoldersOnScreen()]),
    onStarted: (created) => navigate(filePath(created.address, created.title)),
  })

  // A row of a no-state Folder's list opens its file, as the column's rows do.
  const openRow = (file: ForeignObject) => {
    if (!file.address) return
    rememberFileAddress(file.address)
    navigate(filePath(file.address, file.slots.title?.value))
  }

  /*
    A channel that was one of Peek's old topics holds that topic's
    conversation, and a file carries it now (FOL-23, FOL-25): its link leads
    there, as the Folders page's "Open topic" did.
  */
  const topic = id ? legacyTopicByChannel(id) : undefined
  useEffect(() => {
    if (topic && channelDestination(topic.channel) !== `/app/folders/${id}`) navigate(channelDestination(topic.channel), { replace: true })
  }, [topic, id, navigate])

  /*
    A DM's channel is not a Folder (PEE-36): the viewer's own DM opens as the
    DM. Any other answer — a group DM, a channel the viewer cannot see — is
    said as "not a folder" once it is known, never guessed.
  */
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
        // Unanswered is not "not a folder": the column stays as it is.
      })
    return () => {
      cancelled = true
    }
  }, [id, topic, dmForChannel, navigate])

  const selected = folders?.find((folder) => folder.id === id)
  // "Not a DM" is not "a Folder" (PEE-42): a Folder is one the relay lists to this viewer.
  const isFolder = dmCheck != null && dmCheck.id === id && dmCheck.isFolder && !!selected
  // Said only on an answer: a listing that failed is empty without meaning it.
  const notAFolder =
    !!id &&
    !topic &&
    ((dmCheck != null && dmCheck.id === id && !dmCheck.isFolder) || (folders != null && !foldersFailed && !selected))

  /*
    A channel with no folder state is in no list — the tree draws Folders with
    state — so its link is the one place it can be seen, and deleted (FOL-9).
    Delete only where it loses nothing but the Folder: a `kind:9008` hides
    everything carrying the Folder's `h`, Ship issues included, so the relay
    is asked first (`folderDeletable`), again when what the channel holds
    changes, and unanswered is a no. A Folder with state is never asked.
  */
  const stateless = isFolder && selected?.hasState === false

  /*
    A Ship project's channel is a Folder with no state, listed in its team:
    its link opens the project itself (Katerina, 5 October) — selected under
    its Folder in the column, with its issues open under it — rather than a
    list of what the channel holds. Asked once per link; a channel with no
    project, or a read that fails, keeps the list below.
  */
  const [projectCheck, setProjectCheck] = useState<{ id: string; found: boolean } | null>(null)
  useEffect(() => {
    if (!id || !stateless || !selected?.listedIn?.length) return
    let cancelled = false
    resolveFolderProject(id)
      .then((found) => {
        if (cancelled) return
        const project = found?.project
        if (project?.address) {
          navigate(filePath(project.address, project.slots.title?.value), { replace: true, state: { expandSelected: true } })
        } else setProjectCheck({ id, found: false })
      })
      .catch(() => {
        if (!cancelled) setProjectCheck({ id, found: false })
      })
    return () => {
      cancelled = true
    }
  }, [id, stateless, selected?.listedIn?.length, resolveFolderProject, navigate])
  // Still asking which project this is: nothing drawn yet, so the list does not flash before the project opens.
  const findingProject = stateless && !!selected?.listedIn?.length && !(projectCheck?.id === id)

  const { state } = useFolderContents(stateless ? id : null)
  const contentsCount = typeof state === 'object' && 'files' in state ? state.files.length : undefined
  const [deleteCheck, setDeleteCheck] = useState<{ id: string; count?: number; ok: boolean } | null>(null)
  useEffect(() => {
    if (!id || !stateless) return
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
  }, [id, stateless, contentsCount, folderDeletable])
  const canDelete = stateless && deleteCheck != null && deleteCheck.id === id && deleteCheck.count === contentsCount && deleteCheck.ok
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  /*
    An archived Folder leaves the tree; its link still opens here, under its
    notice (FOL-46). Everyone reads that it is archived; only its owners and
    admins are offered Unarchive — every reader ignores it from anybody else.
  */
  const folderArchive = selected?.archived
  const canUnarchive = isFolder && !!selected?.channel && !!me && !!selected?.admins?.includes(me)
  async function unarchive(): Promise<boolean> {
    if (!id || !selected?.channel) return false
    const result = await archiveFolder({ folder: id, channel: selected.channel, archived: false }).catch((error: unknown) => ({
      ok: false as const,
      reason: `Nothing was unarchived: ${(error as Error)?.message ?? 'the write failed'}. Try again.`,
    }))
    if (!result.ok) {
      showToast({ label: result.reason, type: 'error' })
      return false
    }
    await reload()
    return true
  }
  const archivedWith = folderArchive?.with
  const folderNotice =
    folderArchive && isFolder && selected?.channel ? (
      <ArchivedNotice
        archive={folderArchive}
        by={people?.[folderArchive.by]?.displayName ?? `${folderArchive.by.slice(0, 8)}…`}
        withWhat={archivedWith ? kindNoun(Number(archivedWith.split(':')[0])) : undefined}
        onUnarchive={archivedWith || !canUnarchive ? undefined : () => void unarchive()}
        onOpenParent={archivedWith ? () => navigate(filePath(archivedWith)) : undefined}
      />
    ) : undefined

  return (
    <>
      <FoldersPageView
        banner={folderNotice}
        nav={<FolderTree currentFolder={id} showFolder={!!id} onControl={fileControls.open} />}
        rightPanel={
          findingProject ? (
            <EmptyState message="Opening…" />
          ) : stateless && selected ? (
            <Panel
              title={selected.name ?? 'Untitled folder'}
              actions={
                canDelete && (
                  <Toolbar aria-label="Folder actions" surface={false}>
                    <ToolbarButton tooltip="Delete folder" aria-label="Delete folder" onClick={() => setConfirmingDelete(true)}>
                      <IconTrash size={16} stroke={1.5} />
                    </ToolbarButton>
                  </Toolbar>
                )
              }
            >
              {/*
                What the channel holds, as the column's rows (5 October): a
                Folder with no state is in no list, so its link is the one
                place it is seen. It used to say only that.
              */}
              <div className="px-2 py-2">
                <FileTreeView state={state} onSelect={openRow} onControl={fileControls.open} />
              </div>
            </Panel>
          ) : (
            <EmptyState message={notAFolder ? 'This is not a folder.' : 'No file selected'} />
          )
        }
      />
      {fileControls.dialogs}
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
          {/* What a `kind:9008` does, and only that (FOL-9): Delete is offered only on a Folder with nothing filed in it. */}
          <p className="text-body-2 text-text-secondary">
            The folder and every message in it disappear for everyone. Nothing is filed in it. This can’t be undone.
          </p>
        </ConfirmDialog>
      )}
    </>
  )
}

/**
 * The route's body, handed what it draws — the half a story can show
 * (UIG-17): the column, and the side where a file would open.
 */
export function FoldersPageView({
  banner,
  nav,
  rightPanel,
}: {
  /** An archived Folder's notice (FOL-46), at the top of the content area. */
  banner?: ReactNode
  /** The column: the page hands over its wired `FolderTree`; a story, `FolderColumn` with a fixture. */
  nav: ReactNode
  rightPanel?: ReactNode
}) {
  return <AppShell banner={banner} leftPanel={nav} rightPanel={rightPanel} />
}
