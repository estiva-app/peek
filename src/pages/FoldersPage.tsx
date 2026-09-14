import { useState } from 'react'
import { IconArrowUpRight, IconMessagePlus, IconSend, IconTrash, IconX } from '@tabler/icons-react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ScrollArea } from '@estiva-app/ui'
import { AppShell } from '@/layouts/AppShell'
import { ContainerHeader } from '@/components/ContainerHeader'
import { PersonRow } from '@/components/ui/PersonRow'
import { EmptyState } from '@/components/ui/EmptyState'
import { SkeletonSidebarList } from '@/components/ui/Skeleton'
import { FolderContentsView, peersOf } from '@/components/views/FolderContentsView'
import { ForeignConversationView } from '@/components/views/ForeignConversationView'
import {
  useConversationBadges,
  useFolderContents,
  useFolders,
  useForeignConversation,
  useForeignObjects,
  useTeamUnread,
  useTopics,
  useWorkspaceDirectory,
} from '@/api'
import type { ForeignObject } from '@estiva-app/interop'
import { Button } from '@/components/ui/Button'
import { TextInput } from '@/components/ui/TextInput'
import { IconButton } from '@/components/ui/IconButton'
import { EditableText } from '@/components/ui/EditableText'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { MoveFileDialog } from '@/components/MoveFileDialog'
import { StartTopicDialog } from '@/components/StartTopicDialog'
import { useToast } from '@/lib/toast'
import { topicPath } from '@/lib/objectUrl'
import { useMarkFileRead } from '@/lib/useMarkRead'

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
  const { state, reload: reloadContents } = useFolderContents(id)
  const { createFolder, createTopic, renameFolder, deleteFolder, moveFile, applyAction } =
    useForeignObjects()
  const { showToast } = useToast()
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  /*
    Which file's conversation is open — RFC 0.5 §10.

    The file itself rather than its `ref`, because the panel needs the `naddr`
    to resolve by and the title to head the pane with, and the row already holds
    both. Looking them up again from `state` would also go stale the moment the
    contents re-read — and a row a parent's manifest fetched is not in `state`
    at all.

    The URL says *which* — `?file=<address>` (FOL-17). That is what makes a
    bare file openable from outside: Ship's card links to `/o/<naddr>`, which
    resolves to this Folder with the file named, and the listing supplies the
    object once it has loaded. A selection made here holds the row's own
    object under the same name, so a re-read cannot pull the pane out from
    under a conversation, and selecting or closing rewrites the URL so a
    reload lands where you were. Leaving the Folder drops the parameter, so
    the pane closes with it and nothing has to reset it.

    A named file the listing does not hold — one the reader cannot see, or a
    link to something since moved — opens nothing; the Folder is still the
    right place to be.
  */
  const [heldFile, setHeldFile] = useState<ForeignObject | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const namedFile = searchParams.get('file')
  const listed = typeof state === 'object' && 'files' in state ? state.files : undefined
  const openFile =
    heldFile && heldFile.ref === namedFile
      ? heldFile
      : namedFile
        ? (listed?.find((file) => file.ref === namedFile) ?? null)
        : null
  const setOpenFile = (file: ForeignObject | null) => {
    setHeldFile(file)
    setSearchParams(file ? { file: file.ref } : {}, { replace: true })
  }
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
  const { state: conversation, reload: reloadConversation } = useForeignConversation(openFile?.naddr)
  /*
    The open file's conversation counts as read after a dwell — and *only* that
    file's (SPEC §11.1–§11.2, FOL-16). The Folder's channel is not advanced by
    this page: the person is reading one file's talk, not the team's general
    chat, and a sibling file in the same Folder stays exactly as unread as it
    was. Judge it from the listing's dot or `window.__readState.marker(...)`,
    never by opening the sibling, which would read it.
  */
  useMarkFileRead(openFile?.address)
  /*
    The composer follows the manifest, not the kind. A bare file's built-in
    manifest declares `comment`; so does Ship's for a project and an issue.
    RFC 0.5 §10.7 says Peek is where you talk about any file, and peek#189 left
    this open pending exactly that decision — so the control appears wherever
    the owner says a comment may be written, and nowhere else.
  */
  const canComment =
    !!openFile?.naddr && (openFile.actions ?? []).some((action) => action.id === 'comment')
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
  const people = useWorkspaceDirectory()

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

  async function send(body: string): Promise<boolean> {
    if (!openFile?.naddr) return false
    const result = await applyAction({ naddr: openFile.naddr, actionId: 'comment', value: body })
    if (!result.ok) {
      showToast({ label: result.reason ?? 'The relay refused the comment.', type: 'neutral' })
      return false
    }
    // The relay has it; the pane re-reads rather than appending a copy, so
    // what is shown is what every other reader sees.
    await reloadConversation()
    return true
  }

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
                  /* `=== true`: an unjudged Folder draws no dot, not a dark one. */
                  isUnread={teamUnread[folder.id] === true}
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
                topic ? (
                  /*
                    A topic's name is the topic's to change: its rename writes
                    Convex and the relay together, and a rename here would move
                    only the relay's half. A string title wears the same
                    `text-body-2-strong` as the editable one below.
                  */
                  topic.title
                ) : (
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
                )
              }
              actions={
                <>
                  <IconButton
                    tooltip="Start a topic"
                    aria-label="Start a topic in this folder"
                    onClick={() => setStartingTopic({})}
                  >
                    <IconMessagePlus size={16} stroke={1.5} />
                  </IconButton>
                  {topic ? (
                    /*
                      Not a delete. Deleting a topic is the topic's own action,
                      which removes its rows and then its channel; a channel
                      delete from here would leave the topic standing in Peek
                      with its relay half gone. The way to that action is the
                      only thing offered.
                    */
                    <IconButton
                      tooltip="Open topic"
                      aria-label="Open this folder's topic"
                      onClick={() => navigate(topicPath(topic))}
                    >
                      <IconArrowUpRight size={16} stroke={1.5} />
                    </IconButton>
                  ) : (
                    <IconButton
                      tooltip="Delete folder"
                      aria-label="Delete folder"
                      onClick={() => setConfirmingDelete(true)}
                    >
                      <IconTrash size={16} stroke={1.5} />
                    </IconButton>
                  )}
                </>
              }
            />
            {/* The package's bar, not the browser's (D40). */}
            <ScrollArea className="min-h-0 flex-1">
              <FolderContentsView
                state={state}
                selectedRef={openFile?.ref}
                onSelect={setOpenFile}
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
            {canComment && (
              // Keyed on the file: a draft belongs to the conversation it was
              // typed in, and a new key is a new composer with an empty one.
              <CommentComposer
                key={openFile.ref}
                placeholder={`Comment on ${openFile.slots.title?.value ?? 'this file'}`}
                onSend={send}
              />
            )}
          </div>
        ) : undefined
      }
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
                  showToast({ label: result.reason, type: 'neutral' })
                  return false
                }
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

/**
 * The smallest composer that is honest: one line, Enter sends, and the draft
 * dies with the conversation it was typed in (the parent keys this on the
 * file). Not Peek's message composer — that one is `kind:9`-shaped, with
 * attachments and drafts that survive navigation (CON-10), and the shared
 * conversation package (CON-5) is where the two become one. Until then this
 * publishes exactly what the owner's manifest declared a comment to be.
 */
function CommentComposer({
  placeholder,
  onSend,
}: {
  placeholder: string
  onSend: (body: string) => Promise<boolean>
}) {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)

  async function send() {
    const body = draft.trim()
    if (!body || sending) return
    setSending(true)
    const ok = await onSend(body)
    setSending(false)
    if (ok) setDraft('')
  }

  return (
    <div className="flex items-center gap-2 border-t border-border-subtle px-3 py-2">
      <TextInput
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            void send()
          }
        }}
        placeholder={placeholder}
        aria-label="Comment"
        disabled={sending}
      />
      <IconButton tooltip="Send" aria-label="Send comment" disabled={!draft.trim() || sending} onClick={() => void send()}>
        <IconSend size={16} stroke={1.5} />
      </IconButton>
    </div>
  )
}
