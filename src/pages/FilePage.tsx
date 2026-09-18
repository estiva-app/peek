import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { IconArrowUpRight, IconX } from '@tabler/icons-react'
import { ContainerHeader, ScrollArea } from '@estiva-app/ui'
import { AppShell } from '@/layouts/AppShell'
import { EmptyState } from '@/components/ui/EmptyState'
import { IconButton } from '@/components/ui/IconButton'
import { CommentComposer } from '@/components/ui/CommentComposer'
import { FolderTree } from '@/components/views/FolderTree'
import { ForeignConversationView } from '@/components/views/ForeignConversationView'
import { FileThreadView } from '@/components/views/FileThreadView'
import {
  useFileThreads,
  useForeignConversation,
  useForeignObjects,
  useWorkspaceDirectory,
} from '@/api'
import { useToast } from '@/lib/toast'
import { addressFromRef } from '@/lib/objectUrl'
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
  const { showToast } = useToast()
  const people = useWorkspaceDirectory()
  const { replyToComment, applyAction } = useForeignObjects()

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
    Which thread is open, in the URL rather than in state, so a thread is a
    link — the same argument `?file=` was given and the same one §7 makes about
    a topic: a conversation somebody can point at is worth more than one that
    only exists in this tab.
  */
  const openThreadId = searchParams.get('thread') ?? undefined
  const setOpenThread = (id: string | null) => {
    const next = new URLSearchParams(searchParams)
    if (id) next.set('thread', id)
    else next.delete('thread')
    setSearchParams(next, { replace: true })
  }
  const comments = file?.comments ?? []
  const { state: threads, reload: reloadThreads } = useFileThreads(
    file?.address,
    comments.map((comment) => comment.id),
  )
  const replyCounts =
    threads === 'loading' || 'failed' in threads
      ? undefined
      : Object.fromEntries(
          Object.entries(threads.replies).map(([id, replies]) => [id, replies.length]),
        )
  const openThread = openThreadId ? comments.find((c) => c.id === openThreadId) : undefined
  /*
    The parent a reply names (NIP-22 §6.4's lowercase trio). Its *kind* is the
    part no projection reports — `comments` carries id, author, body and time —
    so it comes from the thread read, which fetched the roots by id for exactly
    this. Until it arrives the composer is absent rather than broken: a reply
    built on a guessed kind would publish a wrong `k` for ever.
  */
  const replyParent =
    openThreadId && threads !== 'loading' && !('failed' in threads)
      ? threads.roots[openThreadId]
      : undefined

  if (topicIdentifier) return <Navigate to={`/topic/${topicIdentifier}`} replace />

  if (!address) {
    return (
      <div className="flex min-h-screen flex-col">
        <EmptyState message="That link does not point at anything Peek can open." />
      </div>
    )
  }

  /*
    The composer follows the manifest, not the kind. A bare file's built-in
    manifest declares `comment`; so does Ship's for a project and an issue. The
    control appears wherever the owner says a comment may be written, and
    nowhere else.
  */
  const canComment = !!file?.naddr && (file.actions ?? []).some((a) => a.id === 'comment')
  const title = file?.slots.title?.value ?? 'File'

  async function comment(body: string): Promise<boolean> {
    if (!file?.naddr) return false
    const result = await applyAction({ naddr: file.naddr, actionId: 'comment', value: body })
    if (!result.ok) {
      showToast({ label: result.reason ?? 'The relay refused the comment.', type: 'error' })
      return false
    }
    // The relay has it; the pane re-reads rather than appending a copy, so what
    // is shown is what every other reader sees.
    await reloadConversation()
    return true
  }

  async function reply(body: string): Promise<boolean> {
    if (!file?.address || !replyParent) return false
    const result = await replyToComment({ reference: file.address, parent: replyParent, body })
    if (!result.ok) {
      showToast({ label: result.reason ?? 'The relay refused the reply.', type: 'error' })
      return false
    }
    await reloadThreads()
    return true
  }

  return (
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
                <IconButton
                  tooltip="Open folder"
                  aria-label="Open folder"
                  onClick={() => navigate(`/folders/${file.folder}`)}
                >
                  <IconArrowUpRight size={16} stroke={1.5} />
                </IconButton>
              ) : undefined
            }
          />
          {/* The package's bar, not the browser's (D40). */}
          <ScrollArea className="min-h-0 flex-1">
            <ForeignConversationView
              state={conversation}
              people={people}
              onOpenThread={setOpenThread}
              openThreadId={openThreadId}
              replyCounts={replyCounts}
            />
          </ScrollArea>
          {canComment && (
            // Keyed on the file: a draft belongs to the conversation it was
            // typed in, and a new key is a new composer with an empty one.
            <CommentComposer key={file.ref} placeholder={`Comment on ${title}`} onSend={comment} />
          )}
        </div>
      }
      threadPanel={
        openThread ? (
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
            {canComment && replyParent && (
              <CommentComposer
                key={openThread.id}
                placeholder="Reply in thread"
                onSend={reply}
              />
            )}
          </div>
        ) : undefined
      }
    />
  )
}
