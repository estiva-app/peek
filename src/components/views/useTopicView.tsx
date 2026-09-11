import { shareableTopicUrl } from '@/lib/objectUrl'
import { useMarkRead } from '@/lib/useMarkRead'
import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback, type ReactNode } from 'react'
import { registerTopicConversation, unregisterTopicConversation } from '@/lib/conversationRegistry'
import { registerThreadOpener, unregisterThreadOpener } from '@/lib/threadOpener'
import { isNearBottom } from './scrollPolicy'
import { ScrollArea } from '@estiva-app/ui'
import { ConversationHeader } from '@/components/ConversationHeader'
import { NewTopicBanner } from '@/components/NewTopicBanner'
import { JoinTopicBanner } from '@/components/JoinTopicBanner'
import { MembersDialog, type MembersDialogView } from '@/components/MembersDialog'
import { HuddleCreator } from '@/components/HuddleCreator'
import { ConversationCard } from '@/components/ConversationCard'
import { ThreadPanel, ThreadPanelLoading } from '@/components/ThreadPanel'
import { HuddleCard } from '@/components/HuddleCard'
import { DateDivider } from '@/components/ui/DateDivider'
import { SkeletonConversationList } from '@/components/ui/Skeleton'
import { Button } from '@/components/ui/Button'
import { ComposeBox, type SendPayload } from '@/components/ui/ComposeBox'
import { EmptyState } from '@/components/ui/EmptyState'
import { draftKeys } from '@/lib/drafts'
import { partitionByRelation, subFileAddresses, subFileLabels, type FolderProjectState } from '@/api/useFolderProject'
import type { TopicActivityItem } from '@/components/TopicActivity'
import {
  CURRENT_USER_NAME,
  formatDateLabel,
  useTopicMessages,
  useThread,
  useHuddleLookup,
  useTopicLookup,
  useIsTopicResolved,
  useIsTopicMember,
  useJoinTopic,
  useInviteToTopic,
  useOpenWorkTopicIds,
  usePeekActions,
  useStarred,
  type ConversationData,
  type Huddle,
} from '@/api'
import { useConvex, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { hasConvex } from '@/api'
import { validToken } from '@/auth/estivaId'
import { syncTopicFromRelay } from '@/nostr/sync'
import { getLiveTopics } from '@/nostr/liveTopics'
import { recordBackfillEnd, recordBackfillStart } from '@/nostr/freshness'
import { useRefreshTriggers } from '@/lib/useRefreshTriggers'
import type { RelayState } from '@estiva-app/protocol'
import { useLastSelection } from '@/lib/lastSelection'
import { useToast } from '@/lib/toast'
import { useReportDelete } from '@/lib/reportDelete'
import { useNavigate } from 'react-router-dom'

interface UseTopicViewArgs {
  topicId: string | null
  topicTitle?: string
  /** Override the default toggleTopic-and-stay behavior (e.g. Desk wants to clear selection on unstar) */
  onToggleStarred?: () => void
  /** When false, suppress non-urgent hasNewMessage/hasNewReply flags. Urgent flags always show. */
  showUnreads?: boolean
  /** V2 sidebar tree: when set, auto-opens the matching huddle's thread panel. */
  /** When set, the header offers a show/hide control for the Folder panel
   *  (PEEK-24). Omitted by views with nowhere to put one, so the button never
   *  appears where it cannot do anything. */
  onToggleFolderPanel?: () => void
  folderPanelOpen?: boolean
  /**
   * What is in this topic's Folder, resolved by the page — CON-9.
   *
   * Taken rather than resolved here because the Folder panel needs the same
   * answer, and two callers would mean two relay reads per topic and two
   * chances to disagree about what is in it.
   */
  folderProject?: FolderProjectState
  /** Opens this topic's details dialog from the header's more-menu (PEE-2).
   *  The page owns the dialog, because the sidebar rows open the same one. */
  onOpenDetails?: () => void
  /** Deleting from inside the topic, not only from its row in the list. */
  onDeleteTopic?: () => void
}

interface ViewSlots {
  rightPanel: ReactNode
  threadPanel: ReactNode | undefined
  /** Conversations on files under this one, newest first — the Folder panel draws them. */
  activity: TopicActivityItem[]
  /** Sub-file address → the name its own app gives it, for an Activity row. */
  subFileLabels: Map<string, string>
  /** Open a conversation's thread in the right column. */
  openThread: (convId: string) => void
  /** Which conversation's thread is open, or null. */
  openThreadId: string | null
  /**
   * This topic's Folder, or null when it has none.
   *
   * Exposed so the page can put the Folder panel in the same column this hook
   * fills with threads, and gate it on the same fact the header gates its
   * toggle on — otherwise a topic with no Folder gets a panel and no way to
   * close it.
   */
  folderId: string | null
  /**
   * The tab's live relay connection state (PEE-8).
   *
   * Returned rather than rendered — PEE-8 deliberately shows nothing. PEE-9
   * owns one derived connection state surfaced once, and PEE-1 needs it to know
   * when to idle its refetch interval. Exposing it here is what stops either of
   * them opening a second socket to re-derive it.
   */
  relayState: RelayState
}

export function useTopicView({
  topicId,
  topicTitle,
  onToggleStarred,
  showUnreads = false,
  onToggleFolderPanel,
  folderPanelOpen = false,
  folderProject = 'loading',
  onOpenDetails,
  onDeleteTopic,
}: UseTopicViewArgs): ViewSlots {
  const scrollRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { setPendingDmThreadId, pendingTopicThread, setPendingTopicThread } = useLastSelection()
  const { isTopicStarred, toggleTopic } = useStarred()
  const findTopic = useTopicLookup()
  const huddleLookup = useHuddleLookup()
  const isTopicResolved = useIsTopicResolved()
  const isTopicMember = useIsTopicMember()
  const joinTopic = useJoinTopic()
  const inviteToTopic = useInviteToTopic()
  const openWorkTopicIds = useOpenWorkTopicIds()
  const actions = usePeekActions()
  const { showToast } = useToast()
  const reportDelete = useReportDelete()

  /**
   * Edit, and say so when it did not travel — PEE-24.
   *
   * Peek patches its own row before publishing, so a failed publish leaves this
   * app looking right and every other reader — Ship's conversation view, the
   * agent — showing the old text. Nothing said so until now: all three ways the
   * publish can decline wrote to the console and nothing else.
   *
   * The toast is deliberately not auto-dismissed. This is the one outcome where
   * the app and the world disagree, and a five-second pill that somebody misses
   * puts them back exactly where they were.
   */
  const editBody = (id: string, body: string) => {
    void actions.editBody(id, body).then((outcome) => {
      if (outcome.published) return
      showToast({
        label: `Edited here, but not published — ${outcome.reason}. Other apps still show the old text.`,
        // `warning` since the package gained the tone at 0.12.2; it was
        // `neutral` for want of one. `leadingIcon: false` still matters more
        // than the colour: the default is a circle-CHECK, and a tick beside
        // "not published" is worse than no icon at all.
        type: 'warning',
        leadingIcon: false,
        durationMs: 0,
      })
    })
  }

  const topic = topicId != null ? findTopic(topicId) : undefined
  // The topic's Folder id, so it can be copied and pasted into another app.
  // `'skip'` without a deployment or a topic — Peek runs on static mocks in
  // tests and Storybook, where there is no relay and so no Folder.
  // Prefer the folder id carried on the topic object (returned by topics.list)
  // when available — avoids a second round-trip and prevents a missing id when
  // the client-side topic array already knows it. Fall back to the dedicated
  // folderForTopic query when the topic lacks it.
  const topicFolderIdQuery = useQuery(
    api.nostr.data.folderForTopic,
    hasConvex && topicId != null ? { topicKey: topicId } : 'skip',
  )
  const topicFolderId = (topic as any)?.folderId ?? topicFolderIdQuery

  // Pull this channel as the viewer whenever the topic is opened.
  //
  // The cron cannot: it reads with a custodied key, and Buzz answers a
  // non-member with `403 relay_membership_required`, so every channel an Estiva
  // ID identity created was invisible to it — which is why nothing written in
  // Ship ever reached Peek. The person looking at a topic is a member of it by
  // definition, so their token is the one identity guaranteed to see it.
  //
  // Cheap to repeat: the `since` cursor makes an already-synced channel fetch
  // almost nothing, and imports are idempotent by event id regardless.
  //
  // The relay reads happen here rather than in a Convex action (PEEK-106): the
  // token is the credential, and this is the only place it exists. Convex still
  // does the projection — see `convex/nostr/sync.ts`.
  const convex = useConvex()
  const relayConfig = useQuery(api.nostr.config.relayConfig, hasConvex ? {} : 'skip')
  const relayUrl = relayConfig?.relayUrl

  /**
   * The channel this topic lives in, for the live subscription (PEE-8).
   *
   * `syncPlan` already answers it for the viewer and is the same query the HTTP
   * backfill uses, so the two paths cannot disagree about which channel a topic
   * is. Null until the topic has a channel on the relay — topics created before
   * Nostr emission was wired up never get one, and those stay HTTP-only.
   */
  const syncPlan = useQuery(
    api.nostr.sync.syncPlan,
    hasConvex && topicId != null ? { topicKey: topicId } : 'skip',
  )
  const channelUuid = syncPlan?.channelUuid ?? null

  /**
   * Backfill over HTTP: on open, and again whenever the socket becomes live.
   *
   * **The mount-time run is unconditional and stays that way.** A subscription
   * only delivers what arrives *after* it is registered, so opening a topic
   * must still read history — the socket cannot do it, and should not try. The
   * HTTP path owns the `since` cursor, the `PAGE_LIMIT` paging, and the
   * resolution read that is deliberately *not* cursored, because an assertion
   * about an old message can be made at any time.
   *
   * **The re-run on reconnect is the half the socket cannot cover.** While the
   * connection is down, events are simply missed; the restored subscription
   * then delivers only what is new. Without a backfill at that moment the gap
   * would be invisible and permanent — a topic quietly missing whatever was
   * said during the outage. `since` makes the repeat almost free.
   *
   * A run that lands after `topicId` has changed is harmless rather than
   * cancelled: every import is keyed by `topicKey`, so a late backfill writes
   * the previous topic's history to the previous topic. Nothing here is applied
   * to component state, which is what makes that true.
   */
  const [relayState, setRelayState] = useState<RelayState>('connecting')
  const backfill = useRef<() => void>(() => {})
  backfill.current = () => {
    if (!hasConvex || topicId == null || !relayUrl) return
    // `validToken()` rather than the `usesEstivaId` snapshot: that constant is
    // fixed at module load, so a page opened while the stored token had expired
    // disables this sync for the whole session even after the token is renewed.
    const token = validToken()
    if (!token) return
    // Observed rather than inferred: PEE-9 shows "catching up" while this is in
    // flight, and "last synced" from when it succeeded. A failure records the
    // end without moving the timestamp, so the age on screen keeps growing —
    // which is the whole point of showing it.
    recordBackfillStart()
    void syncTopicFromRelay(topicId, relayUrl, token, {
      syncPlan: (args) => convex.query(api.nostr.sync.syncPlan, args),
      importChannel: (args) => convex.action(api.nostr.sync.importChannel, args as never),
      importReactions: (args) => convex.action(api.nostr.sync.importReactions, args as never),
      importResolutions: (args) => convex.action(api.nostr.sync.importResolutions, args as never),
    })
      .then((synced) => recordBackfillEnd(synced))
      .catch((error) => {
        recordBackfillEnd(false)
        console.warn('[nostr] viewer sync failed:', error)
      })
  }

  useEffect(() => {
    if (!hasConvex || topicId == null || !topicFolderId || !relayUrl) return
    backfill.current()
  }, [topicId, topicFolderId, relayUrl, convex])

  /**
   * Re-sync on focus, on becoming visible, and on a slow interval (PEE-1).
   *
   * The effect above is keyed on ids that do not change while a topic is open,
   * so before this it ran once per mount and never again — which is why a
   * reload "fixed" a reply that had been sitting on the relay for ten minutes.
   *
   * **The interval idles while the socket is live**, and that is the whole
   * adaptation this ticket needed: PEE-1 was written when the socket did not
   * exist and it was the only relief available. Polling underneath a working
   * live connection would undo M3. `relayState` comes from PEE-8 for exactly
   * this — deriving it from a second socket would double the AUTH round trips
   * for nothing.
   *
   * Focus and visibility still fire regardless. They happen at human frequency,
   * the `since` cursor makes a repeat almost free, and returning to a tab is
   * the one moment somebody actively wants certainty — including when the
   * socket believes it is connected and is not.
   */
  useRefreshTriggers(() => backfill.current(), {
    enabled: hasConvex && topicId != null && !!relayUrl,
    interval: relayState !== 'live',
  })

  /**
   * Subscribe this topic's channel to the tab's live socket.
   *
   * Additive by construction: everything above still runs, so a socket that
   * never connects degrades to exactly today's behaviour rather than to
   * nothing. The relay reads stay in the browser — the token is the credential
   * and Convex surfaces action arguments in its dashboard logs, which is why
   * PEEK-106 moved them here in the first place.
   */
  useEffect(() => {
    if (!hasConvex || topicId == null || !relayUrl || !channelUuid) return

    // Everything here is inside a try: this effect is additive, and a failure
    // in it must cost the live path and nothing else. `watch()` throws on a
    // channel key that is not a uuid — correct at that boundary, because such a
    // subscription would register globally and never deliver — but an
    // uncaught throw in an effect takes the whole topic view down with it. The
    // guarantee this ticket is making is that a WS failure degrades to today's
    // behaviour, and the HTTP backfill above has already run by this point.
    let unsubscribe: (() => void) | undefined
    let handle: { stop(): void } | undefined
    try {
      const live = getLiveTopics(relayUrl, {
        importChannel: (args) => convex.action(api.nostr.sync.importChannel, args as never),
        importReactions: (args) => convex.action(api.nostr.sync.importReactions, args as never),
        importResolutions: (args) => convex.action(api.nostr.sync.importResolutions, args as never),
      })

      setRelayState(live.state())
      let wasLive = live.state() === 'live'
      unsubscribe = live.onState((next) => {
        setRelayState(next)
        // Only on the transition *into* live, and not for the first connect —
        // the mount effect above has already backfilled that one.
        if (next === 'live' && !wasLive) backfill.current()
        wasLive = next === 'live'
      })

      // Refcounted: StrictMode's double mount shares one REQ, and the channel
      // closes when the second release lands.
      handle = live.watch({ topicKey: topicId, channelUuid })
    } catch (error) {
      console.warn('[nostr] live topic subscription unavailable:', error)
    }
    return () => {
      unsubscribe?.()
      handle?.stop()
    }
  }, [topicId, relayUrl, channelUuid, convex])

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
    groups: allGroups,
    sent: currentSent,
    openCount,
    resolvedCount,
    members: topicMembers,
    hasAnyPublicMessages,
    isLoading,
    hasEarlier,
    showEarlier,
  } = useTopicMessages(topicId)

  /*
    The two lists — CON-9. Identity merges; relation aggregates.

    A topic and the project in its Folder are **the same file**, so a comment on
    the project is this topic's conversation and stays in the stream. A comment
    on one of that project's *tickets* is a different file's conversation — it
    aggregates into Activity and leaves the stream.

    **This is why the stream gets quieter.** Ship publishes a comment into the
    project's Folder, which *is* this topic's channel, so every issue comment
    ever written has arrived here as an ordinary message. Measured on production
    2026-09-06: 422 of 453 threads across every paired topic, 93%. They were
    never talk in the topic; they were another file's discussion filed in the
    same container, and no reader could tell which was which.

    `subFileAddresses` comes off the projection layer, so nothing here knows what
    a Ship issue is. A fourth app's records split a topic correctly without Peek
    learning what they are.
  */
  const subFiles = useMemo(() => subFileAddresses(folderProject), [folderProject])
  const subFileLabel = useMemo(() => subFileLabels(folderProject), [folderProject])

  /*
    The partition itself is a pure function — `partitionByRelation`. It is the
    claim this whole change rests on, and a `useMemo` is a bad place to prove
    one; the rule that a message must be *tagged* rather than merely naming a
    ticket is asserted there.
  */
  const split = useMemo(
    () => partitionByRelation(allGroups.flatMap((g) => g.convs), subFiles),
    [allGroups, subFiles],
  )
  const inStream = useMemo(() => new Set(split.own.map((c) => c.id)), [split])

  const currentGroups = useMemo(
    () =>
      allGroups
        .map((g) => ({ ...g, convs: g.convs.filter((c) => inStream.has(c.id)) }))
        .filter((g) => g.convs.length > 0),
    [allGroups, inStream],
  )

  /**
   * Activity: the conversations of files related to this one, newest first.
   *
   * Sub-files today. Mentions are the other half and are not here yet — a Peek
   * topic is not an addressable object until files nest, so "conversations that
   * mention this topic" is not a question the relay can answer about it. The
   * project in its Folder *is* addressable, and that is the shape the mentions
   * half will take.
   */
  const activityItems = useMemo(
    () => split.activity.map(({ message, about }) => ({ conv: message, about })),
    [split],
  )

  const currentHuddles = topicId != null ? huddleLookup(topicId) : []


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
  // `useCallback` over the two setters, which are stable — so the registration
  // below has an honest dependency instead of re-running every render.
  const openThread = useCallback((convId: string) => {
    setSelectedHuddleId(null)
    setThreadConvId(convId)
  }, [])
  const closeThread = () => {
    setThreadConvId(null)
    setSelectedHuddleId(null)
  }

  // One-shot deep link (launcher search results):
  // open the requested thread once this topic is showing, then clear.
  useEffect(() => {
    if (pendingTopicThread && topicId != null && pendingTopicThread.topicId === topicId) {
      setSelectedHuddleId(null)
      setThreadConvId(pendingTopicThread.convId)
      setPendingTopicThread(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingTopicThread, topicId])

  const handleSendReply = (payload: SendPayload) => {
    if (!threadConvId) return
    // Returned, not fired and forgotten: `ComposeBox` puts the text back on
    // `false`, and swallowing it here would silently restore the old behaviour.
    return actions.sendReply(threadConvId, payload)
  }

  const handleDeleteReply = (replyId: string) => {
    if (!threadConvId) return
    void actions.deleteReply(threadConvId, replyId).then(({ kept }) => reportDelete('reply', kept))
  }

  const handleSend = (payload: SendPayload) => {
    if (topicId == null) return
    return actions.sendTopicMessage(topicId, payload)
  }

  const handleDelete = (id: string) => {
    if (topicId == null) return
    void actions.deleteTopicMessage(topicId, id).then(({ kept }) => reportDelete('message', kept))
  }

  // The huddle creator (HuddleCreator) owns its own recipient/query/focus state and
  // handles Escape + outside-click internally; here we just flip the open flag.
  const cancelHuddleCreation = () => setIsCreatingHuddle(false)

  const handleCreateHuddle = (recipients: string[], firstMessage: string) => {
    if (!firstMessage || recipients.length === 0 || topicId == null) return
    actions.createHuddle(topicId, recipients, firstMessage)
    setIsCreatingHuddle(false)
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
    setSelectedHuddleId(null)
    setMembersView(null)
    cancelHuddleCreation()
  }, [topicId])

  /*
   * ─── Scroll position ───
   *
   * One question asked four ways: when may Peek move the viewport?
   *
   *   opening a conversation  → the bottom, before the first paint
   *   a message arrives       → follow, but only if you were already at the edge
   *   you sent it             → always the bottom
   *   "Show earlier"          → never; the anchor below owns the position
   *
   * The anchor is declared first because the effects that follow have to know
   * not to fight it.
   */

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

  /**
   * Were you at the live edge when new content arrived?
   *
   * A ref rather than state: this updates on every scroll frame and re-rendering
   * the message list that often would be its own bug. `handleScroll` runs before
   * the render that adds a message, so the value still describes where you were
   * a moment before it landed — which is the question worth answering.
   */
  const nearBottom = useRef(true)
  const handleScroll = () => {
    const el = scrollRef.current
    if (el) nearBottom.current = isNearBottom(el)
  }

  /**
   * Opening a conversation lands at the bottom.
   *
   * Keyed on the messages being *there* rather than on `topicId`, which was the
   * bug: the id changes while `useTopicMessages` is still loading, so this ran
   * against an empty container, where `scrollTop = scrollHeight` clamps to 0 —
   * and nothing ran again once the messages arrived. A long conversation opened
   * at the top.
   *
   * `useLayoutEffect` so it happens before the browser paints. With `useEffect`
   * you would see it render at the top and then jump.
   */
  const pinnedFor = useRef<string | number | null>(null)
  useLayoutEffect(() => {
    if (topicId == null || isLoading) return
    if (pinnedFor.current === topicId) return
    if (earlierAnchorRef.current) return
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    pinnedFor.current = topicId
    nearBottom.current = true
  }, [topicId, isLoading])

  /**
   * A message arrives: follow it only if you were watching the live edge.
   *
   * Keyed on the message count rather than on `currentGroups`, which is rebuilt
   * every render and would make this fire constantly.
   */
  const messageCount = currentGroups.reduce((n, g) => n + g.convs.length, 0)
  useLayoutEffect(() => {
    if (isLoading || !nearBottom.current || earlierAnchorRef.current) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messageCount, isLoading])

  // Your own message always brings you down to it.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [currentSent.length])

  /*
    Publish the topic to the launcher (INT-8).

    Until now only `ThreadPanel` published anything, so a topic with no thread
    open captured `conversation: undefined` and Cmd+K correctly offered nothing
    to ask about — correct given the seam, and wrong for somebody looking
    straight at the topic.

    **Openers only, and that is a real limit rather than a simplification.**
    Replies are fetched per thread and are not in memory until one is opened;
    loading every thread on the chance somebody presses Cmd+K would be a query
    per conversation for a question nobody has asked yet. `repliesNotRead`
    carries what was left out so an answer can say so.

    The registry gives the open thread priority over this, so opening one
    narrows the question rather than competing with it.
  */
  /*
    Everything in the Folder, not just the stream — CON-9.

    `currentGroups` is now the topic's *own* conversation, with ticket comments
    split out into Activity. The launcher's question is a different one: "find
    something I can see", not "what is in this list". Keying this on the stream
    would have made 93% of a paired topic's messages unfindable from Cmd+K on
    the day the split landed, with nothing reporting it — the search would
    simply stop having them.
  */
  const topicKey = [...allGroups.flatMap((g) => g.convs), ...currentSent]
    .map((c) => [c.id, c.authorName, c.timestamp, c.replyCount ?? 0, c.body ?? ''].join('\u0001'))
    .join('\u0000')
  // Rebuilt from the key, the round-trip `ThreadPanel` uses for the same
  // reason: a new array identity every render would re-register constantly.
  const topicSnapshot = useMemo(
    () =>
      topicKey
        ? topicKey.split('\u0000').map((row) => {
            const [id, author, timestamp, replies, ...body] = row.split('\u0001')
            return {
              id,
              author,
              timestamp,
              body: body.join('\u0001'),
              // Every message here IS a conversation, so the citation that
              // opens it and the message it lands on are the same row.
              conversationId: id,
              repliesNotRead: Number(replies) || 0,
            }
          })
        : [],
    [topicKey],
  )
  useEffect(() => {
    registerTopicConversation({ references: [], messages: topicSnapshot })
    return unregisterTopicConversation
  }, [topicSnapshot])

  /*
    And how to open one of them (INT-8). A citation into a conversation that is
    not on screen has to open it before it can scroll to anything.
  */
  useEffect(() => {
    registerThreadOpener(openThread)
    return unregisterThreadOpener
  }, [openThread])

  if (topicId == null || !topicTitle) {
    return {
      rightPanel: (
        <div className="flex-1 flex items-center justify-center h-full">
          <EmptyState />
        </div>
      ),
      threadPanel: undefined,
      folderId: topicFolderId ?? null,
      relayState,
      // No topic selected, so nothing is related to anything.
      activity: [],
      subFileLabels: new Map(),
      openThread,
      openThreadId: threadConvId,
    }
  }

  const rightPanel = (
    <div className="flex flex-col h-full">
      <ConversationHeader
        folderId={topicFolderId}
        /* PEE-17. Null for a topic with no channel uuid — its only link is
           Peek-private, so offering to copy one would hand somebody a URL that
           resolves nowhere else. */
        topicLink={shareableTopicUrl(
          { id: String(topicId ?? ''), title: topicTitle, folderId: topicFolderId },
          window.location.origin,
        )}
        // Only where a Folder exists to show: a topic with no `h` has no panel
        // behind the button.
        onToggleFolderPanel={topicFolderId ? onToggleFolderPanel : undefined}
        folderPanelOpen={folderPanelOpen}
        name={topicTitle}
        topicMode
        isResolved={topicResolved}
        openCount={openCount}
        resolvedCount={resolvedCount}
        members={topicMembers}
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
        onStartHuddle={() => setIsCreatingHuddle(true)}
        onShowMembers={topicId != null ? () => setMembersView('list') : undefined}
        openWorkAction={
          topicId != null ? (openWorkTopicIds.has(topicId) ? 'remove' : 'add') : undefined
        }
        onOpenDetails={topicId != null ? onOpenDetails : undefined}
        onDeleteTopic={topicId != null ? onDeleteTopic : undefined}
        onToggleOpenWork={
          topicId != null
            ? () => {
                if (openWorkTopicIds.has(topicId)) {
                  actions.removeTopicFromOpenWork(topicId)
                } else {
                  actions.addTopicsToOpenWork([topicId])
                  showToast({ label: 'Added to Open work', type: 'success' })
                }
              }
            : undefined
        }
      />

      {(() => {
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
        {
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
          <ScrollArea className="flex-1" viewportRef={scrollRef} onScroll={handleScroll} contentClassName="flex min-h-full flex-col">
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
              {(
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
                          authorAvatarSrc={c.authorAvatarSrc}
                          timestamp={c.timestamp}
                          body={c.body}
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
                          nostrReferences={c.nostrReferences}
                          showCreateTopic={false}
                          isSelected={threadConvId === c.id}
                          onResolvedChange={(resolved, resolvedBy, message) => actions.setResolution(c.id, resolved, resolved ? (resolvedBy ?? CURRENT_USER_NAME) : undefined, message)}
                          onReactionsChange={(next, emoji) => actions.setReactions(c.id, next, c.reactions ?? [], emoji)}
                          onHighlightChange={(hl) => actions.setHighlight(c.id, hl)}
                          onBodyChange={(b) => editBody(c.id, b)}
                          onFilesChange={(f) => actions.editFiles(c.id, f)}
                          onClick={() => openThread(c.id)}
                          onReply={() => openThread(c.id)}
                          onDelete={() => handleDelete(c.id)}
                        />
                      )
                    })}
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
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
          {isCreatingHuddle ? (
            <HuddleCreator topicTitle={topicTitle} onCancel={cancelHuddleCreation} onCreate={handleCreateHuddle} />
          ) : (
            <div className="p-3">
              <ComposeBox onSend={handleSend} contextLabel={topicTitle ? `#${topicTitle}` : undefined} draftKey={topicId ? draftKeys.container(topicId) : undefined} />
            </div>
          )}
        </>
        )
      })()}

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
      resolutionEvents={thread.resolutionEvents}
      isResolved={threadConv.isResolved ?? false}
      huddleMembers={
        selectedHuddleId ? currentHuddles.find((h) => h.id === selectedHuddleId)?.members ?? [] : []
      }
      huddleMemberCount={
        selectedHuddleId ? currentHuddles.find((h) => h.id === selectedHuddleId)?.members.length : undefined
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
              // We're already on this topic page; clicking the link should close the
              // thread panel rather than re-issue a no-op navigation.
              onTopicClick: () => {
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
      onReplyBodyChange={(replyId, body) => editBody(replyId, body)}
      onReplyFilesChange={(replyId, files) => actions.editFiles(replyId, files)}
      onInitialFilesChange={threadConvId ? (files) => actions.editFiles(threadConvId, files) : undefined}
      onReplyHighlightChange={(replyId, hl) => actions.setHighlight(replyId, hl)}
      onReplyReactionsChange={(replyId, next, prev, emoji) => actions.setReactions(replyId, next, prev, emoji)}
    />
  ) : undefined

  /**
   * `relayState` is returned rather than rendered. PEE-8 deliberately shows
   * nothing — PEE-9 owns one derived connection state surfaced once, and PEE-1
   * needs it to know when to idle its refetch interval. Exposing it here is
   * what stops either of them re-deriving it from a second socket.
   */
  return {
    rightPanel,
    threadPanel,
    folderId: topicFolderId ?? null,
    relayState,
    /*
      Activity — CON-9's second list, handed to the page so it can put it in the
      Folder panel beside the files it is about.

      Returned rather than rendered here because it is not a view of the
      conversation: it is the conversations of *other* files that happen to live
      in this Folder, and the Folder is what the right-hand column already
      draws. Computing it here is what keeps one partition rather than two.
    */
    activity: activityItems,
    subFileLabels: subFileLabel,
    /* So the Folder panel's Activity rows open a thread in the same column and
       mark the open one selected — the same `openThread` the stream uses, not a
       second way in. */
    openThread,
    openThreadId: threadConvId,
  }
}
