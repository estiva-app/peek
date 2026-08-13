/**
 * Topic reads + creation (domain model §2.2–2.3).
 *
 * `id` is the stable seedKey where present (see convex/schema.ts).
 * `memberNames` are real names with `memberIds` index-aligned - the client
 * seam renders the viewer as 'You'. isResolved is DERIVED (§4.1), never
 * stored — computed in `list` from the topic's messages.
 */
import { v } from 'convex/values'
import { mutation, query, type MutationCtx } from './_generated/server'
import { internal } from './_generated/api'
import { pubkeyFromIdentity, viewerOrThrow } from './users'
import { deleteAttachmentBlobs } from './messages'
import type { Doc, Id } from './_generated/dataModel'

/** Posting into (or joining) a topic makes you a member — one row, no dupes.
 *  Keeps topicMembers consistent for every user (QA #2.6). */
export async function ensureTopicMember(
  ctx: MutationCtx,
  topicId: Id<'topics'>,
  userId: Id<'users'>,
) {
  const rows = await ctx.db
    .query('topicMembers')
    .withIndex('by_topic', (q) => q.eq('topicId', topicId))
    .collect()
  if (!rows.some((r) => r.userId === userId)) {
    await ctx.db.insert('topicMembers', { topicId, userId, addedAt: Date.now() })
    // Only on an actual insert — this helper runs on every post, so scheduling
    // unconditionally would publish a redundant kind:9000 per message.
    await ctx.scheduler.runAfter(0, internal.nostr.publish.publishMembership, { topicId, userId })
  }
}

/** Resolve a topic by stable client key (seedKey) or _id. */
async function findTopicByKey(ctx: MutationCtx, key: string): Promise<Doc<'topics'> | null> {
  const normalized = ctx.db.normalizeId('topics', key)
  if (normalized) {
    const doc = await ctx.db.get(normalized)
    if (doc) return doc
  }
  const rows = await ctx.db.query('topics').collect()
  return rows.find((t) => t.seedKey === key) ?? null
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    console.log(`[TRACE] topics.list: starting`)
    const topics = await ctx.db.query('topics').collect()
    console.log(`[TRACE] topics.list: found ${topics.length} topics`)
    const out = []
    for (const t of topics) {
      console.log(`[TRACE] topics.list: processing topic _id=${t._id}, seedKey=${t.seedKey}, channelUuid=${t.channelUuid}`)
      const members = await ctx.db
        .query('topicMembers')
        .withIndex('by_topic', (q) => q.eq('topicId', t._id))
        .collect()
      const memberNames: string[] = []
      const memberIds: string[] = []
      for (const m of members) {
        const u = await ctx.db.get(m.userId)
        if (u) {
          memberNames.push(u.name)
          memberIds.push(u._id as string)
        }
      }
      // §4.1 — a topic is resolved when it has ≥1 message and every one is
      // resolved. Derived here, never stored.
      const msgs = await ctx.db
        .query('messages')
        .withIndex('by_parent', (q) => q.eq('parentKind', 'topic').eq('parentId', t._id as string))
        .collect()
      const isResolved = msgs.length > 0 && msgs.every((m) => m.resolved === true)
      console.log(`[TRACE] topics.list: topic ${t.seedKey ?? t._id} has channelUuid=${t.channelUuid}`)
      out.push({
        id: t.seedKey ?? (t._id as string),
        title: t.title,
        createdAt: t.createdAt,
        memberNames,
        memberIds,
        isResolved,
        channelUuid: t.channelUuid ?? null,
      })
    }
    console.log(`[TRACE] topics.list: returning ${out.length} topics`)
    return out.sort((a, b) => a.createdAt - b.createdAt)
  },
})

export const create = mutation({
  args: {
    title: v.string(),
    /** Client-generated id (t_<ts>_<seq>) so the optimistic local topic
     *  and this record are the same topic. */
    seedKey: v.string(),
    inviteeNames: v.array(v.string()),
  },
  handler: async (ctx, { title, seedKey, inviteeNames }) => {
    const you = await viewerOrThrow(ctx)
    const now = Date.now()
    const topicId = await ctx.db.insert('topics', {
      title,
      creatorId: you._id,
      createdAt: now,
      seedKey,
    })
    await ctx.db.insert('topicMembers', { topicId, userId: you._id, addedAt: now })
    for (const name of inviteeNames) {
      if (name === 'You') continue
      const user = (await ctx.db.query('users').collect()).find((u) => u.name === name)
      if (user && user._id !== you._id) {
        await ctx.db.insert('topicMembers', { topicId, userId: user._id, addedAt: now })
      }
    }
    // Scheduled actions cannot access the caller's raw Estiva ID bearer token,
    // and `/sign` must sign as that person rather than a service identity. The
    // authenticated client invokes publishTopicAsCreator immediately after this
    // mutation instead. Legacy auth retains the scheduled path while it exists.
    const isEstivaId = pubkeyFromIdentity(await ctx.auth.getUserIdentity()) !== null
    if (isEstivaId) {
      console.log(
        `[TRACE] topics.create: created topicId=${topicId}, creatorId=${you._id}; ` +
          'awaiting creator-token channel publish',
      )
    } else {
      await ctx.scheduler.runAfter(0, internal.nostr.publish.publishTopic, { topicId })
      console.log(
        `[TRACE] topics.create: created topicId=${topicId}, creatorId=${you._id}; ` +
          'scheduled nostr.publishTopic',
      )
    }
    return topicId
  },
})

/** Delete a message row plus everything hanging off it (replies, reactions,
 *  thread watermarks, and every uploaded-file blob). */
async function cascadeDeleteMessage(ctx: MutationCtx, messageId: Id<'messages'>) {
  const replies = await ctx.db
    .query('replies')
    .withIndex('by_message', (q) => q.eq('messageId', messageId))
    .collect()
  for (const r of replies) {
    await deleteAttachmentBlobs(ctx, r.fileAttachments)
    await ctx.db.delete(r._id)
  }
  const reactions = await ctx.db
    .query('reactions')
    .withIndex('by_message', (q) => q.eq('messageId', messageId))
    .collect()
  for (const r of reactions) await ctx.db.delete(r._id)
  const watermarks = (await ctx.db.query('readState').collect()).filter(
    (w) => w.containerId === (messageId as string),
  )
  for (const w of watermarks) await ctx.db.delete(w._id)
  const msg = await ctx.db.get(messageId)
  await deleteAttachmentBlobs(ctx, msg?.fileAttachments)
  await ctx.db.delete(messageId)
}

/** Delete every message under a container (topic or huddle). */
async function cascadeDeleteContainerMessages(
  ctx: MutationCtx,
  kind: 'topic' | 'huddle',
  containerId: string,
) {
  const msgs = await ctx.db
    .query('messages')
    .withIndex('by_parent', (q) => q.eq('parentKind', kind).eq('parentId', containerId))
    .collect()
  for (const m of msgs) await cascadeDeleteMessage(ctx, m._id)
}

/**
 * Delete a topic and EVERYTHING in it: messages (+replies/reactions), its
 * huddles (with their messages and members), membership rows, per-user desk
 * rows (screener/open-work/stars), and readState watermarks (QA #2.8).
 */
export const remove = mutation({
  args: { topicKey: v.string() },
  handler: async (ctx, { topicKey }) => {
    await viewerOrThrow(ctx)
    const topic = await findTopicByKey(ctx, topicKey)
    if (!topic) return
    const topicId = topic._id as string

    await cascadeDeleteContainerMessages(ctx, 'topic', topicId)

    const huddles = await ctx.db
      .query('huddles')
      .withIndex('by_topic', (q) => q.eq('topicId', topic._id))
      .collect()
    const huddleIds = new Set(huddles.map((h) => h._id as string))
    for (const h of huddles) {
      await cascadeDeleteContainerMessages(ctx, 'huddle', h._id as string)
      const hMembers = await ctx.db
        .query('huddleMembers')
        .withIndex('by_huddle', (q) => q.eq('huddleId', h._id))
        .collect()
      for (const m of hMembers) await ctx.db.delete(m._id)
      await ctx.db.delete(h._id)
    }

    const members = await ctx.db
      .query('topicMembers')
      .withIndex('by_topic', (q) => q.eq('topicId', topic._id))
      .collect()
    for (const m of members) await ctx.db.delete(m._id)

    for (const s of await ctx.db.query('screenerItems').collect()) {
      if (s.kind === 'topic' && s.targetId === topicId) await ctx.db.delete(s._id)
    }
    for (const w of await ctx.db.query('deskOpenWork').collect()) {
      if (w.kind === 'topic' && w.targetId === topicId) await ctx.db.delete(w._id)
    }
    for (const s of await ctx.db.query('stars').collect()) {
      if (s.kind === 'topic' && s.targetId === topicId) await ctx.db.delete(s._id)
    }
    for (const w of await ctx.db.query('readState').collect()) {
      if (w.containerId === topicId || huddleIds.has(w.containerId)) await ctx.db.delete(w._id)
    }
    await ctx.db.delete(topic._id)
  },
})

/** Add people to a topic's membership (the empty-topic "Invite members" flow). */
export const addMembers = mutation({
  args: { topicKey: v.string(), memberNames: v.array(v.string()) },
  handler: async (ctx, { topicKey, memberNames }) => {
    await viewerOrThrow(ctx)
    const topic = await findTopicByKey(ctx, topicKey)
    if (!topic) throw new Error(`Unknown topic '${topicKey}'`)
    const users = await ctx.db.query('users').collect()
    for (const name of memberNames) {
      const user = users.find((u) => u.name === name)
      if (user) await ensureTopicMember(ctx, topic._id, user._id)
    }
  },
})

/** Join a topic you're not a member of (the topic-list Join banner, §QA #2.7). */
export const join = mutation({
  args: { topicKey: v.string() },
  handler: async (ctx, { topicKey }) => {
    const you = await viewerOrThrow(ctx)
    const topic = await findTopicByKey(ctx, topicKey)
    if (!topic) throw new Error(`Unknown topic '${topicKey}'`)
    await ensureTopicMember(ctx, topic._id, you._id)
  },
})
