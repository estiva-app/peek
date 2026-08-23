/**
 * Topic reads + creation (domain model §2.2–2.3).
 *
 * `id` is the stable seedKey where present (see convex/schema.ts).
 * `memberNames` are real names with `memberIds` index-aligned - the client
 * seam renders the viewer as 'You'. isResolved is DERIVED (§4.1), never
 * stored — computed in `list` from the topic's messages.
 */
import { v } from 'convex/values'
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server'
import { internal } from './_generated/api'
import { avatarUrl, pubkeyFromIdentity, viewerId, viewerOrThrow } from './users'
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
  }
}

/** Resolve a topic by stable client key (seedKey) or _id. Read-only, so it is
 *  usable from a query as well — the details dialog needs the same lookup. */
async function findTopicByKey(
  ctx: QueryCtx | MutationCtx,
  key: string,
): Promise<Doc<'topics'> | null> {
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
    const topics = await ctx.db.query('topics').collect()
    const out = []
    for (const t of topics) {
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
    // The channel is published by `publishTopicAsCreator`, which the client
    // calls next — scheduled work cannot see the creator's token.
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
    if (!topic) return { removed: false as const, channelUuid: null }
    const topicId = topic._id as string
    /*
      Read before the row is destroyed. The caller needs it to tell the relay
      the channel is gone, and after this mutation there is nowhere left to
      look it up — the topic row is the only place it lives (PEEK-170).
    */
    const channelUuid = topic.channelUuid ?? null

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

    /*
      Handed back so the caller can tell the relay. Publishing stays the
      client's job — it holds the only Estiva ID token — and this mutation
      holds the only copy of the channel id, so neither can do it alone.
    */
    return { removed: true as const, channelUuid }
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

// ── Topic details (PEE-2) ───────────────────────────────────────────────────

/**
 * Everything the details dialog shows about a topic.
 *
 * A query of its own rather than more fields on `list`: `list` runs for every
 * row in the sidebar on every render, and this reads membership, the creator
 * and the rename history for exactly one topic that somebody has opened.
 *
 * `canRename` is decided here rather than in the component, because the
 * component cannot know. The relay grants a kind:9002 name change to a
 * channel's owner or admin only, and Peek does not track roles — `topicMembers`
 * records who and when, never what. The creator is the one identity Peek can
 * vouch for: they published the create event, so they are the owner. It errs
 * the safe way — an admin who did not create the topic is told no, which is a
 * wrong refusal rather than a rename the relay would silently reject.
 */
export const details = query({
  args: { topicKey: v.string() },
  handler: async (ctx, { topicKey }) => {
    const me = await viewerId(ctx)
    const topic = await findTopicByKey(ctx, topicKey)
    if (!topic) return null

    const creator = await ctx.db.get(topic.creatorId)
    const memberRows = await ctx.db
      .query('topicMembers')
      .withIndex('by_topic', (q) => q.eq('topicId', topic._id))
      .collect()

    const members = []
    for (const row of memberRows) {
      const user = await ctx.db.get(row.userId)
      if (!user) continue
      members.push({
        name: user.name,
        role: user.role ?? '',
        avatarUrl: await avatarUrl(ctx, user),
        /** The creator is the owner, and the only one the relay lets rename. */
        isCreator: user._id === topic.creatorId,
      })
    }
    // The creator first, then everyone else by name. Whoever started the topic
    // is who you look for when you want something changed.
    members.sort((a, b) => Number(b.isCreator) - Number(a.isCreator) || a.name.localeCompare(b.name))

    return {
      title: topic.title,
      createdAt: topic.createdAt,
      createdByName: creator?.name ?? null,
      canRename: me !== null && me === topic.creatorId,
      members,
    }
  },
})

/**
 * A topic's history, merged from the records that already hold it.
 *
 * Deliberately not a message log — the messages are the main view, and
 * repeating them here would drown the handful of entries that say how the
 * topic itself changed. What counts is what happened *to* the topic and looks
 * the same to everybody: personal state like Open work or starring is left out
 * for that reason.
 *
 * Newest last, so it reads downwards as a timeline the way the replies panel's
 * resolutions already do.
 */
export const activity = query({
  args: { topicKey: v.string() },
  handler: async (ctx, { topicKey }) => {
    const topic = await findTopicByKey(ctx, topicKey)
    if (!topic) return []

    const nameOf = async (id: Id<'users'> | undefined) =>
      id ? ((await ctx.db.get(id))?.name ?? null) : null

    const out: {
      kind: 'created' | 'renamed' | 'resolved' | 'reopened' | 'joined'
      at: number
      by: string | null
      /** The old name for a rename; the resolved message's body otherwise. */
      detail?: string
      subject?: string
    }[] = [
      {
        kind: 'created',
        at: topic.createdAt,
        by: await nameOf(topic.creatorId),
      },
    ]

    for (const row of await ctx.db
      .query('topicRenames')
      .withIndex('by_topic', (q) => q.eq('topicId', topic._id))
      .collect()) {
      out.push({ kind: 'renamed', at: row.at, by: await nameOf(row.byUserId), detail: row.from, subject: row.to })
    }

    for (const row of await ctx.db
      .query('topicMembers')
      .withIndex('by_topic', (q) => q.eq('topicId', topic._id))
      .collect()) {
      // Only joins. A removal deletes the row, so there is no honest way to
      // show that somebody left — better a partial history than an invented one.
      if (row.userId === topic.creatorId) continue
      out.push({ kind: 'joined', at: row.addedAt, by: await nameOf(row.userId) })
    }

    const messages = await ctx.db
      .query('messages')
      .withIndex('by_parent', (q) => q.eq('parentKind', 'topic').eq('parentId', topic._id as string))
      .collect()
    for (const message of messages) {
      for (const assertion of await ctx.db
        .query('resolutionAssertions')
        .withIndex('by_message', (q) => q.eq('messageId', message._id))
        .collect()) {
        // Untrusted assertions are recorded but never moved local state
        // (PEEK-128); showing them here would let an outsider write history.
        if (!assertion.trusted) continue
        out.push({
          kind: assertion.action === 'resolved' ? 'resolved' : 'reopened',
          at: assertion.createdAt,
          by: await nameOf(assertion.authorId),
          subject: message.body.slice(0, 120),
        })
      }
    }

    return out.sort((a, b) => a.at - b.at)
  },
})

/**
 * Rename a topic.
 *
 * Convex is updated here; the kind:9002 that tells the relay is published from
 * the browser, which is where signing lives. The two are deliberately separate
 * — the local name changes immediately so the app does not sit still, and the
 * caller reverts if the relay refuses.
 *
 * The old name is kept in `topicRenames`, because `topics.title` is about to
 * stop remembering it.
 */
export const rename = mutation({
  args: { topicKey: v.string(), title: v.string() },
  handler: async (ctx, { topicKey, title }) => {
    const me = await viewerOrThrow(ctx)
    const topic = await findTopicByKey(ctx, topicKey)
    if (!topic) throw new Error(`Unknown topic '${topicKey}'`)
    if (me._id !== topic.creatorId) throw new Error('Only the person who created a topic can rename it')

    // Buzz strips leading '#' and surrounding whitespace before storing, so
    // this is the name the relay would end up with — validate the real one.
    const next = title.replace(/^[#\s]+/, '').replace(/\s+$/, '')
    if (!next) throw new Error('A topic needs a name')
    if (next === topic.title) return { renamed: false as const }

    await ctx.db.insert('topicRenames', {
      topicId: topic._id,
      from: topic.title,
      to: next,
      byUserId: me._id,
      at: Date.now(),
    })
    await ctx.db.patch(topic._id, { title: next })
    return { renamed: true as const, title: next, channelUuid: topic.channelUuid ?? null }
  },
})
