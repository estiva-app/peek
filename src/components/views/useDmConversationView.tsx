import { useMarkRead } from '@/lib/useMarkRead'
import { useState, useRef, useEffect, useLayoutEffect, type ReactNode } from 'react'
import { isNearBottom } from './scrollPolicy'
import { ConversationHeader } from '@/components/ConversationHeader'
import { NewTopicBanner } from '@/components/NewTopicBanner'
import { ConversationCard } from '@/components/ConversationCard'
import { ThreadPanel, ThreadPanelLoading } from '@/components/ThreadPanel'
import { DateDivider } from '@/components/ui/DateDivider'
import { Button } from '@/components/ui/Button'
import { ComposeBox, type SendPayload } from '@/components/ui/ComposeBox'
import { EmptyState } from '@/components/ui/EmptyState'
import { SkeletonConversationList } from '@/components/ui/Skeleton'
import {
  usePeople,
  CURRENT_USER_NAME,
  useDmMessages,
  useThread,
  usePromotedHuddleLookup,
  useTopicLookup,
  useIsTopicResolved,
  usePeekActions,
  useStarred,
} from '@/api'
import { useLastSelection } from '@/lib/lastSelection'
import type { StartTopicResult } from '@/components/CreateTopicDialog'

interface UseDmConversationViewArgs {
  dmId: string | null
  dmName?: string
  /** Override the default toggleDm-and-stay behavior (e.g. Desk wants to clear selection on unstar) */
  onToggleStarred?: () => void
  /** When false, suppress non-urgent hasNewMessage/hasNewReply flags. Urgent flags always show. */
  showUnreads?: boolean
  /** Promote the current DM into the first huddle of a new topic. */
  onStartTopicFromDm?: (dmId: string, dmName: string, seedMessageId: string, data: StartTopicResult) => void
}

interface ViewSlots {
  rightPanel: ReactNode
  threadPanel: ReactNode | undefined
}

export function useDmConversationView({ dmId, dmName, onToggleStarred, showUnreads = false, onStartTopicFromDm }: UseDmConversationViewArgs): ViewSlots {
  const [threadConvId, setThreadConvId] = useState<string | null>(null)

  // Opening the DM clears new-message state; opening a thread clears that
  // thread's new-reply state (§4.3).
  useMarkRead('dm', dmId, threadConvId)
  const scrollRef = useRef<HTMLDivElement>(null)
  const { isDmStarred, toggleDm } = useStarred()
  const findTopic = useTopicLookup()
  const isTopicResolved = useIsTopicResolved()
  const promotedHuddleLookup = usePromotedHuddleLookup()
  const { pendingDmThreadId, setPendingDmThreadId } = useLastSelection()
  const actions = usePeekActions()

  // Merged data from the seam — overrides applied, deletions filtered,
  // replyCount final. DM sends live in the seam store, so they survive
  // navigating away and back (same as topic sends).
  const { groups: dmGroups, sent: currentSent, isLoading, hasEarlier, showEarlier } = useDmMessages(dmId)

  const people = usePeople()
  const dmPartner = dmName ? people?.find((p) => p.name === dmName) : undefined
  const dmContext = dmPartner ? { participants: [dmPartner] } : undefined

  const makeStartTopicHandler = (seedMessageId: string) =>
    dmId != null && dmName && onStartTopicFromDm
      ? (data: StartTopicResult) => onStartTopicFromDm(dmId, dmName, seedMessageId, data)
      : undefined

  const promotedHuddles = dmId != null ? promotedHuddleLookup(dmId) : []
  /** Map from seed message id to its huddle context, for rendering the anchor on the right card
   *  AND the inline promotion divider in the thread panel. */
  const huddleContextByMessageId = new Map<string, { topicId: string; topicTitle: string; topicResolved: boolean; promotedAt: string; promotedAtMs?: number }>()
  for (const h of promotedHuddles) {
    if (!h.seedMessageId) continue
    const topic = findTopic(h.topicId)
    if (topic) huddleContextByMessageId.set(h.seedMessageId, {
      topicId: topic.id,
      topicTitle: topic.title,
      topicResolved: isTopicResolved(topic.id),
      promotedAt: h.promotedAt ?? '',
      promotedAtMs: h.promotedAtMs,
    })
  }

  // Auto-open the thread panel when arriving from the huddle's "Open in DMs" button.
  // The topic view stages `pendingDmThreadId` in context just before navigating; we
  // consume it here once the DM is mounted and clear it so back-nav doesn't re-trigger.
  useEffect(() => {
    if (dmId == null || !pendingDmThreadId) return
    setThreadConvId(pendingDmThreadId)
    setPendingDmThreadId(null)
  }, [dmId, pendingDmThreadId, setPendingDmThreadId])

  // Global merged thread lookup — replies posted from either the DM or the huddle
  // entry point show up on both (they share the message id).
  const thread = useThread(threadConvId)
  const threadConv = thread.conversation
  const threadReplies = thread.replies.map((r) => ({
    ...r,
    isNew: r.isNew && (r.isUrgent || showUnreads),
  }))
  const threadSentReplies = thread.sentReplies

  const openThread = (convId: string) => setThreadConvId(convId)
  const closeThread = () => setThreadConvId(null)

  const handleSendReply = ({ text, resolution, attachments, files }: SendPayload) => {
    if (!threadConvId) return
    // DM replies never carry a highlight (matches pre-seam behavior).
    actions.sendReply(threadConvId, { text, resolution, attachments, files })
  }

  const handleDeleteReply = (replyId: string) => {
    if (!threadConvId) return
    actions.deleteReply(threadConvId, replyId)
  }

  const handleSend = ({ text, resolution, attachments, files }: SendPayload) => {
    if (dmId == null) return
    // DM messages never carry a highlight (matches pre-seam behavior).
    // dmId is the partner's person key — the server resolves the pair and
    // creates the conversation on the first message (§2.4).
    actions.sendDmMessage(dmId, { text, resolution, attachments, files })
  }

  const handleDelete = (id: string) => {
    if (dmId == null) return
    actions.deleteDmMessage(dmId, id)
  }

  // Close thread when switching DMs — but skip the initial mount, since we may have
  // just consumed a pendingDmThreadId from the huddle's "Open original" button and
  // setting threadConvId back to null would clobber that.
  const prevDmIdRef = useRef<string | null>(dmId)
  useEffect(() => {
    if (prevDmIdRef.current !== dmId) {
      // genuine DM switch (not initial bind) — close any open thread
      if (prevDmIdRef.current != null) setThreadConvId(null)
      prevDmIdRef.current = dmId
    }
  }, [dmId])


  // "Show earlier messages": keep the viewport anchored on the same message
  // while older content extends the timeline upward (distance from the
  // BOTTOM is invariant across the expansion). Convex briefly returns the
  // query as undefined while the wider page loads, collapsing the timeline —
  // so we hold the anchor until scrollHeight has actually GROWN past the
  // captured baseline, then restore once and clear.
  const earlierAnchorRef = useRef<{ fromBottom: number; height: number } | null>(null)
  const handleShowEarlier = () => {
    const el = scrollRef.current
    earlierAnchorRef.current = el ? { fromBottom: el.scrollHeight - el.scrollTop, height: el.scrollHeight } : null
    showEarlier()
  }
  useEffect(() => {
    const el = scrollRef.current
    const anchor = earlierAnchorRef.current
    if (el && anchor && el.scrollHeight > anchor.height) {
      el.scrollTop = el.scrollHeight - anchor.fromBottom
      earlierAnchorRef.current = null
    }
  }, [dmGroups])

  /**
   * Were you at the live edge when new content arrived? See `useTopicView` — the
   * policy is identical here, and deliberately so: a DM and a topic should not
   * behave differently just because they are different components.
   */
  const nearBottom = useRef(true)
  const handleScroll = () => {
    const el = scrollRef.current
    if (el) nearBottom.current = isNearBottom(el)
  }

  /**
   * Opening a DM lands at the bottom, before the paint.
   *
   * Keyed on the messages being there rather than on `dmId`, which changed while
   * `useDmMessages` was still loading — so this ran against an empty container
   * and left long conversations at the top.
   */
  const pinnedFor = useRef<string | number | null>(null)
  useLayoutEffect(() => {
    if (dmId == null || isLoading) return
    if (pinnedFor.current === dmId) return
    if (earlierAnchorRef.current) return
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    pinnedFor.current = dmId
    nearBottom.current = true
  }, [dmId, isLoading])

  // A message arrives: follow only if you were watching the live edge.
  const messageCount = dmGroups.reduce((n, g) => n + g.convs.length, 0)
  useLayoutEffect(() => {
    if (isLoading || !nearBottom.current || earlierAnchorRef.current) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messageCount, isLoading])

  // Your own message always brings you down to it.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [currentSent.length])

  if (dmId == null || !dmName) {
    return {
      rightPanel: (
        <div className="flex-1 flex items-center justify-center h-full">
          <EmptyState />
        </div>
      ),
      threadPanel: undefined,
    }
  }

  const rightPanel = (
    <div className="flex flex-col h-full">
      <ConversationHeader
        name={dmName}
        isStarred={dmId != null && isDmStarred(dmId)}
        onToggleStarred={
          onToggleStarred ??
          (dmId != null && dmName ? () => toggleDm({ dmId, name: dmName }) : undefined)
        }
      />
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto flex flex-col">
        <div className="flex-1 min-h-0" />
        <div className="shrink-0 flex flex-col px-4 py-4 gap-2">
          {isLoading && <SkeletonConversationList />}
          {hasEarlier && (
            <div className="flex justify-center py-1">
              <Button variant="muted" size="small" onClick={handleShowEarlier}>
                Show earlier messages
              </Button>
            </div>
          )}
          {dmGroups.map((group) => (
            <div key={group.dateLabel} className="flex flex-col gap-2">
              <DateDivider label={group.dateLabel} className="sticky top-0 z-10 bg-bg-surface" />
              {group.convs.map((c) => (
                <ConversationCard
                  key={`${dmId}_${c.id}`}
                  authorName={c.authorName}
                  authorAvatarSrc={c.authorAvatarSrc}
                  timestamp={c.timestamp}
                  body={c.body}
                  attachments={c.attachments}
                  files={c.files}
                  reactions={c.reactions}
                  highlightType={c.highlightType}
                  replyCount={c.replyCount}
                  replyAuthors={c.replyAuthors}
                  lastReplyTime={c.lastReplyTime}
                  hasNewMessage={c.hasNewMessage && (c.isUrgent || showUnreads)}
                  hasNewReply={c.hasNewReply && (c.isUrgent || showUnreads)}
                  isUrgent={c.isUrgent}
                  isResolved={c.isResolved}
                  resolvedBy={c.resolvedBy}
                  resolutionMessage={c.resolutionMessage}
                  nostrReferences={c.nostrReferences}
                  isSelected={threadConvId === c.id}
                  showCreateTopic={!huddleContextByMessageId.has(c.id)}
                  dmContext={dmContext}
                  huddleContext={huddleContextByMessageId.get(c.id)}
                  onStartTopicFromDm={makeStartTopicHandler(c.id)}
                  onResolvedChange={(resolved, resolvedBy, message) => actions.setResolution(c.id, resolved, resolved ? (resolvedBy ?? CURRENT_USER_NAME) : undefined, message)}
                  onReactionsChange={(next, emoji) => actions.setReactions(c.id, next, c.reactions ?? [], emoji)}
                  onBodyChange={(b) => actions.editBody(c.id, b)}
                  onHighlightChange={(hl) => actions.setHighlight(c.id, hl)}
                  onClick={() => openThread(c.id)}
                  onReply={() => openThread(c.id)}
                  onDelete={() => handleDelete(c.id)}
                />
              ))}
            </div>
          ))}

          {currentSent.length > 0 && (
            <div className="flex flex-col gap-2">
              <DateDivider label="Today" className="sticky top-0 z-10 bg-bg-surface" />
              {currentSent.map((m) => (
                <ConversationCard
                  key={m.id}
                  authorName={m.authorName}
                  authorAvatarSrc={m.authorAvatarSrc}
                  timestamp={m.timestamp}
                  body={m.body}
                  attachments={m.attachments}
                  files={m.files}
                  reactions={m.reactions}
                  highlightType={m.highlightType}
                  replyCount={m.replyCount}
                  replyAuthors={m.replyAuthors}
                  lastReplyTime={m.lastReplyTime}
                  isResolved={m.isResolved}
                  resolvedBy={m.resolvedBy}
                  resolutionMessage={m.resolutionMessage}
                  nostrReferences={m.nostrReferences}
                  isSelected={threadConvId === m.id}
                  showCreateTopic={!huddleContextByMessageId.has(m.id)}
                  dmContext={dmContext}
                  huddleContext={huddleContextByMessageId.get(m.id)}
                  onStartTopicFromDm={makeStartTopicHandler(m.id)}
                  onResolvedChange={(resolved, resolvedBy, message) => actions.setResolution(m.id, resolved, resolved ? (resolvedBy ?? CURRENT_USER_NAME) : undefined, message)}
                  onReactionsChange={(next, emoji) => actions.setReactions(m.id, next, m.reactions ?? [], emoji)}
                  onBodyChange={(b) => actions.editBody(m.id, b)}
                  onHighlightChange={(hl) => actions.setHighlight(m.id, hl)}
                  onClick={() => openThread(m.id)}
                  onReply={() => openThread(m.id)}
                  onDelete={() => handleDelete(m.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      {!isLoading && dmGroups.length === 0 && currentSent.length === 0 && (
        <div className="px-3 pt-2">
          <NewTopicBanner kind="dm" title={dmName} />
        </div>
      )}
      <div className="p-3">
        <ComposeBox onSend={handleSend} contextLabel={dmName ? `DM · ${dmName}` : undefined} />
      </div>
    </div>
  )

  const threadPromotion = threadConvId ? huddleContextByMessageId.get(threadConvId) : undefined

  // Same rule as useTopicView: a selected-but-still-loading thread keeps the
  // panel column mounted with a loading shell instead of unmounting it.
  const threadPanel = !threadConv && threadConvId && thread.isLoading ? (
    <ThreadPanelLoading onClose={closeThread} />
  ) : threadConv ? (
    <ThreadPanel
      conversation={threadConv}
      replies={threadReplies}
      sentReplies={threadSentReplies}
      isLoadingReplies={thread.isLoading}
      resolutionEvents={thread.resolutionEvents}
      isResolved={threadConv.isResolved ?? false}
      dmMembers={dmName ? [CURRENT_USER_NAME, dmName] : []}
      initialReactions={threadConv.reactions}
      onInitialReactionsChange={
        threadConvId
          ? (next, emoji) => actions.setReactions(threadConvId, next, threadConv.reactions ?? [], emoji)
          : undefined
      }
      initialHighlightType={threadConv.highlightType}
      onInitialHighlightChange={
        threadConvId
          ? (hl) => actions.setHighlight(threadConvId, hl)
          : undefined
      }
      resolvedByReplyId={thread.resolvedByReplyId}
      resolutionMsg={thread.resolutionMessage}
      onResolutionChange={
        threadConvId
          ? (resolved, message) => actions.setThreadResolution(threadConvId, resolved, message)
          : undefined
      }
      promotionDivider={
        threadPromotion
          ? {
              topicId: threadPromotion.topicId,
              topicTitle: threadPromotion.topicTitle,
              topicResolved: threadPromotion.topicResolved,
              dateLabel: threadPromotion.promotedAt,
              promotedAtMs: threadPromotion.promotedAtMs,
            }
          : undefined
      }
      onClose={closeThread}
      onSendReply={handleSendReply}
      onDeleteReply={handleDeleteReply}
      onReplyBodyChange={(replyId, body) => actions.editBody(replyId, body)}
      onReplyHighlightChange={(replyId, hl) => actions.setHighlight(replyId, hl)}
      onReplyReactionsChange={(replyId, next) => actions.setReactions(replyId, next)}
    />
  ) : undefined

  return { rightPanel, threadPanel }
}
