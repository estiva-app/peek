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

/**
 * Resolve a stored DM targetId (an _id, possibly a legacy seedKey) to its doc.
 *
 * DMs only. The tables still hold `kind: 'topic'` rows — stars, open work and
 * screener items written before FOL-23 — and every read here skips them; they
 * go with the tables in REM-7.
 */
async function resolveDm(ctx: QueryCtx | MutationCtx, targetId: string): Promise<Doc<'dmConversations'> | null> {
  const normalized = ctx.db.normalizeId('dmConversations', targetId)
  if (normalized) {
    const doc = await ctx.db.get(normalized)
    if (doc) return doc
  }
  const rows = await ctx.db.query('dmConversations').collect()
  return rows.find((r) => r.seedKey === targetId) ?? null
}

/** The DM partner (the not-you side of the pair). */
async function dmPartner(ctx: QueryCtx | MutationCtx, dm: Doc<'dmConversations'>, youId: Id<'users'> | undefined) {
  const partnerId = dm.userLowId === youId ? dm.userHighId : dm.userLowId
  return ctx.db.get(partnerId)
}

/** A DM's client id is its partner's person key (§2.4). */
const personKey = (u: Doc<'users'>) => u.seedKey ?? (u._id as string)

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
      if (s.kind !== 'dm') continue // a topic star, from before FOL-23
      const dm = await resolveDm(ctx, s.targetId)
      if (!dm) continue
      const partner = await dmPartner(ctx, dm, you._id)
      if (!partner) continue
      out.push({ id: s._id as string, kind: 'dm' as const, dmId: personKey(partner), name: partner.name })
    }
    return out
  },
})

export const toggleStar = mutation({
  args: {
    kind: v.literal('dm'),
    /** The partner's person key (§2.4). */
    targetKey: v.string(),
  },
  handler: async (ctx, { kind, targetKey }) => {
    const you = await viewerOrThrow(ctx)
    // Resolve the pair server-side; starring someone you've never messaged
    // creates the conversation.
    const partner = await resolveUserKey(ctx, targetKey)
    if (!partner || partner._id === you._id) throw new Error(`Unknown person '${targetKey}'`)
    let target = await findDmForPair(ctx, you._id, partner._id)
    if (!target) {
      const [userLowId, userHighId] =
        (you._id as string) < (partner._id as string) ? [you._id, partner._id] : [partner._id, you._id]
      const dmId = await ctx.db.insert('dmConversations', { userLowId, userHighId, createdAt: Date.now() })
      target = await ctx.db.get(dmId)
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

/**
 * The **DM half** of the Screener (rule 1) — the only Convex half left.
 *
 * SHR-10 folded the topic half on the device, and FOL-23 removed it with the
 * Convex topics. Nothing writes a `screenerItems` row any more: the fan-out ran
 * on `messages.send`, and DMs are written to the relay since REM-3. Nothing in
 * `src/` asks for it since CON-14, which folds the DM half from the relay; it,
 * the two mutations below and the table go in REM-7.
 *
 * - A `kind: 'topic'` row may still exist in `screenerItems` — written before
 *   SHR-10 shipped — and is skipped rather than swept. A cross-user sweep is
 *   what layer 2 forbids. It costs a dead row until the table goes.
 * - PEE-6's de-duplication still runs here against `deskOpenWork`, which SHR-9
 *   deliberately keeps dual-writing.
 */
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
    /*
     * Filtered at read time as well as at write time (PEE-6): the write-side
     * skip stops NEW duplicates, and this heals every stale row already in
     * the table — plus whatever a future writer forgets — without a sweep.
     */
    const openWork = await ctx.db
      .query('deskOpenWork')
      .withIndex('by_user', (q) => q.eq('userId', you._id))
      .collect()
    const inOpenWork = new Set(openWork.map((w) => `${w.kind}:${w.targetId}`))
    const out = []
    for (const item of rows.sort((a, b) => b.createdAt - a.createdAt)) {
      if (item.kind !== 'dm') continue // a topic, from before SHR-10
      if (item.snoozedUntil !== undefined && item.snoozedUntil > now) continue
      if (inOpenWork.has(`${item.kind}:${item.targetId}`)) continue
      const dm = await resolveDm(ctx, item.targetId)
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
      if (item.kind !== 'dm') continue // a topic, from before FOL-23
      const dm = await resolveDm(ctx, item.targetId)
      if (!dm) continue
      const partner = await dmPartner(ctx, dm, you._id)
      if (!partner) continue
      out.push({ id: item._id as string, kind: 'dm' as const, dmId: personKey(partner), name: partner.name })
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

/*
  `removeOpenWorkItem`, which deleted a row by its Convex id, is gone (SHR-9).
  The rows the Desk draws come from the relay blob now and carry synthetic ids,
  so no client can produce the argument it took. `removeDmFromOpenWork` removes
  by the key the blob holds, which is what its caller had anyway.
*/

/**
 * Remove a DM from Open work by the partner's person key (§2.4).
 *
 * The Desk used to remove a DM row by its Convex row id, because the row id was
 * what rendered it. Since SHR-9 the list comes from the relay blob and the rows
 * carry synthetic ids, so there is no Convex id on the client to pass. The key
 * is what the blob holds, and it is what `toggleStar` already resolves a DM by.
 *
 * Still a Convex write, with the read gone: `screenerList` de-duplicates against
 * these rows, so a DM removed from the blob and left in the table would stay
 * hidden from the Screener for ever.
 */
export const removeDmFromOpenWork = mutation({
  args: { dmKey: v.string() },
  handler: async (ctx, { dmKey }) => {
    const you = await viewerOrThrow(ctx)
    const partner = await resolveUserKey(ctx, dmKey)
    if (!partner) return
    const dm = await findDmForPair(ctx, you._id, partner._id)
    if (!dm) return
    const rows = await ctx.db
      .query('deskOpenWork')
      .withIndex('by_user', (q) => q.eq('userId', you._id))
      .collect()
    for (const w of rows) {
      if (w.kind === 'dm' && w.targetId === (dm._id as string)) await ctx.db.delete(w._id)
    }
  },
})

/** The topic-side menus toggle by topic key (the Desk rows remove by row id,
 *  but a topic page only knows its topic). */
/** §4.4 — Desk Urgent, derived: DMs holding an urgent message newer
 *  than the user's readState watermark. No watermark row = fully read.
 *  No caller since CON-14: Urgent is the relay DM fold's urgent flag. */
export const urgentList = query({
  args: {},
  handler: async (ctx) => {
    const you = await viewer(ctx)
    if (!you) return []
    const readRows = await ctx.db.query('readState').collect()
    const watermark = new Map(
      readRows.filter((r) => r.userId === you._id).map((r) => [r.containerId, r.lastReadAt]),
    )
    const hasUnreadUrgent = async (kind: 'dm', containerId: string) => {
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
    return out
  },
})
