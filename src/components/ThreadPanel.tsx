import { useRef, useEffect, useMemo, useState } from 'react'
import { IconX, IconExternalLink, IconCircleDashed, IconCircleCheck, IconLock, IconArrowNarrowRight } from '@tabler/icons-react'
import { Chip, ScrollArea } from '@estiva-app/ui'
import { RouterLink } from './RouterLink'
import { MembersPill } from './ui/MembersPill'
import { IconButton } from './ui/IconButton'
import { ThreadReplyCard } from './ThreadReplyCard'
import { draftKeys } from '@/lib/drafts'
import { ComposeBox, type SendPayload } from './ui/ComposeBox'
import { DateDivider } from './ui/DateDivider'
import { formatReplyTimestamp } from '@/api'
import type { ConversationData, FileAttachment, HighlightType, ReactionData, ResolutionEvent, ThreadReply } from '@/api'
import { PinnedMessage } from './ui/PinnedMessage'
import { SkeletonConversationList } from './ui/Skeleton'
import { partitionRepliesAroundPromotion } from '@/lib/threadPartition'
import { registerActiveConversation, unregisterActiveConversation } from '@/lib/conversationRegistry'
import { findNaddrs } from '@estiva-app/protocol'
import { cn } from '@/lib/utils'
import { followInApp } from '@/lib/followInApp'
import { useTopicPath } from '@/lib/useTopicPath'

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
              <span className="text-chip font-normal text-text-muted whitespace-nowrap signal:font-mono signal:text-small signal:tracking-wide signal:tabular-nums">
                {' '}· {formatReplyTimestamp(e.atMs)}
              </span>
            )}
          </p>
        </div>
      ))}
    </div>
  )
}

type ThreadRow =
  | { t: 'reply'; reply: ThreadReply }
  | { t: 'divider' }
  | { t: 'events'; events: ResolutionEvent[] }

/**
 * Interleave the resolution events into the reply sequence by time: an event
 * renders after every reply that predates it. Two clock domains are never
 * mixed: PERSISTED replies interleave with SETTLED events (both server
 * clocks), then this session's optimistic replies + pending events form the
 * tail, ordered among themselves by the client clock. Mixing domains made a
 * fresh optimistic reply (client clock) flash between settled bullets
 * (server clock) until its server copy arrived. Replies without a timestamp
 * (static mocks) sort before all events; events without a timestamp sort
 * after everything. Adjacent events merge into one timeline block.
 */
function buildThreadRows(
  persisted: ThreadReply[],
  sent: ThreadReply[],
  hasDivider: boolean,
  promotedAtMs: number | undefined,
  events: ResolutionEvent[]
): ThreadRow[] {
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

  // Persisted section (server clock), settled leftovers before the tail.
  interleave(persisted, settled).forEach(append)

  // Optimistic tail (client clock), split by the promotion divider if any.
  const { above: sentPre, below: sentPost } = promotedAtMs !== undefined
    ? partitionRepliesAroundPromotion({ replies: [], sentReplies: sent, promotedAtMs })
    : { above: sent, below: [] as ThreadReply[] }
  let rest = interleave(sentPre, pending)
  if (hasDivider) rows.push({ t: 'divider' })
  rest = interleave(sentPost, rest)
  rest.forEach(append)
  return rows
}

interface ThreadPanelProps {
  conversation: ConversationData
  /** Merged replies (body/highlight/reactions already applied by the seam). */
  replies: ThreadReply[]
  sentReplies: ThreadReply[]
  /** True while the replies query is loading — renders skeleton reply cards. */
  isLoadingReplies?: boolean
  isResolved?: boolean
  /** When set, shows member avatars in the header (for Huddle threads) */
  huddleMemberCount?: number
  /** Member names for the huddle - drives the avatar lookups in the header pill */
  huddleMembers?: string[]
  /** DM thread participants - shows You + the other person in the header pill */
  dmMembers?: string[]
  /** Reactions on the initial (pinned) message — needed when the panel renders the initial as a
   *  ThreadReplyCard (huddle case) so reactions added on this side persist & mirror to the DM side. */
  initialReactions?: ReactionData[]
  onInitialReactionsChange?: (reactions: ReactionData[], emoji: string) => void
  /** Highlight on the initial message — same purpose as reactions: mirror across DM and huddle. */
  initialHighlightType?: HighlightType
  onInitialHighlightChange?: (highlightType: HighlightType | undefined) => void
  /** Id of the reply (if any) that triggered the parent's resolution. The matching ThreadReplyCard
   *  surfaces the resolution inline in edit mode so the user can update or remove it from the reply. */
  resolvedByReplyId?: string
  /** Current resolution message on the parent conv. Forwarded to the resolution-owning reply card. */
  resolutionMsg?: string
  /** Full resolve/reopen history — rendered as timeline bullets among the replies. */
  resolutionEvents?: ResolutionEvent[]
  /** Called when the resolution-owning reply card edits the resolution. The parent updates the
   *  parent conv's resolution override accordingly (or reopens it when removed). */
  onResolutionChange?: (resolved: boolean, message?: string) => void
  /**
   * When set, an inline divider is rendered between the static `replies` (pre-promotion)
   * and the runtime `sentReplies` (post-promotion). Used to mark the moment a DM
   * conversation was promoted to a topic — visible from both DM and huddle entry points.
   * If `onTopicClick` is provided, it overrides the Link's default navigation (used when
   * the topic is already the current page and we just need to switch tabs / close the panel).
   * `promotedAtMs` is the numeric promotion time used to partition runtime sentReplies
   * chronologically: replies with createdAtMs < promotedAtMs render above the divider.
   */
  promotionDivider?: { topicId: string; topicTitle: string; topicResolved?: boolean; dateLabel: string; promotedAtMs?: number; onTopicClick?: () => void }
  /** When set, renders a header button that jumps to the matching DM thread. Used from the huddle side only. */
  onOpenInDm?: () => void
  /**
   * Where that button leads — the DM — so it is a real link (UIG-14, 4.13): a
   * modified click opens the DM in a new tab, a plain one runs `onOpenInDm`,
   * which also lands on the thread.
   */
  openInDmHref?: string
  onClose: () => void
  /**
   * Send the reply. Resolve `false` when nothing was written — CON-10.
   *
   * Typed rather than left as `void`: a promise still flows at runtime through
   * a `void` signature, so `ComposeBox` would keep working and the type would
   * be quietly lying about the one thing this contract is for.
   */
  onSendReply: (payload: SendPayload) => void | boolean | Promise<void | boolean>
  onDeleteReply?: (id: string) => void
  onInitialBodyChange?: (newBody: string) => void
  /** The root message's files after an edit — PEE-16. */
  onInitialFilesChange?: (files: FileAttachment[]) => void
  onReplyBodyChange?: (replyId: string, body: string) => void
  /** A reply's files after an edit — PEE-16. */
  onReplyFilesChange?: (replyId: string, files: FileAttachment[]) => void
  onReplyHighlightChange?: (replyId: string, type: HighlightType | undefined) => void
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
 * Loading stand-in that keeps the panel column mounted while the switched-to
 * thread's conversation is still in flight. Remote-only messages (anything
 * created in the app rather than seeded into the mock pools — i.e. all real
 * data on the deployed builds) have no local copy, so the conversation query
 * returns undefined for a beat on every switch; rendering null there tears
 * down the whole panel and reads as close-and-reopen. Same chrome as the
 * real panel, same 200ms-delayed skeleton as the replies area.
 */
export function ThreadPanelLoading({ onClose }: { onClose: () => void }) {
  const [showSkeleton, setShowSkeleton] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setShowSkeleton(true), 200)
    return () => clearTimeout(t)
  }, [])
  return (
    <div className="flex flex-col h-full">
      <div className="h-12 shrink-0 flex items-center justify-between pl-5 pr-4 py-2 border-b border-border-subtle z-20 relative bg-bg-surface">
        <span className="text-body-2-strong text-text-primary signal:font-mono signal:text-small signal:font-medium signal:uppercase signal:tracking-widest signal:text-text-interactive">Replies</span>
        <IconButton tooltip="Close" aria-label="Close thread" onClick={onClose}>
          <IconX size={16} stroke={1.5} />
        </IconButton>
      </div>
      <div className="flex-1 overflow-hidden px-4 pt-4">
        {showSkeleton && <SkeletonConversationList />}
      </div>
    </div>
  )
}

/**
 * The replies panel beside a conversation: the first message at the top, the
 * replies and resolve history below it, and a box to write a reply.
 */
export function ThreadPanel({
  conversation,
  replies,
  sentReplies,
  isLoadingReplies = false,
  isResolved = false,
  huddleMemberCount,
  huddleMembers = [],
  dmMembers = [],
  promotionDivider,
  initialReactions,
  onInitialReactionsChange,
  initialHighlightType,
  onInitialHighlightChange,
  resolvedByReplyId,
  resolutionMsg,
  resolutionEvents = [],
  onResolutionChange,
  onOpenInDm,
  openInDmHref,
  onClose,
  onSendReply,
  onDeleteReply,
  onInitialBodyChange,
  onInitialFilesChange,
  onReplyBodyChange,
  onReplyFilesChange,
  onReplyHighlightChange,
  onReplyReactionsChange,
}: ThreadPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const pathForTopic = useTopicPath()

  /*
    Publish what this thread refers to, so Cmd+K can offer those objects as the
    target of a field-setting action (PEE-3). Both notations are collected for
    the reason `MessageBody` merges them: a message composed here carries
    `nostr:naddr1…` in its body, and the same message read back off the relay
    carries a plain address on an `a` tag. Newest first, because the thing just
    discussed is the likeliest target.
  */
  const messages = [conversation, ...replies, ...sentReplies]
  const references = messages.flatMap((m) => [...(m.nostrReferences ?? []), ...findNaddrs(m.body ?? '')])
  const referenceKey = references.join('|')
  /*
    Identity as well as prose since INT-3: an answer has to say which messages
    it came from, and a citation has to reach the message in the thread behind
    the modal. `id` is the same one the reply wrapper renders as
    `data-reply-id`, which is what a citation scrolls to.
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

  // Delayed skeleton: switching threads keeps the panel mounted, but the
  // replies query reloads and a full skeleton flash reads as the panel
  // closing and reopening. Only show the skeleton when loading genuinely
  // takes a beat — fast switches swap content in place with no flash.
  const [showSkeleton, setShowSkeleton] = useState(false)
  useEffect(() => {
    if (!isLoadingReplies) {
      setShowSkeleton(false)
      return
    }
    const t = setTimeout(() => setShowSkeleton(true), 200)
    return () => clearTimeout(t)
  }, [isLoadingReplies])

  // The root message shows here with no date divider above it, so it carries
  // its own day — unlike the same message in the list, where the divider
  // supplies it. Static mocks have no createdAtMs; fall back to their string.
  const rootTimestamp =
    conversation.createdAtMs !== undefined
      ? formatReplyTimestamp(conversation.createdAtMs)
      : conversation.timestamp

  const allReplies = [...replies, ...sentReplies]

  // When a promotion divider is rendered, replies are split chronologically
  // around the promotion event (see lib/threadPartition for the rule).
  // Replies + resolution events interleaved by time into one render sequence.
  const threadRows = buildThreadRows(
    replies,
    sentReplies,
    !!promotionDivider,
    promotionDivider?.promotedAtMs,
    resolutionEvents
  )

  // Scroll to bottom when new replies are added
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [allReplies.length])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="h-12 shrink-0 flex items-center justify-between pl-5 pr-4 py-2 border-b border-border-subtle z-20 relative bg-bg-surface">
        <div className="flex items-center gap-2">
          {huddleMemberCount != null && (
            <IconLock size={16} stroke={1.5} className="text-text-secondary" />
          )}
          <span className="text-body-2-strong text-text-primary signal:font-mono signal:text-small signal:font-medium signal:uppercase signal:tracking-widest signal:text-text-interactive">Replies</span>
        </div>
        <div className="flex items-center gap-2">
          {/* The package's Chip, success: it was a hand-made pill under Signal
              and bare green words elsewhere (UIG-14). */}
          {isResolved && <Chip type="success" label="Resolved" />}
          {(() => {
            // Show member pill for huddle threads OR DM threads. Both display
            // up to 3 avatars with the total count beside them.
            const members =
              huddleMembers.length > 0
                ? huddleMembers
                : dmMembers.length > 0
                  ? dmMembers
                  : []
            const total = members.length || huddleMemberCount || 0
            if (total === 0) return null
            // The header's pill, not a third copy of it (F12). It was the
            // same chrome re-typed around a stack that clipped its own faces.
            return <MembersPill members={members} count={total} />
          })()}
          {onOpenInDm && (
            <IconButton
              tooltip="Open original"
              aria-label="Open original"
              href={openInDmHref}
              onClick={(event) => followInApp(event, onOpenInDm)}
            >
              <IconExternalLink size={16} stroke={1.5} />
            </IconButton>
          )}
          <IconButton tooltip="Close" aria-label="Close thread" onClick={onClose}>
            <IconX size={16} stroke={1.5} />
          </IconButton>
        </div>
      </div>

      {/* Scrollable content */}
      <ScrollArea className="flex-1" viewportRef={scrollRef} contentClassName="flex flex-col">
        {/* Initial message. Anchored like a reply (INT-3): a citation has to be
            able to reach the message that opened the thread too. */}
        <div className="px-4 pt-4 pb-2" data-reply-id={conversation.id}>
          {huddleMemberCount != null ? (
            /* Huddle: show full message like a reply */
            <ThreadReplyCard
              authorName={conversation.authorName}
              authorAvatarSrc={conversation.authorAvatarSrc}
              timestamp={rootTimestamp}
              body={conversation.body}
              editedAt={conversation.editedAt}
              files={conversation.files}
              reactions={initialReactions}
              highlightType={initialHighlightType}
              nostrReferences={conversation.nostrReferences}
              onBodyChange={onInitialBodyChange}
              onFilesChange={onInitialFilesChange}
              onReactionsChange={onInitialReactionsChange}
              onHighlightChange={onInitialHighlightChange}
            />
          ) : (
            <PinnedMessage
              authorName={conversation.authorName}
              authorAvatarSrc={conversation.authorAvatarSrc}
              timestamp={rootTimestamp}
              body={conversation.body}
              highlightType={conversation.highlightType}
            />
          )}
        </div>

        {/* Replies divider */}
        <DateDivider label="Replies" className="px-4 py-2" />

        {/* Reply list - chronological top to bottom. When the conversation was promoted to a
            topic, a system-event divider is inserted between the pre-promotion replies (static)
            and the post-promotion replies (sentReplies). */}
        <div className="flex flex-col px-4 pb-4 gap-2">
          {isLoadingReplies && showSkeleton && <SkeletonConversationList />}
          {threadRows.map((row, i) => {
            if (row.t === 'events') {
              return <ResolutionTimeline key={row.events[0]?.key ?? `events-${i}`} events={row.events} />
            }
            if (row.t === 'reply') {
              const reply = row.reply
              return (
                <div key={reply.id} data-reply-id={reply.id}>
                  <ThreadReplyCard
                    authorName={reply.authorName}
                    authorAvatarSrc={reply.authorAvatarSrc}
                    timestamp={reply.timestamp}
                    body={reply.body}
                    editedAt={reply.editedAt}
                    files={reply.files}
                    highlightType={reply.highlightType}
                    reactions={reply.reactions}
                    isNew={reply.isNew}
                    isUrgent={reply.isUrgent}
                    ownsResolution={resolvedByReplyId === reply.id}
                    resolutionMsg={resolvedByReplyId === reply.id ? resolutionMsg : undefined}
                    nostrReferences={reply.nostrReferences}
                    nostrEventId={reply.nostrEventId}
                    onResolutionChange={resolvedByReplyId === reply.id ? onResolutionChange : undefined}
                    onDelete={onDeleteReply ? () => onDeleteReply(reply.id) : undefined}
                    onBodyChange={onReplyBodyChange ? (b) => onReplyBodyChange(reply.id, b) : undefined}
                    onFilesChange={onReplyFilesChange ? (f) => onReplyFilesChange(reply.id, f) : undefined}
                    onHighlightChange={onReplyHighlightChange ? (h) => onReplyHighlightChange(reply.id, h) : undefined}
                    onReactionsChange={onReplyReactionsChange ? (r, emoji) => onReplyReactionsChange(reply.id, r, reply.reactions ?? [], emoji) : undefined}
                  />
                </div>
              )
            }
            // Promotion divider row
            return promotionDivider ? (
            <DateDivider
              key="promotion-divider"
              className="px-0 py-1"
              label={
                <span className="flex items-center gap-1.5 text-text-secondary min-w-0">
                  {promotionDivider.topicResolved ? (
                    <IconCircleCheck size={14} stroke={1.5} className="text-success-default shrink-0" />
                  ) : (
                    <IconCircleDashed size={14} stroke={1.5} className="shrink-0" />
                  )}
                  {/* The title is the only part allowed to truncate — the
                      "Promoted to" prefix and the date suffix always stay. */}
                  <span className="flex items-center gap-1 min-w-0 whitespace-nowrap">
                    <span className="shrink-0">Promoted to</span>
                    {/* The title's colour on a box around the link, which takes it from there (UIG-9). */}
                    <span className="contents text-text-primary">
                      <RouterLink
                        href={pathForTopic(promotionDivider.topicId)}
                        variant="quiet"
                        truncate
                        data-interactive
                        onClick={(e) => {
                          e.stopPropagation()
                          // When the parent provides an override (e.g. we're already on the
                          // topic page and just need to switch tabs + close the thread),
                          // suppress the no-op navigation and run the callback instead.
                          if (promotionDivider.onTopicClick) {
                            e.preventDefault()
                            promotionDivider.onTopicClick()
                          }
                        }}
                      >
                        {promotionDivider.topicTitle}
                      </RouterLink>
                    </span>
                    <span className="shrink-0">· {promotionDivider.dateLabel}</span>
                  </span>
                </span>
              }
            />
            ) : null
          })}
        </div>
      </ScrollArea>

      {/* Compose box */}
      <div className="p-3">
        <ComposeBox onSend={onSendReply} placeholder="reply" contextLabel={`Reply to ${conversation.authorName}`} draftKey={draftKeys.thread(conversation.id)} />
      </div>
    </div>
  )
}
