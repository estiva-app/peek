import type { ReactNode } from 'react'
import { IconX } from '@tabler/icons-react'
import { Panel } from '@estiva-app/ui'
import { IconButton } from '@/components/ui/IconButton'
import { ForeignConversationView } from '@/components/views/ForeignConversationView'
import { FileThreadView } from '@/components/views/FileThreadView'
import { useFileConversationView, type ConversationParts } from '@/components/views/useFileConversationView'
import { FileActivityPanel } from '@/components/FileActivityPanel'
import { FileWidgetPanel } from '@/components/FileWidgetPanel'
import {
  useFileThreads,
  useForeignConversation,
  useWorkspaceDirectory,
  type ConversationContainer,
  type ForeignConversationState,
} from '@/api'
import { useFileMentions } from '@/api/useFileMentions'
import { referenceLink } from '@/lib/referenceLink'
import { newestMessageAt, useMarkFileRead, useMarkThreadRead } from '@/lib/useMarkRead'

/**
 * One file's conversation and its third column, off the relay — what
 * `FilePage` draws in its middle and right panes, and what the Desk draws
 * beside its lists (SID-3). Held in one place so a file opened from the Desk
 * is the same conversation as the one on its own page: the same view choice,
 * the same composer, the same thread pane, and the same read marker.
 *
 * Nothing here reads Convex. The Desk's in-place pane before FOL-26 was
 * `useTopicView`, which did; this is what replaced it.
 */
export function useFileView({
  address,
  override,
  openThreadId,
  onOpenThread,
}: {
  /** The file's `kind:pubkey:d`, or null while there is none to read. */
  address: string | null
  /** Drawn instead of the resolve — a short link that named no file. */
  override?: ForeignConversationState
  openThreadId: string | undefined
  onOpenThread: (id: string | null) => void
}) {
  const people = useWorkspaceDirectory()
  /*
    The address is the reference. `resolveObject` takes an naddr, an nevent or a
    bare address — `referenceToPointer`'s tolerance, which exists so a widget
    rendered from an `a` tag is actionable and not merely visible — so nothing
    has to be encoded to bech32 on the way in.
  */
  const { state: resolved, reload, previous } = useForeignConversation(address)
  const conversation = override ?? resolved
  const file = typeof conversation === 'object' && 'ref' in conversation ? conversation : null

  const comments = file?.comments ?? []
  const rootIds = comments.map((comment) => comment.id)
  /*
    Which view, decided by the manifest and not by the kind (FOL-31). A file
    the viewer may comment on — a bare file's built-in manifest declares
    `comment`, and so does Ship's for a project and an issue — gets Peek's own
    conversation view: the Topics cards, composer and thread pane over
    `kind:1111`. A file the viewer may only look at keeps the read-only panes.
    The two reads are exclusive, so a page pays for one of them and never both.

    And only with somewhere to write (PEE-33). Peek's view needs the Folder the
    comment goes in, and a file that resolved without one — a record with
    neither `h` nor a channel of its own, after `useForeignConversation` has
    asked — cannot have it; handing the view no container left the column
    loading for ever, since the view answers a null container with nothing.
    Such a file keeps the read-only panes, which draw its comments off the
    same resolve: a conversation one can read and not write in, never a spinner.
  */
  const canComment = !!file?.naddr && (file.actions ?? []).some((a) => a.id === 'comment')
  const container: ConversationContainer | null =
    canComment && file?.address && file.folder ? { kind: 'file', address: file.address, h: file.folder } : null
  const ownView = container !== null
  const title = file?.slots.title?.value ?? 'File'
  const peek = useFileConversationView({
    container,
    rootIds,
    openThreadId,
    onOpenThread,
    title,
    onCommented: reload,
  })
  const { state: threads } = useFileThreads(ownView ? null : file?.address, rootIds)

  /*
    The dwell marks this file's own stream and no container (FOL-16). Passing
    `file?.address` rather than the address asked for is deliberate: an
    address that resolved to nothing was never read, and marking it would clear
    a dot for a file the person never saw. The newest top-level comment the
    pane holds re-arms it, so what arrives while the file is open is read too
    (PEE-44). Replies are read by opening their thread: Peek's own view marks
    its open thread itself, and the read-only pane's is marked here.
  */
  const replies = threads === 'loading' || 'failed' in threads ? undefined : threads.replies
  useMarkFileRead(file?.address, ownView ? peek.newestAt : newestMessageAt(comments))
  useMarkThreadRead(ownView ? null : openThreadId, openThreadId && replies ? newestMessageAt(replies[openThreadId] ?? []) : undefined)
  /*
    Activity — the comments elsewhere that name this file (CON-11), read by
    `#a` off the relay for a file Peek's own view draws. It takes the third
    column when no thread is open and there is something to show; the file's
    own conversation is the middle column, and a mention is not part of it
    (`isCommentOn` keeps the two apart on the read).
  */
  const { mentions } = useFileMentions(ownView ? file?.address : null)
  /*
    The third column while no thread is open (FOL-29): another app's file has
    its widget there, and under it the Activity above when there is any. A
    bare file gets no widget — it is nobody's, so there is no other app whose
    part of it the column could show, and its title is already the header —
    and a file nobody has named keeps its two columns as before. "Another
    app's" is `referenceLink`'s answer, the one place Peek says which files
    live inside it: a file whose way in is a link out to its owner is the one
    whose widget is worth a column. No kind number here, and a manifest from
    an app nobody has written lands the same way Ship's does.
  */
  const home = file ? referenceLink(file.naddr ?? file.address ?? file.ref, file) : null
  // One scroll for the whole column (Katerina, 27 September): with another app's widget,
  // Activity is a section under the card in the same Panel; alone, it is its own Panel.
  const widget = file && home?.place === 'app' && (file.naddr ?? file.address) ? <FileWidgetPanel file={file} below={mentions.length > 0 ? <FileActivityPanel mentions={mentions} as="section" /> : undefined} /> : undefined
  const activity = !widget && mentions.length > 0 ? <FileActivityPanel mentions={mentions} /> : undefined
  const aside = widget ?? activity
  const replyCounts =
    threads === 'loading' || 'failed' in threads
      ? undefined
      : Object.fromEntries(
          Object.entries(threads.replies).map(([id, replies]) => [id, replies.length]),
        )
  const deletedRoots = threads === 'loading' || 'failed' in threads ? undefined : threads.deleted
  const openStandIn = deletedRoots?.find((d) => d.id === openThreadId)
  const openThread = !openThreadId
    ? undefined
    : (comments.find((c) => c.id === openThreadId) ??
      (openStandIn && { id: openStandIn.id, author: '', body: '', createdAt: openStandIn.createdAt, deleted: true }))

  // The middle column's body and footer, for the page's Panel (estiva-ui 0.37.0): the
  // Panel scrolls the body with the package's bar, and keeps the composer under it.
  const panel: Partial<ConversationParts> & { children: ReactNode } = ownView
    ? peek.conversationParts
    : {
        children: (
          <ForeignConversationView
            state={conversation}
            people={people}
            onOpenThread={onOpenThread}
            openThreadId={openThreadId}
            replyCounts={replyCounts}
            deletedRoots={deletedRoots}
          />
        ),
      }

  const threadPanel: ReactNode | undefined = ownView ? (
    // The thread is what somebody just asked for; the widget and Activity are what the page shows otherwise.
    (peek.threadPanel ?? aside)
  ) : openThread ? (
    <Panel
      title="Thread"
      actions={
        <IconButton tooltip="Close" aria-label="Close thread" onClick={() => onOpenThread(null)}>
          <IconX size={16} stroke={1.5} />
        </IconButton>
      }
    >
      <FileThreadView root={openThread} state={threads} people={people} />
    </Panel>
  ) : (
    aside
  )

  return {
    conversation,
    file,
    /** The file drawn last, while the next one resolves (SID-2). */
    previous,
    reload,
    title,
    rootIds,
    /** The middle column's body and footer, for a `Panel` whose header the page draws: spread it onto one. */
    panel,
    threadPanel,
    /** The open thread has drawn its anchor, so a scroll to a comment in it can land. */
    threadDrawn: peek.threadPanel !== undefined,
  }
}
