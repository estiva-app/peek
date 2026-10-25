import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject, type UIEventHandler } from 'react'
import { Divider, EmptyState, ScrollArea } from '@estiva-app/ui'
import { isNearBottom } from './scrollPolicy'
import { anchorIn, useSteadyScroll } from './useSteadyScroll'
import { ConversationRow, type RowHandlers } from './ConversationRow'
import { ReactionHorizon } from '@/components/ReactionHorizon'
import { ThreadPanel } from '@/components/ThreadPanel'
import { DateDivider } from '@/components/ui/DateDivider'
import { MetaText } from '@/components/ui/MetaText'
import { ClosedBox, ConversationBox, type SendAnswer, type SendPayload } from '@/components/ui/ConversationBox'
import { SkeletonConversationList } from '@/components/ui/Skeleton'
import { registerTopicConversation, unregisterTopicConversation, type ConversationMessage } from '@/lib/conversationRegistry'
import { draftKeys } from '@/lib/drafts'
import type { Embed } from '@estiva-app/protocol'
import { newestMessageAt, useMarkThreadRead } from '@/lib/useMarkRead'
import { registerThreadOpener, unregisterThreadOpener } from '@/lib/threadOpener'
import { useToast } from '@/lib/toast'
import {
  CURRENT_USER_NAME,
  conversationKeyOf,
  relayAttachmentOf,
  formatDateLabel,
  formatReplyTimestamp,
  useFileConversation,
  useMembership,
  useNewReplyThreads,
  useReplyOnlyThread,
  useWorkspaceDirectory,
  type ConversationContainer,
  type ReplyStream,
  type ConversationData,
  type ConversationEvent,
  type FileAttachment,
  type FileConversation,
  type OutgoingAttachment,
  type ReactionData,
  type ResolutionEvent,
  type ThreadReply,
  type WriteResult,
  TOPIC_NOT_CREATED,
  topicTextBack,
} from '@/api'
import { groupReactions, offersEditAndDelete, REACTION_HORIZON, type ReactionEvent } from '@estiva-app/conversation'
import type { People } from '@estiva-app/interop'
import { formatTimestamp } from '@/api/format'
import { notSavedNote } from '@/lib/notSent'
import { putBackEdit } from '@/lib/refusedEdits'

interface UseFileConversationViewArgs {
  /** Where the conversation is, and nothing about what kind it is. */
  container: ConversationContainer | null
  /**
   * The root comments' ids, off the resolved file; null while it resolves, and
   * the read waits for them (OPT-9). A channel finds its own; pass none.
   */
  rootIds: readonly string[] | null
  /** Which thread is open — the page owns it, because it is in the URL. */
  openThreadId: string | undefined
  onOpenThread: (id: string | null) => void
  /** What the composer says it is writing to. */
  title: string
  /**
   * The conversation as a note names it when a message is not sent — "Not
   * sent — text restored in <this>" (OPT-7). `title` by default, which is a
   * topic's; a DM says "your conversation with <name>".
   */
  noteName?: string
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
  /**
   * Nothing can be written (Katerina, 7 October): an archived file. No
   * composer in either pane, nothing on a message — no menu, no reactions to
   * toggle, nothing on hover — and only a message with replies opens anything.
   */
  readOnly?: boolean
  /** Why nothing can be written, said in the thread's box's place ("Archived. Unarchive it to comment."). */
  closed?: string
}

/** The stream and its composer as a `Panel` takes them: spread them onto one. */
export interface ConversationParts {
  children: ReactNode
  footer: ReactNode
  bodyRef: RefObject<HTMLDivElement | null>
  onBodyScroll: UIEventHandler<HTMLDivElement>
  bodyClassName: string
}

/** The space above a short conversation, so its messages sit on the composer. */
const STREAM_SPACER = 'flex-1 min-h-0'
/** The messages themselves. */
const STREAM = 'shrink-0 flex flex-col px-4 py-4 gap-2'
/** The body's own layout: the spacer and the stream, at least as tall as the pane. */
const BODY = 'flex min-h-full flex-col'

/**
 * A conversation not known yet, as a `Panel`'s body (OPT-9): the same one
 * placeholder, in the same place, that the conversation draws while it reads,
 * so a file whose resolve answers with Peek's own view goes on to its messages
 * with nothing swapped in between. No composer: what may be written here is
 * not known until the file is.
 */
export const conversationPlaceholder: Pick<ConversationParts, 'children' | 'bodyClassName'> = {
  children: (
    <>
      <div className={STREAM_SPACER} />
      <div className={STREAM}>
        <SkeletonConversationList />
      </div>
    </>
  ),
  bodyClassName: BODY,
}

interface ViewSlots {
  /** The stream and its composer — under the page's own header. */
  conversation: ReactNode
  /** The same two, for a `Panel` whose header is the page's. */
  conversationParts: ConversationParts
  /** The open thread, or nothing. */
  threadPanel: ReactNode | undefined
  /** The newest top-level message's `createdAt`, so the read dwell re-arms when one arrives (PEE-44). */
  newestAt: number | undefined
  /** Who is reading, for the read-only pane's own unread rule (CON-34). */
  viewerPubkey: string | null
  /** The thread to open when only a reply is new (`useReplyOnlyThread`): what a Desk click opens (CON-34). */
  replyOnlyThread: string | null | undefined
}

/**
 * Where each conversation was left in this tab (OPT-3): at the bottom or at an
 * offset, the message at the top of the view and how far down it sat, and
 * when, in Unix seconds. Not per viewer: it holds no content.
 */
const positions = new Map<
  string,
  { atBottom: boolean; offset: number; anchor?: { id: string; top: number }; leftAt: number }
>()

const nowSeconds = () => Math.floor(Date.now() / 1000)

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
 * (CON-3: the effective author and an agent's owner are its to know). A
 * reaction, an edit or a delete shows as it is made, and a refusal undoes it
 * with a note (OPT-8); a resolution's refusal comes back as its reason, in a
 * toast. Two of a topic's controls are
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
 * The read watches the file's Folder on the tab's one socket, and a new root —
 * yours as you send it (OPT-6), or one the socket delivers — is drawn from
 * what is held, before the object lists it. `onCommented` re-resolves the
 * object, and is handed down as what to do when the file itself changed.
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
  noteName = title,
  onCommented,
  draftKey,
  empty,
  readOnly = false,
  closed,
}: UseFileConversationViewArgs): ViewSlots {
  const { state, actions, viewerPubkey } = useFileConversation(container, rootIds, {
    onActivity: () => void onCommented?.(),
  })
  const people = useWorkspaceDirectory()
  const { showToast } = useToast()
  const scrollRef = useRef<HTMLDivElement>(null)
  /*
    You are a member of what you comment in (SPEC §11.8): a root or a reply of
    yours makes you one, on the relay's own events, so nothing is written for
    it. The membership read is asked again so this tab judges the file's dot
    at once rather than at the next refresh. Not awaited and not reported.
  */
  const membership = useMembership()
  const membershipAfterWrite = () => {
    if (container?.kind === 'file') void membership.refresh()
  }

  const isLoading = state === 'loading'
  const failed = typeof state === 'object' && 'failed' in state ? state.failed : null
  const conversation: FileConversation | null = typeof state === 'object' && 'roots' in state ? state : null
  /*
    The newest top-level message the pane holds: the DM's or file's read dwell
    re-arms when it moves (PEE-44). Replies are not in it — a reply is read by
    opening its thread, and that is the open thread's own mark, below.
  */
  const newestAt = conversation ? newestMessageAt(conversation.roots) : undefined
  useMarkThreadRead(openThreadId, conversation && openThreadId ? newestMessageAt(conversation.replies[openThreadId] ?? []) : undefined)
  // Which of those threads hold a reply new to the viewer: the "new reply" on its row (PEE-44).
  const stream: ReplyStream | null =
    container?.kind === 'file' ? { kind: 'file', address: container.address } : container ? { kind: 'channel', h: container.h } : null
  const newReplies = useNewReplyThreads(stream, conversation?.replies, viewerPubkey)
  const replyOnlyThread = useReplyOnlyThread(stream, conversation?.roots, conversation?.replies, viewerPubkey)

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
    void (mine ? actions.remove(mine.id) : actions.react(targetEventId, emoji)).then((result) => notSaved('reaction', result))
  }

  /*
    A reaction, an edit or a delete is drawn as it is made and undone if the
    relay refuses it (OPT-8), and this says so — which change, and where what
    came back is — instead of `refuse`'s toast of the relay's own words. Built
    as the change goes out, so the note names this conversation even when the
    person has moved on by the time the relay answers.
  */
  const notSaved = (change: 'reaction' | 'edit' | 'delete', result: WriteResult) => {
    if (!result.ok) showToast({ label: notSavedNote(change, noteName, noteName, result.reason), type: 'error' })
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
  type PendingEdit = { body?: string; files?: FileAttachment[]; embeds?: Embed[] }
  const pendingEdits = useRef(new Map<string, PendingEdit>())
  const queueEdit = (targetEventId: string, change: PendingEdit) => {
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
      // The card set rides the same edit, so it cannot race the body either (OPT-17).
      void actions.edit(targetEventId, body, files, edit?.embeds).then((result) => {
        // The old text is back on the message; what was saved goes back in its edit box (Miky, 9 Oct).
        if (!result.ok) putBackEdit(targetEventId, body)
        notSaved('edit', result)
      })
    })
  }
  const editBody = (targetEventId: string, body: string) => queueEdit(targetEventId, { body })
  const editFiles = (targetEventId: string, files: FileAttachment[]) => queueEdit(targetEventId, { files })
  const editEmbeds = (targetEventId: string, embeds: Embed[]) => queueEdit(targetEventId, { embeds })

  // Gone as it is confirmed, so nothing is said unless it comes back (Miky, 9 Oct).
  const remove = (targetEventId: string) => void actions.remove(targetEventId).then((result) => notSaved('delete', result))

  /*
    The composer's files are the relay's copies (CON-12): `UploadedFile` carries
    `sha256` and `mediaUrl`. A conversation has nowhere but the relay to keep
    the bytes, so a file the relay does not hold cannot be attached here — said
    before the text is lost, by returning false so the composer keeps it.
  */
  const NOT_ON_THE_RELAY = 'a file is not on the relay, so it cannot be attached here'
  const outgoing = (files: readonly FileAttachment[] | undefined): OutgoingAttachment[] | null => {
    const missing = (files ?? []).find((f) => !f.sha256 || !f.mediaUrl)
    if (missing) {
      showToast({
        label: `${missing.name} is not on the relay, so it cannot be attached here.`,
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

  /*
    A refused send is the box's to put back, with the line under it saying why
    (OPT-7; Decided 2026-10-17: no toast). A message refused with its topic
    (PEE-6) also tells the topic's own note, which waits for what came back.
  */
  const notSent = (text: string, reason: string): SendAnswer => {
    if (reason === TOPIC_NOT_CREATED && container?.kind === 'file') topicTextBack(container.address, !!text.trim())
    return { accepted: false, reason }
  }

  const handleSend = async ({ text, resolution, files, urgent, embeds }: SendPayload): Promise<SendAnswer> => {
    const attachments = outgoing(files)
    if (!attachments) return { accepted: false, reason: NOT_ON_THE_RELAY }
    // Your own comment always brings you down to it, as it is drawn — before the relay has answered (OPT-6).
    nearBottom.current = true
    const result = await actions.comment(text, attachments, urgent, embeds)
    if (!result.ok) {
      // Nothing was drawn, or it was taken out again: where the reader actually is decides what follows next.
      if (scrollRef.current) nearBottom.current = isNearBottom(scrollRef.current)
      return notSent(text, result.reason)
    }
    membershipAfterWrite()
    if (resolution) void actions.resolve(result.id, 'resolved', resolution.message).then(refuse)
    return { accepted: true }
  }

  const openRoot = openThreadId && conversation ? conversation.roots.find((r) => r.id === openThreadId) : undefined
  const openView = openThreadId && view ? view.byId[openThreadId] : undefined

  const handleSendReply = async ({ text, resolution, files, urgent, embeds }: SendPayload): Promise<SendAnswer> => {
    if (!openRoot) return { accepted: false, reason: 'its thread is closed' }
    const attachments = outgoing(files)
    if (!attachments) return { accepted: false, reason: NOT_ON_THE_RELAY }
    const result = await actions.reply(openRoot, text, attachments, urgent, embeds)
    if (!result.ok) return notSent(text, result.reason)
    membershipAfterWrite()
    // A resolution written in the thread names the reply that carried it (PEEK-128).
    if (resolution) setResolution(openRoot.id, true, resolution.message, result.id)
    return { accepted: true }
  }

  /*
    What a card does, as one object that never changes, so a card whose message
    did not change is not drawn again when another one arrives (OPT-6: one new
    message re-drew every card of a long topic, ~50–200 ms). Each call reaches
    the handlers of the latest render.
  */
  const latestRow = useRef<RowHandlers | null>(null)
  useLayoutEffect(() => {
    latestRow.current = { setResolution, toggleReaction, editBody, editFiles, editEmbeds, onOpenThread, remove }
  })
  const [rowActions] = useState<RowHandlers>(() => ({
    setResolution: (id, resolved, message) => latestRow.current?.setResolution(id, resolved, message),
    toggleReaction: (id, emoji) => latestRow.current?.toggleReaction(id, emoji),
    editBody: (id, body) => latestRow.current?.editBody(id, body),
    editFiles: (id, files) => latestRow.current?.editFiles(id, files),
    editEmbeds: (id, embeds) => latestRow.current?.editEmbeds(id, embeds),
    onOpenThread: (id) => latestRow.current?.onOpenThread(id),
    remove: (id) => latestRow.current?.remove(id),
  }))

  /**
   * Were you at the live edge when new content arrived? The topic view's
   * policy, unchanged: a re-read that brings someone else's comment follows
   * only if you were already at the bottom.
   */
  const nearBottom = useRef(true)
  const address = container ? conversationKeyOf(container) : null
  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    nearBottom.current = isNearBottom(el)
    if (address && pinnedFor.current === address) {
      positions.set(address, { atBottom: nearBottom.current, offset: el.scrollTop, anchor: anchorIn(el), leftAt: nowSeconds() })
    }
  }

  /*
    Opening a file lands at the bottom, before the paint — once per file, and
    once the comments are there rather than when the address changes. A
    channel's "address" is the channel.

    Going back to one lands where it was left (OPT-3, Miky 8 Oct): at the
    bottom if it was left there, so what arrived meanwhile is in view; at the
    same spot otherwise, with a "New" line above the first message that
    arrived since.
  */
  const pinnedFor = useRef<string | null>(null)
  // Taken once per visit, as the conversation is opened: later scrolling moves the record, not the line.
  const [newSince, setNewSince] = useState<{ address: string; at: number | null }>()
  if (address && newSince?.address !== address) {
    const left = positions.get(address)
    setNewSince({ address, at: left && !left.atBottom ? left.leftAt : null })
  }
  useLayoutEffect(() => {
    if (!address || isLoading) return
    if (pinnedFor.current === address) return
    const el = scrollRef.current
    if (!el) return
    const left = positions.get(address)
    if (left && !left.atBottom) {
      /*
        The message that was at the top, back at the same height — not the same
        offset: what is above it can change height while you are away (a "new
        reply" mark cleared once read, a reaction row past the horizon).
      */
      el.scrollTop = left.offset
      const card = left.anchor && el.querySelector(`[data-root="${CSS.escape(left.anchor.id)}"]`)?.firstElementChild
      if (card) el.scrollTop += card.getBoundingClientRect().top - el.getBoundingClientRect().top - left.anchor!.top
      nearBottom.current = false
    } else {
      el.scrollTop = el.scrollHeight
      nearBottom.current = true
      positions.set(address, { atBottom: true, offset: el.scrollTop, leftAt: nowSeconds() })
    }
    pinnedFor.current = address
  }, [address, isLoading])

  // From there, it stays where the reader is while its cards, chips and images fill in (OPT-10).
  const placed = useCallback(() => !!address && pinnedFor.current === address, [address])
  useSteadyScroll(scrollRef, nearBottom, placed, isLoading)

  // Leaving: the moment it was left is when "New" starts on the way back.
  useEffect(() => {
    if (!address) return
    return () => {
      const left = positions.get(address)
      if (left) positions.set(address, { ...left, leftAt: nowSeconds() })
    }
  }, [address])

  const firstNew =
    newSince?.address === address && newSince.at !== null && conversation
      ? conversation.roots.find((r) => !r.deleted && r.createdAt > newSince.at! && r.author !== viewerPubkey)?.id
      : undefined

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
  // A file's Folder is what Create topic opens on (INT-12); a DM is a channel in no Folder.
  const fileFolder = container?.kind === 'file' ? container.h : undefined
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
      // A deleted root has no author or words to cite; its replies still do.
      return [...(root.isDeleted ? [] : [asMessage(root)]), ...projected.byId[root.id].replies.map(asMessage)]
    })
    registerTopicConversation({ references: [], messages, ...(fileFolder ? { folder: fileFolder } : {}) })
    return unregisterTopicConversation
  }, [conversation, viewerPubkey, people, fileFolder])

  // And how to open one of its threads, for a citation into one that is closed
  // (INT-8) — only while there is a conversation: the Desk runs the DM view's
  // hooks with nothing selected, beside a topic that owns the opener.
  useEffect(() => {
    if (!address) return
    registerThreadOpener(onOpenThread)
    return unregisterThreadOpener
  }, [address, onOpenThread])

  /*
    Close the thread when the file changes to another — not when it is gone
    or still loading, and only when one is open. Closing writes the URL, and a
    refused new topic's file goes as the person is sent back to its Folder:
    the write, against the page being left, undid that (PEE-6).
  */
  const lastAddress = useRef(address)
  useEffect(() => {
    if (!address) return
    if (lastAddress.current && lastAddress.current !== address && openThreadId) onOpenThread(null)
    lastAddress.current = address
  }, [address, onOpenThread, openThreadId])

  // The stream and its composer, as a Panel's body and footer (estiva-ui 0.37.0): the
  // Panel scrolls the stream and keeps the composer under it. A page with a header of
  // its own (a DM) draws the same two in `conversation`, around a ScrollArea of its own.
  const conversationBody = (
    <>
        <div className={STREAM_SPACER} />
        <div className={STREAM}>
          {/* Only the newest messages are here yet (PEE-7): the older ones are read, and drawn above. */}
          {(isLoading || conversation?.earlier) && <SkeletonConversationList />}
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
                <Fragment key={c.id}>
                {/* Ship's unread line, in Peek's short copy (Miky, OPT-3 /land, 8 Oct). */}
                {c.id === firstNew && <Divider label="New" tone="warning" />}
                {/* No box of its own: it names the card, so a return can find the message it left at the top. */}
                <div data-root={c.id} className="contents">
                <ConversationRow
                  c={c}
                  hasNewReply={newReplies.has(c.id)}
                  isSelected={openThreadId === c.id}
                  readOnly={readOnly}
                  actions={rowActions}
                  writtenOn={container?.kind === 'file' ? container.address : undefined}
                />
                </div>
                </Fragment>
              ))}
            </div>
          ))}
          {/*
            The reaction horizon, said out loud — SPEC §6.6, CON-1. Reactions
            were asked for the newest hundred comments and replies; an older
            one drawn with none may well have some, and the reader is told
            rather than left to conclude nobody reacted.
          */}
          {view && <ReactionHorizon omitted={view.reactionTargetsOmitted} cut={view.reactionEventsCut} container="conversation" />}
          {/*
            The whole read will say its horizon on that line (PEE-7): its room is kept while only the newest
            messages are here, so they do not move up when the rest lands under a reader at the bottom.
          */}
          {view && !view.reactionTargetsOmitted && (conversation?.earlier?.messages ?? 0) > REACTION_HORIZON && (
            <div className="invisible" aria-hidden>
              <ReactionHorizon omitted={1} container="conversation" />
            </div>
          )}
        </div>
    </>
  )
  const composer = readOnly ? (
    closed ? (
      <div className="p-3">
        <ClosedBox reason={closed} />
      </div>
    ) : undefined
  ) : (
      <div className="p-3">
        <ConversationBox
          onSend={handleSend}
          contextLabel={title}
          draftKey={draftKey ?? (container?.kind === 'file' ? draftKeys.object(container.address) : undefined)}
          here={container?.kind === 'file' ? container.address : undefined}
        />
      </div>
  )
  const conversationParts: ConversationParts = { children: conversationBody, footer: composer, bodyRef: scrollRef, onBodyScroll: handleScroll, bodyClassName: BODY }
  const conversationSlot = (
    <>
      <ScrollArea className="flex-1" viewportRef={scrollRef} onScroll={handleScroll} contentClassName={BODY}>
        {conversationBody}
      </ScrollArea>
      {composer}
    </>
  )

  const threadPanel =
    openRoot && openView ? (
      <ThreadPanel
        conversation={openView.data}
        replies={openView.replies}
        sentReplies={[]}
        resolutionEvents={openView.resolutionEvents}
        isResolved={openView.data.isResolved ?? false}
        resolvedByReplyId={openView.resolvedByReplyId}
        resolutionMsg={openView.data.resolutionMessage}
        initialReactions={openView.data.reactions}
        onInitialReactionsChange={(_next, emoji) => toggleReaction(openRoot.id, emoji)}
        onInitialBodyChange={(b) => editBody(openRoot.id, b)}
        onInitialFilesChange={(f) => editFiles(openRoot.id, f)}
        onInitialEmbedsChange={(e) => editEmbeds(openRoot.id, e)}
        onResolutionChange={(resolved, message) => setResolution(openRoot.id, resolved, message)}
        onClose={() => onOpenThread(null)}
        onSendReply={handleSendReply}
        writtenOn={container?.kind === 'file' ? container.address : undefined}
        readOnly={readOnly}
        readOnlyNotice={readOnly && closed ? <ClosedBox reason={closed} /> : undefined}
        // MetaText is a single line; a sentence in a narrow panel has to wrap.
        composerNotice={openView.data.isDeleted ? <MetaText className="whitespace-normal">The comment was deleted, so this thread takes no new replies.</MetaText> : undefined}
        onDeleteReply={(id) => remove(id)}
        onReplyBodyChange={(id, b) => editBody(id, b)}
        onReplyFilesChange={(id, f) => editFiles(id, f)}
        onReplyEmbedsChange={(id, e) => editEmbeds(id, e)}
        onReplyReactionsChange={(id, _next, _prev, emoji) => toggleReaction(id, emoji)}
      />
    ) : undefined

  return { conversation: conversationSlot, conversationParts, threadPanel, newestAt, viewerPubkey, replyOnlyThread }
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
  reactionsById: Record<string, ReactionEvent[]>
  reactionTargetsOmitted: number
  /** A reaction read came back at the relay's page ceiling (SPEC §6.6). */
  reactionEventsCut: boolean
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
  const reactionsById: Record<string, ReactionEvent[]> = {}
  const roots = [...conversation.roots].sort((a, b) => a.createdAt - b.createdAt)

  // SPEC §6.5 (SHI-29): only the viewer's own message — not another person's,
  // not an agent's. Nothing on a deleted root, which has no author.
  const offersControls = (event: ConversationEvent): boolean =>
    !event.deleted && offersEditAndDelete({ viewer: viewerPubkey, author: event.author })

  const decorate = (event: ConversationEvent) => {
    const decoration = conversation.decorations.byId[event.id.toLowerCase()]
    const edit = decoration?.edit
    reactionsById[event.id] = decoration?.reactions ?? []
    return {
      body: edit?.body ?? event.body,
      editedAt: edit?.editedAt,
      files: (edit?.attachments?.map(relayAttachmentOf) ?? event.files).map(asAttachment),
      embeds: conversation.editedEmbeds?.[event.id.toLowerCase()] ?? event.embeds,
      reactions: pillsOf(event.id, decoration?.reactions ?? [], viewerPubkey, nameOf),
      resolutions: decoration?.resolutions ?? [],
      canEditAndDelete: offersControls(event),
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
      canEditAndDelete: d.canEditAndDelete,
      createdAtMs: reply.createdAt * 1000,
      files: d.files,
      nostrReferences: reply.references,
      urgentMentions: reply.urgent,
      parts: reply.parts,
      embeds: d.embeds,
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
      authorName: root.deleted ? '' : nameOf(root.author),
      authorAvatarSrc: root.deleted ? undefined : avatarOf(root.author),
      isDeleted: root.deleted,
      timestamp: formatTimestamp(root.createdAt * 1000),
      body: d.body,
      editedAt: d.editedAt,
      canEditAndDelete: d.canEditAndDelete,
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
      urgentMentions: root.urgent,
      parts: root.parts,
      embeds: d.embeds,
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

  return {
    roots: rootData,
    byId,
    reactionsById,
    reactionTargetsOmitted: conversation.decorations.reactionTargetsOmitted,
    reactionEventsCut: conversation.decorations.reactionEventsCut,
  }
}

/** One pill per emoji (`@estiva-app/conversation`'s `groupReactions`, SPEC §6.6), the viewer's own marked, reactors in reaction order. */
function pillsOf(target: string, reactions: readonly ReactionEvent[], viewerPubkey: string | null, nameOf: (pubkey: string) => string): ReactionData[] {
  const grouped = groupReactions(reactions, viewerPubkey ?? undefined)[target.toLowerCase()] ?? []
  return grouped.map((r) => ({ emoji: r.emoji, count: r.count, owner: r.mine ? ('yours' as const) : ('others' as const), names: r.by.map(nameOf) }))
}

/** A root's or a reply's body as it stands — its latest edit's, else its own. */
function currentBody(conversation: FileConversation, id: string): string | undefined {
  const event = [...conversation.roots, ...Object.values(conversation.replies).flat()].find((e) => e.id === id)
  return event ? (conversation.decorations.byId[id.toLowerCase()]?.edit?.body ?? event.body) : undefined
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
