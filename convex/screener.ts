/**
 * The Screener's hover preview (§2.12).
 *
 * This file used to fill the Screener as well: `screenMessage` and
 * `screenReply` fanned every sent message out to the rows that should show it,
 * and `candidates` handed the device the facts its topic fold ran on (SHR-10).
 * The topic half went with the Convex topics (FOL-23), and the fan-out went
 * with the last caller that wrote a message through Convex — DMs are written to
 * the relay since REM-3. Since CON-14 the preview is read from the relay too
 * (`src/api/screener.ts`) and nothing calls this; it goes with `screenerItems`
 * in REM-7.
 */
import { v } from 'convex/values'
import { query, type QueryCtx } from './_generated/server'
import { viewerId } from './users'
import type { Id } from './_generated/dataModel'

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
      // The conversation's most recent messages.
      const msgs = await ctx.db
        .query('messages')
        .withIndex('by_parent', (q) => q.eq('parentKind', item.kind).eq('parentId', item.targetId))
        .collect()
      msgs.sort((a, b) => a.createdAt - b.createdAt)
      out.push(...msgs.slice(-3).map((m) => row(m.authorId, m.createdAt, m.body, 'message')))
    }

    return out
  },
})
