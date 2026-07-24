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

// ── Read path (Stage 2): projecting relay events back into Convex ───────────

/** Every topic that has a channel on the relay, with its sync cursor. */
export const listSyncableTopics = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('topics').collect()
    return rows
      .filter((t) => t.channelUuid)
      .map((t) => ({
        topicId: t._id,
        channelUuid: t.channelUuid!,
        since: t.nostrSyncedAt ?? null,
      }))
  },
})

/** Peek users that can sign — the read path borrows one to authenticate. */
export const listLocalUsersWithKeys = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('users').collect()
    return rows
      .filter((u) => u.nostrPubkey && u.nostrSecretKey && !u.isExternal)
      .map((u) => ({ nostrPubkey: u.nostrPubkey!, nostrSecretKey: u.nostrSecretKey! }))
  },
})

/** Pubkeys belonging to Peek's own users — everything else is foreign. */
export const listLocalPubkeys = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('users').collect()
    return rows.filter((u) => u.nostrPubkey && !u.isExternal).map((u) => u.nostrPubkey!)
  },
})

/**
 * Resolve a relay pubkey to a Peek user, creating an external placeholder if
 * this is someone Peek has never seen.
 *
 * `name` is required on `users`, so a display name is always written: the
 * kind:0 `display_name` when the relay has one, otherwise a truncated pubkey.
 * Never mints key material — Peek does not custody keys for people who are not
 * its users.
 */
export const resolveExternalUser = internalMutation({
  args: { nostrPubkey: v.string(), displayName: v.optional(v.string()) },
  handler: async (ctx, { nostrPubkey, displayName }) => {
    const existing = await ctx.db
      .query('users')
      .withIndex('by_nostrPubkey', (q) => q.eq('nostrPubkey', nostrPubkey))
      .unique()
    if (existing) {
      // Adopt a real name once the relay learns one, but never overwrite a
      // Peek user's own name with relay metadata.
      if (displayName && existing.isExternal && existing.name !== displayName) {
        await ctx.db.patch(existing._id, { name: displayName })
      }
      return existing._id
    }
    return ctx.db.insert('users', {
      name: displayName || `nostr:${nostrPubkey.slice(0, 8)}`,
      nostrPubkey,
      isExternal: true,
    })
  },
})

/**
 * Insert a message projected from the relay, keyed on its Nostr event id.
 *
 * Idempotent: the event id is the hash of the event's own content, so the same
 * event can never produce two rows no matter how often it is polled.
 */
export const importMessage = internalMutation({
  args: {
    topicId: v.id('topics'),
    authorId: v.id('users'),
    body: v.string(),
    createdAt: v.number(),
    nostrEventId: v.string(),
  },
  handler: async (ctx, { topicId, authorId, body, createdAt, nostrEventId }) => {
    const existing = await ctx.db
      .query('messages')
      .withIndex('by_nostrEventId', (q) => q.eq('nostrEventId', nostrEventId))
      .unique()
    if (existing) return { inserted: false }
    await ctx.db.insert('messages', {
      parentKind: 'topic',
      parentId: topicId as string,
      authorId,
      body,
      createdAt,
      // The event id doubles as the stable client key, so the seam's id
      // contract holds for imported rows exactly as it does for Peek's own.
      seedKey: nostrEventId,
      nostrEventId,
      nostrPublishedAt: Date.now(),
    })
    return { inserted: true }
  },
})

export const setTopicSyncCursor = internalMutation({
  args: { topicId: v.id('topics'), nostrSyncedAt: v.number() },
  handler: async (ctx, { topicId, nostrSyncedAt }) => {
    const t = await ctx.db.get(topicId)
    // Only ever move forward, so an out-of-order run cannot rewind the cursor
    // and re-import everything.
    if (t && (t.nostrSyncedAt ?? 0) < nostrSyncedAt) {
      await ctx.db.patch(topicId, { nostrSyncedAt })
    }
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
