/**
 * Sidebar unread dots (§4.3), derived per viewer — what is left of them here.
 *
 * Same rule the mock fixture used, now computed from readState: a container
 * is unread when any NON-urgent message in it is new to you, or has a reply
 * that is new to you. Urgent items deliberately don't raise the accent dot —
 * they surface in the Desk *Urgent* section instead.
 *
 * ## The topic channels moved to the relay (SHR-5)
 *
 * `summary` used to run `containerFlags` over **every topic** as well, which
 * collected every message in each and then every reply on each message — the
 * most expensive query in the tree, on every sidebar render, to produce four
 * arrays of ids. A topic is a channel and its messages are on the relay, so
 * that half is now a fold in the client (`api/topicUnread.ts`, read by
 * `api/useTopicUnread.ts`) and is gone from here.
 *
 * What stays is what the relay cannot answer:
 *
 * - **Huddles.** A huddle is not a channel — it has no `h` and nothing of it
 *   is published — so its rollup into the parent topic's dot is still Convex's
 *   to compute. `huddleTopics` carries the topic keys it lights; the client
 *   unions them with the relay fold.
 * - **DMs.** A DM conversation lives in Convex until the DMs-on-Nostr work
 *   lands (DMS-*), and the ticket deliberately left that branch alone.
 *
 * The rollup no longer walks the topics table to find the huddles: it reads
 * the huddles, keeps the ones the viewer is a member of, and resolves each
 * one's parent topic key. Same answer, and the cost is the huddles rather
 * than every topic's whole message tree.
 *
 * ## `topicMarks` is the cache, not a second answer
 *
 * The relay frontier is the newest 90 days of the person's slots and is capped
 * in bytes (SHR-4), so a marker can fall out of it while the message it covers
 * is still inside the horizon — and the fold would then light a topic the
 * person read months ago. `readState` is the cache that exists for exactly
 * that ("a context the relay has forgotten keeps its cached value instead of
 * reverting to unread"), so the watermarks it already holds go out with the
 * answer and the fold takes the later of the two. It is the same
 * `watermarks()` collect the DM branch already runs, plus the topics table —
 * no message is read for it. Emitted in **unix seconds**, because that is what
 * a NIP-RS context is and what the fold compares against; the rows are
 * milliseconds, and this is the one place the two meet.
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
  // No 'topic' since SHR-5: a topic's own messages are folded from its
  // channel in the client, and nothing here may walk them again.
  kind: 'dm' | 'huddle',
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

/** Is the viewer a member of this huddle? Huddles are private — only members'
 *  sidebars react to their activity. */
async function isHuddleMember(
  ctx: Parameters<typeof watermarks>[0],
  huddleId: Id<'huddles'>,
  me: Id<'users'>,
): Promise<boolean> {
  const rows = await ctx.db
    .query('huddleMembers')
    .withIndex('by_huddle', (q) => q.eq('huddleId', huddleId))
    .collect()
  return rows.some((r) => r.userId === me)
}

/**
 * Which DMs show the accent unread dot (`dms`) vs. the urgent indicator
 * (`urgentDms`), and which topics are lit by a **huddle** under them
 * (`huddleTopics` / `urgentHuddleTopics`) — the part of a topic's indicator
 * that is not on the relay. Keys are the client's ids.
 *
 * A topic's own channel is folded in the client (SHR-5); `useUnread` unions
 * the two. Nothing here reads the topics' messages.
 */
export const summary = query({
  args: {},
  handler: async (ctx) => {
    const me = await viewerId(ctx)
    const empty = {
      huddleTopics: [],
      dms: [],
      urgentHuddleTopics: [],
      urgentDms: [],
      topicMarks: {},
    }
    if (!me)
      return empty as {
        huddleTopics: string[]
        dms: string[]
        urgentHuddleTopics: string[]
        urgentDms: string[]
        topicMarks: Record<string, number>
      }
    const wm = await watermarks(ctx, me)

    const topicRows = await ctx.db.query('topics').collect()
    const topicKey = new Map(topicRows.map((t) => [t._id as string, t.seedKey ?? (t._id as string)]))
    // Keyed by channel uuid, which is the NIP-RS container context the fold
    // looks the relay marker up under. ms → s here and nowhere else.
    const topicMarks: Record<string, number> = {}
    for (const t of topicRows) {
      const at = t.channelUuid ? wm.get(t._id as string) : undefined
      if (t.channelUuid && at !== undefined) topicMarks[t.channelUuid] = Math.floor(at / 1000)
    }

    // Huddle activity rolls up to the parent topic's sidebar dot — a new
    // huddle message/reply otherwise only badged the card, never the sidebar
    // (QA #2.1). Member-gated: huddles are private.
    const huddleTopics = new Set<string>()
    const urgentHuddleTopics = new Set<string>()
    for (const h of await ctx.db.query('huddles').collect()) {
      if (!(await isHuddleMember(ctx, h._id, me))) continue
      const key = topicKey.get(h.topicId as string)
      if (!key) continue
      if (huddleTopics.has(key) && urgentHuddleTopics.has(key)) continue
      const f = await containerFlags(ctx, me, wm, 'huddle', h._id as string)
      if (f.unread) huddleTopics.add(key)
      if (f.urgent) urgentHuddleTopics.add(key)
    }

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

    return {
      huddleTopics: [...huddleTopics],
      dms,
      urgentHuddleTopics: [...urgentHuddleTopics],
      urgentDms,
      topicMarks,
    }
  },
})
