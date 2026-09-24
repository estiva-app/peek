/**
 * What is left of the message module (domain model §2.5, §3 — one polymorphic
 * table): the key lookups other modules resolve people, DMs and messages by,
 * and the attachment upload URLs the composer still uses.
 *
 * The reads and writes — `list`, `get`, `send`, the edits, reactions,
 * resolutions, highlights and `remove` — went with the Convex topics (FOL-23).
 * Every conversation Peek draws is read from and written to the relay; the
 * `messages` table itself goes in REM-7.
 */
import { v } from 'convex/values'
import { mutation, type QueryCtx, type MutationCtx } from './_generated/server'
import { viewerOrThrow } from './users'
import type { Doc, Id } from './_generated/dataModel'

/** Resolve a person key (seedKey like 'alice', or a users _id) to the user. */
export async function resolveUserKey(
  ctx: QueryCtx | MutationCtx,
  key: string,
): Promise<Doc<'users'> | null> {
  const bySeed = await ctx.db
    .query('users')
    .withIndex('by_seedKey', (q) => q.eq('seedKey', key))
    .unique()
  if (bySeed) return bySeed
  const normalized = ctx.db.normalizeId('users', key)
  return normalized ? await ctx.db.get(normalized) : null
}

/**
 * The one canonical DM conversation for a pair of users (§2.4).
 *
 * DMs are addressed by the PARTNER's person key, never by a client-minted
 * conversation id: the pair is ordered canonically and looked up on
 * `by_pair`, so both people always land on the same row and no client can
 * name a conversation it isn't part of.
 */
export async function findDmForPair(
  ctx: QueryCtx | MutationCtx,
  aId: Id<'users'>,
  bId: Id<'users'>,
) {
  const [userLowId, userHighId] = (aId as string) < (bId as string) ? [aId, bId] : [bId, aId]
  return ctx.db
    .query('dmConversations')
    .withIndex('by_pair', (q) => q.eq('userLowId', userLowId).eq('userHighId', userHighId))
    .unique()
}

/** `key` is a topic/huddle seedKey-or-_id, or — for DMs — the partner's person key. */
export async function resolveParentId(
  ctx: QueryCtx | MutationCtx,
  kind: 'topic' | 'dm' | 'huddle',
  key: string,
  viewer: Id<'users'> | null,
): Promise<string | null> {
  if (kind === 'dm') {
    if (!viewer) return null
    const partner = await resolveUserKey(ctx, key)
    if (!partner) return null
    const dm = await findDmForPair(ctx, viewer, partner._id)
    return dm ? (dm._id as string) : null
  }
  const table = kind === 'topic' ? 'topics' : 'huddles'
  const rows = await ctx.db.query(table).collect()
  const hit = rows.find((r) => r.seedKey === key || (r._id as string) === key)
  return hit ? (hit._id as string) : null
}

/** Short-lived upload URL for a message/reply file attachment (viewer-gated,
 *  mirrors the avatar flow). The client POSTs the blob to it. */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await viewerOrThrow(ctx)
    return ctx.storage.generateUploadUrl()
  },
})

/** Drop an uploaded blob that never got attached (the composer removes a
 *  pending file before sending), so it doesn't orphan in storage. */
export const deleteUpload = mutation({
  args: { storageId: v.id('_storage') },
  handler: async (ctx, { storageId }) => {
    await viewerOrThrow(ctx)
    try {
      await ctx.storage.delete(storageId)
    } catch {
      // Already gone.
    }
  },
})

export async function findMessageByKey(
  ctx: QueryCtx | MutationCtx,
  key: string,
): Promise<Doc<'messages'> | null> {
  const bySeed = await ctx.db
    .query('messages')
    .withIndex('by_seedKey', (q) => q.eq('seedKey', key))
    .unique()
  if (bySeed) return bySeed
  const normalized = ctx.db.normalizeId('messages', key)
  return normalized ? await ctx.db.get(normalized) : null
}
