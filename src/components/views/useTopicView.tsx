import { useMarkRead } from '@/lib/useMarkRead'
import { useState, useRef, useEffect, type ReactNode } from 'react'
import { IconPlus } from '@tabler/icons-react'
import { ConversationHeader } from '@/components/ConversationHeader'
import { NewTopicBanner } from '@/components/NewTopicBanner'
import { JoinTopicBanner } from '@/components/JoinTopicBanner'
import { MembersDialog, type MembersDialogView } from '@/components/MembersDialog'
import { HuddleCreator } from '@/components/HuddleCreator'
import { ConversationCard } from '@/components/ConversationCard'
import { ThreadPanel, ThreadPanelLoading } from '@/components/ThreadPanel'
import { HuddleCard } from '@/components/HuddleCard'
import { StartHuddleDialog, type StartHuddleResult } from '@/components/StartHuddleDialog'
import { DateDivider } from '@/components/ui/DateDivider'
import { SkeletonConversationList, SkeletonHuddleGrid } from '@/components/ui/Skeleton'
import { Button } from '@/components/ui/Button'
import { ComposeBox, type SendPayload } from '@/components/ui/ComposeBox'
import { EmptyState } from '@/components/ui/EmptyState'
import { TopicTabs, type TopicTab } from '@/components/ui/TopicTabs'
import { IconButton } from '@/components/ui/IconButton'
import {
  CURRENT_USER_NAME,
  formatDateLabel,
  useTopicMessages,
  useHuddleMessages,
  useThread,
  useHuddleLookup,
  useHuddlesLoading,
  useTopicLookup,
  useIsTopicResolved,
  useIsTopicMember,
  useJoinTopic,
  useInviteToTopic,
  usePeekActions,
  useStarred,
  type ConversationData,
  type Huddle,
} from '@/api'
import { useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { hasConvex } from '@/api'
import { useLastSelection } from '@/lib/lastSelection'
import { useDebug } from '@/lib/debug'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'

interface UseTopicViewArgs {
  topicId: string | null
  topicTitle?: string
  /** Override the default toggleTopic-and-stay behavior (e.g. Desk wants to clear selection on unstar) */
  onToggleStarred?: () => void
  /** When false, suppress non-urgent hasNewMessage/hasNewReply flags. Urgent flags always show. */
  showUnreads?: boolean
  /** V2 sidebar tree: when set, auto-opens the matching huddle's thread panel. */
  selectedHuddleId?: string | null
}

interface ViewSlots {
  rightPanel: ReactNode
  threadPanel: ReactNode | undefined
}

export function useTopicView({
  topicId,
  topicTitle,
  onToggleStarred,
  showUnreads = false,
  selectedHuddleId: externalSelectedHuddleId = null,
}: UseTopicViewArgs): ViewSlots {
  const [activeTab, setActiveTab] = useState<TopicTab>('conversations')
  const scrollRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { setPendingDmThreadId, pendingTopicThread, setPendingTopicThread } = useLastSelection()
  const { isTopicStarred, toggleTopic } = useStarred()
  const findTopic = useTopicLookup()
  const huddleLookup = useHuddleLookup()
  const huddlesLoading = useHuddlesLoading()
  const isTopicResolved = useIsTopicResolved()
  const isTopicMember = useIsTopicMember()
  const joinTopic = useJoinTopic()
  const inviteToTopic = useInviteToTopic()
  const actions = usePeekActions()
  const { state: debug } = useDebug()
  const huddleVariant = debug.huddles.variant
  const topic = topicId != null ? findTopic(topicId) : undefined
  // The topic's Folder id, so it can be copied and pasted into another app.
  // `'skip'` without a deployment or a topic — Peek runs on static mocks in
  // tests and Storybook, where there is no relay and so no Folder.
  const topicFolderId = useQuery(
    api.nostr.data.folderForTopic,
    hasConvex && topicId != null ? { topicKey: topicId } : 'skip',
  )

  // Derived: a topic is "resolved" iff every non-deleted conv in it is resolved.
  // Single source of truth for the dashed-circle vs checkmark icon everywhere.
  const topicResolved = topicId != null ? isTopicResolved(topicId) : false
  /** Non-members see the content plus a Join banner (QA #2.7 ruling). */
  const isMemberHere = topicId != null ? isTopicMember(topicId) : true

  // Thread + huddle UI state stays local — it's transient view state, not data.
  const [threadConvId, setThreadConvId] = useState<string | null>(null)

  // Opening the topic clears new-message state; opening a thread clears that
  // thread's new-reply state (§4.3).
  useMarkRead('topic', topicId, threadConvId)
  const [selectedHuddleId, setSelectedHuddleId] = useState<string | null>(null)
  const [isCreatingHuddle, setIsCreatingHuddle] = useState(false)
  /** Members dialog: 'list' from the pill, 'add' from the empty-topic banner. */
  const [membersView, setMembersView] = useState<MembersDialogView | null>(null)

  // All data arrives merged from the seam — overrides applied, deletions
  // filtered, replyCount final. Nothing below touches override maps.
  const {
    groups: currentGroups,
    sent: currentSent,
    openCount,
    resolvedCount,
    members: topicMembers,
    hasAnyPublicMessages,
    isLoading,
    hasEarlier,
    showEarlier,
  } = useTopicMessages(topicId)
  const currentHuddles = topicId != null ? huddleLookup(topicId) : []

  /** When the topic was promoted from a DM, this is the seed huddle. Drives the DM-origin empty state. */
  const originHuddle = currentHuddles.find((h) => h.originDmId !== undefined)

  /** V2 huddle main-view: when set, the rightPanel renders the huddle's content
   *  (header in huddleMode, body of extraConvs) instead of the topic's content.
   *  Derived directly from the URL-driven externalSelectedHuddleId — using local
   *  selectedHuddleId here would cause a one-render flicker between URL change
   *  and the sync effect committing it to local state. */
  const v2SelectedHuddle =
    huddleVariant === 2 && externalSelectedHuddleId
      ? currentHuddles.find((h) => h.id === externalSelectedHuddleId)
      : undefined
  const isV2HuddleView = v2SelectedHuddle != null
  const v2HuddleNameLabel = v2SelectedHuddle
    ? (() => {
        const others = v2SelectedHuddle.members.filter((n) => n !== CURRENT_USER_NAME)
        return others.length > 0 ? others.join(', ') : v2SelectedHuddle.members.join(', ')
      })()
    : ''

  /** Merged messages for the V2 huddle main view (seed + extras + runtime-sent). */
  const v2HuddleConvs = useHuddleMessages(v2SelectedHuddle ?? null)

  /** When the open thread is a promoted huddle's seed message, find that huddle so
   *  we can render the promotion divider + "Open in DMs" button. */
  const promotedHuddleForThread = threadConvId
    ? currentHuddles.find((h) => h.seedMessageId === threadConvId && h.originDmId !== undefined)
    : undefined

  // Global merged thread lookup — spans topic messages, huddle messages, and the
  // DM seed message of promoted huddles (message ids are globally unique).
  const thread = useThread(threadConvId)
  const threadConv = thread.conversation
  const threadReplies = thread.replies.map((r) => ({
    ...r,
    isNew: r.isNew && (r.isUrgent || showUnreads),
  }))
  const threadSentReplies = thread.sentReplies

  /** Open a regular (non-huddle) thread. Clears any previously-selected huddle so
   *  the ThreadPanel doesn't keep showing huddle members/lock when the user clicks
   *  from a HuddleCard to a ConversationCard in V3's mixed stream. Huddle clicks
   *  use a separate `openHuddle` handler that sets selectedHuddleId directly. */
  const openThread = (convId: string) => {
    setSelectedHuddleId(null)
    setThreadConvId(convId)
  }
  const closeThread = () => {
    setThreadConvId(null)
    setSelectedHuddleId(null)
  }

  // One-shot deep link (launcher search results):
  // open the requested thread once this topic is showing, then clear.
  useEffect(() => {
    if (pendingTopicThread && topicId != null && pendingTopicThread.topicId === topicId) {
      setActiveTab('conversations')
      setSelectedHuddleId(null)
      setThreadConvId(pendingTopicThread.convId)
      setPendingTopicThread(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingTopicThread, topicId])

  const handleSendReply = (payload: SendPayload) => {
    if (!threadConvId) return
    actions.sendReply(threadConvId, payload)
  }

  const handleDeleteReply = (replyId: string) => {
    if (!threadConvId) return
    actions.deleteReply(threadConvId, replyId)
  }

  const handleSend = (payload: SendPayload) => {
    if (topicId == null) return
    actions.sendTopicMessage(topicId, payload)
  }

  const handleDelete = (id: string) => {
    if (topicId == null) return
    actions.deleteTopicMessage(topicId, id)
  }

  // The huddle creator (HuddleCreator) owns its own recipient/query/focus state and
  // handles Escape + outside-click internally; here we just flip the open flag.
  const cancelHuddleCreation = () => setIsCreatingHuddle(false)

  /** V2 huddle main-view compose box: writes a top-level message into the selected huddle. */
  const handleHuddleMessageSend = ({ text }: SendPayload) => {
    if (!text || !v2SelectedHuddle) return
    actions.sendHuddleMessage(v2SelectedHuddle.id, text)
  }

  const handleCreateHuddle = (recipients: string[], firstMessage: string) => {
    if (!firstMessage || recipients.length === 0 || topicId == null) return
    actions.createHuddle(topicId, recipients, firstMessage)
    setIsCreatingHuddle(false)
  }

  /** V2 dialog flow: members-only creation. The new huddle has no seed message —
   *  the user lands inside it and writes their first via the huddle's compose box. */
  const handleStartHuddleFromDialog = ({ invitees }: StartHuddleResult) => {
    if (topicId == null || invitees.length === 0) return
    const newHuddleId = actions.createEmptyHuddle(topicId, invitees.map((p) => p.name))
    setIsCreatingHuddle(false)
    navigate(`/topics/${topicId}?huddle=${newHuddleId}`)
  }

  const handleDeleteHuddle = (huddleId: string) => {
    actions.deleteHuddle(huddleId)
    if (selectedHuddleId === huddleId) {
      setSelectedHuddleId(null)
      setThreadConvId(null)
    }
  }

  // Reset state when switching topics
  useEffect(() => {
    setThreadConvId(null)
    setActiveTab('conversations')
    setSelectedHuddleId(null)
    setMembersView(null)
    cancelHuddleCreation()
  }, [topicId])

  // V2 sidebar tree: when the URL-driven huddle changes, close any open thread so
  // a stale thread from the previous huddle doesn't briefly render against the new
  // huddle's body. v2SelectedHuddle is derived directly from the URL — no local-state
  // sync needed (which previously caused a one-render flicker).
  useEffect(() => {
    if (huddleVariant !== 2) return
    setThreadConvId(null)
  }, [huddleVariant, externalSelectedHuddleId])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [topicId])
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [currentSent.length])

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
  }, [currentGroups])

  if (topicId == null || !topicTitle) {
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
        folderId={topicFolderId}
        name={isV2HuddleView ? v2HuddleNameLabel : topicTitle}
        topicMode={!isV2HuddleView}
        huddleMode={isV2HuddleView}
        isResolved={topicResolved}
        openCount={openCount}
        resolvedCount={resolvedCount}
        members={isV2HuddleView ? v2SelectedHuddle.members : topicMembers}
        hideTopicMeta={huddleVariant === 1 && activeTab === 'huddles'}
        isStarred={topicId != null && isTopicStarred(topicId)}
        onToggleStarred={
          onToggleStarred ??
          (topicId != null && topicTitle
            ? () => toggleTopic({
                topicId,
                title: topicTitle,
                topicStatus: topicResolved ? 'resolved' : 'unresolved',
              })
            : undefined)
        }
        onStartHuddle={
          huddleVariant === 1 || isV2HuddleView ? undefined : () => setIsCreatingHuddle(true)
        }
        onShowMembers={
          !isV2HuddleView && topicId != null ? () => setMembersView('list') : undefined
        }
        tabs={
          huddleVariant === 1 ? (
            <TopicTabs
              activeTab={activeTab}
              onTabChange={(tab) => {
                setActiveTab(tab)
                setThreadConvId(null)
                setSelectedHuddleId(null)
                cancelHuddleCreation()
              }}
            />
          ) : undefined
        }
      />

      {/* V2 huddle main view — replaces the topic body when a huddle is selected via the sidebar tree.
          Body shows huddle.conversation (seed; for DM-promoted huddles this is the original DM message)
          followed by extraConvs and any huddleSentMessages posted by the user. */}
      {isV2HuddleView && (
        <>
          <div ref={scrollRef} className="flex-1 overflow-y-auto flex flex-col">
            <div className="flex-1 min-h-0" />
            <div className="shrink-0 flex flex-col px-4 py-4 gap-2">
              {v2HuddleConvs.length === 0 ? (
                <div className="py-6 flex items-center justify-center">
                  <span className="text-caption text-text-muted">No messages yet — start the conversation below.</span>
                </div>
              ) : (
              <div className="flex flex-col gap-2">
                <DateDivider label={v2SelectedHuddle.lastActivity} className="sticky top-0 z-10 bg-bg-surface" />
                {v2HuddleConvs.map((c) => (
                  <ConversationCard
                    key={`${v2SelectedHuddle.id}_${c.id}`}
                    authorName={c.authorName}
                    timestamp={c.timestamp}
                    body={c.body}
                    attachments={c.attachments}
                    files={c.files}
                    reactions={c.reactions}
                    highlightType={c.highlightType}
                    replyCount={c.replyCount}
                    replyAuthors={c.replyAuthors}
                    lastReplyTime={c.lastReplyTime}
                    isResolved={c.isResolved}
                    resolvedBy={c.resolvedBy}
                    resolutionMessage={c.resolutionMessage}
                    showCreateTopic={false}
                    isSelected={threadConvId === c.id}
                    onResolvedChange={(resolved, resolvedBy, message) => actions.setResolution(c.id, resolved, resolved ? (resolvedBy ?? CURRENT_USER_NAME) : undefined, message)}
                    onReactionsChange={(next, emoji) => actions.setReactions(c.id, next, c.reactions ?? [], emoji)}
                    onHighlightChange={(hl) => actions.setHighlight(c.id, hl)}
                    onBodyChange={(b) => actions.editBody(c.id, b)}
                    onClick={() => openThread(c.id)}
                    onReply={() => openThread(c.id)}
                  />
                ))}
              </div>
              )}
            </div>
          </div>
          <div className="p-3">
            <ComposeBox onSend={handleHuddleMessageSend} contextLabel={`Huddle · ${v2HuddleNameLabel}`} />
          </div>
        </>
      )}

      {/* Conversations tab — also the only body in V2/V3 (no tabs). Suppressed when a V2 huddle is open. */}
      {!isV2HuddleView && (huddleVariant !== 1 || activeTab === 'conversations') && (() => {
        // V3 unified stream: date-keyed groups holding convs, sent messages, and
        // huddles INTERLEAVED chronologically (QA #2.5 — huddles used to render
        // as a block at the end of their group, and huddle-only dates were
        // appended after "Today"). Timestamps come from the seam (Convex rows +
        // runtime sends); static mocks without them keep the old ordering.
        type V3Entry =
          | { kind: 'conv'; conv: ConversationData }
          | { kind: 'sent'; conv: ConversationData }
          | { kind: 'huddle'; huddle: Huddle }
        type V3Group = { dateLabel: string; entries: V3Entry[] }
        const v3Groups: V3Group[] = []
        if (huddleVariant === 3) {
          const map = new Map<string, V3Group>()
          for (const group of currentGroups) {
            map.set(group.dateLabel, {
              dateLabel: group.dateLabel,
              entries: group.convs.map((c) => ({ kind: 'conv' as const, conv: c })),
            })
          }
          // Sent messages always live under "Today".
          if (currentSent.length > 0) {
            let today = map.get('Today')
            if (!today) {
              today = { dateLabel: 'Today', entries: [] }
              map.set('Today', today)
            }
            today.entries.push(...currentSent.map((m) => ({ kind: 'sent' as const, conv: m })))
          }
          // Member-of huddles with a seed; empty huddles can't exist in V3 anyway.
          // Each slots into its date group at its chronological position. The
          // anchor is when the huddle's seed message was SENT (what the card
          // displays) — a DM-promoted huddle sits where its origin message
          // belongs, not at its later promotion/last-activity time.
          const v3Huddles = currentHuddles.filter(
            (h) => h.conversation != null && h.members.includes(CURRENT_USER_NAME)
          )
          for (const h of v3Huddles) {
            const at = h.conversation?.createdAtMs ?? h.promotedAtMs ?? h.lastActivityMs
            const label = at !== undefined ? formatDateLabel(at) : h.lastActivity
            let group = map.get(label)
            if (!group) {
              group = { dateLabel: label, entries: [] }
              map.set(label, group)
            }
            let idx = group.entries.length
            if (at !== undefined) {
              const later = group.entries.findIndex(
                (e) => e.kind !== 'huddle' && e.conv.createdAtMs !== undefined && e.conv.createdAtMs > at,
              )
              if (later !== -1) idx = later
            }
            group.entries.splice(idx, 0, { kind: 'huddle', huddle: h })
          }
          v3Groups.push(...map.values())
          // Order the DAY groups chronologically when every group carries a
          // timestamp (Convex); mock groups without one keep insertion order.
          const groupAt = (g: V3Group): number | undefined => {
            for (const e of g.entries) {
              const at =
                e.kind === 'huddle'
                  ? (e.huddle.conversation?.createdAtMs ?? e.huddle.promotedAtMs ?? e.huddle.lastActivityMs)
                  : e.conv.createdAtMs
              if (at !== undefined) return at
            }
            return undefined
          }
          if (v3Groups.every((g) => groupAt(g) !== undefined)) {
            v3Groups.sort((a, b) => groupAt(a)! - groupAt(b)!)
          }
        }
        return (
        <>
          <div ref={scrollRef} className="flex-1 overflow-y-auto flex flex-col">
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
              {huddleVariant === 3 ? (
                v3Groups.map((group) => (
                  <div key={group.dateLabel} className="flex flex-col gap-2">
                    <DateDivider label={group.dateLabel} className="sticky top-0 z-10 bg-bg-surface" />
                    {group.entries.map((entry) => {
                      if (entry.kind === 'huddle') {
                        const huddle = entry.huddle
                        // safe to access .id — we filtered to conversation != null above
                        const threadId = huddle.seedMessageId ?? huddle.conversation!.id
                        const openHuddle = () => {
                          setSelectedHuddleId(huddle.id)
                          setThreadConvId(threadId)
                          cancelHuddleCreation()
                        }
                        return (
                          <HuddleCard
                            key={huddle.id}
                            huddle={huddle}
                            variant="inStream"
                            isSelected={selectedHuddleId === huddle.id}
                            onClick={openHuddle}
                            onReply={openHuddle}
                            onDelete={() => handleDeleteHuddle(huddle.id)}
                          />
                        )
                      }
                      const c = entry.conv
                      return (
                        <ConversationCard
                          key={`${topicId}_${c.id}`}
                          authorName={c.authorName}
                          timestamp={c.timestamp}
                          body={c.body}
                          attachments={c.attachments}
                          files={c.files}
                          reactions={c.reactions}
                          highlightType={c.highlightType}
                          replyCount={c.replyCount}
                          replyAuthors={c.replyAuthors}
                          lastReplyTime={c.lastReplyTime}
                          hasNewMessage={entry.kind === 'conv' && c.hasNewMessage && (c.isUrgent || showUnreads)}
                          hasNewReply={entry.kind === 'conv' && c.hasNewReply && (c.isUrgent || showUnreads)}
                          isUrgent={entry.kind === 'conv' ? c.isUrgent : undefined}
                          isResolved={c.isResolved}
                          resolvedBy={c.resolvedBy}
                          resolutionMessage={c.resolutionMessage}
                          showCreateTopic={false}
                          isSelected={threadConvId === c.id}
                          onResolvedChange={(resolved, resolvedBy, message) => actions.setResolution(c.id, resolved, resolved ? (resolvedBy ?? CURRENT_USER_NAME) : undefined, message)}
                          onReactionsChange={(next, emoji) => actions.setReactions(c.id, next, c.reactions ?? [], emoji)}
                          onHighlightChange={(hl) => actions.setHighlight(c.id, hl)}
                          onBodyChange={(b) => actions.editBody(c.id, b)}
                          onClick={() => openThread(c.id)}
                          onReply={() => openThread(c.id)}
                          onDelete={() => handleDelete(c.id)}
                        />
                      )
                    })}
                  </div>
                ))
              ) : (
                <>
                  {currentGroups.map((group) => (
                    <div key={group.dateLabel} className="flex flex-col gap-2">
                      <DateDivider label={group.dateLabel} className="sticky top-0 z-10 bg-bg-surface" />
                      {group.convs.map((c) => (
                        <ConversationCard
                          key={`${topicId}_${c.id}`}
                          authorName={c.authorName}
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
                          showCreateTopic={false}
                          isSelected={threadConvId === c.id}
                          onResolvedChange={(resolved, resolvedBy, message) => actions.setResolution(c.id, resolved, resolved ? (resolvedBy ?? CURRENT_USER_NAME) : undefined, message)}
                          onReactionsChange={(next, emoji) => actions.setReactions(c.id, next, c.reactions ?? [], emoji)}
                          onHighlightChange={(hl) => actions.setHighlight(c.id, hl)}
                          onBodyChange={(b) => actions.editBody(c.id, b)}
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
                          showCreateTopic={false}
                          isSelected={threadConvId === m.id}
                          onResolvedChange={(resolved, resolvedBy, message) => actions.setResolution(m.id, resolved, resolved ? (resolvedBy ?? CURRENT_USER_NAME) : undefined, message)}
                          onReactionsChange={(next, emoji) => actions.setReactions(m.id, next, m.reactions ?? [], emoji)}
                          onHighlightChange={(hl) => actions.setHighlight(m.id, hl)}
                          onBodyChange={(b) => actions.editBody(m.id, b)}
                          onClick={() => openThread(m.id)}
                          onReply={() => openThread(m.id)}
                          onDelete={() => handleDelete(m.id)}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
          {!isLoading && !isMemberHere && (
            <div className="px-3 pt-2">
              <JoinTopicBanner title={topicTitle} onJoin={() => topicId != null && joinTopic(topicId)} />
            </div>
          )}
          {!isLoading && isMemberHere && !hasAnyPublicMessages && (
            <div className="px-3 pt-2">
              <NewTopicBanner title={topicTitle} onInviteMembers={() => setMembersView('add')} />
            </div>
          )}
          {/* V3 only: the topic-header "+ Start huddle" button toggles isCreatingHuddle and
              flips the regular composer into the people-picker + first-message creator.
              V2 uses a portalled dialog (rendered below) and never touches the composer. */}
          {isCreatingHuddle && huddleVariant === 3 ? (
            <HuddleCreator topicTitle={topicTitle} onCancel={cancelHuddleCreation} onCreate={handleCreateHuddle} />
          ) : (
            <div className="p-3">
              <ComposeBox onSend={handleSend} contextLabel={topicTitle ? `#${topicTitle}` : undefined} />
            </div>
          )}
        </>
        )
      })()}

      {/* Timeline tab (V1 only) */}
      {huddleVariant === 1 && activeTab === 'timeline' && (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState message="A selective view of how this topic evolved - highlights, resolutions, and key events." />
        </div>
      )}

      {/* Huddles tab (V1 only) */}
      {huddleVariant === 1 && activeTab === 'huddles' && (
        <>
          {huddlesLoading ? (
            <div className="flex-1 overflow-y-auto px-4 py-4">
              <SkeletonHuddleGrid />
            </div>
          ) : currentHuddles.length === 0 && !isCreatingHuddle ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4">
              <EmptyState message="No huddles yet - start a private discussion with a few people or AI." />
              <button
                onClick={() => setIsCreatingHuddle(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-bg-elevated border border-border-default text-caption text-text-secondary hover:bg-bg-hover transition-colors cursor-pointer"
              >
                <IconPlus size={14} stroke={1.5} />
                New Huddle
              </button>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto px-4 py-4">
              <div className="grid grid-cols-2 gap-3">
                {currentHuddles.map((huddle) => {
                  // Promoted-from-DM huddles route the thread to the original DM
                  // message id so replies/reactions/highlights mirror across both
                  // entry points (DM thread panel and huddle thread panel).
                  // Empty huddles (no seed) just select without opening a thread.
                  const threadId = huddle.seedMessageId ?? huddle.conversation?.id
                  const openHuddle = () => {
                    setSelectedHuddleId(huddle.id)
                    if (threadId) setThreadConvId(threadId)
                    cancelHuddleCreation()
                  }
                  return (
                    <HuddleCard
                      key={huddle.id}
                      huddle={huddle}
                      isSelected={selectedHuddleId === huddle.id}
                      onClick={openHuddle}
                      onReply={openHuddle}
                      onDelete={() => handleDeleteHuddle(huddle.id)}
                    />
                  )
                })}
                <div className={cn(
                  'flex flex-col items-center justify-center gap-2 h-[130px]',
                  currentHuddles.length % 2 === 0 && 'col-span-2'
                )}>
                  <IconButton
                    variant="primary"
                    disabled={isCreatingHuddle}
                    onClick={() => setIsCreatingHuddle(true)}
                    aria-label="New Huddle"
                  >
                    <IconPlus size={16} stroke={1.5} />
                  </IconButton>
                  <span className="text-caption text-text-primary">New Huddle</span>
                </div>
              </div>
            </div>
          )}
          {isCreatingHuddle && (
            <HuddleCreator topicTitle={topicTitle} onCancel={cancelHuddleCreation} onCreate={handleCreateHuddle} />
          )}
        </>
      )}

      {/* V2 dialog: members-only, portalled, sits above any body branch. */}
      {isCreatingHuddle && huddleVariant === 2 && (
        <StartHuddleDialog
          onConfirm={handleStartHuddleFromDialog}
          onCancel={() => setIsCreatingHuddle(false)}
        />
      )}

      {/* Members dialog (portalled): roster layer + add layer. Opened at the
          roster by the members pill, or straight at the add layer by the
          empty-topic banner. Inviting returns to the roster. */}
      {membersView != null && topicId != null && (
        <MembersDialog
          memberNames={topicMembers}
          canAdd={isMemberHere}
          initialView={membersView}
          onInvite={(invitees) => inviteToTopic(topicId, invitees)}
          onClose={() => setMembersView(null)}
        />
      )}
    </div>
  )

  // While a selected thread's conversation is still loading (remote-only
  // messages have no local copy), keep the panel column mounted with a
  // loading shell — rendering null here reads as the panel closing/reopening.
  const threadPanel = !threadConv && threadConvId && thread.isLoading ? (
    <ThreadPanelLoading onClose={closeThread} />
  ) : threadConv ? (
    <ThreadPanel
      conversation={threadConv}
      replies={threadReplies}
      sentReplies={threadSentReplies}
      isLoadingReplies={thread.isLoading}
      isResolved={threadConv.isResolved ?? false}
      huddleMembers={
        // V2 huddle view already shows lock + members in the rightPanel header,
        // so we suppress the duplicate pill on ThreadPanel.
        selectedHuddleId && huddleVariant !== 2
          ? currentHuddles.find((h) => h.id === selectedHuddleId)?.members ?? []
          : []
      }
      huddleMemberCount={
        selectedHuddleId && huddleVariant !== 2
          ? currentHuddles.find((h) => h.id === selectedHuddleId)?.members.length
          : undefined
      }
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
        promotedHuddleForThread && topic
          ? {
              topicId: topic.id,
              topicTitle: topic.title,
              topicResolved,
              dateLabel: promotedHuddleForThread.promotedAt ?? '',
              promotedAtMs: promotedHuddleForThread.promotedAtMs,
              // We're already on this topic page; clicking the link should switch to
              // the Conversations tab and close the thread panel rather than re-issue
              // a no-op navigation that wouldn't reset local tab state.
              onTopicClick: () => {
                setActiveTab('conversations')
                closeThread()
              },
            }
          : undefined
      }
      onOpenInDm={
        promotedHuddleForThread && promotedHuddleForThread.originDmId !== undefined && threadConvId
          ? () => {
              const dmId = promotedHuddleForThread.originDmId
              // Stage the pending thread id BEFORE navigating so the DM view can consume
              // it on mount. Context state is more reliable than location.state across
              // route transitions (location.state can be reset by replace navigations).
              setPendingDmThreadId(threadConvId)
              navigate(`/people/${dmId}`)
            }
          : undefined
      }
      onClose={closeThread}
      onSendReply={handleSendReply}
      onDeleteReply={handleDeleteReply}
      onInitialBodyChange={
        selectedHuddleId && threadConvId
          ? (newBody: string) => actions.editHuddleSeedBody(threadConvId, newBody)
          : undefined
      }
      onReplyBodyChange={(replyId, body) => actions.editBody(replyId, body)}
      onReplyHighlightChange={(replyId, hl) => actions.setHighlight(replyId, hl)}
      onReplyReactionsChange={(replyId, next) => actions.setReactions(replyId, next)}
    />
  ) : undefined

  return { rightPanel, threadPanel }
}
