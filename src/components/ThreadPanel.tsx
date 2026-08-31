import { useRef, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { IconX, IconExternalLink, IconCircleDashed, IconCircleCheck, IconLock, IconArrowNarrowRight } from '@tabler/icons-react'
import { Avatar } from './ui/Avatar'
import { IconButton } from './ui/IconButton'
import { ThreadReplyCard } from './ThreadReplyCard'
import { ComposeBox, type SendPayload } from './ui/ComposeBox'
import { DateDivider } from './ui/DateDivider'
import { formatReplyTimestamp } from '@/api'
import type { ConversationData, HighlightType, ReactionData, ResolutionEvent, ThreadReply } from '@/api'
import { PinnedMessage } from './ui/PinnedMessage'
import { SkeletonConversationList } from './ui/Skeleton'
import { partitionRepliesAroundPromotion } from '@/lib/threadPartition'
import { cn } from '@/lib/utils'
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
          <p className="text-[12px] leading-[1.4] font-medium min-w-0">
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
              <span className="text-[11px] font-normal text-text-muted whitespace-nowrap signal:font-mono signal:text-[10px] signal:tracking-[0.02em] signal:tabular-nums">
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
  onClose: () => void
  onSendReply: (payload: SendPayload) => void
  onDeleteReply?: (id: string) => void
  onInitialBodyChange?: (newBody: string) => void
  onReplyBodyChange?: (replyId: string, body: string) => void
  onReplyHighlightChange?: (replyId: string, type: HighlightType | undefined) => void
  onReplyReactionsChange?: (replyId: string, reactions: ReactionData[]) => void
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
        <span className="text-body-2-strong text-text-primary signal:font-mono signal:text-[10px] signal:font-medium signal:uppercase signal:tracking-[0.16em] signal:text-[color:var(--text-interactive)]">Replies</span>
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
  onClose,
  onSendReply,
  onDeleteReply,
  onInitialBodyChange,
  onReplyBodyChange,
  onReplyHighlightChange,
  onReplyReactionsChange,
}: ThreadPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const pathForTopic = useTopicPath()

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
          <span className="text-body-2-strong text-text-primary signal:font-mono signal:text-[10px] signal:font-medium signal:uppercase signal:tracking-[0.16em] signal:text-[color:var(--text-interactive)]">Replies</span>
        </div>
        <div className="flex items-center gap-2">
          {isResolved && (
            <span className="text-caption text-success-default signal:font-mono signal:text-[9.5px] signal:font-semibold signal:uppercase signal:tracking-[0.1em] signal:bg-[color:var(--success-wash)] signal:border signal:border-[rgba(63,222,140,0.3)] signal:rounded-full signal:px-2 signal:py-[3px]">Resolved</span>
          )}
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
            return (
              <div className="bg-bg-elevated border border-border-default rounded-sm flex gap-2 items-center pl-[2px] pr-2 py-[2px]">
                <div className="flex items-center pr-2">
                  {(members.length > 0
                    ? members.slice(0, 3).map((name, i) => ({ key: i, name }))
                    : Array.from({ length: Math.min(total, 3) }, (_, i) => ({ key: i, name: undefined as string | undefined }))
                  ).map(({ key, name }) => (
                    <div
                      key={key}
                      className="-mr-2 relative shrink-0 size-6 rounded-sm overflow-hidden border-2 border-bg-elevated"
                    >
                      <Avatar size={24} name={name} alt={name} />
                    </div>
                  ))}
                </div>
                <span className="text-caption text-text-secondary">{total}</span>
              </div>
            )
          })()}
          {onOpenInDm && (
            <IconButton tooltip="Open original" aria-label="Open original" onClick={onOpenInDm}>
              <IconExternalLink size={16} stroke={1.5} />
            </IconButton>
          )}
          <IconButton tooltip="Close" aria-label="Close thread" onClick={onClose}>
            <IconX size={16} stroke={1.5} />
          </IconButton>
        </div>
      </div>

      {/* Scrollable content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto flex flex-col">
        {/* Initial message */}
        <div className="px-4 pt-4 pb-2">
          {huddleMemberCount != null ? (
            /* Huddle: show full message like a reply */
            <ThreadReplyCard
              authorName={conversation.authorName}
              authorAvatarSrc={conversation.authorAvatarSrc}
              timestamp={rootTimestamp}
              body={conversation.body}
              attachments={conversation.attachments}
              files={conversation.files}
              reactions={initialReactions}
              highlightType={initialHighlightType}
              nostrReferences={conversation.nostrReferences}
              onBodyChange={onInitialBodyChange}
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
                    attachments={reply.attachments}
                    files={reply.files}
                    highlightType={reply.highlightType}
                    reactions={reply.reactions}
                    isNew={reply.isNew}
                    isUrgent={reply.isUrgent}
                    ownsResolution={resolvedByReplyId === reply.id}
                    resolutionMsg={resolvedByReplyId === reply.id ? resolutionMsg : undefined}
                    nostrReferences={reply.nostrReferences}
                    onResolutionChange={resolvedByReplyId === reply.id ? onResolutionChange : undefined}
                    onDelete={onDeleteReply ? () => onDeleteReply(reply.id) : undefined}
                    onBodyChange={onReplyBodyChange ? (b) => onReplyBodyChange(reply.id, b) : undefined}
                    onHighlightChange={onReplyHighlightChange ? (h) => onReplyHighlightChange(reply.id, h) : undefined}
                    onReactionsChange={onReplyReactionsChange ? (r) => onReplyReactionsChange(reply.id, r) : undefined}
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
                    <Link
                      to={pathForTopic(promotionDivider.topicId)}
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
                      className="text-text-primary hover:underline min-w-0 truncate"
                    >
                      {promotionDivider.topicTitle}
                    </Link>
                    <span className="shrink-0">· {promotionDivider.dateLabel}</span>
                  </span>
                </span>
              }
            />
            ) : null
          })}
        </div>
      </div>

      {/* Compose box */}
      <div className="p-3">
        <ComposeBox onSend={onSendReply} placeholder="reply" contextLabel={`Reply to ${conversation.authorName}`} />
      </div>
    </div>
  )
}
