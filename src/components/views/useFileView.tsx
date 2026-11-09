import { useMemo, type ReactNode } from 'react'
import { IconX } from '@tabler/icons-react'
import { Panel } from '@estiva-app/ui'
import { ListedFileHeading } from '@/components/views/ListedFileHeading'
import { IconButton } from '@/components/ui/IconButton'
import { ForeignConversationView } from '@/components/views/ForeignConversationView'
import { FileThreadView } from '@/components/views/FileThreadView'
import { conversationPlaceholder, useFileConversationView, type ConversationParts, type ListedView } from '@/components/views/useFileConversationView'
import { FileActivityPanel } from '@/components/FileActivityPanel'
import { OverviewPanel } from '@/components/OverviewPanel'
import { TopicFiles } from '@/components/TopicFiles'
import { KIND_BARE_FILE, isArchived } from '@estiva-app/interop'
import {
  listedFile,
  topicFollowTarget,
  useFileThreads,
  useForeignConversation,
  useListedConversations,
  useNewReplyThreads,
  usePlaceFollow,
  useReplyOnlyThread,
  useTeams,
  useTopicFiles,
  useWorkspaceDirectory,
  type ConversationContainer,
  type ReplyStream,
  type ForeignConversationState,
  type TopicFile,
} from '@/api'
import { useFileMentions } from '@/api/useFileMentions'
import { referenceLink } from '@/lib/referenceLink'
import { archivedLineOf } from '@/lib/archiveWords'
import { useSidePanel } from '@/lib/sidePanel'
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
  titleHint,
}: {
  /** The file's `kind:pubkey:d`, or null while there is none to read. */
  address: string | null
  /** Drawn instead of the resolve — a short link that named no file. */
  override?: ForeignConversationState
  /** The title the row that opened it showed, drawn while the file resolves and no Folder listing holds it. */
  titleHint?: string
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
  // Oldest first, which the resolve does not promise: a long file's first open draws the last ones first (PEE-7).
  const rootIds = [...comments].sort((a, b) => a.createdAt - b.createdAt).map((comment) => comment.id)
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
  /*
    While the file resolves, the Folder listing it was clicked in already
    holds it (OPT-9): its title, its Folder and what it allows. An open Peek
    topic there gets its own view at once — the conversation's one
    placeholder with the composer under it — instead of a "File" pane that
    becomes a topic half a second later. Only a Peek topic that is not
    archived, so a composer drawn now is never taken away when the resolve
    answers (Miky, OPT-9's kickoff); another app's file waits for it.
  */
  const listed = conversation === 'loading' && address ? listedFile(address) : undefined
  const listedTopic =
    listed?.address && !isArchived(listed) && referenceLink(listed.address, listed)?.place === 'file' ? listed : null
  const writable = file ?? listedTopic
  const canComment = !!writable?.naddr && (writable.actions ?? []).some((a) => a.id === 'comment')
  const container: ConversationContainer | null =
    canComment && writable?.address && writable.folder ? { kind: 'file', address: writable.address, h: writable.folder } : null
  const ownView = container !== null
  const title = (file ?? listed)?.slots.title?.value ?? titleHint ?? 'File'

  /*
    A topic's level is its view's too (TOPI-3): one control, the follow switch. Followed at All, its middle column
    draws its own conversation and every thread on each file it lists (not files under them) in one time order, each
    file's under its heading; at Important, Not following or muted, its own only. The place is read here, once, and the
    header's switch draws the same read (`useFilePane`). A mute shows as Not following, so it draws the topic's own.
  */
  const isTopic = Number(file?.address?.split(':')[0]) === KIND_BARE_FILE
  const { teams, failed: teamsFailed } = useTeams({ read: isTopic })
  const followTarget = topicFollowTarget(file, teams, teamsFailed)
  const follow = usePlaceFollow(followTarget)
  const atAll = !!followTarget && follow.state?.shown === 'all'
  const sidePanel = useSidePanel(file?.address)
  /*
    A topic's files (TOP-3): read once for both the Overview's Files and, at All, their conversations. Filed in the
    topic's own Folder, the one its root names.
  */
  const topic = isTopic && file?.address && file.folder ? file.address : null
  const topicFiles = useTopicFiles(topic && (atAll || sidePanel.open) ? topic : null, file?.folder)
  const listedFiles = topic && atAll && typeof topicFiles.state === 'object' && 'files' in topicFiles.state ? topicFiles.state.files : null
  const listedConversations = useListedConversations(listedFiles)
  // One node per file, kept across renders, so a card whose message did not change is not drawn again.
  const headings = useMemo(() => new Map((listedFiles ?? []).map((f) => [f.address, <ListedFileHeading key={f.address} file={f} />])), [listedFiles])
  const listedView: ListedView | undefined =
    topic && atAll
      ? {
          // The list itself is still being read: the files' conversations are as good as loading. A list that could not
          // be read draws the topic's own, as a failed read of the files does; the Overview says it could not load them.
          state: listedFiles ? listedConversations.state : topicFiles.state === 'loading' ? 'loading' : { failed: 'unreachable' },
          actionsFor: listedConversations.actionsFor,
          headingOf: (address) => headings.get(address),
          nameOf: (address) => nameOf(listedFiles?.find((f) => f.address === address)),
          closedOf: (address) => {
            const f = listedFiles?.find((one) => one.address === address)
            return f?.archived ? archivedLineOf(f.object?.archived ?? {}) : undefined
          },
        }
      : undefined

  const peek = useFileConversationView({
    container,
    // The listing's copy of a file lists no comments: the read waits for the file's own.
    rootIds: file ? rootIds : null,
    openThreadId,
    onOpenThread,
    title,
    onCommented: reload,
    // An archived file is read-only until it is unarchived (Katerina, 7 October).
    readOnly: !!file?.archived,
    closed: archivedLineOf(file?.archived),
    listed: listedView,
  })
  const { state: threads } = useFileThreads(ownView ? null : file?.address, rootIds)

  /*
    The dwell marks this file's own stream and no container (FOL-16). Passing
    `file?.address` rather than the address asked for is deliberate: an
    address that resolved to nothing was never read, and marking it would clear
    a dot for a file the person never saw. Peek's own view marks up to the
    newest top-level comment seen on screen, which has had its dwell already
    (Katerina, 30 October); the read-only pane up to the newest it holds. What
    arrives while the file is open is read too (PEE-44). Replies are read by
    opening their thread: Peek's own view marks its open thread itself, and the
    read-only pane's is marked here.
  */
  const replies = threads === 'loading' || 'failed' in threads ? undefined : threads.replies
  useMarkFileRead(file?.address, ownView ? peek.seenAt : newestMessageAt(comments), ownView ? 0 : undefined)
  useMarkThreadRead(ownView ? null : openThreadId, openThreadId && replies ? newestMessageAt(replies[openThreadId] ?? []) : undefined)  // The read-only pane's "new reply", by the dot's own rule; Peek's own view works out its own (CON-34).
  const readOnlyStream: ReplyStream | null = !ownView && file?.address ? { kind: 'file', address: file.address } : null
  const newReplies = useNewReplyThreads(readOnlyStream, replies, peek.viewerPubkey)
  const readOnlyReplyThread = useReplyOnlyThread(readOnlyStream, file ? comments : undefined, replies, peek.viewerPubkey)
  /*
    Activity — the comments elsewhere that name this file (CON-11), read by
    `#a` off the relay for a file Peek's own view draws. It takes the third
    column when no thread is open and the column is shown; the file's
    own conversation is the middle column, and a mention is not part of it
    (`isCommentOn` keeps the two apart on the read).
  */
  const { mentions } = useFileMentions(ownView ? file?.address : null)
  /*
    The third column while no thread is open: the file's Overview (Katerina,
    7 October). Another app's file has its card there (FOL-29); a bare file
    gets none — it is nobody's, so there is no other app whose part of it the
    column could show, and its title is already the header. "Another app's"
    is `referenceLink`'s answer, the one place Peek says which files live
    inside it: a file whose way in is a link out to its owner is the one whose
    card is worth a column. No kind number here, and a manifest from an app
    nobody has written lands the same way Ship's does.

    Activity is under it wherever mentions are read — Peek's own view — with
    its empty line when there are none. A read-only file's are never asked
    for, and an empty line there would claim what nobody looked at.

    Closed whenever a file is opened, whatever it holds; the header's sidebar
    button opens it (`useSidePanel`, Katerina, 13 October).
  */
  const home = file ? referenceLink(file.naddr ?? file.address ?? file.ref, file) : null
  const cardFile = file && home?.place === 'app' && (file.naddr ?? file.address) ? file : undefined
  const canShow = !!cardFile || ownView
  /*
    A topic's files (TOP-3), above Activity: a topic keeps its own list, and
    only topics' lists are read in this stage (Miky, 30 Oct).
  */
  const topicFilesPanel = topic ? <TopicFiles key={topic} topic={topic} files={topicFiles} title={title} readOnly={!!file?.archived} /> : undefined
  const aside =
    sidePanel.open && canShow ? (
      <OverviewPanel file={cardFile} files={topicFilesPanel} activity={ownView ? <FileActivityPanel address={file?.address} mentions={mentions} /> : undefined} />
    ) : undefined
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
      (openStandIn && { id: openStandIn.id, author: '', body: '', createdAt: openStandIn.createdAt, ...(openStandIn.unseen ? { unseen: true } : { deleted: true }) }))

  /*
    The middle column under the page's bar. Peek's own view, and a file still resolving, are the kit's
    ConversationLayout (its parts, spread onto one): the placeholder is the layout reading, so a file that turns out
    to be Peek's own goes on to its messages with nothing swapped. Another app's file stays the list it was, in a
    Panel: in the layout it would sit on the box and space its comments wider (its thread keeps its shape too,
    Katerina, 1 November).
  */
  const list: { layout: ConversationParts } | { panel: { children: ReactNode } } = ownView
    ? // The thread is what somebody just asked for, in the layout's column; the Overview is what it shows otherwise.
      { layout: { ...peek.conversationParts, aside } }
    : conversation === 'loading'
      ? { layout: conversationPlaceholder }
      : {
          panel: {
          children: (
            <ForeignConversationView
              state={conversation}
              people={people}
              onOpenThread={onOpenThread}
              openThreadId={openThreadId}
              replyCounts={replyCounts}
              newReplies={newReplies}
              deletedRoots={deletedRoots}
            />
          ),
          },
        }

  /*
    Another app's file only: its read-only thread, or its Overview, in the frame's column beside the Panel. Peek's own
    view draws both in its ConversationLayout's column (B1).
  */
  const threadPanel: ReactNode | undefined = ownView ? undefined : openThread ? (
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
    /** The middle column under the page's bar: the kit's ConversationLayout's parts, or another app's list for a `Panel`. */
    list,
    /** Another app's file: what the frame's column beside it holds, its open thread or its Overview. */
    threadPanel,
    /** The open thread has drawn its anchor, so a scroll to a comment in it can land. */
    threadDrawn: peek.threadDrawn,
    /** The thread to open when only a reply is new: `undefined` until judged (CON-34). */
    replyOnlyThread: ownView ? peek.replyOnlyThread : readOnlyReplyThread,
    /**
     * The header's sidebar button: whether the Overview is shown, and the
     * toggle. Absent when the file has nothing the column could ever hold —
     * a read-only file with no card.
     */
    sidePanel: canShow ? sidePanel : undefined,
    /** A topic's place as read, for the header's switch: the same read the middle column's level comes from (TOPI-3). */
    follow,
    followTarget,
  }
}

/** A listed file's name, as its heading draws it (`ListedFileHeading`), for a note that says where a change was not saved. */
const nameOf = (f: TopicFile | undefined): string => f?.object?.slots.title?.value || 'File'
