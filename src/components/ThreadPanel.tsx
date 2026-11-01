import { useRef, useEffect, useLayoutEffect, useMemo, type ReactNode } from 'react'
import { IconArrowNarrowRight } from '@tabler/icons-react'
import { MetaText, Thread } from '@estiva-app/ui'
import { ReplyCard } from './ReplyCard'
import { draftKeys } from '@/lib/drafts'
import { ConversationBox, type SendAnswer, type SendPayload } from './ui/ConversationBox'
import { formatReplyTimestamp } from '@/api'
import type { ConversationData, FileAttachment, ReactionData, ResolutionEvent, ThreadReply } from '@/api'
import { registerActiveConversation, unregisterActiveConversation } from '@/lib/conversationRegistry'
import { findNaddrs, type Embed } from '@estiva-app/protocol'
import { cn } from '@/lib/utils'
import { previewText } from '@/lib/textParsing'
import { useSteadyScroll } from '@/components/views/useSteadyScroll'

/** A thread is placed as it opens, at its bottom: the keeper may act from the first resize. */
const always = () => true

// ── Thread Panel ──

/**
 * Resolve/reopen history as timeline bullets sitting chronologically among
 * the replies (ruling 2026-07-28: bullets, not banners/dividers — and the
 * FULL history, so resolve → reopen → resolve reads as a timeline).
 * Consecutive events share one block with a connecting line between dots.
 */
function ResolutionTimeline({ events }: { events: ResolutionEvent[] }) {
  return (
    <div data-resolution-timeline className="relative flex flex-col gap-2 py-1">
      {/* Connector runs through the dot column's center — x = 20px, the same
          axis as the reply cards' avatars (card p-2 + 24px avatar). */}
      {events.length > 1 && (
        <div aria-hidden className="absolute left-[19.5px] top-[12px] bottom-[12px] w-px bg-border-default" />
      )}
      {events.map((e, i) => (
        <div
          key={e.key ?? `${e.kind}-${e.atMs ?? i}`}
          data-resolution-event={e.kind}
          className="relative flex items-start"
        >
          {/* Dot column mirrors the cards' avatar column (40px, centered) so
              bullets line up with avatars; the disc masks the connector. */}
          <span className="flex items-center justify-center w-10 h-[17px] shrink-0">
            <span className="flex items-center justify-center size-2 rounded-full bg-bg-surface">
              <span className={cn('size-1 rounded-full', e.kind === 'resolved' ? 'bg-success-default' : 'bg-text-muted')} />
            </span>
          </span>
          <p className="text-h5 leading-snug min-w-0">
            {e.kind === 'resolved' ? (
              <>
                <span className="text-success-default whitespace-nowrap">{e.by || 'Someone'} resolved</span>
                {e.message && (
                  <>
                    <IconArrowNarrowRight size={12} stroke={1.5} className="inline shrink-0 mx-1.5 -mt-px text-text-primary" />
                    <span className="text-text-primary">{e.message}</span>
                  </>
                )}
              </>
            ) : (
              <>
                <span className="text-text-primary">{e.by || 'Someone'}</span>
                <span className="text-text-secondary"> reopened</span>
              </>
            )}
            {e.atMs !== undefined && (
              <MetaText size="chip">
                {' '}· {formatReplyTimestamp(e.atMs)}
              </MetaText>
            )}
          </p>
        </div>
      ))}
    </div>
  )
}

type ThreadRow =
  | { t: 'reply'; reply: ThreadReply }
  | { t: 'events'; events: ResolutionEvent[] }

/**
 * Interleave the resolution events into the reply sequence by time: an event
 * renders after every reply that predates it. Two clock domains are never
 * mixed: the replies interleave with SETTLED events (both server clocks), and
 * this session's pending events form the tail, ordered among themselves by the
 * client clock. Replies without a timestamp (static mocks) sort before all
 * events; events without a timestamp sort after everything. Adjacent events
 * merge into one timeline block. (Optimistic replies had a tail of their own
 * here; nothing has sent one since the conversation is the kit's — audit D3.)
 */
function buildThreadRows(replies: ThreadReply[], events: ResolutionEvent[]): ThreadRow[] {
  const byAt = (a: ResolutionEvent, b: ResolutionEvent) => (a.atMs ?? Infinity) - (b.atMs ?? Infinity)
  const rows: ThreadRow[] = []
  const append = (e: ResolutionEvent) => {
    const last = rows[rows.length - 1]
    if (last?.t === 'events') last.events.push(e)
    else rows.push({ t: 'events', events: [e] })
  }
  /** Walk one reply list, emitting queued events that predate each reply;
   *  returns the events that belong after every reply in the list. */
  const interleave = (replies: ThreadReply[], queue: ResolutionEvent[]): ResolutionEvent[] => {
    let ei = 0
    for (const reply of replies) {
      while (ei < queue.length && (queue[ei].atMs ?? Infinity) < (reply.createdAtMs ?? 0)) {
        append(queue[ei++])
      }
      rows.push({ t: 'reply', reply })
    }
    return queue.slice(ei)
  }

  const settled = events.filter((e) => !e.pending).sort(byAt)
  const pending = events.filter((e) => e.pending).sort(byAt)

  // The replies (server clock), settled leftovers before the tail.
  interleave(replies, settled).forEach(append)

  // Pending events (client clock).
  pending.forEach(append)
  return rows
}

interface ThreadPanelProps {
  conversation: ConversationData
  /** The file whose conversation this is: a reply or an edit linking it adds no card (§13.6.2). */
  writtenOn?: string
  /** Merged replies (body/highlight/reactions already applied by the seam). */
  replies: ThreadReply[]
  isResolved?: boolean
  /** Id of the reply (if any) that triggered the parent's resolution. The matching ReplyCard
   *  surfaces the resolution inline in edit mode so the user can update or remove it from the reply. */
  resolvedByReplyId?: string
  /** Current resolution message on the parent conv. Forwarded to the resolution-owning reply card. */
  resolutionMsg?: string
  /** Full resolve/reopen history — rendered as timeline bullets among the replies. */
  resolutionEvents?: ResolutionEvent[]
  /** Called when the resolution-owning reply card edits the resolution. The parent updates the
   *  parent conv's resolution override accordingly (or reopens it when removed). */
  onResolutionChange?: (resolved: boolean, message?: string) => void
  onClose: () => void
  /** Send the reply; answers whether the relay took it, and a refusal is said under the box (OPT-7). */
  onSendReply: (payload: SendPayload, away: () => boolean) => Promise<SendAnswer>
  /**
   * Makes the thread read-only and is drawn where the composer would be — a
   * Convex topic's thread since CON-8. The replies keep no hover menu either.
   */
  readOnlyNotice?: ReactNode
  /**
   * Read-only with nothing where the composer was — an archived file's thread:
   * no composer, no menus, nothing on hover. `readOnlyNotice` draws a notice there instead.
   */
  readOnly?: boolean
  /**
   * Drawn where the composer would be, while the replies keep their menus — a
   * thread whose first message was deleted takes no new replies, and each
   * reply's author can still edit or delete their own (PER-24).
   */
  composerNotice?: ReactNode
  onDeleteReply?: (id: string) => void
  onReplyBodyChange?: (replyId: string, body: string) => void
  /** A reply's files after an edit — PEE-16. */
  onReplyFilesChange?: (replyId: string, files: FileAttachment[]) => void
  /** A reply's card set after an edit, when it changed — OPT-17. */
  onReplyEmbedsChange?: (replyId: string, embeds: Embed[]) => void
  /**
   * A reaction on a reply — the emoji and the aggregate it replaces, both.
   *
   * This used to be `(replyId, reactions)`, and the two dropped arguments were
   * the whole of PEE-12's remaining bug: `setReactions` reads a missing `prev`
   * as "session-local, do not persist", so every reply reaction stopped at the
   * browser — never written to Convex, never published, gone on reload. The
   * card has always supplied the emoji; this signature threw it away.
   */
  onReplyReactionsChange?: (
    replyId: string,
    reactions: ReactionData[],
    prev: ReactionData[],
    emoji: string,
  ) => void
}

/**
 * The replies column beside a conversation, drawn by the kit's `Thread`: the
 * first message pinned at the top, the replies and resolve history below it,
 * and a box to write a reply.
 *
 * Peek's half is what the kit cannot know: the replies interleaved with the
 * "Name resolved → note" lines (Katerina kept them, 1 November), what the
 * thread publishes for Cmd+K, and where it scrolls. The column reads as it did:
 * an empty thread says nothing, Close is "Close thread" to a screen reader, and
 * the first message is still reachable by its id (`data-thread-start`, which
 * `scrollToMessage` reads with `data-reply-id`).
 */
export function ThreadPanel({
  conversation,
  writtenOn,
  replies,
  isResolved = false,
  resolvedByReplyId,
  resolutionMsg,
  resolutionEvents = [],
  onResolutionChange,
  onClose,
  onSendReply,
  readOnlyNotice,
  readOnly: readOnlyProp = false,
  composerNotice,
  onDeleteReply,
  onReplyBodyChange,
  onReplyFilesChange,
  onReplyEmbedsChange,
  onReplyReactionsChange,
}: ThreadPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const readOnly = readOnlyProp || readOnlyNotice != null

  /*
    Publish what this thread refers to, so Cmd+K can offer those objects as the
    target of a field-setting action (PEE-3). Both notations are collected for
    the reason `MessageBody` merges them: a message composed here carries
    `nostr:naddr1…` in its body, and the same message read back off the relay
    carries a plain address on an `a` tag. Newest first, because the thing just
    discussed is the likeliest target.
  */
  const messages = [conversation, ...replies]
  const references = messages.flatMap((m) => [...(m.nostrReferences ?? []), ...findNaddrs(m.body ?? '')])
  const referenceKey = references.join('|')
  /*
    Identity as well as prose since INT-3: an answer has to say which messages
    it came from, and a citation has to reach the message in the thread behind
    the modal. `id` is the same one a reply's wrapper renders as
    `data-reply-id`, and the pinned first message as `data-thread-start`,
    which is what a citation scrolls to.
  */
  // The event id rides along since RIC-11: a mention of a message is written
  // as its `nevent`, and the `[` menu reads it off this snapshot.
  const bodyKey = messages
    .map((m) => [m.id, m.authorName, m.timestamp, m.nostrEventId ?? '', m.body ?? ''].join('\u0001'))
    .join('\u0000')
  /*
    Rebuilt from the key rather than from `messages`, which is the round-trip
    this effect already did for bodies: a new array identity every render would
    re-register on every keystroke in the composer, and the key is what says
    whether anything actually changed.
  */
  const snapshot = useMemo(
    () =>
      bodyKey
        ? bodyKey.split('\u0000').map((row) => {
            const [id, author, timestamp, eventId, ...body] = row.split('\u0001')
            return { id, author, timestamp, eventId: eventId || undefined, body: body.join('\u0001') }
          })
        : [],
    [bodyKey],
  )
  useEffect(() => {
    const unique = [...new Set(referenceKey ? referenceKey.split('|') : [])]
    registerActiveConversation({ references: unique, messages: snapshot })
    return unregisterActiveConversation
  }, [referenceKey, snapshot])

  // The root message shows here with no date divider above it, so it carries
  // its own day — unlike the same message in the list, where the divider
  // supplies it. Static mocks have no createdAtMs; fall back to their string.
  const rootTimestamp =
    conversation.createdAtMs !== undefined
      ? formatReplyTimestamp(conversation.createdAtMs)
      : conversation.timestamp

  // Replies + resolution events interleaved by time into one render sequence.
  const threadRows = buildThreadRows(replies, resolutionEvents)

  // Scroll to bottom when new replies are added — before the paint, so a thread
  // never shows its top for a frame and then jumps (OPT-9).
  useLayoutEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [replies.length])
  // And stays there while the replies' cards, chips and images fill in (OPT-10).
  // Keyed on the replies too: the panel's rows are the scroller's children, and a new one is observed only from then.
  useSteadyScroll(scrollRef, undefined, always, `${conversation.id}:${replies.length}`)

  return (
    <Thread
      bodyRef={scrollRef}
      resolved={isResolved}
      onClose={onClose}
      closeLabel="Close thread"
      empty={null}
      start={{
        // Anchored like a reply (INT-3): a citation has to be able to reach the message that opened the thread too.
        id: conversation.id,
        author: { name: conversation.authorName, picture: conversation.authorAvatarSrc, bot: conversation.authorBot },
        time: rootTimestamp,
        words: previewText(conversation.body).replace(/\n/g, ' '),
        deleted: conversation.isDeleted,
      }}
      // An archived thread with no notice has nothing under it; a deleted first message says why instead of the box.
      notice={readOnlyNotice ?? (readOnlyProp ? undefined : composerNotice)}
      box={
        readOnly ? undefined : (
          <ConversationBox kind="reply" onSend={onSendReply} here={writtenOn} contextLabel={`Reply to ${conversation.authorName}`} draftKey={draftKeys.thread(conversation.id)} />
        )
      }
    >
      {/* Replies and the resolve history, chronological top to bottom. */}
      {threadRows.map((row, i) =>
        row.t === 'events' ? (
          <ResolutionTimeline key={row.events[0]?.key ?? `events-${i}`} events={row.events} />
        ) : (
          <div key={row.reply.id} data-reply-id={row.reply.id}>
            <ThreadReplyCard
              reply={row.reply}
              writtenOn={writtenOn}
              readOnly={readOnly}
              ownsResolution={resolvedByReplyId === row.reply.id}
              resolutionMsg={resolutionMsg}
              onResolutionChange={onResolutionChange}
              onDeleteReply={onDeleteReply}
              onReplyBodyChange={onReplyBodyChange}
              onReplyFilesChange={onReplyFilesChange}
              onReplyEmbedsChange={onReplyEmbedsChange}
              onReplyReactionsChange={onReplyReactionsChange}
            />
          </div>
        ),
      )}
    </Thread>
  )
}

type ReplyHandlers = Pick<
  ThreadPanelProps,
  'onResolutionChange' | 'onDeleteReply' | 'onReplyBodyChange' | 'onReplyFilesChange' | 'onReplyEmbedsChange' | 'onReplyReactionsChange'
>

/** One reply in the column, its handlers bound to its id. */
function ThreadReplyCard({
  reply,
  writtenOn,
  readOnly,
  ownsResolution,
  resolutionMsg,
  onResolutionChange,
  onDeleteReply,
  onReplyBodyChange,
  onReplyFilesChange,
  onReplyEmbedsChange,
  onReplyReactionsChange,
}: ReplyHandlers & { reply: ThreadReply; writtenOn?: string; readOnly: boolean; ownsResolution: boolean; resolutionMsg?: string }) {
  return (
    <ReplyCard
      authorName={reply.authorName}
      authorAvatarSrc={reply.authorAvatarSrc}
      authorBot={reply.authorBot}
      timestamp={reply.timestamp}
      body={reply.body}
      editedAt={reply.editedAt}
      canEditAndDelete={reply.canEditAndDelete}
      files={reply.files}
      highlightType={reply.highlightType}
      reactions={reply.reactions}
      isNew={reply.isNew}
      isUrgent={reply.isUrgent}
      ownsResolution={ownsResolution}
      resolutionMsg={ownsResolution ? resolutionMsg : undefined}
      nostrReferences={reply.nostrReferences}
      urgentMentions={reply.urgentMentions}
      parts={reply.parts}
      embeds={reply.embeds}
      nostrEventId={reply.nostrEventId}
      onResolutionChange={ownsResolution ? onResolutionChange : undefined}
      onDelete={onDeleteReply ? () => onDeleteReply(reply.id) : undefined}
      onBodyChange={onReplyBodyChange ? (b) => onReplyBodyChange(reply.id, b) : undefined}
      messageId={reply.id}
      onFilesChange={onReplyFilesChange ? (f) => onReplyFilesChange(reply.id, f) : undefined}
      onEmbedsChange={onReplyEmbedsChange ? (e) => onReplyEmbedsChange(reply.id, e) : undefined}
      writtenOn={writtenOn}
      onReactionsChange={onReplyReactionsChange ? (r, emoji) => onReplyReactionsChange(reply.id, r, reply.reactions ?? [], emoji) : undefined}
      readOnly={readOnly}
    />
  )
}
