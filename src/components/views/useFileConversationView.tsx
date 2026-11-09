import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Divider, EmptyState, GONE_CLOSED, MetaText, ReactionHorizon, SkeletonConversation, useLeftAt, useSeenOnScreen, type ConversationItem, type ConversationLayoutProps } from '@estiva-app/ui'
import { ConversationRow, type RowHandlers } from './ConversationRow'
import { ThreadPanel } from '@/components/ThreadPanel'
import { ClosedBox, ConversationBox, type SendAnswer, type SendPayload } from '@/components/ui/ConversationBox'
import { registerTopicConversation, unregisterTopicConversation, type ConversationMessage } from '@/lib/conversationRegistry'
import { browserDrafts, draftKeys } from '@/lib/drafts'
import type { Embed } from '@estiva-app/protocol'
import { newestMessageAt, useMarkThreadRead } from '@/lib/useMarkRead'
import { registerThreadOpener, unregisterThreadOpener } from '@/lib/threadOpener'
import { useToast } from '@/lib/toast'
import {
  CURRENT_USER_NAME,
  conversationKeyOf,
  isGone,
  relayAttachmentOf,
  formatDateLabel,
  formatReplyTimestamp,
  useFileConversation,
  useMembership,
  isUrgentForViewer,
  useNewReplyThreads,
  useNewWhenDrawn,
  useReplyOnlyThread,
  useUrgentReplyThreads,
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
import { notSavedNote, notSentNote } from '@/lib/notSent'
import { putBackEdit } from '@/lib/refusedEdits'
import type { ReactionAnswer } from '@/lib/reactions'

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

/**
 * The messages, their open thread and the composer as the kit's `ConversationLayout` takes them, two columns: spread
 * them onto one, with the page's own `header`. The open thread stands in the layout's column beside, 384px; the page
 * adds what that column holds while none is open (`aside`, a file's Overview). Where the messages scroll, and which
 * were seen, are the layout's: it is told the conversation's name (`rememberAs`) and what to watch (`seen`).
 */
export type ConversationParts = Pick<
  ConversationLayoutProps,
  'items' | 'open' | 'onOpenChange' | 'aside' | 'box' | 'above' | 'below' | 'loading' | 'empty' | 'rememberAs' | 'seen'
>

/**
 * A conversation not known yet (OPT-9): the layout reading, its one placeholder sitting on the box, as the
 * conversation draws while it reads, so a file whose resolve answers with Peek's own view goes on to its messages
 * with nothing swapped in between. No composer: what may be written here is not known until the file is.
 */
export const conversationPlaceholder: ConversationParts = { items: [], loading: true }

interface ViewSlots {
  /** The messages, the open thread and the composer, for the kit's `ConversationLayout` under the page's own header. */
  conversationParts: ConversationParts
  /** The open thread is drawn (its root is in hand), so a scroll to a message in it can land. */
  threadDrawn: boolean
  /**
   * The newest top-level message seen on screen, `createdAt`: what the DM or
   * file is marked read up to, with no dwell of its own — being seen took one
   * (Katerina, 30 October). It moves as more is seen, and with it the mark (PEE-44).
   */
  seenAt: number | undefined
  /** Who is reading, for the read-only pane's own unread rule (CON-34). */
  viewerPubkey: string | null
  /** The thread to open when only a reply is new (`useReplyOnlyThread`): what a Desk click opens (CON-34). */
  replyOnlyThread: string | null | undefined
}

/** The drafts every box keeps (CON-10), read to know whether a thread's reply box holds text. */
const drafts = browserDrafts()
const replyHoldsText = (threadId: string) => !!drafts.read(draftKeys.thread(threadId))?.trim()

/**
 * A file's conversation drawn as Peek's own — FOL-31.
 *
 * The same cards, composer and thread pane a topic gets, over `kind:1111`
 * read from the relay by `useFileConversation` instead of `kind:9` read from
 * Convex by `useTopicMessages`. `useTopicView` is not reused because it is
 * bound to Convex's row-and-override model end to end; this hook mirrors what
 * it *draws* — date groups under a sticky divider, the reaction horizon said
 * out loud, the thread pane keyed on its root — and
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
  const address = container ? conversationKeyOf(container) : null
  /*
    A message is read by being seen (Katerina, 30 October): on screen for a
    moment, in the stream or in its open thread — not by its conversation
    being open. The newest top-level message seen is what the DM or file is
    marked up to, and the newest reply seen in the open thread is what the
    thread is (PEE-44: a reply is read only in its thread). The marker is a
    time, so a message older than one seen is read with it. Nothing is seen
    before what was new has been judged, or it would be judged read.
  */
  const stream: ReplyStream | null =
    container?.kind === 'file' ? { kind: 'file', address: container.address } : container ? { kind: 'channel', h: container.h } : null
  const newWhenDrawn = useNewWhenDrawn(stream, conversation?.roots, conversation?.replies, viewerPubkey)
  // The kit's watch (ConversationLayout's and Thread's `seen`): its messages by the layout, its replies by the thread.
  const seenRoots = useSeenOnScreen(newWhenDrawn ? address : null)
  const seenReplies = useSeenOnScreen(newWhenDrawn ? (openThreadId ?? null) : null)
  const seenAt = conversation ? newestMessageAt(conversation.roots.filter((r) => seenRoots.ids.has(r.id))) : undefined
  const openReplies = conversation && openThreadId ? conversation.replies[openThreadId] : undefined
  useMarkThreadRead(openThreadId, openReplies ? newestMessageAt(openReplies.filter((r) => seenReplies.ids.has(r.id))) : undefined, 0)
  // Which of those threads hold a reply new to the viewer: the "new reply" on its row (PEE-44).
  const newReplies = useNewReplyThreads(stream, conversation?.replies, viewerPubkey)
  const urgentReplies = useUrgentReplyThreads(stream, conversation?.replies, viewerPubkey)
  const replyOnlyThread = useReplyOnlyThread(stream, conversation?.roots, conversation?.replies, viewerPubkey)
  // What was new as it was drawn keeps the unread look until it is seen; urgent for you, in its urgent tone.
  const unseen = (id: string, seen: { ids: ReadonlySet<string> }) => !!newWhenDrawn?.has(id) && !seen.ids.has(id)
  const urgentRoots = new Set(conversation?.roots.filter((r) => !isGone(r) && isUrgentForViewer(r, viewerPubkey)).map((r) => r.id))

  const view = conversation ? project(conversation, viewerPubkey, people) : null

  const liveRoot = openThreadId && conversation ? conversation.roots.find((r) => r.id === openThreadId) : undefined
  const liveView = openThreadId && view ? view.byId[openThreadId] : undefined
  /*
    The open thread as last read. A comment with no replies leaves the read the moment it is deleted; while its reply
    box holds text it stays where it was, as "This comment was deleted." with the box, so the text is not lost and Send
    says why it is refused (ONE-10, Decided 9 November). Kept until the thread is closed: Peek's box empties its draft
    the moment Send is pressed and draws the reply before the relay answers, so a check of the draft on that render
    would close the thread, and the refusal with it.
  */
  const [lastOpen, setLastOpen] = useState<{ root: NonNullable<typeof liveRoot>; view: NonNullable<typeof liveView> }>()
  if (liveRoot && liveView && lastOpen?.root !== liveRoot) setLastOpen({ root: liveRoot, view: liveView })
  /** The open thread whose comment went while its reply box held text; its box stays until the thread is closed. */
  const [boxKept, setBoxKept] = useState<string>()
  const goneNow = !!openThreadId && (liveView ? liveView.data.isDeleted || liveView.data.isUnseen : !!view && lastOpen?.root.id === openThreadId)
  if (boxKept !== undefined && boxKept !== openThreadId) setBoxKept(undefined)
  else if (goneNow && boxKept !== openThreadId && replyHoldsText(openThreadId)) setBoxKept(openThreadId)
  const keepsBox = !!openThreadId && boxKept === openThreadId
  const held =
    view && !liveRoot && openThreadId && lastOpen?.root.id === openThreadId && keepsBox
      ? { root: lastOpen.root, view: { ...lastOpen.view, data: { ...lastOpen.view.data, isDeleted: true, isUnseen: false, replyCount: 0 }, replies: [] } }
      : undefined
  const roots = view ? (held ? [...view.roots, held.view.data].sort((a, b) => (a.createdAtMs ?? 0) - (b.createdAtMs ?? 0)) : view.roots) : []
  const groups = groupByDay(roots)

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
    The relay's answer goes back to the card as it came: the kit's card says a
    refusal under the message, in the shared words, as Ship and Leaf do (ONE-4).
  */
  const toggleReaction = async (targetEventId: string, emoji: string): Promise<ReactionAnswer> => {
    const mine = view?.reactionsById[targetEventId]?.find((r) => r.emoji === emoji && r.by === viewerPubkey)
    const result = await (mine ? actions.remove(mine.id) : actions.react(targetEventId, emoji))
    return result.ok ? { accepted: true } : { accepted: false, reason: result.reason }
  }

  /*
    An edit or a delete is drawn as it is made and undone if the relay refuses
    it (OPT-8), and this says so — which change, why, and where what came back
    is — instead of `refuse`'s toast of the relay's own words. Built as the
    change goes out, so the note names this conversation even when the person
    has moved on by the time the relay answers.
  */
  const notSaved = (change: 'edit' | 'delete', result: WriteResult | { ok: false; reason: unknown }) => {
    if (!result.ok) showToast({ label: notSavedNote(change, noteName, result.reason), type: 'error' })
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
      const current = conversation ? currentFiles(conversation, targetEventId) : undefined
      let files: OutgoingAttachment[]
      if (edit?.files) {
        // A file the message already had goes back as its `imeta` was read, every field kept; a new one as uploaded.
        // An empty set is the edit that takes every file off.
        const had = new Map((current ?? []).map((f) => [f.sha256, f]))
        files = edit.files.map((f) => (f.sha256 && had.get(f.sha256)) || outgoing([f])[0])
      } else {
        // Files untouched still ride the edit: an edit is the whole new message, and one with none takes them off.
        // Unknown when the message is not in hand, so that edit is not sent.
        // why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/an-edit-is-the-whole-new-message.md
        if (!current) {
          // Peek's own cause, said in the shared words ("something went wrong, try again").
          const reason = { cause: 'unknown' }
          if (!putBackEdit(targetEventId, { text: body, reason })) notSaved('edit', { ok: false, reason })
          return
        }
        files = current
      }
      // The card set rides the same edit, so it cannot race the body either (OPT-17).
      void actions.edit(targetEventId, body, files, edit?.embeds).then((result) => {
        if (result.ok) return
        // The old text is back on the message; what was saved goes back in its edit box with why under it (Miky, 9 Oct;
        // PEEKM-4). A note only when no card of it is on screen to reopen.
        if (!putBackEdit(targetEventId, { text: body, reason: result.reason, files: edit?.files })) notSaved('edit', result)
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
    under the box, with the words kept in it, in the shared words (Peek's own
    cause, ONE-4).
  */
  const notOnTheRelay = (files: readonly FileAttachment[] | undefined): SendAnswer | undefined => {
    const missing = (files ?? []).find((f) => !f.sha256 || !f.mediaUrl)
    return missing ? { accepted: false, reason: { cause: 'unknown' } } : undefined
  }
  const outgoing = (files: readonly FileAttachment[] | undefined): OutgoingAttachment[] =>
    (files ?? []).map(({ name, contentType, size, sha256, mediaUrl, thumbUrl }) => ({
      name,
      contentType,
      size,
      sha256,
      mediaUrl,
      thumbUrl,
    }))

  /*
    A refused send is the box's to put back, with the line under it saying why
    (OPT-7; Decided 2026-10-17: no toast). A message refused with its topic
    (PEE-6) tells the topic's own note instead, which waits for what came back.
    When the person has moved on before the relay answered, the box is gone and
    its line cannot be seen: the note says it, with the box's reason, naming
    where the text went back to — its draft there (the record's "Not sent —
    text restored in <topic>"). The reason goes to the box as it came: the box
    says it in the shared words (ONE-4).
    why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-refused-action-is-undone-and-your-text-comes-back.md
  */
  const notSent = (where: string, payload: SendPayload, reason: string, away: () => boolean): SendAnswer => {
    const text = !!payload.text.trim()
    if (reason === TOPIC_NOT_CREATED && container?.kind === 'file') topicTextBack(container.address, text)
    else if (away()) showToast({ label: notSentNote(where, reason, { text, files: false, filesLost: !!payload.files?.length }), type: 'error' })
    return { accepted: false, reason }
  }

  const handleSend = async (payload: SendPayload, away: () => boolean): Promise<SendAnswer> => {
    const { text, resolution, files, urgent, embeds } = payload
    const missing = notOnTheRelay(files)
    if (missing) return missing
    const attachments = outgoing(files)
    // Your own comment brings you down to it as it is drawn, and a refusal leaves where you are to decide: the layout's (OPT-6).
    const result = await actions.comment(text, attachments, urgent, embeds)
    if (!result.ok) return notSent(noteName, payload, result.reason, away)
    membershipAfterWrite()
    if (resolution) void actions.resolve(result.id, 'resolved', resolution.message).then(refuse)
    return { accepted: true }
  }

  const openRoot = liveRoot ?? held?.root
  const openView = liveView ?? held?.view

  const handleSendReply = async (payload: SendPayload, away: () => boolean): Promise<SendAnswer> => {
    const { text, resolution, files, urgent, embeds } = payload
    if (!openRoot) return { accepted: false, reason: { cause: 'unknown' } }
    const missing = notOnTheRelay(files)
    if (missing) return missing
    const where = openView ? `your reply to ${openView.data.authorName}` : noteName
    const result = await actions.reply(openRoot, text, outgoing(files), urgent, embeds)
    if (!result.ok) return notSent(where, payload, result.reason, away)
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
    latestRow.current = { setResolution, toggleReaction, editBody, editFiles, editEmbeds, remove }
  })
  const [rowActions] = useState<RowHandlers>(() => ({
    setResolution: (id, resolved, message) => latestRow.current?.setResolution(id, resolved, message),
    toggleReaction: async (id, emoji) => latestRow.current?.toggleReaction(id, emoji),
    editBody: (id, body) => latestRow.current?.editBody(id, body),
    editFiles: (id, files) => latestRow.current?.editFiles(id, files),
    editEmbeds: (id, embeds) => latestRow.current?.editEmbeds(id, embeds),
    remove: (id) => latestRow.current?.remove(id),
  }))

  /*
    Where the messages scroll is the kit's ConversationLayout's (C1, 2 November): it opens a file at its newest, comes
    back to where it was left (OPT-3), follows what arrives only at the live edge, and holds still while cards fill in
    (OPT-10). Going back to one left away from its newest draws a "New" line above the first message from someone else
    since: when it was left is the layout's record, under the same name (`rememberAs`).
  */
  const leftAt = useLeftAt(address)
  const firstNew =
    leftAt !== null && conversation
      ? conversation.roots.find((r) => !isGone(r) && r.createdAt > Math.floor(leftAt / 1000) && r.author !== viewerPubkey)?.id
      : undefined

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
      return [...(root.isDeleted || root.isUnseen ? [] : [asMessage(root)]), ...projected.byId[root.id].replies.map(asMessage)]
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

  // Its replies carry the unread look until each is seen, as the stream's messages do.
  const urgentInThread = new Set(openReplies?.filter((r) => isUrgentForViewer(r, viewerPubkey)).map((r) => r.id))
  const threadReplies = openView?.replies.map((r) =>
    unseen(r.id, seenReplies) ? { ...r, isNew: true, isUrgent: urgentInThread.has(r.id) } : r,
  )
  const threadPanel =
    openRoot && openView ? (
      <ThreadPanel
        conversation={openView.data}
        replies={threadReplies ?? openView.replies}
        resolutionEvents={openView.resolutionEvents}
        isResolved={openView.data.isResolved ?? false}
        resolvedByReplyId={openView.resolvedByReplyId}
        resolutionMsg={openView.data.resolutionMessage}
        onResolutionChange={(resolved, message) => setResolution(openRoot.id, resolved, message)}
        onClose={() => onOpenThread(null)}
        onSendReply={handleSendReply}
        writtenOn={container?.kind === 'file' ? container.address : undefined}
        readOnly={readOnly}
        readOnlyNotice={readOnly && closed ? <ClosedBox reason={closed} /> : undefined}
        // MetaText, as before the adoption (in Signal the mono micro-type); it is one line, and a sentence in a narrow panel has to wrap.
        // Its comment gone, the kit's one sentence for it, as Leaf and Ship say it (SPEC §6.5): the pinned card above says why.
        // A reply being written when its comment went keeps its box, and Send says why it is refused (ONE-10).
        composerNotice={(openView.data.isDeleted || openView.data.isUnseen) && !keepsBox ? (
          // @estiva-escape(no-restyled-part): a sentence, not a time: it wraps in the narrow thread column, as it did before the adoption (audit A17); the kit's MetaText has no way to wrap yet
          <MetaText className="whitespace-normal">{GONE_CLOSED}</MetaText>
        ) : undefined}
        onDeleteReply={(id) => remove(id)}
        onReplyBodyChange={(id, b) => editBody(id, b)}
        onReplyFilesChange={(id, f) => editFiles(id, f)}
        onReplyEmbedsChange={(id, e) => editEmbeds(id, e)}
        onReplyReactionsChange={(id, _next, _prev, emoji) => toggleReaction(id, emoji)}
        seen={seenReplies}
      />
    ) : undefined

  /*
    The messages, the open thread and the composer, as the kit's ConversationLayout takes them (two columns): it
    scrolls the messages, sits a short conversation on the composer, draws each day's line over its stretch, keeps the
    composer under them and the open thread in its column beside. A press on a card, its replies row or Reply asks it
    open (`onOpenChange`); which one is open stays the page's, in its URL (`open`). Only the open one is built.
  */
  const items: ConversationItem[] = groups.flatMap((group) =>
    group.convs.map((c) => ({
      id: c.id,
      day: group.dateLabel,
      // Ship's unread line, in Peek's short copy (Miky, OPT-3 /land, 8 Oct).
      before: c.id === firstNew ? <Divider label="New" tone="warning" /> : undefined,
      card: (
        <ConversationRow
          c={c}
          hasNewMessage={unseen(c.id, seenRoots)}
          hasNewReply={newReplies.has(c.id)}
          isUrgent={(unseen(c.id, seenRoots) && urgentRoots.has(c.id)) || (newReplies.has(c.id) && urgentReplies.has(c.id))}
          readOnly={readOnly}
          actions={rowActions}
          writtenOn={container?.kind === 'file' ? container.address : undefined}
        />
      ),
      thread: () => threadPanel,
    })),
  )
  const failedLine = failed && (
    <EmptyState
      scope="section"
      message={
        failed === 'not_a_member'
          ? container?.kind === 'channel'
            ? 'You are not a member of this conversation.'
            : 'You are not a member of the team this file is in.'
          : failed === 'refused'
            ? 'The relay refused to show this conversation.'
            : 'The relay could not be reached.'
      }
    />
  )
  const conversationParts: ConversationParts = {
    items,
    open: openThreadId,
    onOpenChange: (id) => onOpenThread(id ?? null),
    loading: isLoading,
    // Only the newest messages are here yet (PEE-7): the older ones are read, and drawn above.
    above: conversation?.earlier ? <SkeletonConversation /> : undefined,
    empty: failedLine || (view ? (empty ?? <EmptyState scope="section" message="Nobody has commented yet." />) : null),
    /*
      The reaction horizon, said out loud — SPEC §6.6, CON-1. Reactions were asked for the newest hundred comments and
      replies; an older one drawn with none may well have some, and the reader is told rather than left to conclude
      nobody reacted. Peek calls them messages, as it always did (Katerina, 1 November: keep Peek's words). The whole
      read will say its horizon on that line (PEE-7): its room is kept while only the newest messages are here, so they
      do not move up when the rest lands under a reader at the bottom.
    */
    below: view && (
      <ReactionHorizon
        limit={REACTION_HORIZON}
        omitted={view.reactionTargetsOmitted}
        cut={view.reactionEventsCut}
        noun="messages"
        keepRoom={(conversation?.earlier?.messages ?? 0) > REACTION_HORIZON}
      />
    ),
    box: readOnly ? (
      closed ? (
        <ClosedBox reason={closed} />
      ) : undefined
    ) : (
      <ConversationBox
        onSend={handleSend}
        contextLabel={title}
        draftKey={draftKey ?? (container?.kind === 'file' ? draftKeys.object(container.address) : undefined)}
        here={container?.kind === 'file' ? container.address : undefined}
      />
    ),
    // A channel's "address" is the channel.
    rememberAs: address ?? undefined,
    seen: seenRoots,
  }

  return { conversationParts, threadDrawn: threadPanel !== undefined, seenAt, viewerPubkey, replyOnlyThread }
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
 * `CURRENT_USER_NAME` — which is what the reaction row lights your pills and
 * says "you" by. A pubkey the directory does not know is drawn as a
 * dash, as the kit's Person draws a nameless person: never part of their key.
 */
export function project(conversation: FileConversation, viewerPubkey: string | null, people: People | undefined): ProjectedConversation {
  // Only the viewer is CURRENT_USER_NAME: someone who calls themselves "You" is drawn by their key, or their pill would light as yours.
  const nameOf = (pubkey: string) => {
    if (pubkey === viewerPubkey) return CURRENT_USER_NAME
    const name = people?.[pubkey]?.displayName
    // A dash for a person nobody has named, as the kit's Person draws one: never their key (A27).
    return name && name.trim().toLowerCase() !== CURRENT_USER_NAME.toLowerCase() ? name : '—'
  }
  const avatarOf = (pubkey: string) => people?.[pubkey]?.picture
  // The profile says it is an agent (NIP-24 `bot`), never its name: its face is the kit's robot.
  const botOf = (pubkey: string) => people?.[pubkey]?.bot === true

  const byId: Record<string, RootView> = {}
  const reactionsById: Record<string, ReactionEvent[]> = {}
  const roots = [...conversation.roots].sort((a, b) => a.createdAt - b.createdAt)

  // SPEC §6.5 (SHI-29): only the viewer's own message — not another person's,
  // not an agent's. Nothing on a gone root, which has no author.
  const offersControls = (event: ConversationEvent): boolean =>
    !isGone(event) && offersEditAndDelete({ viewer: viewerPubkey, author: event.author })

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
      authorBot: botOf(reply.author),
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
      ownFile: reply.ownFile,
      nostrEventId: reply.id,
      reactions: d.reactions,
    }
  }

  const rootData = roots.map((root): ConversationData => {
    const d = decorate(root)
    const replies = (conversation.replies[root.id] ?? []).map(asReply)
    // The resolve that counts (§6.4, C51), as the shared fold read it — also under a comment that is gone (§6.5).
    const thread = conversation.threads[root.id]
    const last = thread?.resolution
    const isResolved = last?.action === 'resolved'
    const gone = isGone(root)
    const seen = new Set<string>()
    const replyAuthors = (conversation.replies[root.id] ?? [])
      .filter((r) => !seen.has(r.author) && seen.add(r.author))
      .map((r) => ({ name: nameOf(r.author), avatarSrc: avatarOf(r.author), bot: botOf(r.author) }))
    const lastReply = replies[replies.length - 1]
    const data: ConversationData = {
      id: root.id,
      authorName: gone ? '' : nameOf(root.author),
      authorAvatarSrc: gone ? undefined : avatarOf(root.author),
      authorBot: gone ? undefined : botOf(root.author),
      isDeleted: root.deleted,
      isUnseen: root.unseen,
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
      ownFile: root.ownFile,
      nostrEventId: root.id,
    }
    byId[root.id] = {
      data,
      replies,
      resolvedByReplyId: isResolved ? last.supportingEventId : undefined,
      // Only the resolves filed in the thread's Folder, as the state above counts them (§6.4, C51): the timeline never says otherwise.
      resolutionEvents: d.resolutions.filter((r) => !thread?.folder || r.folder === thread.folder).map((r) => ({
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

/**
 * One pill per emoji (`@estiva-app/conversation`'s `groupReactions`, SPEC §6.6), reactors in reaction order, each
 * known by their key, so two people with the same name are two reactors (ONE-9). The viewer is `CURRENT_USER_NAME`,
 * which is what a toggle adds and takes away; `names` says each one's name.
 */
function pillsOf(target: string, reactions: readonly ReactionEvent[], viewerPubkey: string | null, nameOf: (pubkey: string) => string): ReactionData[] {
  const grouped = groupReactions(reactions, viewerPubkey ?? undefined)[target.toLowerCase()] ?? []
  return grouped.map((r) => {
    const by = r.by.map((key) => (key === viewerPubkey ? CURRENT_USER_NAME : key))
    return { emoji: r.emoji, by, names: Object.fromEntries(r.by.map((key, i) => [by[i], nameOf(key)])) }
  })
}

const messageOf = (conversation: FileConversation, id: string): ConversationEvent | undefined =>
  [...conversation.roots, ...Object.values(conversation.replies).flat()].find((e) => e.id === id)

/** A root's or a reply's body as it stands — its latest edit's, else its own. */
function currentBody(conversation: FileConversation, id: string): string | undefined {
  const event = messageOf(conversation, id)
  return event ? (conversation.decorations.byId[id.toLowerCase()]?.edit?.body ?? event.body) : undefined
}

/** A root's or a reply's files as they stand, drawn as {@link currentBody}'s: the latest edit's set, else its own. */
function currentFiles(conversation: FileConversation, id: string): ConversationEvent['files'] | undefined {
  const event = messageOf(conversation, id)
  return event ? (conversation.decorations.byId[id.toLowerCase()]?.edit?.attachments?.map(relayAttachmentOf) ?? event.files) : undefined
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
