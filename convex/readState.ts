/**
 * Read state (§2.10, §4.3) — what you've already seen.
 *
 * TWO granularities, per the 2026-07-09 ruling (which revises the earlier
 * "one watermark per container"): the UI has two distinct unread signals and
 * they clear independently.
 *
 *   - **Container watermark** — a topic / DM / huddle. Set when you open the
 *     conversation (after a short dwell). Drives `hasNewMessage`.
 *   - **Thread watermark** — one message's reply thread. Set only when you
 *     open THAT message's thread panel. Drives `hasNewReply` / `isNew`.
 *
 * Opening a topic therefore does not clear a "1 new reply" badge — you have
 * to open the thread, exactly as the card designs imply.
 *
 * Both live in the one `readState` table: `containerId` is a container _id
 * or, for a thread, the parent message's _id. No watermark row = never
 * opened, so everything in it (except your own writing) is new.
 */
import { v } from 'convex/values'
import { mutation, query, type QueryCtx, type MutationCtx } from './_generated/server'
import { findMessageByKey, resolveParentId } from './messages'
import { viewerOrThrow, viewerId } from './users'
import type { Id } from './_generated/dataModel'

const parentKindArg = v.union(v.literal('topic'), v.literal('dm'), v.literal('huddle'))

/** All of a user's watermarks, keyed by containerId (container _id or message _id). */
export async function watermarks(
  ctx: QueryCtx | MutationCtx,
  userId: Id<'users'>,
): Promise<Map<string, number>> {
  const rows = await ctx.db
    .query('readState')
    .withIndex('by_user_container', (q) => q.eq('userId', userId))
    .collect()
  return new Map(rows.map((r) => [r.containerId, r.lastReadAt]))
}

/** Watermarks only ever move forward. */
async function touch(ctx: MutationCtx, userId: Id<'users'>, containerId: string, at: number) {
  const existing = await ctx.db
    .query('readState')
    .withIndex('by_user_container', (q) => q.eq('userId', userId).eq('containerId', containerId))
    .unique()
  if (existing) {
    if (existing.lastReadAt < at) await ctx.db.patch(existing._id, { lastReadAt: at })
  } else {
    await ctx.db.insert('readState', { userId, containerId, lastReadAt: at })
  }
}

/**
 * Reading a conversation from anywhere retires its Screener item (§2.12,
 * ruling 2026-07-15): the Screener is for what you HAVEN'T looked at yet, so
 * opening the topic/DM from People or Topics removes it from the Screener.
 * `containerId` is the container's _id (the screener item's targetId).
 */
async function clearScreenerFor(ctx: MutationCtx, userId: Id<'users'>, containerId: string) {
  const rows = await ctx.db
    .query('screenerItems')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .collect()
  for (const r of rows) {
    if (r.targetId === containerId) await ctx.db.delete(r._id)
  }
}

/** You opened a topic / DM / huddle and stayed a moment: its messages are read. */
/** You opened one message's thread panel: its replies are read. */
export const markThreadRead = mutation({
  args: { messageKey: v.string() },
  handler: async (ctx, { messageKey }) => {
    const you = await viewerOrThrow(ctx)
    const m = await findMessageByKey(ctx, messageKey)
    if (!m) return
    await touch(ctx, you._id, m._id as string, Date.now())
    // Engaging with the thread also retires the container's Screener item.
    await clearScreenerFor(ctx, you._id, m.parentId)
  },
})

// ---------------------------------------------------------------------------
// The horizon cache (CRO-6)
// ---------------------------------------------------------------------------

/**
 * This table's second job, and the reason it is not retired by NIP-RS.
 *
 * NIP-RS fetches with `since: now - horizon`, and SPEC §11.6 is explicit about
 * the consequence: *"a container last read before the horizon reads as unread
 * unless the client keeps its own cache behind the protocol."* Contexts that
 * aged out are **indistinguishable from never-read ones**.
 *
 * For Peek that is not theoretical. Topics here are long-lived; one read three
 * weeks ago and quiet since would light the sidebar up, which is precisely the
 * staleness symptom this programme exists to remove.
 *
 * So `readState` stops being the source of truth and becomes the durable cache
 * that outlives the horizon:
 *
 *   - the merged relay state is written in as it arrives, **max only**;
 *   - the UI keeps reading from here, so nothing downstream changes;
 *   - a context the relay has forgotten keeps its cached value instead of
 *     reverting to unread.
 *
 * It holds exactly what the merge produced plus history the horizon dropped —
 * never a value the merge did not produce. Being per-deployment is expected and
 * fine: the relay is the shared layer, this is local.
 *
 * ## The unit boundary, which is the easy thing to get silently wrong
 *
 * `readState.lastReadAt` is **epoch milliseconds** — it is compared against
 * `messages.createdAt`. NIP-RS contexts are **unix seconds**. Getting the
 * conversion wrong does not throw: seconds written as ms date to 1970 and lose
 * every max, and ms written as seconds land in the year 56000 and mark the
 * whole workspace permanently read. Conversion happens here and nowhere else.
 */

/** A context id resolved to this deployment's `readState.containerId`, or null. */
async function resolveContextId(ctx: QueryCtx | MutationCtx, context: string): Promise<string | null> {
  // SPEC §11.1: the container context is the bare channel uuid. A topic's or a
  // DM's (DMS-8) — the uuid says nothing about which, so both tables are asked.
  // The two rows are what `markContainerRead` keys on, so a marker that arrived
  // from another installation lands where the viewer's own click would have.
  if (!context.includes(':')) {
    const topic = await ctx.db
      .query('topics')
      .withIndex('by_channelUuid', (q) => q.eq('channelUuid', context))
      .unique()
    if (topic) return topic._id as string
    const dm = await ctx.db
      .query('dmConversations')
      .withIndex('by_channelUuid', (q) => q.eq('channelUuid', context))
      .unique()
    return dm ? (dm._id as string) : null
  }
  if (context.startsWith('thread:')) {
    const eventId = context.slice('thread:'.length)
    const message = await ctx.db
      .query('messages')
      .withIndex('by_nostrEventId', (q) => q.eq('nostrEventId', eventId))
      .unique()
    // Peek's thread watermark is keyed on the parent message's id — the same
    // key `markThreadRead` writes, so the two paths agree by construction.
    return message ? (message._id as string) : null
  }
  /*
   * `msg:<id>` is a real NIP-RS grain and Peek has nowhere to put it: the UI
   * has two granularities, container and thread, and no per-message marker.
   * Reported as unresolved rather than folded into the thread watermark —
   * conflating them would advance a whole thread because one message in it was
   * read, which is §11.2's failure in a different direction.
   *
   * A **file** context — the bare `<kind>:<pubkey>:<d>` (§11.1, FOL-16) — is
   * unresolved here by design too. It is the frontier of one file's
   * conversation, and folding it into the Folder's topic row would let a read
   * of one issue silently read the team's general chat (§11.3 says the two do
   * not reach each other). The Folder listing judges files from the relay
   * frontier directly, so this cache never needs to hold them.
   */
  return null
}

/**
 * Write merged relay read state into the cache.
 *
 * **Max only, never overwrite** — `touch` enforces it, in this direction and in
 * the one the client publishes. An overwrite either way can lower a read
 * position, which the protocol forbids and a person experiences as messages
 * un-reading themselves.
 *
 * Returns what it could not place, so a caller can tell "nothing to apply" from
 * "this deployment has never seen those objects" — a distinction that is
 * invisible in an unread count and matters while the two halves are dual-run.
 */
export const applyRelayReadState = mutation({
  args: {
    contexts: v.array(v.object({ context: v.string(), atSeconds: v.number() })),
  },
  handler: async (ctx, { contexts }) => {
    const you = await viewerOrThrow(ctx)
    let applied = 0
    let unresolved = 0
    for (const { context, atSeconds } of contexts) {
      if (!Number.isInteger(atSeconds) || atSeconds < 0) continue
      const containerId = await resolveContextId(ctx, context)
      if (!containerId) {
        unresolved++
        continue
      }
      await touch(ctx, you._id, containerId, atSeconds * 1000) // seconds → ms, once
      applied++
    }
    return { applied, unresolved }
  },
})

/**
 * The cache, expressed as protocol contexts — the other direction.
 *
 * This is what re-anchors read state the horizon has forgotten: publishing it
 * puts an aged-out marker back inside the window, so it survives without the
 * cache having to cover it forever. The publish path takes the max, so nothing
 * here can lower anything.
 *
 * Only watermarks with a protocol identity come back. A topic never published
 * to the relay, and a message that never was, have no context id that any other
 * app could interpret — CRO-4 declines to invent one and so does this.
 */
export const cachedReadContexts = query({
  args: {},
  handler: async (ctx): Promise<{ context: string; atSeconds: number }[]> => {
    const me = await viewerId(ctx)
    if (!me) return []
    const rows = await ctx.db
      .query('readState')
      .withIndex('by_user_container', (q) => q.eq('userId', me))
      .collect()
    const out: { context: string; atSeconds: number }[] = []
    for (const row of rows) {
      // `containerId` is a topic, DM or message id; the id itself says which.
      const topicId = ctx.db.normalizeId('topics', row.containerId)
      if (topicId) {
        const topic = await ctx.db.get(topicId)
        if (topic?.channelUuid) {
          out.push({ context: topic.channelUuid, atSeconds: Math.floor(row.lastReadAt / 1000) })
        }
        continue
      }
      /*
       * A DM's context is its channel uuid, bare, exactly as a topic's (DMS-8).
       * This is also how a DM read *before* it had a channel reaches the relay:
       * the click recorded only the Convex watermark, and once `recordDmChannel`
       * has written the uuid this returns it, and `useCacheReanchor` publishes
       * what the relay does not yet hold.
       */
      const dmId = ctx.db.normalizeId('dmConversations', row.containerId)
      if (dmId) {
        const dm = await ctx.db.get(dmId)
        if (dm?.channelUuid) {
          out.push({ context: dm.channelUuid, atSeconds: Math.floor(row.lastReadAt / 1000) })
        }
        continue
      }
      const messageId = ctx.db.normalizeId('messages', row.containerId)
      if (messageId) {
        const message = await ctx.db.get(messageId)
        if (message?.nostrEventId) {
          out.push({
            context: `thread:${message.nostrEventId}`,
            atSeconds: Math.floor(row.lastReadAt / 1000),
          })
        }
      }
    }
    return out
  },
})
