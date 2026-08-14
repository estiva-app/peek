/**
 * Database access for the Nostr publish pipeline.
 *
 * Separate from `publish.ts` because that file runs in Convex's **Node** runtime
 * (`"use node"`, needed for signing) and Node-runtime files may only contain
 * actions. Queries and mutations have to live here.
 *
 * Almost everything is `internal*` — not reachable from the client. The one
 * exception is `folderForTopic` at the bottom, and it says why.
 */
import { v } from 'convex/values'
import { internalMutation, internalQuery, query } from '../_generated/server'
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
      // Resolved here rather than in the action, because this is the file
      // allowed to touch the database. A user with no uploaded avatar publishes
      // no `picture` at all — different from publishing an empty one, which
      // would have consumers render a broken image instead of their own
      // placeholder.
      avatarUrl: u.avatarStorageId ? ((await ctx.storage.getUrl(u.avatarStorageId)) ?? null) : null,
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
    // An existing pubkey is never overwritten — with or without a secret beside
    // it. The old test was `pubkey && secret`, which let a custodied mint land on
    // top of an identity Estiva ID holds and silently detach that person from
    // everything they had published. `identityFor` already refuses this case;
    // this is the backstop, because the damage is unrecoverable and invisible.
    if (u.nostrPubkey) {
      if (!u.nostrSecretKey) throw new Error(`refusing to mint over held identity for ${userId}`)
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
    if (t.channelUuid) {
      console.log(`[TRACE] storeChannelUuid: topicId=${topicId} already has channelUuid=${t.channelUuid}`)
      return { channelUuid: t.channelUuid, minted: false }
    }
    await ctx.db.patch(topicId, { channelUuid })
    console.log(`[TRACE] storeChannelUuid: persisted topicId=${topicId}, channelUuid=${channelUuid}`)
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

/** One syncable topic by client-facing key — the viewer-driven sync entry point. */
export const syncableTopicByKey = internalQuery({
  args: { topicKey: v.string() },
  handler: async (ctx, { topicKey }) => {
    const normalized = ctx.db.normalizeId('topics', topicKey)
    const rows = await ctx.db.query('topics').collect()
    const t = normalized
      ? rows.find((r) => (r._id as string) === (normalized as string))
      : rows.find((r) => r.seedKey === topicKey)
    if (!t?.channelUuid) return null
    return { topicId: t._id, channelUuid: t.channelUuid, since: t.nostrSyncedAt ?? null }
  },
})

/**
 * Human-readable list of which topic maps to which relay channel.
 *
 * Exists purely so you can find a channel id without squinting at
 * `npx convex data topics`:
 *
 *   npx convex run nostr/data:listChannels
 */
export const listChannels = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('topics').collect()
    return rows
      .map((t) => ({
        topic: t.title,
        channelUuid: t.channelUuid ?? '(not published yet — post a message in it)',
      }))
      .sort((a, b) => a.topic.localeCompare(b.topic))
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
 * `picture` is stored when published — it is the only face Peek will ever have
 * for someone who does not have a Peek account. Never mints key material —
 * Peek does not custody keys for people who are not its users.
 */
export const resolveExternalUser = internalMutation({
  args: {
    nostrPubkey: v.string(),
    displayName: v.optional(v.string()),
    /** kind:0 `picture` — an avatar URL chosen by whichever app published it. */
    picture: v.optional(v.string()),
  },
  handler: async (ctx, { nostrPubkey, displayName, picture }) => {
    const existing = await ctx.db
      .query('users')
      .withIndex('by_nostrPubkey', (q) => q.eq('nostrPubkey', nostrPubkey))
      .unique()
    if (existing) {
      // Adopt a real name and face once the relay learns them, but never
      // overwrite a Peek user's own profile with relay metadata: for a Peek
      // account this app is the source of truth and the relay is its output.
      if (existing.isExternal) {
        const patch: { name?: string; image?: string } = {}
        if (displayName && existing.name !== displayName) patch.name = displayName
        if (picture && existing.image !== picture) patch.image = picture
        if (Object.keys(patch).length) await ctx.db.patch(existing._id, patch)
      }
      return existing._id
    }
    return ctx.db.insert('users', {
      name: displayName || `nostr:${nostrPubkey.slice(0, 8)}`,
      image: picture,
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
    nostrReferences: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { topicId, authorId, body, createdAt, nostrEventId, nostrReferences }) => {
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
      nostrReferences,
    })
    return { inserted: true }
  },
})

// ── Replies (kind:9 + NIP-10) ───────────────────────────────────────────────

/**
 * Everything needed to publish one reply.
 *
 * A reply can only be published once its **parent message** has been — the
 * NIP-10 `e` tag needs the parent's event id, and Buzz rejects replies whose
 * parent it does not know ("unknown parents rejected", `NOSTR.md`).
 */
export const getReplyContext = internalQuery({
  args: { replyId: v.id('replies') },
  handler: async (ctx, { replyId }) => {
    const r = await ctx.db.get(replyId)
    if (!r) return null
    const parent = await ctx.db.get(r.messageId)
    if (!parent || parent.parentKind !== 'topic') return null
    const topicId = ctx.db.normalizeId('topics', parent.parentId)
    if (!topicId) return null
    const topic = await ctx.db.get(topicId)
    return {
      body: r.body,
      createdAt: r.createdAt,
      authorId: r.authorId,
      alreadyPublished: r.nostrEventId ?? null,
      parentEventId: parent.nostrEventId ?? null,
      channelUuid: topic?.channelUuid ?? null,
    }
  },
})

export const markReplyPublished = internalMutation({
  args: { replyId: v.id('replies'), nostrEventId: v.string() },
  handler: async (ctx, { replyId, nostrEventId }) => {
    await ctx.db.patch(replyId, { nostrEventId })
  },
})

/** Import a reply from the relay, keyed on its event id. */
export const importReply = internalMutation({
  args: {
    messageId: v.id('messages'),
    authorId: v.id('users'),
    body: v.string(),
    createdAt: v.number(),
    nostrEventId: v.string(),
    nostrReferences: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { messageId, authorId, body, createdAt, nostrEventId, nostrReferences }) => {
    const existing = await ctx.db
      .query('replies')
      .withIndex('by_nostrEventId', (q) => q.eq('nostrEventId', nostrEventId))
      .unique()
    if (existing) return { inserted: false }
    await ctx.db.insert('replies', {
      messageId,
      authorId,
      body,
      createdAt,
      seedKey: nostrEventId,
      nostrEventId,
      nostrReferences,
    })
    return { inserted: true }
  },
})

/**
 * Event ids of a topic's published messages — the targets to look for reactions
 * on.
 *
 * Reactions cannot be found the way messages are: kind:7 has no `h` tag, and it
 * has no `created_at` relationship to the message it targets, so a `since`
 * cursor over the channel does not reach them. They have to be queried by
 * target, which means knowing every message Peek has in the channel — not just
 * the ones that arrived in the current sync window.
 *
 * Newest first and capped, so a long-running channel does not build an
 * unbounded filter.
 */
export const listMessageEventIdsForTopic = internalQuery({
  args: { topicId: v.id('topics'), limit: v.number() },
  handler: async (ctx, { topicId, limit }) => {
    const rows = await ctx.db
      .query('messages')
      .withIndex('by_parent', (q) => q.eq('parentKind', 'topic').eq('parentId', topicId as string))
      .collect()
    return rows
      .filter((m) => m.nostrEventId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((m) => m.nostrEventId!)
  },
})

/**
 * Event ids of reactions Peek has already imported for a topic.
 *
 * Needed to spot **retractions**. A kind:5 targets the reaction event, and once
 * the relay has that deletion it stops returning the reaction itself — so asking
 * "are any of the reactions I just fetched deleted?" can never find one. The
 * question has to be "are any of the reactions I already hold deleted?".
 */
export const listReactionEventIdsForTopic = internalQuery({
  args: { topicId: v.id('topics'), limit: v.number() },
  handler: async (ctx, { topicId, limit }) => {
    const messages = await ctx.db
      .query('messages')
      .withIndex('by_parent', (q) => q.eq('parentKind', 'topic').eq('parentId', topicId as string))
      .collect()
    const out: string[] = []
    for (const m of messages) {
      const rows = await ctx.db
        .query('reactions')
        .withIndex('by_message', (q) => q.eq('messageId', m._id))
        .collect()
      for (const r of rows) {
        if (r.nostrEventId) out.push(r.nostrEventId)
        if (out.length >= limit) return out
      }
    }
    return out
  },
})

/** Local message for a relay event id — resolves a NIP-10 `e` tag to a parent. */
export const messageByNostrEventId = internalQuery({
  args: { nostrEventId: v.string() },
  handler: async (ctx, { nostrEventId }) => {
    const m = await ctx.db
      .query('messages')
      .withIndex('by_nostrEventId', (q) => q.eq('nostrEventId', nostrEventId))
      .unique()
    return m ? { messageId: m._id } : null
  },
})

// ── Reactions (kind:7 / kind:5) ─────────────────────────────────────────────

export const getReactionContext = internalQuery({
  args: { reactionId: v.id('reactions') },
  handler: async (ctx, { reactionId }) => {
    const r = await ctx.db.get(reactionId)
    if (!r) return null
    const target = await ctx.db.get(r.messageId)
    return {
      emoji: r.emoji,
      createdAt: r.createdAt,
      userId: r.userId,
      alreadyPublished: r.nostrEventId ?? null,
      targetEventId: target?.nostrEventId ?? null,
    }
  },
})

export const markReactionPublished = internalMutation({
  args: { reactionId: v.id('reactions'), nostrEventId: v.string() },
  handler: async (ctx, { reactionId, nostrEventId }) => {
    // The row may already be gone: un-reacting deletes it, and the publish is
    // async. Patching a deleted id throws, so check first.
    const r = await ctx.db.get(reactionId)
    if (r) await ctx.db.patch(reactionId, { nostrEventId })
  },
})

/** Import a reaction from the relay. Idempotent on the kind:7 event id. */
export const importReaction = internalMutation({
  args: {
    messageId: v.id('messages'),
    userId: v.id('users'),
    emoji: v.string(),
    createdAt: v.number(),
    nostrEventId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('reactions')
      .withIndex('by_nostrEventId', (q) => q.eq('nostrEventId', args.nostrEventId))
      .unique()
    if (existing) return { inserted: false }
    await ctx.db.insert('reactions', args)
    return { inserted: true }
  },
})

/** Apply a kind:5 deletion of a reaction that was imported earlier. */
export const removeReactionByNostrEventId = internalMutation({
  args: { nostrEventId: v.string() },
  handler: async (ctx, { nostrEventId }) => {
    const r = await ctx.db
      .query('reactions')
      .withIndex('by_nostrEventId', (q) => q.eq('nostrEventId', nostrEventId))
      .unique()
    if (r) await ctx.db.delete(r._id)
    return { deleted: r !== null }
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

/**
 * The Folder id for a topic — its NIP-29 channel UUID.
 *
 * **Public**, unlike everything else in this file, because it is the one piece
 * of Nostr plumbing a user has a reason to hold: it is what pairs this topic
 * with another app's view of the same thing. Linear-lite pastes it and its
 * issues land in this topic's channel, carrying the same `h` as the messages
 * (RFC_UPDATES.md §1.1 — one container, many projections).
 *
 * Safe to expose: a channel UUID is an identifier, not a credential. Reading
 * anything in the channel still goes through the relay's own membership and
 * visibility checks.
 *
 * `null` for topics created before Nostr emission was wired up, which is why
 * the caller has to treat "no Folder" as an ordinary state rather than an error.
 */
export const folderForTopic = query({
  args: { topicKey: v.string() },
  handler: async (ctx, { topicKey }) => {
    console.log(`[TRACE] folderForTopic: called with topicKey=${topicKey}`)
    // `topicKey` is the client-facing id: the stable seedKey where a topic has
    // one, otherwise the Convex `_id` (convex/schema.ts). Seeded topics carry a
    // seedKey, so taking a `v.id('topics')` here would reject exactly the
    // topics the demo uses.
    const normalized = ctx.db.normalizeId('topics', topicKey)
    console.log(`[TRACE] folderForTopic: normalized=${normalized}`)
    if (normalized) {
      const doc = await ctx.db.get(normalized)
      console.log(`[TRACE] folderForTopic: doc found=${!!doc}, doc.channelUuid=${doc?.channelUuid}`)
      if (doc) return doc.channelUuid ?? null
    }
    // No seedKey index on `topics`, so this mirrors `findTopicByKey` in
    // convex/topics.ts: collect and scan. Topics are few and this is the
    // fallback path only.
    const rows = await ctx.db.query('topics').collect()
    const found = rows.find((t) => t.seedKey === topicKey)
    console.log(`[TRACE] folderForTopic: fallback found=${!!found}, found.channelUuid=${found?.channelUuid}`)
    return found?.channelUuid ?? null
  },
})
