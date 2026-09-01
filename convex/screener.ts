/**
 * Screener auto-fill (§2.12; rules confirmed by the user 2026-07-09).
 *
 * The Screener is a *preview* of things that want your attention — not a log
 * of every message. An item appears when:
 *
 *   1. someone DMs you;
 *   2. a topic you were added to but have never opened gets a message;
 *   3. you are @mentioned.
 *
 * …and it is refreshed (never duplicated) by later activity: one row per
 * conversation, carrying the newest preview. Ordinary messages and replies in
 * topics you already follow do NOT screen — that's what keeps it quiet.
 *
 * URGENT overrides everything: an urgent message (written with `!@`) goes to
 * the Desk *Urgent* section and never to the Screener.
 *
 * "Later" (snoozedUntil) survives a refresh — new activity does not un-snooze
 * something you deliberately put off.
 */
import { v } from 'convex/values'
import { query, type MutationCtx, type QueryCtx } from './_generated/server'
import { viewerId } from './users'
import type { Doc, Id } from './_generated/dataModel'

const PREVIEW_MAX = 240
const snippet = (body: string) => body.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_MAX)

/** `@Name` — also true for the urgent form `!@Name`. */
export function mentionsUser(body: string, name: string): boolean {
  return body.includes(`@${name}`)
}

/** The composer's urgent marker. */
export function isUrgentBody(body: string): boolean {
  return body.includes('!@')
}

/** Everyone who could be notified about a message in this container, minus its author. */
async function recipients(
  ctx: MutationCtx,
  kind: 'topic' | 'dm' | 'huddle',
  containerId: string,
  authorId: Id<'users'>,
): Promise<Id<'users'>[]> {
  if (kind === 'dm') {
    const dm = await ctx.db.get(containerId as Id<'dmConversations'>)
    if (!dm) return []
    const other = dm.userLowId === authorId ? dm.userHighId : dm.userLowId
    return [other]
  }
  if (kind === 'topic') {
    const rows = await ctx.db
      .query('topicMembers')
      .withIndex('by_topic', (q) => q.eq('topicId', containerId as Id<'topics'>))
      .collect()
    return rows.map((r) => r.userId).filter((id) => id !== authorId)
  }
  const rows = await ctx.db
    .query('huddleMembers')
    .withIndex('by_huddle', (q) => q.eq('huddleId', containerId as Id<'huddles'>))
    .collect()
  return rows.map((r) => r.userId).filter((id) => id !== authorId)
}

/** Where a message screens to: DMs to themselves, huddles to their parent topic. */
async function screenTarget(
  ctx: MutationCtx,
  kind: 'topic' | 'dm' | 'huddle',
  containerId: string,
): Promise<{ kind: 'topic' | 'dm'; targetId: string } | null> {
  if (kind === 'dm') return { kind: 'dm', targetId: containerId }
  if (kind === 'topic') return { kind: 'topic', targetId: containerId }
  const h = await ctx.db.get(containerId as Id<'huddles'>)
  return h ? { kind: 'topic', targetId: h.topicId as string } : null
}

async function findItem(ctx: MutationCtx, userId: Id<'users'>, kind: 'topic' | 'dm', targetId: string) {
  const rows = await ctx.db
    .query('screenerItems')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .collect()
  return rows.find((r) => r.kind === kind && r.targetId === targetId) ?? null
}

/**
 * Already committed to: an item in Desk Open Work must not screen (PEE-6).
 *
 * The Screener previews things that *want* your attention; Open Work holds
 * what you have already given it to. One conversation in both reads as a
 * duplicate — "you're trying to open an item that is already open" — and its
 * attention signal is the unread badge the Open Work row already carries.
 */
async function inOpenWork(
  ctx: MutationCtx | QueryCtx,
  userId: Id<'users'>,
  kind: 'topic' | 'dm',
  targetId: string,
): Promise<boolean> {
  const rows = await ctx.db
    .query('deskOpenWork')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .collect()
  return rows.some((w) => w.kind === kind && w.targetId === targetId)
}

/** One row per conversation: create it, or refresh its preview in place. */
async function upsert(
  ctx: MutationCtx,
  userId: Id<'users'>,
  kind: 'topic' | 'dm',
  targetId: string,
  preview: string,
  messageId: Id<'messages'>,
) {
  const existing = await findItem(ctx, userId, kind, targetId)
  const now = Date.now()
  if (existing) {
    // snoozedUntil is deliberately left alone (see header).
    await ctx.db.patch(existing._id, { preview, createdAt: now, messageId })
  } else {
    await ctx.db.insert('screenerItems', { userId, kind, targetId, preview, createdAt: now, messageId })
  }
}

/** Fan a newly-sent message out to the Screeners that should show it. */
export async function screenMessage(ctx: MutationCtx, m: Doc<'messages'>) {
  if (m.urgent) return // → Desk Urgent instead
  const target = await screenTarget(ctx, m.parentKind, m.parentId)
  if (!target) return

  const members = new Set(await recipients(ctx, m.parentKind, m.parentId, m.authorId))
  // A MENTION reaches you whether or not you're a member of the container —
  // being named is the point. Membership only gates the other two rules.
  const candidates = await ctx.db.query('users').collect()

  for (const user of candidates) {
    if (user._id === m.authorId) continue

    let screen = false
    if (mentionsUser(m.body, user.name)) {
      screen = true // you were @mentioned
    } else if (!members.has(user._id)) {
      continue
    } else if (m.parentKind === 'dm') {
      screen = true // every DM to you
    } else {
      // "added to a topic and it has a new message" — i.e. you've never
      // opened it. Once you have, its ordinary traffic stops screening.
      const seen = await ctx.db
        .query('readState')
        .withIndex('by_user_container', (q) => q.eq('userId', user._id).eq('containerId', target.targetId))
        .unique()
      screen = seen === null
    }
    // Checked only for someone about to be screened: `candidates` is every
    // user, and most of them are not (PEE-6).
    if (screen && !(await inOpenWork(ctx, user._id, target.kind, target.targetId))) {
      await upsert(ctx, user._id, target.kind, target.targetId, snippet(m.body), m._id)
    }
  }
}

/**
 * A reply screens to you when (ruling 2026-07-16, extending 2026-07-09):
 *
 *   - you are @mentioned in it; or
 *   - you PARTICIPATED in that thread — you wrote the parent message or an
 *     earlier reply in it; or
 *   - you already have a Screener item for the conversation (the reply
 *     refreshes it — "new replies in a thread you were mentioned in").
 *
 * Ordinary replies in threads you never touched still don't screen.
 */
export async function screenReply(ctx: MutationCtx, reply: Doc<'replies'>) {
  if (reply.urgent) return
  const parent = await ctx.db.get(reply.messageId)
  if (!parent) return
  const target = await screenTarget(ctx, parent.parentKind, parent.parentId)
  if (!target) return

  const members = new Set(await recipients(ctx, parent.parentKind, parent.parentId, reply.authorId))
  const priorReplies = await ctx.db
    .query('replies')
    .withIndex('by_message', (q) => q.eq('messageId', parent._id))
    .collect()
  const participants = new Set<string>([
    parent.authorId as string,
    ...priorReplies.filter((r) => r._id !== reply._id).map((r) => r.authorId as string),
  ])
  for (const user of await ctx.db.query('users').collect()) {
    if (user._id === reply.authorId) continue
    const mentioned = mentionsUser(reply.body, user.name)
    if (!mentioned && !members.has(user._id)) continue
    const existing = await findItem(ctx, user._id, target.kind, target.targetId)
    if (
      (mentioned || existing || participants.has(user._id as string)) &&
      !(await inOpenWork(ctx, user._id, target.kind, target.targetId))
    ) {
      await upsert(ctx, user._id, target.kind, target.targetId, snippet(reply.body), parent._id)
    }
  }
}

/**
 * The hover preview (user request 2026-07-09): hovering a Screener item shows
 * more of the conversation than its two-line snippet.
 *
 * When we know which message triggered the item we show that message plus its
 * replies (the thread you were mentioned in); otherwise we fall back to the
 * conversation's most recent messages. Own rows are labelled by the client.
 */
export const preview = query({
  args: { itemId: v.string() },
  handler: async (ctx: QueryCtx, { itemId }) => {
    const me = await viewerId(ctx)
    if (!me) return null
    const id = ctx.db.normalizeId('screenerItems', itemId)
    const item = id ? await ctx.db.get(id) : null
    if (!item || item.userId !== me) return null // never leak someone else's inbox

    const users = await ctx.db.query('users').collect()
    const nameOf = new Map(users.map((u) => [u._id, u.name]))
    const row = (
      authorId: Id<'users'>,
      createdAt: number,
      body: string,
      kind: 'message' | 'reply',
    ) => ({
      authorId: authorId as string,
      authorName: nameOf.get(authorId) ?? 'Unknown',
      createdAt,
      body,
      kind,
    })

    const out: ReturnType<typeof row>[] = []

    if (item.messageId) {
      const m = await ctx.db.get(item.messageId)
      if (m) {
        out.push(row(m.authorId, m.createdAt, m.body, 'message'))
        const replies = await ctx.db
          .query('replies')
          .withIndex('by_message', (q) => q.eq('messageId', m._id))
          .collect()
        replies.sort((a, b) => a.createdAt - b.createdAt)
        for (const r of replies.slice(-4)) out.push(row(r.authorId, r.createdAt, r.body, 'reply'))
      }
    }

    if (out.length === 0) {
      const msgs = await ctx.db
        .query('messages')
        .withIndex('by_parent', (q) => q.eq('parentKind', item.kind).eq('parentId', item.targetId))
        .collect()
      msgs.sort((a, b) => a.createdAt - b.createdAt)
      for (const m of msgs.slice(-3)) out.push(row(m.authorId, m.createdAt, m.body, 'message'))
    }

    return out
  },
})
