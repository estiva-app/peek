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
import { avatarUrl, pubkeyFromIdentity, viewerId, viewerOrThrow } from './users'
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
 * Replaces the name-only map this used to be. Resolved server-side because the
 * client cannot: a face may belong to someone with no Peek account at all, and
 * `people.ts` deliberately excludes them from the directory — so a client
 * looking avatars up by name could never find one.
 *
 * There is only one source now (PEEK-42): `image`, Peek's copy of whatever
 * Estiva ID published as `kind:0`. It used to be two, with a Convex upload
 * outranking the relay, which meant the two apps could show different faces for
 * the same person.
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
  // Reply reactions share the parent's index (PEE-12) and belong to the
  // reply's own pill, not the message's.
  return foldReactionRows(rows.filter((r) => r.replyId === undefined), youId, faces)
}

/** The aggregation itself, shared with the per-reply pills (convex/replies.ts). */
export function foldReactionRows(
  rows: Doc<'reactions'>[],
  youId: Id<'users'> | undefined,
  faces: Map<Id<'users'>, Face>,
): { emoji: string; count: number; owner: 'yours' | 'others'; names: string[] }[] | undefined {
  if (rows.length === 0) return undefined
  const sorted = [...rows].sort((a, b) => a._creationTime - b._creationTime)
  const agg: { emoji: string; count: number; owner: 'yours' | 'others'; names: string[] }[] = []
  for (const r of sorted) {
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

/**
 * Append one assertion to a message's resolve/reopen history (PEEK-128).
 *
 * Never patches or deletes an earlier row: the history is the point, and a
 * reopen that overwrote its resolve would leave nothing to render.
 *
 * `trusted: true` because everything routed through here was asserted by the
 * signed-in viewer of this deployment. Assertions arriving from the relay come
 * in through the sync path, which judges trust for itself.
 */
export async function appendResolutionAssertion(
  ctx: MutationCtx,
  args: {
    messageId: Id<'messages'>
    action: 'resolved' | 'reopened'
    author: Doc<'users'>
    createdAt: number
    rationale?: string
    supportingReplyId?: Id<'replies'>
  },
): Promise<Id<'resolutionAssertions'>> {
  return await ctx.db.insert('resolutionAssertions', {
    messageId: args.messageId,
    action: args.action,
    authorId: args.author._id,
    authorPubkey: args.author.nostrPubkey,
    createdAt: args.createdAt,
    rationale: args.rationale,
    supportingReplyId: args.supportingReplyId,
    trusted: true,
  })
}

/**
 * Legacy history for a message resolved before assertions existed.
 *
 * Decision 5 of PEEK-128: nothing is backfilled onto the relay. These rows were
 * never published and never will be, so they are synthesized on read from the
 * single-slot columns and carry no `nostrEventId`. Without this an old resolved
 * thread would render as though it had never been resolved at all.
 */
function legacyAssertions(m: Doc<'messages'>) {
  if (!m.resolved || !m.resolvedById || !m.resolvedAt) return []
  return [
    {
      key: undefined,
      action: 'resolved' as const,
      authorId: m.resolvedById,
      createdAt: m.resolvedAt,
      rationale: m.resolutionMessage,
      supportingReplyId: m.resolvedByReplyId,
      trusted: true,
      legacy: true as const,
    },
  ]
}

/**
 * Read a message's assertions, oldest first, falling back to legacy synthesis.
 *
 * Ordered by `createdAt` then id — the same tiebreak `foldResolution` uses, and
 * for the same reason: two assertions can share a millisecond, and an unstable
 * order would fold to different states on different reads.
 */
export async function resolutionHistory(ctx: QueryCtx | MutationCtx, m: Doc<'messages'>) {
  const rows = await ctx.db
    .query('resolutionAssertions')
    .withIndex('by_message', (q) => q.eq('messageId', m._id))
    .collect()
  if (rows.length === 0) return legacyAssertions(m)
  return [...rows]
    .sort((a, b) => a.createdAt - b.createdAt || a._id.localeCompare(b._id))
    .map((r) => ({
      key: r._id as string,
      action: r.action,
      authorId: r.authorId,
      createdAt: r.createdAt,
      rationale: r.rationale,
      supportingReplyId: r.supportingReplyId,
      trusted: r.trusted,
      legacy: false as const,
    }))
}

/**
 * Fold the trusted assertions back onto the message's columns.
 *
 * The columns are a cache of the fold, not the truth — kept because every
 * existing query, index and card reads them, and rewriting all of that is not
 * this ticket. Untrusted assertions are excluded here rather than at write
 * time, so a foreign claim is still recorded and renderable as history without
 * being able to move Peek's own state.
 */
export async function applyResolutionProjection(ctx: MutationCtx, messageId: Id<'messages'>) {
  const m = await ctx.db.get(messageId)
  if (!m) return
  const trusted = (await resolutionHistory(ctx, m)).filter((a) => a.trusted)
  const last = trusted[trusted.length - 1]
  if (!last || last.action === 'reopened') {
    await ctx.db.patch(messageId, {
      resolved: undefined,
      resolvedById: undefined,
      resolutionMessage: undefined,
      resolvedByReplyId: undefined,
      resolvedAt: undefined,
    })
    return
  }
  await ctx.db.patch(messageId, {
    resolved: true,
    resolvedById: last.authorId,
    resolutionMessage: last.rationale,
    resolvedByReplyId: last.supportingReplyId,
    resolvedAt: last.createdAt,
  })
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
    /**
     * The resolve/reopen history the thread renders as timeline bullets
     * (PEEK-129), oldest first.
     *
     * Sourced from the append-only assertion log rather than a column, so a
     * resolution asserted by another app is in here too. Untrusted assertions
     * are included deliberately: they must not move `isResolved` above — the
     * fold excludes them — but the thread should still show that someone said
     * it, which is the difference between ignoring a claim and hiding it.
     */
    resolutionEvents: (await resolutionHistory(ctx, m)).map((e) => ({
      kind: e.action,
      by: e.authorId ? faces.get(e.authorId)?.name : undefined,
      byId: e.authorId ? (e.authorId as string) : undefined,
      byAvatarUrl: e.authorId ? faces.get(e.authorId)?.avatarUrl : undefined,
      atMs: e.createdAt,
      message: e.rationale,
      /** Stable React key; absent for synthesized legacy history. */
      key: e.key,
      /** False for anything Peek will not let move its own state. */
      trusted: e.trusted,
    })),
    attachments: m.attachments,
    files: await resolveFileAttachments(ctx, m.fileAttachments),
    nostrReferences: m.nostrReferences,
    nostrBlockId: m.nostrBlockId,
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
    // The key names a message OR a reply — the two id spaces are distinct.
    // Reply reactions used to be silently dropped here ("session-local until
    // modeled"), which is why a reaction on an agent's reply vanished on
    // reload (PEE-12).
    let m = await findMessageByKey(ctx, key)
    let replyId: Id<'replies'> | undefined
    if (!m) {
      const reply = await findReplyByKey(ctx, key)
      if (!reply) return null
      replyId = reply._id
      m = await ctx.db.get(reply.messageId)
      if (!m) return null
    }
    const you = await viewerOrThrow(ctx)
    const mine = await ctx.db
      .query('reactions')
      .withIndex('by_message_user', (q) => q.eq('messageId', m._id).eq('userId', you._id))
      .collect()
    const existing = mine.find(
      (r) => r.emoji === emoji && (r.replyId ?? null) === (replyId ?? null),
    )
    if (existing) {
      // Capture the event id BEFORE deleting: the retraction needs something to
      // point a kind:5 at, and the row is about to be gone.
      const publishedAs = existing.nostrEventId
      await ctx.db.delete(existing._id)
      if (!publishedAs) return null // never reached the relay, so nothing to retract
      return { action: 'removed' as const, nostrEventId: publishedAs }
    }

    const reactionId = await ctx.db.insert('reactions', {
      messageId: m._id,
      replyId,
      userId: you._id,
      emoji,
      createdAt: Date.now(),
    })
    return { action: 'added' as const, reactionId }
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
    // Published by the browser after this returns: only it holds the token,
    // and `/sign` signs as nobody but that token's subject.
    return id
  },
})

export async function findReplyByKey(
  ctx: QueryCtx | MutationCtx,
  key: string,
): Promise<Doc<'replies'> | null> {
  const bySeed = await ctx.db
    .query('replies')
    .withIndex('by_seedKey', (q) => q.eq('seedKey', key))
    .unique()
  if (bySeed) return bySeed
  const normalized = ctx.db.normalizeId('replies', key)
  return normalized ? await ctx.db.get(normalized) : null
}

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

/**
 * Change what a message or a reply says — CON-8.
 *
 * ## This used to patch, and only patch
 *
 * The row changed and nothing was published, so a human edit never left Peek
 * and every other reader — Ship's conversation view, the agent, any future app
 * — kept the original text indefinitely, with nothing announcing the
 * divergence. ADR 0001: *"Convex may never be the source of truth for something
 * the relay owns"*, and `messages.body` was exactly that for a `kind:9`'s body.
 * The browser publishes the `kind:40003` afterwards, from `unsignedEdit`.
 *
 * ## And it checked nobody at all
 *
 * There was no viewer here — not even a signed-in one. Any caller could rewrite
 * anybody's message, the same shape as `remove` before PEE-18, and the UI's
 * `isOwnMessage` was the only thing holding it shut. So the same two paths, for
 * the same reason: an author-only rule would reproduce SHI-14 inside the
 * backend, because the relay accepts an edit from the target's effective author
 * **or** the NIP-OA owner of an authoring agent and no client can tell which it
 * is looking at.
 *
 * - **The viewer is the author.** A local claim, so the row changes now.
 * - **The viewer is not.** Nothing changes here. The browser publishes the edit,
 *   the relay adjudicates, and the text arrives through the sync if it was
 *   accepted — `applyEdits` folds it in from the relay's own event.
 *
 * A message that never reached the relay has no adjudicator, so a non-author is
 * refused rather than left with an edit that can never complete.
 */
export const editBody = mutation({
  args: { key: v.string(), body: v.string() },
  handler: async (ctx, { key, body }): Promise<{ patched: boolean }> => {
    const you = await viewerOrThrow(ctx)

    const m = await findMessageByKey(ctx, key)
    if (m) {
      if (m.authorId !== you._id) {
        if (!m.nostrEventId) throw new Error('only the author may edit a message that is not on the relay')
        return { patched: false }
      }
      await ctx.db.patch(m._id, { body })
      return { patched: true }
    }

    // The seam's editBody is id-keyed across messages AND replies.
    const bySeed = await ctx.db
      .query('replies')
      .withIndex('by_seedKey', (q) => q.eq('seedKey', key))
      .unique()
    const normalized = bySeed ? null : ctx.db.normalizeId('replies', key)
    const r = bySeed ?? (normalized ? await ctx.db.get(normalized) : null)
    if (!r) return { patched: false }
    if (r.authorId !== you._id) {
      if (!r.nostrEventId) throw new Error('only the author may edit a reply that is not on the relay')
      return { patched: false }
    }
    await ctx.db.patch(r._id, { body })
    return { patched: true }
  },
})

/**
 * Replace a message's or reply's uploaded files — PEE-16.
 *
 * Editing was body-only until this: `editBody` patched `body` and nothing
 * could ever touch `fileAttachments` again after the row was created, which
 * is why the paperclip in the edit box had nowhere to put a file even once it
 * was wired up.
 *
 * The whole list is sent, not a delta, because that is what the edit box
 * holds — the message's files minus the ones removed plus the ones added. A
 * delta would need the two sides to agree about order and identity across a
 * reactive read that can arrive mid-edit.
 *
 * Blobs dropped from the list are deleted here, for the same reason `remove`
 * deletes them: nothing will ever own them again. Storage ids that survive
 * the edit are left alone.
 *
 * ## Author only, and stricter than `editBody` on purpose
 *
 * `editBody` lets a non-author through with `patched: false`, because the
 * browser publishes a `kind:40003`, the relay adjudicates, and an accepted
 * edit arrives back through the sync (CON-8). **Files have no wire form at
 * all**: `unsignedMessage` builds the event from the body and the addresses
 * in it, and there is no event for an attachment. So the same branch here
 * would not defer a decision to the relay, it would drop the edit in silence
 * and wait for a fold that can never come. Until an attachment is addressable
 * on the wire, the only honest answer to a non-author is no.
 */
export const editFiles = mutation({
  args: { key: v.string(), files: v.array(fileAttachment) },
  handler: async (ctx, { key, files }) => {
    const you = await viewerOrThrow(ctx)
    const kept = new Set(files.map((f) => f.storageId))

    const m = await findMessageByKey(ctx, key)
    if (m) {
      if (m.authorId !== you._id) throw new Error("only the author may change a message's files")
      await deleteAttachmentBlobs(ctx, (m.fileAttachments ?? []).filter((f) => !kept.has(f.storageId)))
      await ctx.db.patch(m._id, { fileAttachments: files })
      return
    }
    // Id-keyed across messages AND replies, exactly like editBody.
    const bySeed = await ctx.db
      .query('replies')
      .withIndex('by_seedKey', (q) => q.eq('seedKey', key))
      .unique()
    const normalized = bySeed ? null : ctx.db.normalizeId('replies', key)
    const r = bySeed ?? (normalized ? await ctx.db.get(normalized) : null)
    if (!r) return
    if (r.authorId !== you._id) throw new Error("only the author may change a reply's files")
    await deleteAttachmentBlobs(ctx, (r.fileAttachments ?? []).filter((f) => !kept.has(f.storageId)))
    await ctx.db.patch(r._id, { fileAttachments: files })
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
  /**
   * Returns the assertion just appended, so the browser can publish it
   * (PEEK-128). `null` when nothing was recorded — an unknown key, or a
   * no-op un-resolve of something already open.
   */
  handler: async (ctx, { key, resolved, resolutionMessage, resolvedByReplyKey, dropReplyPointer }): Promise<Id<'resolutionAssertions'> | null> => {
    const m = await findMessageByKey(ctx, key)
    if (!m) return null
    const you = await viewerOrThrow(ctx)
    const at = Date.now()

    if (!resolved) {
      // Nothing to reopen — don't append an assertion asserting no change.
      if (!m.resolved) return null
      const assertionId = await appendResolutionAssertion(ctx, {
        messageId: m._id,
        action: 'reopened',
        author: you,
        createdAt: at,
      })
      await applyResolutionProjection(ctx, m._id)
      return assertionId
    }

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

    const assertionId = await appendResolutionAssertion(ctx, {
      messageId: m._id,
      action: 'resolved',
      author: you,
      createdAt: at,
      rationale: resolutionMessage,
      supportingReplyId: resolvedByReplyId,
    })
    await applyResolutionProjection(ctx, m._id)
    return assertionId
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

/**
 * What `remove` did, and what the caller still has to do.
 *
 * `removed: false` is the case worth naming: the rows are **still here**, and
 * whether they go is the relay's decision, arriving later through the sync.
 */
export interface RemoveOutcome {
  /** The rows are gone from Peek. */
  removed: boolean
  /** kind:5 targets for the browser to publish. */
  nostrEventIds: string[]
}

/**
 * Delete a message, its replies, and its reactions — or ask the relay whether
 * you may (PEE-18).
 *
 * ## This used to delete unconditionally
 *
 * `me` was read and used only to decide what to *tombstone*, never whether the
 * delete could happen. A `mutation` is a client-callable API surface, so any
 * authenticated user could pass somebody else's message key and remove it, its
 * replies and its reactions from Peek for everybody — while the relay copies
 * survived, because no kind:5 was published for events they did not author. The
 * record diverged permanently and nothing announced it. Peek's UI gated the
 * control on `isOwnMessage`, which is why it went unnoticed; the mutation is the
 * boundary, not the menu.
 *
 * ## Two paths, because a client cannot evaluate the relay's rule
 *
 * The relay accepts a deletion from the target's effective author **or** from
 * the NIP-OA owner of an authoring agent (SPEC §6.5, corrected 2026-09-06), and
 * ownership is written from the attestation and readable only server-side. So
 * "author-only" here would reproduce SHI-14 inside Peek's backend — and on this
 * workspace it would hide the control from the one party who could use it, since
 * most messages are written by an agent.
 *
 * - **The viewer is the author.** A local claim, so the rows go now and the
 *   browser tombstones the viewer's own events.
 * - **The viewer is not.** They may still have a claim and only the relay knows.
 *   So **nothing is deleted here.** The message's own event id goes back, the
 *   browser publishes a kind:5, and if the relay accepts it the next sync
 *   removes the row through `applyDeletions` — which acts only on a kind:5 the
 *   relay actually returned. If the relay refuses, no such event exists and the
 *   row correctly stays.
 *
 * That is what keeps Peek's row and the relay's copy from silently disagreeing:
 * the row now goes *because* the relay accepted, rather than ahead of it.
 *
 * A message that never reached the relay has no adjudicator, so a non-author is
 * refused outright rather than left with a delete that can never complete.
 *
 * ## Why the ids are collected first
 *
 * After the delete there is nothing left to look them up from. The browser
 * publishes the kind:5s because a bearer token only exists there, and scheduled
 * work has no identity the relay accepts.
 */
export const remove = mutation({
  args: { key: v.string() },
  handler: async (ctx, { key }): Promise<RemoveOutcome> => {
    const m = await findMessageByKey(ctx, key)
    // Already gone. Idempotent rather than an error: a second click, or a sync
    // that got there first, is not a failure.
    if (!m) return { removed: true, nostrEventIds: [] }
    const you = await viewerOrThrow(ctx)

    if (m.authorId !== you._id) {
      if (!m.nostrEventId) {
        throw new Error('only the author may delete a message that is not on the relay')
      }
      // No local claim, and possibly a real one. Ask, do not act.
      return { removed: false, nostrEventIds: [m.nostrEventId] }
    }

    const nostrEventIds: string[] = []
    const tombstone = (eventId: string | undefined, author: Id<'users'>) => {
      // Still only the viewer's OWN events: a reply or reaction somebody else
      // wrote stays on the relay, and collecting it would only produce a
      // rejection.
      if (eventId && author === you._id) nostrEventIds.push(eventId)
    }

    tombstone(m.nostrEventId, m.authorId)
    const replies = await ctx.db
      .query('replies')
      .withIndex('by_message', (q) => q.eq('messageId', m._id))
      .collect()
    for (const r of replies) {
      tombstone(r.nostrEventId, r.authorId)
      await deleteAttachmentBlobs(ctx, r.fileAttachments)
      await ctx.db.delete(r._id)
    }
    const reactions = await ctx.db
      .query('reactions')
      .withIndex('by_message', (q) => q.eq('messageId', m._id))
      .collect()
    for (const r of reactions) {
      tombstone(r.nostrEventId, r.userId)
      await ctx.db.delete(r._id)
    }
    await deleteAttachmentBlobs(ctx, m.fileAttachments)
    await ctx.db.delete(m._id)
    return { removed: true, nostrEventIds }
  },
})
