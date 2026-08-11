/**
 * Message reads + writes (domain model §2.5, §3 — one polymorphic table).
 *
 * Ids returned to the client are stable seedKeys where present (demo-seed
 * ids + client-generated optimistic ids — see convex/schema.ts). Rows carry
 * real author names plus authorId; the client seam renders the viewer's own
 * rows as 'You' by id comparison (Phase 3 identity sweep). The viewer comes
 * from ctx.auth (convex/users.ts).
 */
import { v } from 'convex/values'
import { mutation, query, type QueryCtx, type MutationCtx } from './_generated/server'
import { internal } from './_generated/api'
import { highlightType, fileAttachment } from './schema'
import { avatarUrl, viewerId, viewerOrThrow } from './users'
import { watermarks } from './readState'
import { isUrgentBody, screenMessage } from './screener'
import { ensureTopicMember } from './topics'
import type { Doc, Id } from './_generated/dataModel'

const parentKindArg = v.union(v.literal('topic'), v.literal('dm'), v.literal('huddle'))

/** Resolve a person key (seedKey like 'alice', or a users _id) to the user. */
export async function resolveUserKey(
  ctx: QueryCtx | MutationCtx,
  key: string,
): Promise<Doc<'users'> | null> {
  const bySeed = await ctx.db
    .query('users')
    .withIndex('by_seedKey', (q) => q.eq('seedKey', key))
    .unique()
  if (bySeed) return bySeed
  const normalized = ctx.db.normalizeId('users', key)
  return normalized ? await ctx.db.get(normalized) : null
}

/**
 * The one canonical DM conversation for a pair of users (§2.4).
 *
 * DMs are addressed by the PARTNER's person key, never by a client-minted
 * conversation id: the pair is ordered canonically and looked up on
 * `by_pair`, so both people always land on the same row and no client can
 * name a conversation it isn't part of.
 */
export async function findDmForPair(
  ctx: QueryCtx | MutationCtx,
  aId: Id<'users'>,
  bId: Id<'users'>,
) {
  const [userLowId, userHighId] = (aId as string) < (bId as string) ? [aId, bId] : [bId, aId]
  return ctx.db
    .query('dmConversations')
    .withIndex('by_pair', (q) => q.eq('userLowId', userLowId).eq('userHighId', userHighId))
    .unique()
}

/** `key` is a topic/huddle seedKey-or-_id, or — for DMs — the partner's person key. */
export async function resolveParentId(
  ctx: QueryCtx | MutationCtx,
  kind: 'topic' | 'dm' | 'huddle',
  key: string,
  viewer: Id<'users'> | null,
): Promise<string | null> {
  if (kind === 'dm') {
    if (!viewer) return null
    const partner = await resolveUserKey(ctx, key)
    if (!partner) return null
    const dm = await findDmForPair(ctx, viewer, partner._id)
    return dm ? (dm._id as string) : null
  }
  const table = kind === 'topic' ? 'topics' : 'huddles'
  const rows = await ctx.db.query(table).collect()
  const hit = rows.find((r) => r.seedKey === key || (r._id as string) === key)
  return hit ? (hit._id as string) : null
}

/** How a person is shown: their name, and a face when anything has one. */
export interface Face {
  name: string
  avatarUrl?: string
}

/**
 * Everyone's name and avatar, in one pass over `users` (PEEK-43).
 *
 * Replaces the name-only map this used to be. The avatar has to be resolved
 * server-side because `avatarStorageId` is a storage handle, not a URL, and
 * only the server can turn it into one — `avatarUrl()` in users.ts is the same
 * precedence the profile query uses (upload, else the relay's kind:0 `picture`).
 *
 * That second source is the point of the ticket: someone with no Peek account
 * only ever has `image`, so a client looking avatars up by name — against a
 * directory that excludes them (`people.ts`) — could never find their face.
 */
export async function userFaces(ctx: QueryCtx | MutationCtx): Promise<Map<Id<'users'>, Face>> {
  const users = await ctx.db.query('users').collect()
  const faces = new Map<Id<'users'>, Face>()
  for (const u of users) {
    faces.set(u._id, { name: u.name, avatarUrl: await avatarUrl(ctx, u) })
  }
  return faces
}

/** Per-user rows → the aggregate array the cards render (§4.6): first-seen
 *  emoji order, count, owner 'yours' when the current user is among them.
 *  `names` lists the reactors in reaction order (the viewer as 'You') —
 *  the pill tooltip renders it. */
export async function aggregateReactions(
  ctx: QueryCtx | MutationCtx,
  messageId: Id<'messages'>,
  youId: Id<'users'> | undefined,
  faces: Map<Id<'users'>, Face>,
): Promise<{ emoji: string; count: number; owner: 'yours' | 'others'; names: string[] }[] | undefined> {
  const rows = await ctx.db
    .query('reactions')
    .withIndex('by_message', (q) => q.eq('messageId', messageId))
    .collect()
  if (rows.length === 0) return undefined
  rows.sort((a, b) => a._creationTime - b._creationTime)
  const agg: { emoji: string; count: number; owner: 'yours' | 'others'; names: string[] }[] = []
  for (const r of rows) {
    const who = r.userId === youId ? 'You' : faces.get(r.userId)?.name ?? 'Someone'
    const entry = agg.find((e) => e.emoji === r.emoji)
    if (entry) {
      entry.count++
      entry.names.push(who)
      if (r.userId === youId) entry.owner = 'yours'
    } else {
      agg.push({ emoji: r.emoji, count: 1, owner: r.userId === youId ? 'yours' : 'others', names: [who] })
    }
  }
  return agg
}

/**
 * The two unread signals (§4.3), derived per viewer:
 *   hasNewMessage — the message itself is newer than your CONTAINER watermark
 *   hasNewReply   — it has a reply newer than your THREAD watermark for it
 * Your own writing is never unread. No watermark = never opened = all new.
 */
export async function unreadFlags(
  ctx: QueryCtx | MutationCtx,
  m: Doc<'messages'>,
  me: Id<'users'> | null,
  wm: Map<string, number>,
  replies: Doc<'replies'>[],
): Promise<{ hasNewMessage?: boolean; hasNewReply?: boolean }> {
  if (!me) return {}
  const containerWm = wm.get(m.parentId)
  const threadWm = wm.get(m._id as string)
  const isNew = (at: number, mark: number | undefined) => mark === undefined || at > mark
  const hasNewMessage = m.authorId !== me && isNew(m.createdAt, containerWm)
  const hasNewReply = replies.some((r) => r.authorId !== me && isNew(r.createdAt, threadWm))
  return {
    hasNewMessage: hasNewMessage || undefined,
    hasNewReply: hasNewReply || undefined,
  }
}

/** Resolve stored file records to browser-renderable rows (blob → URL). A
 *  file whose blob has vanished is dropped rather than surfaced as broken. */
export async function resolveFileAttachments(
  ctx: QueryCtx | MutationCtx,
  files: Doc<'messages'>['fileAttachments'],
) {
  if (!files || files.length === 0) return undefined
  const out = []
  for (const f of files) {
    const url = await ctx.storage.getUrl(f.storageId)
    if (url) out.push({ storageId: f.storageId as string, url, name: f.name, contentType: f.contentType, size: f.size })
  }
  return out.length > 0 ? out : undefined
}

export async function shape(ctx: QueryCtx | MutationCtx, m: Doc<'messages'>, faces: Map<Id<'users'>, Face>) {
  const resolvedByReply = m.resolvedByReplyId ? await ctx.db.get(m.resolvedByReplyId) : null
  return {
    id: m.seedKey ?? (m._id as string),
    authorId: m.authorId as string,
    authorName: faces.get(m.authorId)?.name ?? 'Unknown',
    /** Undefined for anyone with no face anywhere — the client then falls back
     *  to its name-keyed demo portraits, so seeded rows render as they always did. */
    authorAvatarUrl: faces.get(m.authorId)?.avatarUrl,
    createdAt: m.createdAt,
    body: m.body,
    isUrgent: m.urgent,
    highlightType: m.highlightType,
    isResolved: m.resolved,
    resolvedBy: m.resolvedById ? faces.get(m.resolvedById)?.name : undefined,
    resolvedById: m.resolvedById ? (m.resolvedById as string) : undefined,
    resolutionMessage: m.resolutionMessage,
    resolvedByReplyId: resolvedByReply ? resolvedByReply.seedKey ?? (resolvedByReply._id as string) : undefined,
    attachments: m.attachments,
    files: await resolveFileAttachments(ctx, m.fileAttachments),
  }
}

/**
 * Messages of a topic or DM, oldest first. `parentKey` is a seedKey or _id.
 * With `limit` set, returns only the NEWEST `limit` messages (still oldest
 * first) and flags whether earlier ones exist — the client's "Show earlier
 * messages" grows the limit (Phase 5 pagination; shaping per message is the
 * expensive part, so the slice happens before it).
 */
export const list = query({
  args: { parentKind: parentKindArg, parentKey: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { parentKind, parentKey, limit }) => {
    const me = await viewerId(ctx)
    const parentId = await resolveParentId(ctx, parentKind, parentKey, me)
    if (!parentId) return { rows: [], hasMore: false }
    const all = (
      await ctx.db
        .query('messages')
        .withIndex('by_parent', (q) => q.eq('parentKind', parentKind).eq('parentId', parentId))
        .collect()
    ).sort((a, b) => a.createdAt - b.createdAt)
    const rows = limit !== undefined && all.length > limit ? all.slice(all.length - limit) : all
    const faces = await userFaces(ctx)
    const wm = me ? await watermarks(ctx, me) : new Map<string, number>()
    const shaped = []
    for (const m of rows) {
      const replies = (
        await ctx.db
          .query('replies')
          .withIndex('by_message', (q) => q.eq('messageId', m._id))
          .collect()
      ).sort((a, b) => a.createdAt - b.createdAt)
      // Distinct authors in first-reply order + newest reply time — the
      // reply row's facepile (client renders the viewer as 'You' by id).
      const replyAuthorIds = [...new Set(replies.map((r) => r.authorId))]
      shaped.push({
        ...(await shape(ctx, m, faces)),
        replyCount: replies.length,
        replyAuthors: replyAuthorIds.map((id) => ({
          id: id as string,
          name: faces.get(id)?.name ?? 'Unknown',
          // The facepile already carried an avatarSrc through the seam; it was
          // simply never filled from the server side.
          avatarUrl: faces.get(id)?.avatarUrl,
        })),
        lastReplyAt: replies.length > 0 ? replies[replies.length - 1].createdAt : undefined,
        reactions: await aggregateReactions(ctx, m._id, me ?? undefined, faces),
        ...(await unreadFlags(ctx, m, me, wm, replies)),
      })
    }
    return { rows: shaped, hasMore: all.length > rows.length }
  },
})

/** Single-message lookup by seedKey/_id — the thread panel's refresh fallback. */
export const get = query({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    let m = await ctx.db
      .query('messages')
      .withIndex('by_seedKey', (q) => q.eq('seedKey', key))
      .unique()
    if (!m) {
      const normalized = ctx.db.normalizeId('messages', key)
      m = normalized ? await ctx.db.get(normalized) : null
    }
    if (!m) return null
    const me = await viewerId(ctx)
    const faces = await userFaces(ctx)
    return {
      ...(await shape(ctx, m, faces)),
      reactions: await aggregateReactions(ctx, m._id, me ?? undefined, faces),
    }
  },
})

/** Short-lived upload URL for a message/reply file attachment (viewer-gated,
 *  mirrors the avatar flow). The client POSTs the blob, then passes the
 *  returned storageId into `send`/`replies.send`. */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await viewerOrThrow(ctx)
    return ctx.storage.generateUploadUrl()
  },
})

/** Drop an uploaded blob that never got attached (the composer removes a
 *  pending file before sending), so it doesn't orphan in storage. */
export const deleteUpload = mutation({
  args: { storageId: v.id('_storage') },
  handler: async (ctx, { storageId }) => {
    await viewerOrThrow(ctx)
    try {
      await ctx.storage.delete(storageId)
    } catch {
      // Already gone.
    }
  },
})

/** Add or remove the current user's reaction (per-user rows, §2.7). */
export const toggleReaction = mutation({
  args: { key: v.string(), emoji: v.string() },
  handler: async (ctx, { key, emoji }) => {
    const m = await findMessageByKey(ctx, key)
    if (!m) return // reply reactions stay session-local until modeled (§2.7 is message-keyed)
    const you = await viewerOrThrow(ctx)
    const mine = await ctx.db
      .query('reactions')
      .withIndex('by_message_user', (q) => q.eq('messageId', m._id).eq('userId', you._id))
      .collect()
    const existing = mine.find((r) => r.emoji === emoji)
    if (existing) {
      // Capture the event id BEFORE deleting: the retraction needs something to
      // point a kind:5 at, and the row is about to be gone.
      const publishedAs = existing.nostrEventId
      await ctx.db.delete(existing._id)
      if (publishedAs) {
        await ctx.scheduler.runAfter(0, internal.nostr.publish.publishReactionRemoval, {
          userId: you._id,
          nostrEventId: publishedAs,
        })
      }
    } else {
      const reactionId = await ctx.db.insert('reactions', {
        messageId: m._id,
        userId: you._id,
        emoji,
        createdAt: Date.now(),
      })
      await ctx.scheduler.runAfter(0, internal.nostr.publish.publishReaction, { reactionId })
    }
  },
})

export const send = mutation({
  args: {
    parentKind: parentKindArg,
    parentKey: v.string(),
    /** Client-generated id — the optimistic local copy and this record are the same message. */
    seedKey: v.string(),
    body: v.string(),
    highlightType: v.optional(highlightType),
    resolved: v.optional(v.boolean()),
    resolutionMessage: v.optional(v.string()),
    attachments: v.optional(v.array(v.string())),
    fileAttachments: v.optional(v.array(fileAttachment)),
  },
  handler: async (ctx, { parentKind, parentKey, seedKey, body, highlightType, resolved, resolutionMessage, attachments, fileAttachments }) => {
    const you = await viewerOrThrow(ctx)
    let parentId = await resolveParentId(ctx, parentKind, parentKey, you._id)
    // First DM to someone: create the pair's conversation on demand.
    if (!parentId && parentKind === 'dm') {
      const partner = await resolveUserKey(ctx, parentKey)
      if (partner && partner._id !== you._id) {
        const [userLowId, userHighId] =
          (you._id as string) < (partner._id as string) ? [you._id, partner._id] : [partner._id, you._id]
        parentId = await ctx.db.insert('dmConversations', {
          userLowId,
          userHighId,
          createdAt: Date.now(),
        })
      }
    }
    if (!parentId) throw new Error(`Unknown ${parentKind} '${parentKey}'`)
    // `!@Name` is the composer's urgent marker — urgent diverts to Desk
    // Urgent and never screens (§2.12).
    const urgent = isUrgentBody(body) || undefined
    const id = await ctx.db.insert('messages', {
      parentKind,
      parentId,
      authorId: you._id,
      body,
      createdAt: Date.now(),
      urgent,
      highlightType,
      resolved,
      resolvedById: resolved ? you._id : undefined,
      resolutionMessage,
      attachments,
      fileAttachments,
      seedKey,
    })
    // Posting into a topic makes you a member (QA #2.6 — keeps the member
    // pill consistent for every user; also the implicit join for QA #2.7).
    if (parentKind === 'topic') {
      const topicId = ctx.db.normalizeId('topics', parentId)
      if (topicId) await ensureTopicMember(ctx, topicId, you._id)
    }
    const inserted = await ctx.db.get(id)
    if (inserted) await screenMessage(ctx, inserted)
    // Mirror the message onto the Nostr relay (docs/buzz-compat/). Scheduled
    // rather than inline: signing and HTTP are action-only in Convex, and the
    // publish must never be able to fail this mutation. No-op unless
    // NOSTR_RELAY_URL is set.
    await ctx.scheduler.runAfter(0, internal.nostr.publish.publishMessage, { messageId: id })
    return id
  },
})

export async function findMessageByKey(
  ctx: QueryCtx | MutationCtx,
  key: string,
): Promise<Doc<'messages'> | null> {
  const bySeed = await ctx.db
    .query('messages')
    .withIndex('by_seedKey', (q) => q.eq('seedKey', key))
    .unique()
  if (bySeed) return bySeed
  const normalized = ctx.db.normalizeId('messages', key)
  return normalized ? await ctx.db.get(normalized) : null
}

export const editBody = mutation({
  args: { key: v.string(), body: v.string() },
  handler: async (ctx, { key, body }) => {
    const m = await findMessageByKey(ctx, key)
    if (m) {
      await ctx.db.patch(m._id, { body })
      return
    }
    // The seam's editBody is id-keyed across messages AND replies.
    const bySeed = await ctx.db
      .query('replies')
      .withIndex('by_seedKey', (q) => q.eq('seedKey', key))
      .unique()
    const normalized = bySeed ? null : ctx.db.normalizeId('replies', key)
    const r = bySeed ?? (normalized ? await ctx.db.get(normalized) : null)
    if (r) await ctx.db.patch(r._id, { body })
  },
})

export const setResolution = mutation({
  args: {
    key: v.string(),
    resolved: v.boolean(),
    resolutionMessage: v.optional(v.string()),
    /** Reply (seedKey/_id) whose `→ msg` resolution resolved the parent. */
    resolvedByReplyKey: v.optional(v.string()),
    /** Card-level resolve drops an earlier reply pointer; thread-level keeps it. */
    dropReplyPointer: v.optional(v.boolean()),
  },
  handler: async (ctx, { key, resolved, resolutionMessage, resolvedByReplyKey, dropReplyPointer }) => {
    const m = await findMessageByKey(ctx, key)
    if (!m) return
    if (!resolved) {
      await ctx.db.patch(m._id, {
        resolved: undefined,
        resolvedById: undefined,
        resolutionMessage: undefined,
        resolvedByReplyId: undefined,
        resolvedAt: undefined,
      })
      return
    }
    const you = await viewerOrThrow(ctx)
    let resolvedByReplyId: Id<'replies'> | undefined
    if (resolvedByReplyKey) {
      const bySeed = await ctx.db
        .query('replies')
        .withIndex('by_seedKey', (q) => q.eq('seedKey', resolvedByReplyKey))
        .unique()
      resolvedByReplyId = bySeed?._id ?? ctx.db.normalizeId('replies', resolvedByReplyKey) ?? undefined
    } else if (!dropReplyPointer) {
      resolvedByReplyId = m.resolvedByReplyId
    }
    await ctx.db.patch(m._id, {
      resolved: true,
      resolvedById: you._id,
      resolutionMessage,
      resolvedByReplyId,
      resolvedAt: Date.now(),
    })
  },
})

export const setHighlight = mutation({
  args: { key: v.string(), highlightType: v.optional(highlightType) },
  handler: async (ctx, { key, highlightType: hl }) => {
    const m = await findMessageByKey(ctx, key)
    if (m) {
      await ctx.db.patch(m._id, { highlightType: hl })
      return
    }
    // Highlights are id-keyed across messages AND replies (like editBody).
    const bySeed = await ctx.db
      .query('replies')
      .withIndex('by_seedKey', (q) => q.eq('seedKey', key))
      .unique()
    const normalized = bySeed ? null : ctx.db.normalizeId('replies', key)
    const r = bySeed ?? (normalized ? await ctx.db.get(normalized) : null)
    if (r) await ctx.db.patch(r._id, { highlightType: hl })
  },
})

/** Delete the storage blobs behind a message/reply's uploaded files, so
 *  removing content doesn't leak files (Phase 5). Missing blobs are ignored. */
export async function deleteAttachmentBlobs(
  ctx: MutationCtx,
  files: Doc<'messages'>['fileAttachments'],
) {
  for (const f of files ?? []) {
    try {
      await ctx.storage.delete(f.storageId)
    } catch {
      // Already gone — nothing to clean up.
    }
  }
}

export const remove = mutation({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const m = await findMessageByKey(ctx, key)
    if (!m) return
    const replies = await ctx.db
      .query('replies')
      .withIndex('by_message', (q) => q.eq('messageId', m._id))
      .collect()
    for (const r of replies) {
      await deleteAttachmentBlobs(ctx, r.fileAttachments)
      await ctx.db.delete(r._id)
    }
    const reactions = await ctx.db
      .query('reactions')
      .withIndex('by_message', (q) => q.eq('messageId', m._id))
      .collect()
    for (const r of reactions) await ctx.db.delete(r._id)
    await deleteAttachmentBlobs(ctx, m.fileAttachments)
    await ctx.db.delete(m._id)
  },
})
