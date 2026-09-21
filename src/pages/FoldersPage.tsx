import { useMemo, useState } from 'react'
import { IconArrowUpRight, IconBell, IconBellFilled, IconMessagePlus, IconTrash } from '@tabler/icons-react'
import { useNavigate, useParams } from 'react-router-dom'
import { ContainerHeader, Form, ListColumn, ScrollArea, Toolbar, ToolbarButton, ToolbarLink } from '@estiva-app/ui'
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
  useFollows,
  useForeignObjects,
  useTeamUnread,
  useTopics,
} from '@/api'
import type { ForeignObject } from '@estiva-app/interop'
import { Button } from '@/components/ui/Button'
import { TextInput } from '@/components/ui/TextInput'
import { EditableText } from '@/components/ui/EditableText'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { MoveFileDialog } from '@/components/MoveFileDialog'
import { StartTopicDialog } from '@/components/StartTopicDialog'
import { useToast } from '@/lib/toast'
import { filePath, topicPath } from '@/lib/objectUrl'
import { followInApp } from '@/lib/followInApp'
import { useFolderPath } from '@/lib/useFolderPath'

/**
 * `/app/folders` and `/app/folders/:id` — navigation by Folder (RFC 0.4 §4).
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
  const railClosed = useRailClosed()
  const { folders, signedOut, reload } = useFolders()
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { state, reload: reloadContents } = useFolderContents(id)
  const { createFolder, createTopic, renameFolder, deleteFolder, moveFile } = useForeignObjects()
  const { showToast } = useToast()
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  /** The file whose destination is being chosen, if any. */
  const [movingFile, setMovingFile] = useState<ForeignObject | null>(null)
  /*
    A topic being started — SPEC §6.7. `parent` is the file it will sit under
    when it was started from a row; `undefined` from the folder header means a
    topic at the top of the Folder. Two different sentences in the dialog and
    one different tag on the wire.
  */
  const [startingTopic, setStartingTopic] = useState<{ parent?: ForeignObject } | null>(null)
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
  const { unread: teamUnread } = useTeamUnread(folders)
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
    The Folder that is one of this Peek's topics.

    A topic's channel *is* its Folder (`Topic.folderId`), so every topic is in
    the list on the left beside the Folders people made on purpose — and the
    relay cannot tell them apart. Renaming or deleting it here reaches only the
    relay: the Convex twin keeps the old name, or keeps the whole topic, which
    then looks alive in Peek while every publish into it is refused and none
    of its messages can be read by pointer. Fourteen topics were lost that way
    in the two days after the delete shipped, and the dialog had promised that
    nothing in the folder would be. So a topic's Folder is managed from the
    topic, where the rename and the delete do both halves.
  */
  const topics = useTopics()
  const topic = topics?.find((t) => t.folderId === id)

  /*
    Follow / unfollow the Folder itself (FOL-30): that is its general stream —
    the messages in it that name no file — and it lights the Folder's dot on
    its own, as a followed file in it does. Same control as the file page's,
    keyed by the Folder's uuid, and absent until the relay has said what is
    followed.
  */
  const follows = useFollows()
  const followed = id ? follows.isFollowed(id) : false
  const toggleFollow = id && follows.state !== 'unknown' ? () => void follows.setFollowed(id, !followed) : undefined

  async function create() {
    const trimmed = name.trim()
    if (!trimmed || creating) return
    setCreating(true)
    const result = await createFolder(trimmed)
    setCreating(false)
    if (!result.ok) {
      showToast({ label: result.reason, type: 'error' })
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
    navigate(`/app/folders/${result.id}`)
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
        <ListColumn
          title="Folders"
          collapsed={railClosed}
          above={
            !signedOut && (
              // The package Form (UIG-7): Enter or Create makes the folder; the row locks while it does.
              <Form busy={creating} onSubmit={create} className="flex items-center gap-2 px-3 pt-3 pb-1">
                {/* min-w-0 + shrink-0: the column is 290px and the field has no
                    width of its own, so "Create" was pushed past the right edge
                    and clipped (Katerina, 2026-09-11). */}
                <TextInput
                  className="min-w-0 flex-1"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="New folder name"
                  aria-label="New folder name"
                />
                <Button className="shrink-0" type="submit" disabled={!name.trim() || creating}>
                  {creating ? 'Creating…' : 'Create'}
                </Button>
              </Form>
            )
          }
        >
          {/*
            Three states, not two. "Not signed in", "still loading" and "there
            are genuinely none" are different sentences, and the first version
            of this page told a signed-out viewer "No folders yet" about a
            workspace holding eighty-one of them.
          */}
          {/*
            The list scrolls, and it is the package's bar (D40). It had none at
            all: `AppShell`'s list panel was `overflow-hidden`, so a workspace
            of eighty-one Folders simply had the ones past the fold clipped
            away, with nothing to scroll (Katerina, 2026-09-11). Step 6 could
            not have caught it — that sweep converted regions that already had
            a native bar, and a column that should scroll and never did has
            none to find. The package's `ListColumn` scrolls its rows itself
            now, with the insets every list column in Peek shares (UIG-14, N9).

            The list column of a two-column page, so its empties are sections
            (D51): the line alone, left, no icon. Loading is a skeleton, not a
            sentence (§4.7).
          */}
          {/*
            The same tree the Topics column draws (FOL-21), so the two rail
            items navigate the same way: a Folder is a fold over its first
            level, the one open on the right starts open, and a row opens its
            file in three panes. The body rather than `FolderTree` because this
            page already holds the Folder list — it re-reads it after a
            create, a rename and a delete — and the create form sits between
            the header and the list.
          */}
          <FolderTreeView
            folders={topLevel}
            signedOut={signedOut}
            unread={teamUnread}
            currentFolder={id}
            onSelect={(file) => file.address && navigate(filePath(file.address, file.slots.title?.value))}
            onOpenFolder={(folder) => navigate(folderPath(folder))}
          />
        </ListColumn>
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
                topic ? (
                  /*
                    A topic's name is the topic's to change: its rename writes
                    Convex and the relay together, and a rename here would move
                    only the relay's half. A string title wears the same
                    `text-body-2-strong` as the editable one below.
                  */
                  topic.title
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
                // One strip: one Tab stop, arrows along it (UIG-14).
                <Toolbar aria-label="Folder actions" surface={false}>
                  <ToolbarButton
                    tooltip="Start a topic"
                    aria-label="Start a topic in this folder"
                    onClick={() => setStartingTopic({})}
                  >
                    <IconMessagePlus size={16} stroke={1.5} />
                  </ToolbarButton>
                  {toggleFollow && (
                    <ToolbarButton
                      tooltip={followed ? 'Unfollow' : 'Follow'}
                      aria-label={followed ? 'Unfollow this folder' : 'Follow this folder'}
                      pressed={followed}
                      onClick={toggleFollow}
                    >
                      {followed ? <IconBellFilled size={16} stroke={1.5} /> : <IconBell size={16} stroke={1.5} />}
                    </ToolbarButton>
                  )}
                  {topic ? (
                    /*
                      Not a delete. Deleting a topic is the topic's own action,
                      which removes its rows and then its channel; a channel
                      delete from here would leave the topic standing in Peek
                      with its relay half gone. The way to that action is the
                      only thing offered.

                      A link that looks like the strip's buttons (UIG-14, F3):
                      a new tab works, and the arrow keys still reach it.
                    */
                    <ToolbarLink
                      tooltip="Open topic"
                      aria-label="Open this folder's topic"
                      href={topicPath(topic)}
                      onClick={(event) => followInApp(event, () => navigate(topicPath(topic)))}
                    >
                      <IconArrowUpRight size={16} stroke={1.5} />
                    </ToolbarLink>
                  ) : (
                    <ToolbarButton
                      tooltip="Delete folder"
                      aria-label="Delete folder"
                      onClick={() => setConfirmingDelete(true)}
                    >
                      <IconTrash size={16} stroke={1.5} />
                    </ToolbarButton>
                  )}
                </Toolbar>
              }
            />
            {/* The package's bar, not the browser's (D40). */}
            <ScrollArea className="min-h-0 flex-1">
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
                onMove={setMovingFile}
                onStartTopic={(file) => setStartingTopic({ parent: file })}
                counts={counts}
                unread={unread}
              />
            </ScrollArea>
          </div>
        ) : (
          <EmptyState message="Select a folder." />
        )
      }
      /*
        No third pane here any more. A file's conversation is a page of its own
        — `/topic/<address>`, FOL-19 — because a pane on this page could only
        ever show a file this listing holds, and the files people most want to
        open are the ones it does not: a Ship issue is its project's child,
        resolved by address rather than found among peers. The three panes moved
        wholesale to `FilePage`, which is why this one lost its conversation
        rather than gaining a second way in.
      */
    />
<>
          {startingTopic && id && (
            <StartTopicDialog
              folderName={selected?.name ?? id}
              parent={startingTopic.parent}
              onClose={() => setStartingTopic(null)}
              onCreate={async (title) => {
                /*
                  `hasState` from the read on this page, never guessed — the
                  same argument as the rename: a `kind:1852` against a Folder
                  with no state empties it on every surface.
                */
                const hasState = typeof state === 'object' && 'hasState' in state && state.hasState
                const result = await createTopic({
                  folder: id,
                  title,
                  parent: startingTopic.parent?.address,
                  hasState,
                })
                if (!result.ok) {
                  showToast({ label: result.reason, type: 'error' })
                  return false
                }
                // You follow what you create (FOL-30). Not awaited: the topic
                // exists whether or not the follow lands, and its own toggle
                // is the recovery.
                void follows.setFollowed(result.address, true)
                await reloadContents()
                return true
              }}
            />
          )}
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
                  showToast({ label: result.reason, type: 'error' })
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
                  showToast({ label: result.reason, type: 'error' })
                  return false
                }
                await reload()
                navigate('/app/folders')
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

