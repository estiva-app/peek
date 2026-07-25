/**
 * Per-user desk data: stars, screener inbox, open work (domain model
 * §2.11–2.13). All scoped to the authenticated viewer (ctx.auth).
 *
 * Rows store real target _ids (as the seed writes them); responses resolve
 * back to the stable client keys (seedKeys) the client joins on.
 */
import { v } from 'convex/values'
import { mutation, query, type QueryCtx, type MutationCtx } from './_generated/server'
import { viewer, viewerOrThrow } from './users'
import { findDmForPair, resolveUserKey } from './messages'
import type { Doc, Id } from './_generated/dataModel'

const kindArg = v.union(v.literal('topic'), v.literal('dm'))

/** Resolve a stored targetId (an _id, possibly a legacy seedKey) to its doc. */
async function resolveTarget(
  ctx: QueryCtx | MutationCtx,
  kind: 'topic' | 'dm',
  targetId: string,
): Promise<Doc<'topics'> | Doc<'dmConversations'> | null> {
  const table = kind === 'topic' ? 'topics' : 'dmConversations'
  const normalized = ctx.db.normalizeId(table, targetId)
  if (normalized) {
    const doc = await ctx.db.get(normalized)
    if (doc) return doc
  }
  const rows = await ctx.db.query(table).collect()
  return rows.find((r) => r.seedKey === targetId) ?? null
}

/** The DM partner (the not-you side of the pair). */
async function dmPartner(ctx: QueryCtx | MutationCtx, dm: Doc<'dmConversations'>, youId: Id<'users'> | undefined) {
  const partnerId = dm.userLowId === youId ? dm.userHighId : dm.userLowId
  return ctx.db.get(partnerId)
}

/** A DM's client id is its partner's person key (§2.4). */
const personKey = (u: Doc<'users'>) => u.seedKey ?? (u._id as string)

/** §4.1 — derived, same rule as topics.list. */
async function topicResolved(ctx: QueryCtx | MutationCtx, topicId: Id<'topics'>): Promise<boolean> {
  const msgs = await ctx.db
    .query('messages')
    .withIndex('by_parent', (q) => q.eq('parentKind', 'topic').eq('parentId', topicId as string))
    .collect()
  return msgs.length > 0 && msgs.every((m) => m.resolved === true)
}

export const starsList = query({
  args: {},
  handler: async (ctx) => {
    const you = await viewer(ctx)
    if (!you) return []
    const rows = await ctx.db
      .query('stars')
      .withIndex('by_user', (q) => q.eq('userId', you._id))
      .collect()
    const out = []
    for (const s of rows) {
      if (s.kind === 'dm') {
        const dm = (await resolveTarget(ctx, 'dm', s.targetId)) as Doc<'dmConversations'> | null
        if (!dm) continue
        const partner = await dmPartner(ctx, dm, you._id)
        if (!partner) continue
        out.push({ id: s._id as string, kind: 'dm' as const, dmId: personKey(partner), name: partner.name })
      } else {
        const topic = (await resolveTarget(ctx, 'topic', s.targetId)) as Doc<'topics'> | null
        if (!topic) continue
        out.push({
          id: s._id as string,
          kind: 'topic' as const,
          topicId: topic.seedKey ?? (topic._id as string),
          title: topic.title,
          topicStatus: (await topicResolved(ctx, topic._id)) ? ('resolved' as const) : ('unresolved' as const),
        })
      }
    }
    return out
  },
})

export const toggleStar = mutation({
  args: {
    kind: kindArg,
    /** Topic seedKey/_id, or — for DMs — the partner's person key (§2.4). */
    targetKey: v.string(),
  },
  handler: async (ctx, { kind, targetKey }) => {
    const you = await viewerOrThrow(ctx)
    let target: Doc<'topics'> | Doc<'dmConversations'> | null
    if (kind === 'dm') {
      // Resolve the pair server-side; starring someone you've never messaged
      // creates the conversation.
      const partner = await resolveUserKey(ctx, targetKey)
      if (!partner || partner._id === you._id) throw new Error(`Unknown person '${targetKey}'`)
      target = await findDmForPair(ctx, you._id, partner._id)
      if (!target) {
        const [userLowId, userHighId] =
          (you._id as string) < (partner._id as string) ? [you._id, partner._id] : [partner._id, you._id]
        const dmId = await ctx.db.insert('dmConversations', { userLowId, userHighId, createdAt: Date.now() })
        target = await ctx.db.get(dmId)
      }
    } else {
      target = await resolveTarget(ctx, kind, targetKey)
    }
    if (!target) throw new Error(`Unknown ${kind} '${targetKey}'`)
    const rows = await ctx.db
      .query('stars')
      .withIndex('by_user', (q) => q.eq('userId', you._id))
      .collect()
    const existing = rows.find((s) => s.kind === kind && s.targetId === (target._id as string))
    if (existing) {
      await ctx.db.delete(existing._id)
    } else {
      await ctx.db.insert('stars', {
        userId: you._id,
        kind,
        targetId: target._id as string,
        createdAt: Date.now(),
      })
    }
  },
})

export const screenerList = query({
  args: {},
  handler: async (ctx) => {
    const you = await viewer(ctx)
    if (!you) return []
    const now = Date.now()
    const rows = await ctx.db
      .query('screenerItems')
      .withIndex('by_user', (q) => q.eq('userId', you._id))
      .collect()
    const out = []
    for (const item of rows.sort((a, b) => b.createdAt - a.createdAt)) {
      if (item.snoozedUntil !== undefined && item.snoozedUntil > now) continue
      if (item.kind === 'topic') {
        const topic = (await resolveTarget(ctx, 'topic', item.targetId)) as Doc<'topics'> | null
        if (!topic) continue
        out.push({
          id: item._id as string,
          kind: 'topic' as const,
          topicId: topic.seedKey ?? (topic._id as string),
          topicTitle: topic.title,
          preview: item.preview,
        })
      } else {
        const dm = (await resolveTarget(ctx, 'dm', item.targetId)) as Doc<'dmConversations'> | null
        if (!dm) continue
        const partner = await dmPartner(ctx, dm, you._id)
        if (!partner) continue
        out.push({
          id: item._id as string,
          kind: 'dm' as const,
          dmId: personKey(partner),
          authorName: partner.name,
          preview: item.preview,
        })
      }
    }
    return out
  },
})

export const dismissScreenerItem = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const normalized = ctx.db.normalizeId('screenerItems', id)
    if (normalized) await ctx.db.delete(normalized)
  },
})

export const snoozeScreenerItem = mutation({
  args: { id: v.string(), until: v.optional(v.number()) },
  handler: async (ctx, { id, until }) => {
    const normalized = ctx.db.normalizeId('screenerItems', id)
    // Default snooze: reappears after 24h ("Later" — §2.12).
    if (normalized) await ctx.db.patch(normalized, { snoozedUntil: until ?? Date.now() + 24 * 60 * 60 * 1000 })
  },
})

export const openWorkList = query({
  args: {},
  handler: async (ctx) => {
    const you = await viewer(ctx)
    if (!you) return []
    const rows = await ctx.db
      .query('deskOpenWork')
      .withIndex('by_user', (q) => q.eq('userId', you._id))
      .collect()
    const out = []
    for (const item of rows.sort((a, b) => b.addedAt - a.addedAt)) {
      if (item.kind === 'topic') {
        const topic = (await resolveTarget(ctx, 'topic', item.targetId)) as Doc<'topics'> | null
        if (!topic) continue
        out.push({
          id: item._id as string,
          kind: 'topic' as const,
          topicId: topic.seedKey ?? (topic._id as string),
          title: topic.title,
          topicStatus: (await topicResolved(ctx, topic._id)) ? ('resolved' as const) : ('unresolved' as const),
        })
      } else {
        const dm = (await resolveTarget(ctx, 'dm', item.targetId)) as Doc<'dmConversations'> | null
        if (!dm) continue
        const partner = await dmPartner(ctx, dm, you._id)
        if (!partner) continue
        out.push({ id: item._id as string, kind: 'dm' as const, dmId: personKey(partner), name: partner.name })
      }
    }
    return out
  },
})

/** Screener "Open" → move the item into Open work (§2.12/§2.13). */
export const addToOpenWork = mutation({
  args: { screenerItemId: v.string() },
  handler: async (ctx, { screenerItemId }) => {
    const you = await viewerOrThrow(ctx)
    const id = ctx.db.normalizeId('screenerItems', screenerItemId)
    const item = id ? await ctx.db.get(id) : null
    if (!item || item.userId !== you._id) return
    // No duplicates: if it's already in Open work, just drop the screener row.
    const existing = await ctx.db
      .query('deskOpenWork')
      .withIndex('by_user', (q) => q.eq('userId', you._id))
      .collect()
    if (!existing.some((w) => w.kind === item.kind && w.targetId === item.targetId)) {
      await ctx.db.insert('deskOpenWork', {
        userId: you._id,
        kind: item.kind,
        targetId: item.targetId,
        addedAt: Date.now(),
      })
    }
    await ctx.db.delete(item._id)
  },
})

export const removeOpenWorkItem = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const normalized = ctx.db.normalizeId('deskOpenWork', id)
    if (normalized) await ctx.db.delete(normalized)
  },
})

/** Desk "+" picker and the topic menus: put topics straight into Open work —
 *  no screener row involved (§2.13). Duplicates are skipped. */
export const addTopicsToOpenWork = mutation({
  args: { topicKeys: v.array(v.string()) },
  handler: async (ctx, { topicKeys }) => {
    const you = await viewerOrThrow(ctx)
    const existing = await ctx.db
      .query('deskOpenWork')
      .withIndex('by_user', (q) => q.eq('userId', you._id))
      .collect()
    for (const key of topicKeys) {
      const topic = (await resolveTarget(ctx, 'topic', key)) as Doc<'topics'> | null
      if (!topic) continue
      if (existing.some((w) => w.kind === 'topic' && w.targetId === (topic._id as string))) continue
      await ctx.db.insert('deskOpenWork', {
        userId: you._id,
        kind: 'topic',
        targetId: topic._id as string,
        addedAt: Date.now(),
      })
    }
  },
})

/** The topic-side menus toggle by topic key (the Desk rows remove by row id,
 *  but a topic page only knows its topic). */
export const removeTopicFromOpenWork = mutation({
  args: { topicKey: v.string() },
  handler: async (ctx, { topicKey }) => {
    const you = await viewerOrThrow(ctx)
    const topic = (await resolveTarget(ctx, 'topic', topicKey)) as Doc<'topics'> | null
    if (!topic) return
    const rows = await ctx.db
      .query('deskOpenWork')
      .withIndex('by_user', (q) => q.eq('userId', you._id))
      .collect()
    for (const w of rows) {
      if (w.kind === 'topic' && w.targetId === (topic._id as string)) await ctx.db.delete(w._id)
    }
  },
})

/** §4.4 — Desk Urgent, derived: containers holding an urgent message newer
 *  than the user's readState watermark. No watermark row = fully read. */
export const urgentList = query({
  args: {},
  handler: async (ctx) => {
    const you = await viewer(ctx)
    if (!you) return []
    const readRows = await ctx.db.query('readState').collect()
    const watermark = new Map(
      readRows.filter((r) => r.userId === you._id).map((r) => [r.containerId, r.lastReadAt]),
    )
    const hasUnreadUrgent = async (kind: 'topic' | 'dm' | 'huddle', containerId: string) => {
      const last = watermark.get(containerId)
      // No watermark = never opened = everything in it is new (§4.3). The old
      // rule said "fully read", which silently swallowed an urgent message in a
      // conversation you'd never opened — e.g. the first DM from a new person.
      const isNew = (at: number, mark = last) => mark === undefined || at > mark
      const msgs = await ctx.db
        .query('messages')
        .withIndex('by_parent', (q) => q.eq('parentKind', kind).eq('parentId', containerId))
        .collect()
      // Urgency belongs to the individual message/reply (ruling 2026-07-16):
      // only an unread URGENT message or an unread URGENT reply lands here.
      // A non-urgent reply on an urgent thread no longer keeps it urgent —
      // it raises the ordinary unread dot instead; the sender must `!@` again.
      for (const m of msgs) {
        if (m.urgent === true && m.authorId !== you._id && isNew(m.createdAt)) return true
        const replies = await ctx.db
          .query('replies')
          .withIndex('by_message', (q) => q.eq('messageId', m._id))
          .collect()
        const threadWm = watermark.get(m._id as string)
        if (replies.some((r) => r.urgent === true && r.authorId !== you._id && isNew(r.createdAt, threadWm)))
          return true
      }
      return false
    }
    const out = []
    for (const dm of await ctx.db.query('dmConversations').collect()) {
      if (dm.userLowId !== you._id && dm.userHighId !== you._id) continue
      if (!(await hasUnreadUrgent('dm', dm._id as string))) continue
      const partner = await dmPartner(ctx, dm, you._id)
      if (!partner) continue
      const key = personKey(partner)
      out.push({ id: `urg_dm_${key}`, kind: 'dm' as const, dmId: key, name: partner.name })
    }
    for (const topic of await ctx.db.query('topics').collect()) {
      let urgentHere = await hasUnreadUrgent('topic', topic._id as string)
      if (!urgentHere) {
        // Urgent huddle traffic surfaces on the parent topic (member-gated),
        // matching the sidebar's urgent-indicator rollup in unread.summary.
        const huddles = await ctx.db
          .query('huddles')
          .withIndex('by_topic', (q) => q.eq('topicId', topic._id))
          .collect()
        for (const h of huddles) {
          const members = await ctx.db
            .query('huddleMembers')
            .withIndex('by_huddle', (q) => q.eq('huddleId', h._id))
            .collect()
          if (!members.some((r) => r.userId === you._id)) continue
          if (await hasUnreadUrgent('huddle', h._id as string)) {
            urgentHere = true
            break
          }
        }
      }
      if (!urgentHere) continue
      out.push({
        id: `urg_topic_${topic.seedKey ?? topic._id}`,
        kind: 'topic' as const,
        topicId: topic.seedKey ?? (topic._id as string),
        title: topic.title,
        topicStatus: (await topicResolved(ctx, topic._id)) ? ('resolved' as const) : ('unresolved' as const),
      })
    }
    return out
  },
})
