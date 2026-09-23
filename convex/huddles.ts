/**
 * Huddle reads + writes (domain model §2.8–2.9).
 *
 * One `list` query returns every huddle fully shaped (members, preview
 * conversation, extra messages, promotion metadata) — the client builds its
 * per-topic and per-origin-DM lookups from it (the dataset is small and the
 * sidebar needs all topics' huddles anyway). Id conventions as in the other
 * modules: stable seedKeys where present; members carry real names plus ids
 * (memberIds, index-aligned) - the client seam renders the viewer as 'You'.
 */
import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { aggregateReactions, findDmForPair, refuseReadOnlyWrite, resolveUserKey, shape, unreadFlags, userFaces } from './messages'
import { watermarks } from './readState'
import { viewerId, viewerOrThrow } from './users'
import type { Doc } from './_generated/dataModel'

export const list = query({
  args: {},
  handler: async (ctx) => {
    const huddles = await ctx.db.query('huddles').collect()
    const faces = await userFaces(ctx)
    const me = await viewerId(ctx)
    const wm = me ? await watermarks(ctx, me) : new Map<string, number>()
    const topics = await ctx.db.query('topics').collect()
    const topicKey = new Map(topics.map((t) => [t._id as string, t.seedKey ?? (t._id as string)]))
    const out = []
    for (const h of huddles) {
      const memberRows = await ctx.db
        .query('huddleMembers')
        .withIndex('by_huddle', (q) => q.eq('huddleId', h._id))
        .collect()
      memberRows.sort((a, b) => a._creationTime - b._creationTime)
      const members: string[] = []
      const memberIds: string[] = []
      for (const m of memberRows) {
        const u = await ctx.db.get(m.userId)
        if (u) {
          members.push(u.name)
          memberIds.push(u._id as string)
        }
      }

      const msgs = await ctx.db
        .query('messages')
        .withIndex('by_parent', (q) => q.eq('parentKind', 'huddle').eq('parentId', h._id as string))
        .collect()
      msgs.sort((a, b) => a.createdAt - b.createdAt)
      const shapeFull = async (m: Doc<'messages'>) => {
        const replies = (
          await ctx.db
            .query('replies')
            .withIndex('by_message', (q) => q.eq('messageId', m._id))
            .collect()
        ).sort((a, b) => a.createdAt - b.createdAt)
        const replyAuthorIds = [...new Set(replies.map((r) => r.authorId))]
        return {
          ...(await shape(ctx, m, faces)),
          replyCount: replies.length,
          replyAuthors: replyAuthorIds.map((id) => ({
            id: id as string,
            name: faces.get(id)?.name ?? 'Unknown',
            avatarUrl: faces.get(id)?.avatarUrl,
          })),
          lastReplyAt: replies.length > 0 ? replies[replies.length - 1].createdAt : undefined,
          reactions: await aggregateReactions(ctx, m._id, me ?? undefined, faces),
          ...(await unreadFlags(ctx, m, me, wm, replies)),
        }
      }
      const shaped = []
      for (const m of msgs) shaped.push(await shapeFull(m))

      // Promoted huddles preview the DM message that seeded them; regular
      // huddles preview their first message (the rest are extraConvs).
      const seedMsg = h.seedMessageId ? await ctx.db.get(h.seedMessageId) : null
      const conversation = seedMsg ? await shapeFull(seedMsg) : shaped[0]
      const extraConvs = seedMsg ? shaped : shaped.slice(1)

      // The origin DM is addressed by the partner's person key, relative to
      // the viewer — a member who isn't in that DM simply gets no back-link.
      const originDm = h.originDmId ? await ctx.db.get(h.originDmId) : null
      let originDmKey: string | undefined
      if (originDm && me) {
        const otherId =
          originDm.userLowId === me ? originDm.userHighId : originDm.userHighId === me ? originDm.userLowId : null
        if (otherId) {
          const other = await ctx.db.get(otherId)
          if (other) originDmKey = other.seedKey ?? (otherId as string)
        }
      }
      const lastMs = Math.max(h.createdAt, ...msgs.map((m) => m.createdAt))
      out.push({
        id: h.seedKey ?? (h._id as string),
        topicId: topicKey.get(h.topicId as string) ?? (h.topicId as string),
        members,
        memberIds,
        state: h.state,
        lastActivityMs: lastMs,
        conversation,
        extraConvs,
        originDmKey,
        promotedAtMs: h.promotedAt,
        seedMessageId: seedMsg ? seedMsg.seedKey ?? (seedMsg._id as string) : undefined,
      })
    }
    return out
  },
})

async function findHuddleByKey(ctx: Parameters<typeof userFaces>[0], key: string) {
  const rows = await ctx.db.query('huddles').collect()
  return rows.find((h) => h.seedKey === key || (h._id as string) === key) ?? null
}

/** Inline/dialog creation. `firstMessage` is optional (V2 dialog = members only). */
export const create = mutation({
  args: {
    topicKey: v.string(),
    seedKey: v.string(),
    memberNames: v.array(v.string()),
    firstMessage: v.optional(v.object({ seedKey: v.string(), body: v.string() })),
  },
  handler: async (ctx, { topicKey, seedKey, memberNames, firstMessage }) => {
    // Disabled until huddles are rebuilt on the relay — see `refuseReadOnlyWrite`.
    refuseReadOnlyWrite({ parentKind: 'huddle' })
    const topics = await ctx.db.query('topics').collect()
    const topic = topics.find((t) => t.seedKey === topicKey || (t._id as string) === topicKey)
    if (!topic) throw new Error(`Unknown topic '${topicKey}'`)
    const you = await viewerOrThrow(ctx)
    const now = Date.now()
    const huddleId = await ctx.db.insert('huddles', {
      topicId: topic._id,
      state: 'active',
      createdById: you._id,
      createdAt: now,
      seedKey,
    })
    const users = await ctx.db.query('users').collect()
    await ctx.db.insert('huddleMembers', { huddleId, userId: you._id })
    for (const name of memberNames) {
      if (name === 'You') continue
      const u = users.find((u) => u.name === name)
      if (u && u._id !== you._id) await ctx.db.insert('huddleMembers', { huddleId, userId: u._id })
    }
    if (firstMessage) {
      await ctx.db.insert('messages', {
        parentKind: 'huddle',
        parentId: huddleId as string,
        authorId: you._id,
        body: firstMessage.body,
        createdAt: now,
        seedKey: firstMessage.seedKey,
      })
    }
    return huddleId
  },
})

/** DM promotion: the huddle anchors to an existing DM message (never copies it — §3). */
export const createFromDm = mutation({
  args: {
    topicKey: v.string(),
    seedKey: v.string(),
    originDmKey: v.string(),
    seedMessageKey: v.string(),
    memberNames: v.array(v.string()),
  },
  handler: async (ctx, { topicKey, seedKey, originDmKey, seedMessageKey, memberNames }) => {
    refuseReadOnlyWrite({ parentKind: 'huddle' })
    const topics = await ctx.db.query('topics').collect()
    const topic = topics.find((t) => t.seedKey === topicKey || (t._id as string) === topicKey)
    if (!topic) throw new Error(`Unknown topic '${topicKey}'`)
    const you0 = await viewerOrThrow(ctx)
    const partner = await resolveUserKey(ctx, originDmKey)
    const dm = partner ? await findDmForPair(ctx, you0._id, partner._id) : null
    const seedMsg = await ctx.db
      .query('messages')
      .withIndex('by_seedKey', (q) => q.eq('seedKey', seedMessageKey))
      .unique()
    const you = await viewerOrThrow(ctx)
    const now = Date.now()
    const huddleId = await ctx.db.insert('huddles', {
      topicId: topic._id,
      state: 'active',
      createdById: you._id,
      createdAt: now,
      originDmId: dm?._id,
      promotedAt: now,
      seedMessageId: seedMsg?._id,
      seedKey,
    })
    const users = await ctx.db.query('users').collect()
    await ctx.db.insert('huddleMembers', { huddleId, userId: you._id })
    for (const name of memberNames) {
      if (name === 'You') continue
      const u = users.find((u) => u.name === name)
      if (u && u._id !== you._id) await ctx.db.insert('huddleMembers', { huddleId, userId: u._id })
    }
    return huddleId
  },
})

export const remove = mutation({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const h = await findHuddleByKey(ctx, key)
    if (!h) return
    const members = await ctx.db
      .query('huddleMembers')
      .withIndex('by_huddle', (q) => q.eq('huddleId', h._id))
      .collect()
    for (const m of members) await ctx.db.delete(m._id)
    const msgs = await ctx.db
      .query('messages')
      .withIndex('by_parent', (q) => q.eq('parentKind', 'huddle').eq('parentId', h._id as string))
      .collect()
    for (const m of msgs) {
      const replies = await ctx.db
        .query('replies')
        .withIndex('by_message', (q) => q.eq('messageId', m._id))
        .collect()
      for (const r of replies) await ctx.db.delete(r._id)
      const reactions = await ctx.db
        .query('reactions')
        .withIndex('by_message', (q) => q.eq('messageId', m._id))
        .collect()
      for (const r of reactions) await ctx.db.delete(r._id)
      await ctx.db.delete(m._id)
    }
    await ctx.db.delete(h._id)
  },
})
