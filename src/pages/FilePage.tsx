import { useCallback, useEffect } from 'react'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { IconArrowUpRight, IconDotsVertical, IconX } from '@tabler/icons-react'
import { ContainerHeader, ScrollArea, Toolbar, ToolbarButton, ToolbarLink } from '@estiva-app/ui'
import { AppShell } from '@/layouts/AppShell'
import { EmptyState } from '@/components/ui/EmptyState'
import { IconButton } from '@/components/ui/IconButton'
import { TopicMoreMenu } from '@/components/ui/TopicMoreMenu'
import { FolderTree } from '@/components/views/FolderTree'
import { ForeignConversationView } from '@/components/views/ForeignConversationView'
import { FileThreadView } from '@/components/views/FileThreadView'
import { useFileControls } from '@/components/views/useFileControls'
import { useFileConversationView } from '@/components/views/useFileConversationView'
import { useFileThreads, useForeignConversation, useWorkspaceDirectory } from '@/api'
import { fileControlsOf, hasFileControls } from '@/lib/fileControls'
import { addressFromRef } from '@/lib/objectUrl'
import { followInApp } from '@/lib/followInApp'
import { useLastSelection } from '@/lib/lastSelection'
import { scrollToMessageWhenReady } from '@/lib/messageAnchor'
import { rememberRecent } from '@/lib/recents'
import { useMarkFileRead } from '@/lib/useMarkRead'
import { KIND_TOPIC } from '@/nostr/foreign'

/**
 * `/topic/<address>` — one file, in three panes (FOL-19).
 *
 * **One page shape for every file, Peek's or anybody's.** RFC 0.5 §10.7 says
 * Peek is where a file's conversation is read; this is the page that claim
 * needs. A Ship issue, a Ship project, a Peek bare file and a record from an
 * app nobody has written open here identically — navigation on the left, the
 * conversation in the middle, one thread on the right — because the address is
 * the whole of what the route carries and everything else comes off the owner's
 * manifest at runtime. Nothing in this file knows what Ship is, and a kind
 * number here would turn the page into an integration.
 *
 * ## Why it replaced a pane on the Folder page
 *
 * FOL-17 opened a file as `?file=<address>` beside its Folder's listing, which
 * meant the file had to *be in that listing*: a child resolved against its
 * peers. A Ship issue is not a peer of anything — it is its project's child,
 * fetched from the project's manifest when somebody expands the row — so a
 * pasted link to one opened the Folder and nothing else. That gap is the ticket.
 * Here the address is resolved on its own, and the listing is navigation rather
 * than the source of truth: the Folder comes off the resolved file (`h`), the
 * parent off `parentRef`, and the left pane opens to where the file is.
 *
 * ## Two grammars, one route
 *
 * `/topic/<slug>-<uuid>` is still Peek's own topic and still `TopicsPage`;
 * `/topic/<address>` is any file. `addressFromRef` tells them apart without
 * fetching anything — an address carries two colons and a slug carries none —
 * so every link already in the wild keeps working, which is the reason the
 * prefix was not changed.
 *
 * ## Reading marks the file, and nothing else
 *
 * SPEC §11.1–§11.2 and FOL-16: the dwell advances `fileContext(address)` only.
 * A topic page advances its container, and this page must not, because the
 * person is reading one file's talk and not the team's general chat — a sibling
 * in the same Folder stays exactly as unread as it was. Verified against Ship's
 * issue page, which marks only the issue.
 */
export function FilePage() {
  const { ref } = useParams<{ ref: string }>()
  const address = ref ? addressFromRef(ref) : null
  /*
    A topic is not a file page. A `39000:` address resolves — it is a real
    addressable event — but its conversation is `kind:9` messages carrying `h`
    and no `a`, so this page would draw it as a file nobody has said anything
    about. `/topic/<uuid>` is where a topic is read, and `TopicsPage`
    canonicalises the URL once it knows the title. Decided before the read, so
    the redirect costs no round trip.
  */
  const topicIdentifier = address?.startsWith(`${KIND_TOPIC}:`) ? address.split(':')[2] : null
  const fileAddress = topicIdentifier ? null : address
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const people = useWorkspaceDirectory()

  /*
    The address is the reference. `resolveObject` takes an naddr, an nevent or a
    bare address — `referenceToPointer`'s tolerance, which exists so a widget
    rendered from an `a` tag is actionable and not merely visible — so nothing
    has to be encoded to bech32 on the way in.
  */
  const { state: conversation, reload: reloadConversation } = useForeignConversation(fileAddress)
  const file = typeof conversation === 'object' && 'ref' in conversation ? conversation : null

  /*
    The dwell marks this file's own stream and no container (FOL-16). Passing
    `file?.address` rather than the address from the URL is deliberate: an
    address that resolved to nothing was never read, and marking it would clear
    a dot for a file the person never saw.
  */
  useMarkFileRead(file?.address)

  /*
    The launcher's Recent (UIG-29), which only `TopicsPage` fed until FOL-36 —
    so a topic started since #194, which is a bare file and opens here, was
    never recent. Written once the file has resolved, with the title the
    header shows, since a file has no live list the launcher could read a
    title from (`lib/recents`).
  */
  const resolvedAddress = file?.address
  const fileTitle = file?.slots.title?.value
  useEffect(() => {
    if (resolvedAddress && fileTitle) rememberRecent({ kind: 'file', id: resolvedAddress, title: fileTitle })
  }, [resolvedAddress, fileTitle])

  /*
    Which thread is open, in the URL rather than in state, so a thread is a
    link — the same argument `?file=` was given and the same one §7 makes about
    a topic: a conversation somebody can point at is worth more than one that
    only exists in this tab.
  */
  const openThreadId = searchParams.get('thread') ?? undefined
  const setOpenThread = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(searchParams)
      if (id) next.set('thread', id)
      else next.delete('thread')
      setSearchParams(next, { replace: true })
    },
    [searchParams, setSearchParams],
  )
  const comments = file?.comments ?? []
  const rootIds = comments.map((comment) => comment.id)
  /*
    Which view, decided by the manifest and not by the kind (FOL-31). A file
    the viewer may comment on — a bare file's built-in manifest declares
    `comment`, and so does Ship's for a project and an issue — gets Peek's own
    conversation view: the Topics cards, composer and thread pane over
    `kind:1111`. A file the viewer may only look at keeps the read-only panes.
    The two reads are exclusive, so a page pays for one of them and never both.
  */
  const canComment = !!file?.naddr && (file.actions ?? []).some((a) => a.id === 'comment')
  const title = file?.slots.title?.value ?? 'File'
  const peek = useFileConversationView({
    container:
      canComment && file?.address && file.folder ? { kind: 'file', address: file.address, h: file.folder } : null,
    rootIds,
    openThreadId,
    onOpenThread: setOpenThread,
    title,
    onCommented: reloadConversation,
  })
  const { state: threads } = useFileThreads(canComment ? null : file?.address, rootIds)
  const replyCounts =
    threads === 'loading' || 'failed' in threads
      ? undefined
      : Object.fromEntries(
          Object.entries(threads.replies).map(([id, replies]) => [id, replies.length]),
        )
  const openThread = openThreadId ? comments.find((c) => c.id === openThreadId) : undefined

  /*
    A link to a comment lands on the comment (FOL-36) — `ObjectPage`'s and the
    launcher's one-shot, the same one the topic view answers (RIC-16), read
    here for a comment whose thread is one of this file's. The thread comes
    open from the URL; what is left is the scroll, and it can only happen once
    the thread pane has drawn the comment's anchor, which `peek.threadPanel`
    being something says. Waiting on that rather than on the mount is what
    makes a cold load work: the pane draws a read or more after the file does.
    The one-shot is consumed only once it is answered, so a link that opens
    while the reads are still in flight is not lost to them.
  */
  const { pendingTopicMessage, setPendingTopicMessage } = useLastSelection()
  const threadDrawn = peek.threadPanel !== undefined
  useEffect(() => {
    if (!pendingTopicMessage || !rootIds.includes(pendingTopicMessage.eventId)) return
    if (openThreadId !== pendingTopicMessage.eventId) {
      setOpenThread(pendingTopicMessage.eventId)
      return
    }
    if (!threadDrawn) return
    setPendingTopicMessage(null)
    void scrollToMessageWhenReady(pendingTopicMessage.reply ?? pendingTopicMessage.eventId)
  }, [pendingTopicMessage, rootIds, openThreadId, threadDrawn, setOpenThread, setPendingTopicMessage])

  /*
    Rename and Delete, from the manifest and not from the kind (FOL-33) — the
    same gate as `canComment` a few lines up. A bare file's built-in manifest
    declares both; Ship's declares neither for an issue, so an issue's header
    keeps only "Open folder", which is the ticket's test. The dialogs are the
    page's, shared with the tree's row menu so both ends open the same ones
    (PEE-2). A rename re-reads the file, whose title the header draws (the
    tree re-reads on the change event's own signal); deleting the open file
    lands on the team it was in, since this page no longer resolves. A row's
    delete of some other file stays here — the person was not looking at it.
  */
  const controls = fileControlsOf(file)
  const fileControls = useFileControls({
    onRenamed: () => void reloadConversation(),
    onDeleted: (deleted) => {
      if (deleted.folder && deleted.address === file?.address) navigate(`/folders/${deleted.folder}`, { replace: true })
    },
  })

  if (topicIdentifier) return <Navigate to={`/topic/${topicIdentifier}`} replace />

  if (!address) {
    return (
      <div className="flex min-h-screen flex-col">
        <EmptyState message="That link does not point at anything Peek can open." />
      </div>
    )
  }

  return (
    <>
    {fileControls.dialogs}
    <AppShell
      leftPanel={
        /*
          The navigation: the Folder tree (FOL-21), opened to the Folder this
          file lives in and to the row it sits under. Both come off the
          resolved file rather than the URL, which is what lets a bare address
          open in a fresh tab with the left pane in the right place — §7.2's
          property, one level up: the identity in the link is enough, and
          nothing else has to be carried. `selectedParent` is the file this one
          names as its parent: `peersOf` hides a child whose parent is listed,
          so without it a Ship issue would be in the Folder and drawn nowhere —
          the same shape of gap the route itself was opened for.
        */
        <FolderTree
          currentFolder={file?.folder}
          selectedRef={file?.ref}
          selectedParent={file?.parentRef}
          onControl={fileControls.open}
        />
      }
      rightPanel={
        <div className="flex h-full flex-col">
          <ContainerHeader
            title={
              <div className="min-w-0">
                <p className="truncate text-body-2-strong text-text-primary">{title}</p>
                {/*
                  Whose file this is, said plainly. The page draws another app's
                  conversation in Peek's own language, which is the point and is
                  also exactly what could mislead: without this the discussion
                  reads as something in Peek.
                */}
                {file?.appName && (
                  <p className="truncate text-caption text-text-muted">In {file.appName}</p>
                )}
              </div>
            }
            actions={
              file?.folder ? (
                // One strip: one Tab stop, arrows along it (UIG-14).
                <Toolbar aria-label="File actions" surface={false}>
                  {/* A link that looks like the button (UIG-14, 4.13): a new tab works. */}
                  <ToolbarLink
                    tooltip="Open folder"
                    aria-label="Open folder"
                    href={`/folders/${file.folder}`}
                    onClick={(event) => followInApp(event, () => navigate(`/folders/${file.folder}`))}
                  >
                    <IconArrowUpRight size={16} stroke={1.5} />
                  </ToolbarLink>
                  {/*
                    The topic's menu, when the manifest offers anything for it
                    to hold (FOL-33) — and absent, not inert, when it does not:
                    a Ship issue's header has nothing to put here, and a button
                    that opens nothing would say otherwise.
                  */}
                  {hasFileControls(controls) && (
                    <TopicMoreMenu
                      trigger={
                        <ToolbarButton tooltip="More actions" aria-label="More actions">
                          <IconDotsVertical size={16} stroke={1.5} />
                        </ToolbarButton>
                      }
                      onOpenDetails={() => fileControls.open('details', file)}
                      onRename={controls.rename ? () => fileControls.open('rename', file) : undefined}
                      onDeleteTopic={controls.delete ? () => fileControls.open('delete', file) : undefined}
                    />
                  )}
                </Toolbar>
              ) : undefined
            }
          />
          {canComment ? (
            peek.conversation
          ) : (
            /* The package's bar, not the browser's (D40). */
            <ScrollArea className="min-h-0 flex-1">
              <ForeignConversationView
                state={conversation}
                people={people}
                onOpenThread={setOpenThread}
                openThreadId={openThreadId}
                replyCounts={replyCounts}
              />
            </ScrollArea>
          )}
        </div>
      }
      threadPanel={
        canComment ? (
          peek.threadPanel
        ) : openThread ? (
          <div className="flex h-full flex-col">
            <ContainerHeader
              title="Thread"
              actions={
                <IconButton
                  tooltip="Close"
                  aria-label="Close thread"
                  onClick={() => setOpenThread(null)}
                >
                  <IconX size={16} stroke={1.5} />
                </IconButton>
              }
            />
            <ScrollArea className="min-h-0 flex-1">
              <FileThreadView root={openThread} state={threads} people={people} />
            </ScrollArea>
          </div>
        ) : undefined
      }
    />
    </>
  )
}
