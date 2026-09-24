/**
 * Sidebar unread dots (§4.3), derived per viewer — what is left of them here.
 *
 * Same rule the mock fixture used, now computed from readState: a container
 * is unread when any NON-urgent message in it is new to you, or has a reply
 * that is new to you. Urgent items deliberately don't raise the accent dot —
 * they surface in the Desk *Urgent* section instead.
 *
 * DMs only. The topic half became a relay fold in SHR-5 (`api/topicUnread.ts`);
 * the huddle rollup and the `topicMarks` cache went with the Convex topics
 * (FOL-23). Nothing in the app reads this any more — `scripts/probe-dms8-dm-read-state.ts`
 * does, and the DM read state it checks is the relay's since DMS-8.
 */
import { query } from './_generated/server'
import { watermarks } from './readState'
import { viewerId } from './users'
import type { Doc, Id } from './_generated/dataModel'

/**
 * Per-container unread state for a viewer: the regular accent dot
 * (`unread`, non-urgent only) and the urgent flag (`urgent`). Kept as one
 * pass so the People/Topics rows can show the urgent icon instead of the dot
 * when there's an unread URGENT message (issue #11).
 */
async function containerFlags(
  ctx: Parameters<typeof watermarks>[0],
  me: Id<'users'>,
  wm: Map<string, number>,
  kind: 'dm',
  containerId: string,
): Promise<{ unread: boolean; urgent: boolean }> {
  const msgs = await ctx.db
    .query('messages')
    .withIndex('by_parent', (q) => q.eq('parentKind', kind).eq('parentId', containerId))
    .collect()
  const containerWm = wm.get(containerId)
  const isNew = (at: number, mark: number | undefined) => mark === undefined || at > mark
  let unread = false
  let urgent = false
  for (const m of msgs) {
    const replies = await ctx.db
      .query('replies')
      .withIndex('by_message', (q) => q.eq('messageId', m._id))
      .collect()
    const threadWm = wm.get(m._id as string)
    // Your own message is never new to you — but replies OTHERS leave on it
    // are (QA #2.1: the most common "new reply, no sidebar dot" case).
    const msgNew = m.authorId !== me && isNew(m.createdAt, containerWm)
    const newReplies = replies.filter((r) => r.authorId !== me && isNew(r.createdAt, threadWm))
    // Urgency belongs to the individual message/reply (ruling 2026-07-16):
    // a non-urgent reply on an urgent thread raises the ordinary accent dot,
    // not the urgent indicator — the sender must `!@` again to re-urge.
    if ((m.urgent && msgNew) || newReplies.some((r) => r.urgent)) urgent = true
    if ((!m.urgent && msgNew) || newReplies.some((r) => !r.urgent)) unread = true
  }
  return { unread, urgent }
}

/**
 * Which DMs show the accent unread dot (`dms`) vs. the urgent indicator
 * (`urgentDms`). Keys are the client's ids.
 */
export const summary = query({
  args: {},
  handler: async (ctx) => {
    const me = await viewerId(ctx)
    if (!me) return { dms: [] as string[], urgentDms: [] as string[] }
    const wm = await watermarks(ctx, me)

    const dms: string[] = []
    const urgentDms: string[] = []
    for (const dm of await ctx.db.query('dmConversations').collect()) {
      if (dm.userLowId !== me && dm.userHighId !== me) continue
      const { unread, urgent } = await containerFlags(ctx, me, wm, 'dm', dm._id as string)
      if (!unread && !urgent) continue
      const partnerId = dm.userLowId === me ? dm.userHighId : dm.userLowId
      const partner: Doc<'users'> | null = await ctx.db.get(partnerId)
      if (!partner) continue
      const key = partner.seedKey ?? (partnerId as string)
      if (urgent) urgentDms.push(key)
      if (unread) dms.push(key)
    }

    return { dms, urgentDms }
  },
})
