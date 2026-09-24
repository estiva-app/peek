import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { ScrollArea } from '@estiva-app/ui'
import { isNearBottom } from './scrollPolicy'
import { ConversationCard } from '@/components/ConversationCard'
import { ReactionHorizon } from '@/components/ReactionHorizon'
import { ThreadPanel } from '@/components/ThreadPanel'
import { DateDivider } from '@/components/ui/DateDivider'
import { EmptyState } from '@/components/ui/EmptyState'
import { ComposeBox, type SendPayload } from '@/components/ui/ComposeBox'
import { SkeletonConversationList } from '@/components/ui/Skeleton'
import { registerTopicConversation, unregisterTopicConversation, type ConversationMessage } from '@/lib/conversationRegistry'
import { draftKeys } from '@/lib/drafts'
import { registerThreadOpener, unregisterThreadOpener } from '@/lib/threadOpener'
import { useToast } from '@/lib/toast'
import {
  CURRENT_USER_NAME,
  conversationKeyOf,
  formatDateLabel,
  formatReplyTimestamp,
  useFileConversation,
  useFollows,
  useWorkspaceDirectory,
  UploadDestinationProvider,
  type ConversationContainer,
  type ConversationData,
  type ConversationEvent,
  type FileAttachment,
  type FileConversation,
  type OutgoingAttachment,
  type ReactionData,
  type ResolutionEvent,
  type ThreadReply,
  type UploadedFile,
  type WriteResult,
} from '@/api'
import type { CommentDecoration, CommentReaction, People } from '@estiva-app/interop'
import { formatTimestamp } from '@/api/format'

interface UseFileConversationViewArgs {
  /** Where the conversation is, and nothing about what kind it is. */
  container: ConversationContainer | null
  /** The root comments' ids, off the resolved file. A channel finds its own; pass none. */
  rootIds: readonly string[]
  /** Which thread is open — the page owns it, because it is in the URL. */
  openThreadId: string | undefined
  onOpenThread: (id: string | null) => void
  /** What the composer says it is writing to. */
  title: string
  /**
   * A new root comment landed. A file's roots come off the object's own read,
   * not this one, so the page re-resolves the object; the changed root ids
   * then re-read the conversation through the key. A channel re-reads itself.
   */
  onCommented?: () => Promise<void>
  /** Where the composer keeps its draft. A file's address by default. */
  draftKey?: string
  /** What an empty conversation shows. "Nobody has commented yet." by default. */
  empty?: ReactNode
  /** Who is in the conversation, for the thread's members pill — a DM's two people. */
  threadMembers?: string[]
}

interface ViewSlots {
  /** The stream and its composer — under the page's own header. */
  conversation: ReactNode
  /** The open thread, or nothing. */
  threadPanel: ReactNode | undefined
}

/**
 * A file's conversation drawn as Peek's own — FOL-31.
 *
 * The same cards, composer and thread pane a topic gets, over `kind:1111`
 * read from the relay by `useFileConversation` instead of `kind:9` read from
 * Convex by `useTopicMessages`. `useTopicView` is not reused because it is
 * bound to Convex's row-and-override model end to end; this hook mirrors what
 * it *draws* — date groups under a sticky divider, the scroll policy, the
 * reaction horizon said out loud, the thread pane keyed on its root — and
 * differs in one thing only: there is no local copy to patch, so every write
 * goes to the relay and the page re-reads. What is on screen is what the relay
 * holds, always.
 *
 * ## What is offered, and what decides it
 *
 * Every control the card has is offered: edit, delete, react, resolve, reply.
 * Ownership is not gated here — the relay decides who may edit or delete
 * (CON-3: the effective author and an agent's owner are its to know), and a
 * refusal comes back as its reason, in a toast. Two of a topic's controls are
 * deliberately absent: urgent and the highlight, which live only in Convex
 * (HIG-1) and would be a lie on a conversation another app reads.
 *
 * ## The edited marker
 *
 * A body shown here is the newest `kind:40003`'s when there is one, and the
 * card is told (`editedAt`) so it draws "(edited)" — the reader's half of
 * CON-8's newest-wins rule, without which a reply written against the old
 * text reads as a non sequitur.
 *
 * An edit may also carry `imeta` (RFC 0.4 §7.2.1, amended 2026-09-23, CON-5):
 * the files drawn are the latest such edit's set, else the comment's own. An
 * edit that only attaches — its content byte-identical to the body it replaces
 * — is not marked edited, since the mark is about the body.
 *
 * ## Live, the way a topic is (FOL-32)
 *
 * The read watches the file's Folder on the tab's one socket. A new root is
 * not in `rootIds` until the object is re-resolved, which is `onCommented`'s
 * job already — so it is handed down as what to do when the socket says
 * something was said about the file.
 *
 * ## A channel, too (REM-1)
 *
 * A DM is a channel container: its `kind:9` messages, read and written here
 * exactly as a file's comments are, with the same cards and the same rule —
 * nothing on screen that the relay does not hold. The DM view puts its own
 * header above this and nothing else.
 */
export function useFileConversationView({
  container,
  rootIds,
  openThreadId,
  onOpenThread,
  title,
  onCommented,
  draftKey,
  empty,
  threadMembers,
}: UseFileConversationViewArgs): ViewSlots {
  const { state, actions, viewerPubkey } = useFileConversation(container, rootIds, {
    onActivity: () => void onCommented?.(),
  })
  const people = useWorkspaceDirectory()
  const { showToast } = useToast()
  const scrollRef = useRef<HTMLDivElement>(null)
  /*
    You follow what you comment in (FOL-30): a root or a reply of yours puts
    the file on your list. Not awaited and not reported — the comment is on
    the relay whether or not the follow lands, and the header's toggle is the
    recovery.
  */
  const follows = useFollows()
  const followAfterWrite = () => {
    if (container?.kind === 'file') void follows.setFollowed(container.address, true)
  }

  const isLoading = state === 'loading'
  const failed = typeof state === 'object' && 'failed' in state ? state.failed : null
  const conversation: FileConversation | null = typeof state === 'object' && 'roots' in state ? state : null

  const view = conversation ? project(conversation, viewerPubkey, people) : null
  const groups = view ? groupByDay(view.roots) : []

  /** Toasts a refusal; true when the relay took the write. */
  const refuse = (result: WriteResult): result is { ok: true; id: string } => {
    if (!result.ok) showToast({ label: result.reason, type: 'error' })
    return result.ok
  }

  /*
    A reaction is toggled by the card as "here is the new aggregate", and the
    relay has no aggregate: it has this viewer's `kind:7`, or not. So the
    aggregate is ignored and the emoji decides — the viewer's own reaction
    with it is taken back (a `kind:5` on the reaction), or one is published.
  */
  const toggleReaction = (targetEventId: string, emoji: string) => {
    const mine = view?.reactionsById[targetEventId]?.find((r) => r.emoji === emoji && r.by === viewerPubkey)
    void (mine ? actions.remove(mine.id) : actions.react(targetEventId, emoji)).then(refuse)
  }

  const setResolution = (targetEventId: string, resolved: boolean, message?: string, supportingEventId?: string) =>
    void actions.resolve(targetEventId, resolved ? 'resolved' : 'reopened', message, supportingEventId).then(refuse)

  /*
    One edit per save. A card's save reports the body and then, when they
    changed, the files — two calls in the same handler — and two `kind:40003`s
    would race: the files' edit, built with the body as it stood, could land
    last and put the old text back. So the two are gathered until the handler
    has returned and published as one event: the new body, and the new set as
    `imeta` (CON-5).
  */
  const pendingEdits = useRef(new Map<string, { body?: string; files?: FileAttachment[] }>())
  const queueEdit = (targetEventId: string, change: { body?: string; files?: FileAttachment[] }) => {
    const pending = pendingEdits.current
    const first = !pending.has(targetEventId)
    pending.set(targetEventId, { ...pending.get(targetEventId), ...change })
    if (!first) return
    queueMicrotask(() => {
      const edit = pending.get(targetEventId)
      pending.delete(targetEventId)
      const body = edit?.body ?? (conversation ? currentBody(conversation, targetEventId) : undefined)
      if (body === undefined) return
      let files: OutgoingAttachment[] | undefined
      if (edit?.files) {
        // An edit carrying no `imeta` means "unchanged", so there is no event
        // that takes the last file off; the body still travels.
        if (edit.files.length === 0) {
          showToast({ label: 'The last attachment cannot be removed from a message yet.', type: 'error' })
        } else {
          files = outgoing(edit.files) ?? undefined
          if (!files) return
        }
      }
      void actions.edit(targetEventId, body, files).then(refuse)
    })
  }
  const editBody = (targetEventId: string, body: string) => queueEdit(targetEventId, { body })
  const editFiles = (targetEventId: string, files: FileAttachment[]) => queueEdit(targetEventId, { files })

  const remove = (targetEventId: string, what: 'Comment' | 'Reply') =>
    void actions.remove(targetEventId).then((result) => {
      if (refuse(result)) showToast({ label: `${what} deleted`, type: 'neutral' })
    })

  /*
    The composer's files are the relay's copies (CON-12): `UploadedFile` carries
    `sha256` and `mediaUrl` when the blob upload succeeded, and `shareError`
    when it did not. A relay-only conversation has nowhere else to keep the
    bytes, so a file the relay does not hold cannot be attached here — said
    before the text is lost, by returning false so the composer keeps it.
  */
  const outgoing = (files: readonly (FileAttachment & Pick<UploadedFile, 'shareError'>)[] | undefined): OutgoingAttachment[] | null => {
    const missing = (files ?? []).find((f) => !f.sha256 || !f.mediaUrl)
    if (missing) {
      showToast({
        label: `${missing.name} is not on the relay${missing.shareError ? ` — ${missing.shareError}` : ''}, so it cannot be attached here.`,
        type: 'error',
      })
      return null
    }
    return (files ?? []).map(({ name, contentType, size, sha256, mediaUrl, thumbUrl }) => ({
      name,
      contentType,
      size,
      sha256,
      mediaUrl,
      thumbUrl,
    }))
  }

  const handleSend = async ({ text, resolution, files }: SendPayload) => {
    const attachments = outgoing(files)
    if (!attachments) return false
    const result = await actions.comment(text, attachments)
    if (!refuse(result)) return false
    followAfterWrite()
    await onCommented?.()
    if (resolution) void actions.resolve(result.id, 'resolved', resolution.message).then(refuse)
    // Your own comment always brings you down to it.
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    return true
  }

  const openRoot = openThreadId && conversation ? conversation.roots.find((r) => r.id === openThreadId) : undefined
  const openView = openThreadId && view ? view.byId[openThreadId] : undefined

  const handleSendReply = async ({ text, resolution, files }: SendPayload) => {
    if (!openRoot) return false
    const attachments = outgoing(files)
    if (!attachments) return false
    const result = await actions.reply(openRoot, text, attachments)
    if (!refuse(result)) return false
    followAfterWrite()
    // A resolution written in the thread names the reply that carried it (PEEK-128).
    if (resolution) setResolution(openRoot.id, true, resolution.message, result.id)
    return true
  }

  /**
   * Were you at the live edge when new content arrived? The topic view's
   * policy, unchanged: a re-read that brings someone else's comment follows
   * only if you were already at the bottom.
   */
  const nearBottom = useRef(true)
  const handleScroll = () => {
    const el = scrollRef.current
    if (el) nearBottom.current = isNearBottom(el)
  }

  // Opening a file lands at the bottom, before the paint — once per file, and
  // once the comments are there rather than when the address changes. A
  // channel's "address" is the channel.
  const pinnedFor = useRef<string | null>(null)
  const address = container ? conversationKeyOf(container) : null
  useLayoutEffect(() => {
    if (!address || isLoading) return
    if (pinnedFor.current === address) return
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    pinnedFor.current = address
    nearBottom.current = true
  }, [address, isLoading])

  // A comment arrives: follow only if you were watching the live edge.
  const rootCount = view?.roots.length ?? 0
  useLayoutEffect(() => {
    if (isLoading || !nearBottom.current) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [rootCount, isLoading])

  /*
    What the launcher can ask about (INT-8, here since FOL-36). The topic view
    publishes its conversations' opening messages and says how many replies it
    has not read; this view has read every thread already — a file's replies
    come with `threadsAsViewer` — so the snapshot is the whole conversation,
    each root followed by its replies, oldest first, and nothing is unread. A
    reply names its root as the conversation to open, so a citation into a
    closed thread opens it, through the opener registered below. The open
    thread's own pane still registers itself and wins (the registry's rule),
    as it does over a topic.
  */
  useEffect(() => {
    if (!conversation) return
    const projected = project(conversation, viewerPubkey, people)
    const messages: ConversationMessage[] = projected.roots.flatMap((root) => {
      const asMessage = (m: { id: string; authorName: string; timestamp: string; body: string }): ConversationMessage => ({
        id: m.id,
        author: m.authorName,
        timestamp: m.timestamp,
        body: m.body,
        eventId: m.id,
        conversationId: root.id,
      })
      return [asMessage(root), ...projected.byId[root.id].replies.map(asMessage)]
    })
    registerTopicConversation({ references: [], messages })
    return unregisterTopicConversation
  }, [conversation, viewerPubkey, people])

  // And how to open one of its threads, for a citation into one that is closed
  // (INT-8) — only while there is a conversation: the Desk runs the DM view's
  // hooks with nothing selected, beside a topic that owns the opener.
  useEffect(() => {
    if (!address) return
    registerThreadOpener(onOpenThread)
    return unregisterThreadOpener
  }, [address, onOpenThread])

  // Close the thread when the file changes.
  const prevAddress = useRef(address)
  useEffect(() => {
    if (prevAddress.current !== address) {
      if (prevAddress.current != null) onOpenThread(null)
      prevAddress.current = address
    }
  }, [address, onOpenThread])

  // A file's conversation lives only on the relay, so its attachments go to the
  // blob store and nowhere else (REM-2): the composer, the thread panel and the
  // cards' edit boxes all upload inside this.
  const conversationSlot = (
    <UploadDestinationProvider value="blobStore">
      <ScrollArea className="flex-1" viewportRef={scrollRef} onScroll={handleScroll} contentClassName="flex min-h-full flex-col">
        <div className="flex-1 min-h-0" />
        <div className="shrink-0 flex flex-col px-4 py-4 gap-2">
          {isLoading && <SkeletonConversationList />}
          {failed && (
            <EmptyState
              scope="section"
              message={
                failed === 'not_a_member'
                  ? container?.kind === 'channel'
                    ? 'You are not a member of this conversation.'
                    : 'You are not a member of the folder this file is in.'
                  : failed === 'refused'
                    ? 'The relay refused to show this conversation.'
                    : 'The relay could not be reached.'
              }
            />
          )}
          {view && groups.length === 0 && (empty ?? <EmptyState scope="section" message="Nobody has commented yet." />)}
          {groups.map((group) => (
            <div key={group.dateLabel} className="flex flex-col gap-2">
              <DateDivider label={group.dateLabel} className="sticky top-0 z-10 bg-bg-surface" />
              {group.convs.map((c) => (
                <ConversationCard
                  key={c.id}
                  authorName={c.authorName}
                  authorAvatarSrc={c.authorAvatarSrc}
                  timestamp={c.timestamp}
                  body={c.body}
                  editedAt={c.editedAt}
                  files={c.files}
                  reactions={c.reactions}
                  replyCount={c.replyCount}
                  replyAuthors={c.replyAuthors}
                  lastReplyTime={c.lastReplyTime}
                  isResolved={c.isResolved}
                  resolvedBy={c.resolvedBy}
                  resolutionMessage={c.resolutionMessage}
                  nostrReferences={c.nostrReferences}
                  isSelected={openThreadId === c.id}
                  onResolvedChange={(resolved, _by, message) => setResolution(c.id, resolved, message)}
                  onReactionsChange={(_next, emoji) => toggleReaction(c.id, emoji)}
                  onBodyChange={(b) => editBody(c.id, b)}
                  onFilesChange={(f) => editFiles(c.id, f)}
                  onClick={() => onOpenThread(c.id)}
                  onReply={() => onOpenThread(c.id)}
                  onDelete={() => remove(c.id, 'Comment')}
                />
              ))}
            </div>
          ))}
          {/*
            The reaction horizon, said out loud — SPEC §6.6, CON-1. Reactions
            were asked for the newest hundred comments and replies; an older
            one drawn with none may well have some, and the reader is told
            rather than left to conclude nobody reacted.
          */}
          {view && <ReactionHorizon omitted={view.reactionTargetsOmitted} container="conversation" />}
        </div>
      </ScrollArea>
      <div className="p-3">
        <ComposeBox
          onSend={handleSend}
          contextLabel={title}
          draftKey={draftKey ?? (container?.kind === 'file' ? draftKeys.object(container.address) : undefined)}
        />
      </div>
    </UploadDestinationProvider>
  )

  const threadPanel =
    openRoot && openView ? (
      <UploadDestinationProvider value="blobStore">
      <ThreadPanel
        conversation={openView.data}
        replies={openView.replies}
        sentReplies={[]}
        resolutionEvents={openView.resolutionEvents}
        isResolved={openView.data.isResolved ?? false}
        dmMembers={threadMembers}
        resolvedByReplyId={openView.resolvedByReplyId}
        resolutionMsg={openView.data.resolutionMessage}
        initialReactions={openView.data.reactions}
        onInitialReactionsChange={(_next, emoji) => toggleReaction(openRoot.id, emoji)}
        onInitialBodyChange={(b) => editBody(openRoot.id, b)}
        onInitialFilesChange={(f) => editFiles(openRoot.id, f)}
        onResolutionChange={(resolved, message) => setResolution(openRoot.id, resolved, message)}
        onClose={() => onOpenThread(null)}
        onSendReply={handleSendReply}
        onDeleteReply={(id) => remove(id, 'Reply')}
        onReplyBodyChange={(id, b) => editBody(id, b)}
        onReplyFilesChange={(id, f) => editFiles(id, f)}
        onReplyReactionsChange={(id, _next, _prev, emoji) => toggleReaction(id, emoji)}
      />
      </UploadDestinationProvider>
    ) : undefined

  return { conversation: conversationSlot, threadPanel }
}

// ── From the relay's events to what the cards take ──

interface RootView {
  data: ConversationData
  replies: ThreadReply[]
  resolutionEvents: ResolutionEvent[]
  resolvedByReplyId: string | undefined
}

interface ProjectedConversation {
  roots: ConversationData[]
  byId: Record<string, RootView>
  /** Every reaction by target, the viewer's own among them — what a toggle looks up. */
  reactionsById: Record<string, CommentReaction[]>
  reactionTargetsOmitted: number
}

/**
 * The relay's events as the cards take them, all at once.
 *
 * Names come from the workspace directory by pubkey, the viewer's own as
 * `CURRENT_USER_NAME` — which is what `ReactionData.owner` and the "You"
 * the card draws both key on. A pubkey the directory does not know is drawn
 * shortened, the way `CommentRow` draws it, rather than blank.
 */
export function project(conversation: FileConversation, viewerPubkey: string | null, people: People | undefined): ProjectedConversation {
  const nameOf = (pubkey: string) =>
    pubkey === viewerPubkey ? CURRENT_USER_NAME : (people?.[pubkey]?.displayName ?? `${pubkey.slice(0, 8)}…`)
  const avatarOf = (pubkey: string) => people?.[pubkey]?.picture

  const byId: Record<string, RootView> = {}
  const reactionsById: Record<string, CommentReaction[]> = {}
  const roots = [...conversation.roots].sort((a, b) => a.createdAt - b.createdAt)

  const decorate = (event: ConversationEvent) => {
    const decoration: CommentDecoration | undefined = conversation.decorations.byId[event.id]
    const edit = conversation.edits[event.id]
    reactionsById[event.id] = decoration?.reactions ?? []
    return {
      body: edit?.body ?? event.body,
      editedAt: edit?.editedAt !== undefined ? edit.editedAt * 1000 : undefined,
      files: (edit?.files ?? event.files).map(asAttachment),
      reactions: groupReactions(decoration?.reactions ?? [], viewerPubkey, nameOf),
      resolutions: decoration?.resolutions ?? [],
    }
  }

  const asReply = (reply: ConversationEvent): ThreadReply => {
    const d = decorate(reply)
    return {
      id: reply.id,
      authorName: nameOf(reply.author),
      authorAvatarSrc: avatarOf(reply.author),
      timestamp: formatReplyTimestamp(reply.createdAt * 1000),
      body: d.body,
      editedAt: d.editedAt,
      createdAtMs: reply.createdAt * 1000,
      files: d.files,
      nostrReferences: reply.references,
      nostrEventId: reply.id,
      reactions: d.reactions,
    }
  }

  const rootData = roots.map((root): ConversationData => {
    const d = decorate(root)
    const replies = (conversation.replies[root.id] ?? []).map(asReply)
    const last = d.resolutions[d.resolutions.length - 1]
    const isResolved = last?.action === 'resolved'
    const seen = new Set<string>()
    const replyAuthors = (conversation.replies[root.id] ?? [])
      .filter((r) => !seen.has(r.author) && seen.add(r.author))
      .map((r) => ({ name: nameOf(r.author), avatarSrc: avatarOf(r.author) }))
    const lastReply = replies[replies.length - 1]
    const data: ConversationData = {
      id: root.id,
      authorName: nameOf(root.author),
      authorAvatarSrc: avatarOf(root.author),
      timestamp: formatTimestamp(root.createdAt * 1000),
      body: d.body,
      editedAt: d.editedAt,
      createdAtMs: root.createdAt * 1000,
      reactions: d.reactions,
      replyCount: replies.length,
      replyAuthors,
      lastReplyTime: lastReply?.createdAtMs ? formatReplyTimestamp(lastReply.createdAtMs) : undefined,
      isResolved,
      resolvedBy: isResolved ? nameOf(last.by) : undefined,
      resolutionMessage: isResolved ? last.message : undefined,
      files: d.files,
      nostrReferences: root.references,
      nostrEventId: root.id,
    }
    byId[root.id] = {
      data,
      replies,
      resolvedByReplyId: isResolved ? last.supportingEventId : undefined,
      resolutionEvents: d.resolutions.map((r) => ({
        kind: r.action,
        by: nameOf(r.by),
        byId: r.by,
        byAvatarUrl: avatarOf(r.by),
        atMs: r.at * 1000,
        message: r.message,
        key: r.id,
        trusted: true,
      })),
    }
    return data
  })

  return { roots: rootData, byId, reactionsById, reactionTargetsOmitted: conversation.decorations.reactionTargetsOmitted }
}

/** One pill per emoji, the viewer's own marked, reactors in reaction order. */
function groupReactions(reactions: readonly CommentReaction[], viewerPubkey: string | null, nameOf: (pubkey: string) => string): ReactionData[] {
  const byEmoji = new Map<string, ReactionData>()
  for (const r of reactions) {
    const pill = byEmoji.get(r.emoji) ?? { emoji: r.emoji, count: 0, owner: 'others' as const, names: [] as string[] }
    pill.count += 1
    pill.names!.push(nameOf(r.by))
    if (r.by === viewerPubkey) pill.owner = 'yours'
    byEmoji.set(r.emoji, pill)
  }
  return [...byEmoji.values()]
}

/** A root's or a reply's body as it stands — its latest edit's, else its own. */
function currentBody(conversation: FileConversation, id: string): string | undefined {
  const event = [...conversation.roots, ...Object.values(conversation.replies).flat()].find((e) => e.id === id)
  return event ? (conversation.edits[id]?.body ?? event.body) : undefined
}

const asAttachment = (f: ConversationEvent['files'][number]): FileAttachment => ({
  name: f.name,
  contentType: f.contentType,
  size: f.size,
  sha256: f.sha256,
  mediaUrl: f.mediaUrl,
  thumbUrl: f.thumbUrl,
})

function groupByDay(convs: ConversationData[]): { dateLabel: string; convs: ConversationData[] }[] {
  const groups: { dateLabel: string; convs: ConversationData[] }[] = []
  for (const c of convs) {
    const dateLabel = formatDateLabel(c.createdAtMs ?? 0)
    const last = groups[groups.length - 1]
    if (last?.dateLabel === dateLabel) last.convs.push(c)
    else groups.push({ dateLabel, convs: [c] })
  }
  return groups
}
