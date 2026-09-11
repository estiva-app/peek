import { useEffect, useState } from 'react'
import { IconTrash, IconX } from '@tabler/icons-react'
import { useNavigate, useParams } from 'react-router-dom'
import { ScrollArea } from '@estiva-app/ui'
import { AppShell } from '@/layouts/AppShell'
import { ContainerHeader } from '@/components/ContainerHeader'
import { PersonRow } from '@/components/ui/PersonRow'
import { EmptyState } from '@/components/ui/EmptyState'
import { SkeletonSidebarList } from '@/components/ui/Skeleton'
import { FolderContentsView, peersOf } from '@/components/views/FolderContentsView'
import { ForeignConversationView } from '@/components/views/ForeignConversationView'
import {
  useConversationCounts,
  useFolderContents,
  useFolders,
  useForeignConversation,
  useForeignObjects,
  useWorkspaceDirectory,
} from '@/api'
import type { ForeignObject } from '@estiva-app/interop'
import { Button } from '@/components/ui/Button'
import { TextInput } from '@/components/ui/TextInput'
import { IconButton } from '@/components/ui/IconButton'
import { EditableText } from '@/components/ui/EditableText'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { MoveFileDialog } from '@/components/MoveFileDialog'
import { useToast } from '@/lib/toast'

/**
 * `/folders` and `/folders/:id` — navigation by Folder (RFC 0.4 §4).
 *
 * **Added beside the topic model, not on top of it.** Peek's topic routes,
 * `useTopicPath` and the whole `@/api` topic seam are untouched: a Folder is a
 * second way into the same relay, and RFC 0.4 §11.1 is explicit that turning
 * topics into files under Folders is a separate and much larger change. This
 * page reads Folders and draws what is in them; nothing about a topic moves.
 *
 * The left pane lists Folders by name; the right draws one Folder's contents,
 * whichever apps own them.
 */
export function FoldersPage() {
  const { folders, signedOut, reload } = useFolders()
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { state } = useFolderContents(id)
  const { createFolder, renameFolder, deleteFolder, moveFile } = useForeignObjects()
  const { showToast } = useToast()
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  /*
    Which file's conversation is open — RFC 0.5 §10.

    The file itself rather than its `ref`, because the panel needs the `naddr`
    to resolve by and the title to head the pane with, and the row already holds
    both. Looking them up again from `state` would also go stale the moment the
    contents re-read.
  */
  const [openFile, setOpenFile] = useState<ForeignObject | null>(null)
  /** The file whose destination is being chosen, if any. */
  const [movingFile, setMovingFile] = useState<ForeignObject | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const { state: conversation } = useForeignConversation(openFile?.naddr)
  /*
    One counts request for the whole listing, made here rather than inside the
    view so the view stays a pure render of what it is handed — and so a folder
    nobody has opened costs nothing.
  */
  const counts = useConversationCounts(
    // Peers only. A nested child gets its own count when its parent is
    // expanded, so counting it here is a request for a badge nothing draws.
    typeof state === 'object' && 'files' in state ? peersOf(state.files) : undefined,
  )
  const people = useWorkspaceDirectory()

  const selected = folders?.find((folder) => folder.id === id)

  /*
    Changing Folder closes the panel.

    Without this the previous Folder's file stays open beside the new Folder's
    contents — a conversation the list on screen does not contain, which reads
    as though it belongs to something here.
  */
  useEffect(() => setOpenFile(null), [id])

  async function create() {
    const trimmed = name.trim()
    if (!trimmed || creating) return
    setCreating(true)
    const result = await createFolder(trimmed)
    setCreating(false)
    if (!result.ok) {
      showToast({ label: result.reason, type: 'neutral' })
      return
    }
    setName('')
    /*
      Re-read before navigating. The relay emits the `kind:39000` this list
      reads as a side effect of accepting the create, so it exists by the time
      the publish returns — but the list in this component does not, and
      navigating first would land on a Folder the sidebar cannot show.
    */
    await reload()
    navigate(`/folders/${result.id}`)
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
    <AppShell
      leftPanel={
        <div className="flex h-full flex-col">
          <ContainerHeader title="Folders" />
          {!signedOut && (
            <div className="flex items-center gap-2 px-3 pt-3 pb-1">
              {/* min-w-0 + shrink-0: the column is 290px and the field has no
                  width of its own, so "Create" was pushed past the right edge
                  and clipped (Katerina, 2026-09-11). */}
              <TextInput
                className="min-w-0 flex-1"
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  // The one key handler here, and it is the package's input's
                  // own submit affordance rather than a hand-rolled shortcut.
                  if (event.key === 'Enter') void create()
                }}
                placeholder="New folder name"
                aria-label="New folder name"
              />
              <Button className="shrink-0" onClick={() => void create()} disabled={!name.trim() || creating}>
                {creating ? 'Creating…' : 'Create'}
              </Button>
            </div>
          )}
          {/*
            Three states, not two. "Not signed in", "still loading" and "there
            are genuinely none" are different sentences, and the first version
            of this page told a signed-out viewer "No folders yet" about a
            workspace holding eighty-one of them.
          */}
          {/*
            The list scrolls, and it is the package's bar (D40). It had none at
            all: `AppShell`'s list panel is `overflow-hidden`, so a workspace of
            eighty-one Folders simply had the ones past the fold clipped away,
            with nothing to scroll (Katerina, 2026-09-11). Step 6 could not have
            caught it — that sweep converted regions that already had a native
            bar, and a column that should scroll and never did has none to find.

            `contentClassName` is the same one every other list column in Peek
            passes (`PeoplePage`, `TopicsPage`, `DeskPage`), which is also what
            gives the rows their 12px inset: they were flush against the panel
            edge while the header above them sat at 20px.

            The list column of a two-column page, so its empties are sections
            (D51): the line alone, left, no icon. Loading is a skeleton, not a
            sentence (§4.7).
          */}
          <ScrollArea className="flex-1" contentClassName="pt-4 pb-3 px-3 flex flex-col gap-0.5">
            {signedOut ? (
              <EmptyState scope="section" message="Sign in to see folders." />
            ) : folders === null ? (
              <SkeletonSidebarList />
            ) : folders.length === 0 ? (
              <EmptyState scope="section" message="No folders yet." />
            ) : (
              folders.map((folder) => (
                <PersonRow
                  key={folder.id}
                  /*
                    The id when there is no name. A Folder with no state event
                    has only its channel's name, and a channel created by an app
                    rather than a person may carry none — so this is the ordinary
                    case on today's data, not a defensive branch.
                  */
                  name={folder.name ?? folder.id}
                  /* A Folder, so a folder's glyph. Without a type this fell
                     through to `topic` and drew the dashed circle that means
                     "an unresolved topic" on every row. */
                  type="folder"
                  isSelected={folder.id === id}
                  onClick={() => navigate(`/folders/${folder.id}`)}
                />
              ))
            )}
          </ScrollArea>
        </div>
      }
      rightPanel={
        id ? (
          <div className="flex h-full flex-col">
            {/*
              The name is edited where it is shown — `EditableText`'s own
              "When", and the reason there is no rename dialog. `ContainerHeader`
              takes a node for its title since 2026-09-11, so this pane is
              headed by the same component as every other pane rather than by a
              row of its own: 48px tall, inset 20px, with the hairline under it.
              It had been `px-3 py-2` with no height and no rule, so its title
              sat eight pixels left of "Folders" in the column beside it and
              nothing separated it from the list (Katerina, 2026-09-11).
            */}
            <ContainerHeader
              title={
                <div className="-ml-2 min-w-0">
                <EditableText
                  /*
                    A pane title is `text-body-2-strong` everywhere else in
                    Peek, and `EditableText` takes its size from the caller —
                    so with nothing passed the folder name rendered at the
                    base font, larger than every other header (Katerina,
                    2026-09-11). `-ml-2` cancels the component's own `px-2`
                    so the text starts on the header's 20px inset, while the
                    hover border keeps its padding.
                  */
                  className="text-body-2-strong"
                  value={selected?.name ?? ''}
                  placeholder={id}
                  label="Folder name"
                  onCommit={async (next) => {
                    const trimmed = next.trim()
                    if (!trimmed) return false
                    /*
                      `hasState` is passed, never guessed. A `kind:1852` name
                      change on a Folder with no state emits state listing
                      nothing, and a Folder read by containment would lose every
                      file on screen. The read that is already on this page is
                      the only honest source for it.
                    */
                    const hasState = typeof state === 'object' && 'hasState' in state && state.hasState
                    const result = await renameFolder(id, trimmed, hasState)
                    if (!result.ok) {
                      showToast({ label: result.reason, type: 'neutral' })
                      return false
                    }
                    await reload()
                    return true
                  }}
                />
                </div>
              }
              actions={
                <IconButton
                  tooltip="Delete folder"
                  aria-label="Delete folder"
                  onClick={() => setConfirmingDelete(true)}
                >
                  <IconTrash size={16} stroke={1.5} />
                </IconButton>
              }
            />
            {/* The package's bar, not the browser's (D40). */}
            <ScrollArea className="min-h-0 flex-1">
              <FolderContentsView
                state={state}
                selectedRef={openFile?.ref}
                onSelect={setOpenFile}
                onMove={setMovingFile}
                counts={counts}
              />
            </ScrollArea>
          </div>
        ) : (
          <EmptyState message="Select a folder." />
        )
      }
      /*
        The conversation goes in the thread pane, which is where a conversation
        lives everywhere else in Peek — the same pane a topic's thread opens in.
        That is the point being demonstrated rather than a layout convenience: a
        Ship project's discussion is not a special panel bolted to a folder
        view, it is Peek's ordinary conversation surface pointed at a file
        another app owns.
      */
      threadPanel={
        openFile ? (
          <div className="flex h-full flex-col">
            {/*
              The same header as every other pane. This used to be a hand-made
              row, on the reasoning that `ThreadPanel` heads itself so this pane
              should too — but `ThreadPanel`'s own header is `h-12 pl-5 pr-4
              border-b`, which is `ContainerHeader`'s geometry exactly. The row
              here was `px-3 py-2`, so it matched neither (Katerina,
              2026-09-11). `actions` carries the close.
            */}
            <ContainerHeader
              title={
                <div className="min-w-0">
                  <p className="truncate text-body-2-strong text-text-primary">
                    {openFile.slots.title?.value ?? 'Conversation'}
                  </p>
                {/*
                  Whose file this is, said plainly. The panel draws another app's
                  conversation in Peek's own language, which is the point and is
                  also exactly what could mislead: without this the discussion
                  reads as something in Peek.
                */}
                  {openFile.appName && (
                    <p className="truncate text-caption text-text-muted">In {openFile.appName}</p>
                  )}
                </div>
              }
              actions={
                <IconButton
                  tooltip="Close"
                  aria-label="Close conversation"
                  onClick={() => setOpenFile(null)}
                >
                  <IconX size={16} stroke={1.5} />
                </IconButton>
              }
            />
            {/* The package's bar, not the browser's (D40). This pane
                arrived with #192, after the adoption had swept the rest. */}
<ScrollArea className="min-h-0 flex-1">
              <ForeignConversationView state={conversation} people={people} />
            </ScrollArea>
          </div>
        ) : undefined
      }
    />
<>
          {movingFile && (
            <MoveFileDialog
              file={movingFile}
              from={id ?? ''}
              folders={folders ?? []}
              onClose={() => setMovingFile(null)}
              onMove={async (to) => {
                const address = movingFile.address
                if (!address || !id) return false
                const result = await moveFile(address, id, to)
                if (!result.ok) {
                  showToast({ label: result.reason, type: 'neutral' })
                  return false
                }
                // The file left this Folder, so this Folder's read is stale.
                await reload()
                return true
              }}
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
                  showToast({ label: result.reason, type: 'neutral' })
                  return false
                }
                await reload()
                navigate('/folders')
                return true
              }}
            >
              {/*
                Said explicitly, because a folder full of other apps' work looks
                like it owns that work and does not. RFC 0.4 §2: a Folder is an
                association, so deleting it unfiles its contents and destroys
                none of them.
              */}
              <p className="text-body-2 text-text-secondary">
                The files in it are not deleted — they stay in their own apps and
                simply stop being filed here. Everyone loses the folder.
              </p>
            </ConfirmDialog>
          )}
        </>
    </>
  )
}
