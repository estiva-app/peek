/**
 * Merged message/reply reads.
 *
 * Dual-mode: Convex-backed when a deployment is configured (the override
 * layers then cover only the optimistic window); static mocks merged with
 * the override layers otherwise (tests, Storybook, checkouts without a
 * deployment). Components receive final values and never see override maps.
 */
import { useEffect, useState } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { TOPIC_CONVERSATIONS } from '@/data/topicData'
import { DM_CONVERSATIONS } from '@/data/dmData'
import { mockConvIdFor } from './directory'
import { REPLIES } from '@/data/replyData'
import { useTopicMutations } from '@/api/internal/topicMutations'
import { useTopicStore } from '@/api/internal/topicStore'
import { useTopicLookup } from './topics'
import { formatDateLabel, formatTimestamp, formatLastReplyTimestamp, dayKey } from './format'
import { CURRENT_USER_NAME, useCurrentUser } from './currentUser'
import { hasConvex, useDmRuntime } from './store'
import { useHuddleLookup } from './huddles'
import type { ConversationData, ConvGroup, FileAttachment, Huddle, ReactionData, ReplyData } from './types'

/** Row shape returned by convex/messages.ts list/get. Seam-internal. */
export interface RemoteMessage {
  id: string
  authorId?: string
  /** Derived per viewer from readState (§4.3). */
  hasNewMessage?: boolean
  hasNewReply?: boolean
  authorName: string
  /** Resolved server-side (PEEK-43): an uploaded avatar, else the kind:0
   *  `picture` that arrived from the relay. Undefined when nobody has a face
   *  for this author, which is when the name-keyed demo portraits take over. */
  authorAvatarUrl?: string
  createdAt: number
  body: string
  isUrgent?: boolean
  highlightType?: ConversationData['highlightType']
  isResolved?: boolean
  resolvedBy?: string
  resolvedById?: string
  resolutionMessage?: string
  resolvedByReplyId?: string
  attachments?: string[]
  /** Resolved uploaded files (storage blob → URL), server-side (§Phase 5). */
  files?: FileAttachment[]
  /** Derived server-side (list only). */
  replyCount?: number
  /** NIP-27 `a` tag addresses from imported events (references to other apps' objects). */
  nostrReferences?: string[]
  /** Distinct reply authors in first-reply order (list only). */
  replyAuthors?: { id: string; name: string; avatarUrl?: string }[]
  /** Send time of the newest reply (list only). */
  lastReplyAt?: number
  /** Aggregated server-side from per-user rows (§4.6). */
  reactions?: ReactionData[]
}

/** Row shape returned by convex/replies.ts list. */
interface RemoteReply {
  id: string
  authorId?: string
  /** Derived from YOUR thread watermark (§4.3). */
  isNew?: boolean
  authorName: string
  authorAvatarUrl?: string
  createdAt: number
  body: string
  isUrgent?: boolean
  highlightType?: ConversationData['highlightType']
  attachments?: string[]
  files?: FileAttachment[]
  /** NIP-27 `a` tag addresses from imported events (references to other apps' objects). */
  nostrReferences?: string[]
}

/** Remote reply → presentation shape; the viewer's own rows render as 'You'
 *  (id comparison — Phase 3); the mock reply with the same id bridges the
 *  seeded isNew flag (readState is Phase 4). */
function toReplyData(r: RemoteReply, meId: string | undefined): ReplyData {
  return {
    id: r.id,
    authorName: r.authorId && r.authorId === meId ? CURRENT_USER_NAME : r.authorName,
    authorAvatarSrc: r.authorAvatarUrl,
    timestamp: formatTimestamp(r.createdAt),
    body: r.body,
    isNew: r.isNew,
    isUrgent: r.isUrgent,
    highlightType: r.highlightType,
    attachments: r.attachments,
    files: r.files,
    createdAtMs: r.createdAt,
    nostrReferences: r.nostrReferences,
  }
}

/**
 * Remote row → presentation shape. The viewer's own rows render as 'You'
 * (authorId/resolvedById vs the current user's id). Unread is derived
 * server-side per viewer from readState (§4.3) — no mock bridge left.
 */
export function toConversationData(r: RemoteMessage, meId: string | undefined): ConversationData {
  return {
    id: r.id,
    authorName: r.authorId && r.authorId === meId ? CURRENT_USER_NAME : r.authorName,
    authorAvatarSrc: r.authorAvatarUrl,
    timestamp: formatTimestamp(r.createdAt),
    body: r.body,
    isUrgent: r.isUrgent,
    highlightType: r.highlightType,
    isResolved: r.isResolved,
    resolvedBy: r.resolvedById && r.resolvedById === meId ? CURRENT_USER_NAME : r.resolvedBy,
    resolutionMessage: r.resolutionMessage,
    attachments: r.attachments,
    files: r.files,
    reactions: r.reactions,
    hasNewMessage: r.hasNewMessage,
    hasNewReply: r.hasNewReply,
    replyCount: r.replyCount,
    replyAuthors: r.replyAuthors?.map((a) => ({
      name: a.id === meId ? CURRENT_USER_NAME : a.name,
      avatarSrc: a.avatarUrl,
    })),
    lastReplyTime: r.lastReplyAt !== undefined ? formatLastReplyTimestamp(r.lastReplyAt, r.createdAt) : undefined,
    createdAtMs: r.createdAt,
    nostrReferences: r.nostrReferences,
  }
}

/** Group remote rows (already oldest-first) into per-local-day ConvGroups. */
function groupRemoteByDay(rows: RemoteMessage[], toConv: (r: RemoteMessage) => ConversationData): ConvGroup[] {
  const groups: { key: string; dateLabel: string; convs: ConversationData[] }[] = []
  for (const r of rows) {
    const key = dayKey(r.createdAt)
    let group = groups.length > 0 && groups[groups.length - 1].key === key ? groups[groups.length - 1] : undefined
    if (!group) {
      group = { key, dateLabel: formatDateLabel(r.createdAt), convs: [] }
      groups.push(group)
    }
    group.convs.push(toConv(r))
  }
  return groups.map(({ dateLabel, convs }) => ({ dateLabel, convs }))
}

function mockMessagesById(groups: ConvGroup[] | undefined): Map<string, ConversationData> {
  const map = new Map<string, ConversationData>()
  for (const g of groups ?? []) for (const c of g.convs) map.set(c.id, c)
  return map
}

/** A reply as rendered in a thread: static shape + runtime reactions. */
export interface ThreadReply extends ReplyData {
  reactions?: ReactionData[]
}

/** Messages fetched per page (Phase 5): the newest N render immediately;
 *  "Show earlier messages" grows the window by another page. */
const MESSAGE_PAGE = 100

export interface TopicMessages {
  /** Persisted conversation groups — deletions filtered, overrides merged. */
  groups: ConvGroup[]
  /** Runtime-sent messages — overrides merged. Rendered under "Today". */
  sent: ConversationData[]
  /** groups + sent flattened (post-merge). */
  all: ConversationData[]
  openCount: number
  resolvedCount: number
  /** Invitees ∪ message authors ∪ static reply authors (display names). */
  members: string[]
  hasAnyPublicMessages: boolean
  /** True while the Convex query is in flight — render a skeleton, not an empty state. */
  isLoading: boolean
  /** True when messages older than the current window exist on the server. */
  hasEarlier: boolean
  /** Widen the window by another page of earlier messages. */
  showEarlier: () => void
}

export interface ThreadData {
  conversation: ConversationData | null
  /** Persisted replies, overrides merged. Render above any promotion divider. */
  replies: ThreadReply[]
  /** Runtime-sent replies, overrides merged. */
  sentReplies: ThreadReply[]
  /** Resolution bookkeeping for the parent (drives inline resolution editing). */
  resolvedByReplyId: string | undefined
  resolutionMessage: string | undefined
  /** True while the Convex replies query is in flight. */
  isLoading: boolean
}

type Overrides = ReturnType<typeof useTopicMutations>

/**
 * Convex-mode optimistic window for message reactions: layer the user's
 * in-flight per-emoji toggles on top of the server aggregate. Idempotent —
 * once the reactive query reflects a toggle, applying it again is a no-op,
 * so there's no flicker while the pending entry clears.
 */
function applyPendingReactions(
  base: ReactionData[] | undefined,
  pending: Record<string, 'add' | 'remove'> | undefined,
): ReactionData[] | undefined {
  if (!pending) return base
  let next = [...(base ?? [])]
  for (const [emoji, dir] of Object.entries(pending)) {
    const i = next.findIndex((r) => r.emoji === emoji)
    if (dir === 'add') {
      if (i === -1) next.push({ emoji, count: 1, owner: 'yours', names: ['You'] })
      else if (next[i].owner !== 'yours')
        next[i] = { ...next[i], count: next[i].count + 1, owner: 'yours', names: next[i].names && [...next[i].names!, 'You'] }
    } else if (i !== -1 && next[i].owner === 'yours') {
      next = next[i].count <= 1
        ? next.filter((_, j) => j !== i)
        : next.map((r, j) => (j === i
            ? { ...r, count: r.count - 1, owner: 'others' as const, names: r.names?.filter((n) => n !== 'You') }
            : r))
    }
  }
  return next.length > 0 ? next : undefined
}

/**
 * `recountReplies` distinguishes the two read paths: the mock path derives
 * the count from the static REPLIES map + session-sent replies; the Convex
 * path trusts the server count already on the row (the reactive query
 * catches up within a beat of a reply landing).
 */
function mergeConv(c: ConversationData, o: Overrides, recountReplies = true): ConversationData {
  const resolution = o.resolvedOverrides[c.id]
  return {
    ...c,
    body: o.bodyOverrides[c.id] ?? c.body,
    highlightType: c.id in o.highlightOverrides ? o.highlightOverrides[c.id] : c.highlightType,
    reactions: applyPendingReactions(o.reactionOverrides[c.id] ?? c.reactions, o.pendingReactions[c.id]),
    isResolved: resolution?.resolved ?? c.isResolved,
    resolvedBy: resolution?.resolvedBy ?? c.resolvedBy,
    resolutionMessage: resolution?.message ?? c.resolutionMessage,
    replyCount: recountReplies
      ? (REPLIES[c.id]?.length ?? c.replyCount ?? 0) + (o.sentReplies[c.id]?.length ?? 0)
      : c.replyCount ?? 0,
    // Reply-row facepile + last-reply time. Convex rows arrive with these
    // already shaped; mock/optimistic rows derive them from the fixture +
    // session-sent replies.
    ...(c.replyAuthors
      ? {}
      : (() => {
          const rs = [...(REPLIES[c.id] ?? []), ...(o.sentReplies[c.id] ?? [])]
          if (rs.length === 0) return {}
          const last = rs[rs.length - 1]
          return {
            replyAuthors: [...new Set(rs.map((r) => r.authorName))].map((name) => ({ name })),
            // Day-qualify when both sides carry real times (runtime-sent reply
            // on an older card); static mock strings pass through untouched.
            lastReplyTime:
              last.createdAtMs !== undefined && c.createdAtMs !== undefined
                ? formatLastReplyTimestamp(last.createdAtMs, c.createdAtMs)
                : last.timestamp,
          }
        })()),
  }
}

function mergeReply(r: ReplyData, o: Overrides): ThreadReply {
  return {
    ...r,
    body: o.bodyOverrides[r.id] ?? r.body,
    highlightType: r.id in o.highlightOverrides ? o.highlightOverrides[r.id] : r.highlightType,
    reactions: o.reactionOverrides[r.id],
  }
}

const NOOP = () => {}

const EMPTY_TOPIC: TopicMessages = {
  groups: [],
  sent: [],
  all: [],
  openCount: 0,
  resolvedCount: 0,
  members: [],
  hasAnyPublicMessages: false,
  isLoading: false,
  hasEarlier: false,
  showEarlier: NOOP,
}

export function useTopicMessages(topicId: string | null): TopicMessages {
  const o = useTopicMutations()
  // Convex-aware lookup: the members pill must reflect server topicMembers
  // for topics created by OTHER users too (QA #2.6) — the mock store only
  // knows static + this session's topics.
  const findTopic = useTopicLookup()
  const me = useCurrentUser()
  const [limit, setLimit] = useState(MESSAGE_PAGE)
  useEffect(() => setLimit(MESSAGE_PAGE), [topicId])
  const remote = useQuery(
    api.messages.list,
    hasConvex && topicId != null ? { parentKind: 'topic', parentKey: topicId, limit } : 'skip',
  )
  if (topicId == null) return EMPTY_TOPIC

  const topic = findTopic(topicId)
  const sentLocal = o.sentMessages[topicId] ?? []
  let groups: ConvGroup[]
  let sent: ConversationData[]
  let hasEarlier = false
  if (hasConvex) {
    if (remote === undefined || me === undefined) return { ...EMPTY_TOPIC, isLoading: true }
    const mockById = mockMessagesById(TOPIC_CONVERSATIONS[topicId])
    const rows = remote.rows.filter((r) => !o.deletedIds.has(r.id))
    groups = groupRemoteByDay(rows, (r) => mergeConv(toConversationData(r, me.id), o, false))
    // The confirmed copy renders from the query; the local copy covers the
    // optimistic window only.
    const remoteIds = new Set(remote.rows.map((r) => r.id))
    sent = sentLocal.filter((c) => !remoteIds.has(c.id)).map((c) => mergeConv(c, o))
    hasEarlier = remote.hasMore
  } else {
    groups = (TOPIC_CONVERSATIONS[topicId] ?? [])
      .map((g) => ({
        dateLabel: g.dateLabel,
        convs: g.convs.filter((c) => !o.deletedIds.has(c.id)).map((c) => mergeConv(c, o)),
      }))
      .filter((g) => g.convs.length > 0)
    sent = sentLocal.map((c) => mergeConv(c, o))
  }
  const all = [...groups.flatMap((g) => g.convs), ...sent]

  const openCount = all.filter((c) => !(c.isResolved ?? false)).length
  const resolvedCount = all.length - openCount
  const replyAuthors = all.flatMap((c) => (REPLIES[c.id] ?? []).map((r) => r.authorName))
  const members = Array.from(
    new Set([...(topic?.invitees ?? []), ...all.map((c) => c.authorName), ...replyAuthors]),
  )
  const hasAnyPublicMessages = all.length > 0

  return {
    groups,
    sent,
    all,
    openCount,
    resolvedCount,
    members,
    hasAnyPublicMessages,
    isLoading: false,
    hasEarlier,
    showEarlier: () => setLimit((l) => l + MESSAGE_PAGE),
  }
}

export interface DmMessages {
  groups: ConvGroup[]
  sent: ConversationData[]
  /** True while the Convex query is in flight — render a skeleton, not an empty state. */
  isLoading: boolean
  /** True when messages older than the current window exist on the server. */
  hasEarlier: boolean
  /** Widen the window by another page of earlier messages. */
  showEarlier: () => void
}

export function useDmMessages(dmId: string | null): DmMessages {
  const o = useTopicMutations()
  const { sentDmMessages } = useDmRuntime()
  const me = useCurrentUser()
  const [limit, setLimit] = useState(MESSAGE_PAGE)
  useEffect(() => setLimit(MESSAGE_PAGE), [dmId])
  const remote = useQuery(
    api.messages.list,
    hasConvex && dmId != null ? { parentKind: 'dm', parentKey: String(dmId), limit } : 'skip',
  )
  const showEarlier = () => setLimit((l) => l + MESSAGE_PAGE)
  if (dmId == null) return { groups: [], sent: [], isLoading: false, hasEarlier: false, showEarlier: NOOP }

  const sentLocal = sentDmMessages[dmId] ?? []
  // The mock fixture stores DMs under legacy conversation numbers; the seam
  // speaks person keys (§2.4).
  const mockConvId = mockConvIdFor(dmId)
  const mockGroups = mockConvId === undefined ? undefined : DM_CONVERSATIONS[mockConvId]
  let groups: ConvGroup[]
  let sent: ConversationData[]
  let hasEarlier = false
  if (hasConvex) {
    if (remote === undefined || me === undefined) {
      return { groups: [], sent: [], isLoading: true, hasEarlier: false, showEarlier: NOOP }
    }
    const mockById = mockMessagesById(mockGroups)
    const rows = remote.rows.filter((r) => !o.deletedIds.has(r.id))
    groups = groupRemoteByDay(rows, (r) => mergeConv(toConversationData(r, me.id), o, false))
    const remoteIds = new Set(remote.rows.map((r) => r.id))
    sent = sentLocal.filter((c) => !remoteIds.has(c.id)).map((c) => mergeConv(c, o))
    hasEarlier = remote.hasMore
  } else {
    groups = (mockGroups ?? [])
      .map((g) => ({
        dateLabel: g.dateLabel,
        convs: g.convs.filter((c) => !o.deletedIds.has(c.id)).map((c) => mergeConv(c, o)),
      }))
      .filter((g) => g.convs.length > 0)
    sent = sentLocal.map((c) => mergeConv(c, o))
  }
  return { groups, sent, isLoading: false, hasEarlier, showEarlier }
}

/**
 * Merged top-level messages inside a huddle: seed conversation (if any),
 * static extras, and runtime-sent messages — in that order, as the huddle
 * main view renders them.
 */
export function useHuddleMessages(huddle: Huddle | null): ConversationData[] {
  const o = useTopicMutations()
  if (!huddle) return []
  const base = [...(huddle.conversation ? [huddle.conversation] : []), ...(huddle.extraConvs ?? [])]
  const sentLocal = o.huddleSentMessages[huddle.id] ?? []
  if (hasConvex) {
    // base comes remote-shaped via useHuddleLookup (server replyCounts);
    // local sends cover the optimistic window only.
    const baseIds = new Set(base.map((c) => c.id))
    return [
      ...base.map((c) => mergeConv(c, o, false)),
      ...sentLocal.filter((c) => !baseIds.has(c.id)).map((c) => mergeConv(c, o)),
    ]
  }
  return [...base, ...sentLocal].map((c) => mergeConv(c, o))
}

/**
 * Global message lookup for the thread panel. Message ids are unique across
 * topics, DMs, and huddles, so the thread panel can resolve its conversation
 * without container context (mirrors — and supersedes — the per-view lookup
 * pools the view hooks used to build).
 */
export function useThread(messageId: string | null): ThreadData {
  const o = useTopicMutations()
  const { topics } = useTopicStore()
  const { sentDmMessages } = useDmRuntime()
  const me = useCurrentUser()
  const huddleLookup = useHuddleLookup()
  // Refresh fallback: a message sent in an earlier session exists only in
  // Convex — the local pools below can't see it (mock data + this session's
  // sent stores only).
  const remoteMsg = useQuery(api.messages.get, hasConvex && messageId ? { key: messageId } : 'skip')
  const remoteReplies = useQuery(api.replies.list, hasConvex && messageId ? { messageKey: messageId } : 'skip')

  if (!messageId) {
    return { conversation: null, replies: [], sentReplies: [], resolvedByReplyId: undefined, resolutionMessage: undefined, isLoading: false }
  }

  const find = (): ConversationData | undefined => {
    for (const groups of Object.values(TOPIC_CONVERSATIONS)) {
      for (const g of groups) {
        const hit = g.convs.find((c) => c.id === messageId)
        if (hit) return hit
      }
    }
    for (const msgs of Object.values(o.sentMessages)) {
      const hit = msgs.find((c) => c.id === messageId)
      if (hit) return hit
    }
    for (const groups of Object.values(DM_CONVERSATIONS)) {
      for (const g of groups) {
        const hit = g.convs.find((c) => c.id === messageId)
        if (hit) return hit
      }
    }
    for (const msgs of Object.values(sentDmMessages)) {
      const hit = msgs.find((c) => c.id === messageId)
      if (hit) return hit
    }
    // Huddle seed/extra/runtime messages (incl. runtime topics' huddles).
    for (const t of topics) {
      for (const h of huddleLookup(t.id)) {
        if (h.conversation?.id === messageId) return h.conversation
        const extra = h.extraConvs?.find((c) => c.id === messageId)
        if (extra) return extra
        const sent = (o.huddleSentMessages[h.id] ?? []).find((c) => c.id === messageId)
        if (sent) return sent
      }
    }
    return undefined
  }

  // Remote wins for persisted messages — a body/highlight edited in an
  // earlier session exists only on the server, and the main views already
  // render the remote copy. The local hit covers mock mode, the optimistic
  // window, and the beat while the get query is in flight; it also bridges
  // the seeded unread flags (readState is Phase 4).
  const local = find()
  const raw = hasConvex && remoteMsg ? toConversationData(remoteMsg, me?.id) : local
  const conversation = raw ? mergeConv(raw, o) : null

  const sentLocal = o.sentReplies[messageId] ?? []
  let replies: ThreadReply[]
  let sentReplies: ThreadReply[]
  let isLoading = false
  if (hasConvex) {
    if (remoteReplies === undefined) {
      replies = []
      sentReplies = []
      isLoading = true
    } else {
      const mockById = new Map((REPLIES[messageId] ?? []).map((r) => [r.id, r]))
      replies = remoteReplies.map((r) => mergeReply(toReplyData(r, me?.id), o))
      const remoteIds = new Set(remoteReplies.map((r) => r.id))
      sentReplies = sentLocal.filter((r) => !remoteIds.has(r.id)).map((r) => mergeReply(r, o))
    }
  } else {
    replies = (REPLIES[messageId] ?? []).map((r) => mergeReply(r, o))
    sentReplies = sentLocal.map((r) => mergeReply(r, o))
  }
  const resolution = o.resolvedOverrides[messageId]

  return {
    conversation,
    replies,
    sentReplies,
    // A session override wins outright (even a reopen, which clears the
    // pointer); otherwise the persisted resolution from Convex applies.
    resolvedByReplyId: resolution ? resolution.resolvedByReplyId : remoteMsg?.resolvedByReplyId,
    resolutionMessage: resolution ? resolution.message : remoteMsg?.resolutionMessage,
    isLoading,
  }
}

/**
 * Live reply count for a message. Convex mode trusts the caller's
 * server-derived count (the reactive query keeps it current — same source
 * the conversation cards render). Mock mode keeps the static + runtime-sent
 * formula.
 */
export function useReplyCount(): (messageId: string | undefined, fallback?: number) => number {
  const o = useTopicMutations()
  return (messageId, fallback = 0) => {
    if (!messageId) return fallback
    if (hasConvex) return fallback
    return (REPLIES[messageId]?.length ?? fallback) + (o.sentReplies[messageId]?.length ?? 0)
  }
}

/**
 * Live reply-row metadata (facepile authors + last-reply time) for a thread
 * id — the huddle-card counterpart of the fields ConversationData rows carry.
 * Mock mode derives from the fixture + session-sent replies; the Convex path
 * returns nothing and callers fall back to the server-shaped fields already
 * on the row.
 */
export function useReplyMeta(): (messageId: string | undefined) => Pick<ConversationData, 'replyAuthors' | 'lastReplyTime'> {
  const o = useTopicMutations()
  return (messageId) => {
    if (!messageId || hasConvex) return {}
    const rs = [...(REPLIES[messageId] ?? []), ...(o.sentReplies[messageId] ?? [])]
    if (rs.length === 0) return {}
    return {
      replyAuthors: [...new Set(rs.map((r) => r.authorName))].map((name) => ({ name })),
      lastReplyTime: rs[rs.length - 1].timestamp,
    }
  }
}
