/**
 * Database access for the Nostr publish pipeline.
 *
 * Separate from `publish.ts` because that file runs in Convex's **Node** runtime
 * (`"use node"`, needed for signing) and Node-runtime files may only contain
 * actions. Queries and mutations have to live here.
 *
 * Everything is `internal*` — none of this is reachable from the client.
 */
import { v } from 'convex/values'
import { internalMutation, internalQuery } from '../_generated/server'
import type { Id } from '../_generated/dataModel'

/** A user's key material, or nulls when they have not been minted yet. */
export const getUserKeys = internalQuery({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => {
    const u = await ctx.db.get(userId)
    if (!u) return null
    return {
      name: u.name,
      role: u.role,
      nostrPubkey: u.nostrPubkey ?? null,
      nostrSecretKey: u.nostrSecretKey ?? null,
    }
  },
})

/**
 * Store a minted keypair, **first write wins**.
 *
 * Two concurrent publishes for the same user would otherwise mint two keypairs
 * and the user's events would split across two identities. Returns whatever is
 * effectively stored, so a loser of the race uses the winner's key rather than
 * its own. Mirrors how Buzz makes `set_agent_owner` atomic
 * (crates/buzz-db/src/user.rs:291).
 */
export const storeKeypair = internalMutation({
  args: {
    userId: v.id('users'),
    nostrPubkey: v.string(),
    nostrSecretKey: v.string(),
  },
  handler: async (ctx, { userId, nostrPubkey, nostrSecretKey }) => {
    const u = await ctx.db.get(userId)
    if (!u) throw new Error(`unknown user ${userId}`)
    if (u.nostrPubkey && u.nostrSecretKey) {
      return { nostrPubkey: u.nostrPubkey, nostrSecretKey: u.nostrSecretKey, minted: false }
    }
    await ctx.db.patch(userId, { nostrPubkey, nostrSecretKey })
    return { nostrPubkey, nostrSecretKey, minted: true }
  },
})

/** Topic plus the creator's id — the publish action needs both. */
export const getTopic = internalQuery({
  args: { topicId: v.id('topics') },
  handler: async (ctx, { topicId }) => {
    const t = await ctx.db.get(topicId)
    if (!t) return null
    return {
      title: t.title,
      creatorId: t.creatorId,
      createdAt: t.createdAt,
      channelUuid: t.channelUuid ?? null,
    }
  },
})

/** Assign a channel UUID, first write wins (same reasoning as `storeKeypair`). */
export const storeChannelUuid = internalMutation({
  args: { topicId: v.id('topics'), channelUuid: v.string() },
  handler: async (ctx, { topicId, channelUuid }) => {
    const t = await ctx.db.get(topicId)
    if (!t) throw new Error(`unknown topic ${topicId}`)
    if (t.channelUuid) return { channelUuid: t.channelUuid, minted: false }
    await ctx.db.patch(topicId, { channelUuid })
    return { channelUuid, minted: true }
  },
})

/** Everything needed to build one kind:9, in a single round trip. */
export const getMessageContext = internalQuery({
  args: { messageId: v.id('messages') },
  handler: async (ctx, { messageId }) => {
    const m = await ctx.db.get(messageId)
    if (!m) return null
    // Only topic messages publish in Stage 1: DMs need NIP-17 gift wrap, and
    // huddles have no Buzz container. See the plan's §6.3.
    if (m.parentKind !== 'topic') return null
    const topicId = ctx.db.normalizeId('topics', m.parentId)
    if (!topicId) return null
    const topic = await ctx.db.get(topicId)
    if (!topic) return null
    return {
      body: m.body,
      createdAt: m.createdAt,
      authorId: m.authorId,
      alreadyPublished: m.nostrEventId ?? null,
      topicId,
      channelUuid: topic.channelUuid ?? null,
    }
  },
})

export const markMessagePublished = internalMutation({
  args: { messageId: v.id('messages'), nostrEventId: v.string() },
  handler: async (ctx, { messageId, nostrEventId }) => {
    await ctx.db.patch(messageId, { nostrEventId, nostrPublishedAt: Date.now() })
  },
})

/** Topic members, for publishing kind:9000 membership events. */
export const getTopicMemberIds = internalQuery({
  args: { topicId: v.id('topics') },
  handler: async (ctx, { topicId }): Promise<Id<'users'>[]> => {
    const rows = await ctx.db
      .query('topicMembers')
      .withIndex('by_topic', (q) => q.eq('topicId', topicId))
      .collect()
    return rows.map((r) => r.userId)
  },
})
