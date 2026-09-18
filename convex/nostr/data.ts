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
import type { QueryCtx } from '../_generated/server'
import type { Id } from '../_generated/dataModel'
import { containerKind as containerKindArg, fileAttachment } from '../schema'
import { applyResolutionProjection, deleteAttachmentBlobs, resolveParentId } from '../messages'

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
      return { channelUuid: t.channelUuid, minted: false }
    }
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

/**
 * What a container is, to everything that reads a channel off the relay.
 *
 * `parentKind`/`parentId` is the pair `messages` is already keyed by
 * (`convex/schema.ts` §2.5), so every query below addresses a DM's messages
 * with the index it already uses for a topic's. Nothing downstream of this
 * needs to know which kind it got.
 */
export interface SyncableContainer {
  parentKind: 'topic' | 'dm'
  parentId: string
  channelUuid: string
  since: number | null
  /** What the last run recorded, so `importChannel` writes only on change. */
  reactionTargetsOmitted: number
}

/**
 * One syncable container by client-facing key — the viewer-driven sync entry
 * point, for a topic or a DM (DMS-5).
 *
 * A plain function rather than only an `internalQuery`, because both the public
 * `syncPlan` and the internal lookup the import actions use must answer
 * identically: two implementations of "which channel is this" is exactly how a
 * backfill and a live flush end up projecting into different containers.
 *
 * **`viewer` is the privacy gate, not a convenience.** `resolveParentId` looks a
 * DM up by the *pair* — the viewer and the partner the key names — so a signed-in
 * person can only ever name a conversation they are in. Passing the key straight
 * to `ctx.db.get` would let anyone who could guess a `dmConversations` id learn
 * its channel uuid, which is the one thing needed to ask the relay for it.
 *
 * A topic resolves by seedKey-or-`_id` exactly as before; `resolveParentId`
 * scans, because `topics` has no seedKey index.
 */
export async function syncableContainer(
  ctx: QueryCtx,
  parentKind: 'topic' | 'dm',
  containerKey: string,
  viewer: Id<'users'> | null,
): Promise<SyncableContainer | null> {
  const parentId = await resolveParentId(ctx, parentKind, containerKey, viewer)
  if (!parentId) return null
  const row =
    parentKind === 'topic'
      ? await ctx.db.get(parentId as Id<'topics'>)
      : await ctx.db.get(parentId as Id<'dmConversations'>)
  // No channel on the relay yet. A topic predating Nostr emission never gets
  // one; a DM gets one on its first render or first message (DMS-3), so this is
  // a wait rather than a dead end. Absent `reactionTargetsOmitted` reads as 0 —
  // a never-synced container omitted nothing.
  if (!row?.channelUuid) return null
  return {
    parentKind,
    parentId,
    channelUuid: row.channelUuid,
    since: row.nostrSyncedAt ?? null,
    reactionTargetsOmitted: row.reactionTargetsOmitted ?? 0,
  }
}

export const syncableContainerByKey = internalQuery({
  args: { containerKind: containerKindArg, containerKey: v.string(), viewerId: v.id('users') },
  handler: async (ctx, { containerKind, containerKey, viewerId }) =>
    syncableContainer(ctx, containerKind, containerKey, viewerId),
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
      // The relay's `kind:0` is the profile, and this row is Peek's cache of it
      // (PEEK-42). Estiva ID is its sole publisher (PEEK-31) and the only place
      // a name or a picture is edited (`api/profile.ts`), so whatever it says
      // now replaces whatever Peek held.
      //
      // The name used to be guarded — patched only for an `isExternal` row or a
      // `nostr:<8 chars>` placeholder, "so a name someone typed into Peek still
      // wins". Nobody can type one into Peek any more, and the guard's real
      // effect was that a rename in Estiva ID never reached anyone who had
      // signed in here: their author line, and every `nostr:npub…` mention of
      // them, kept the old name for ever while Ship — which reads `kind:0`
      // straight from the relay — showed the new one (RIC-2). A mention that
      // names a key is only an improvement on one that names a display name if
      // the key resolves to the *current* name, so the name now follows the
      // relay exactly as the picture already did.
      const patch: { name?: string; image?: string } = {}
      if (displayName && displayName !== existing.name) {
        patch.name = displayName
      }
      // Nothing outranks the relay now (PEEK-42). This used to skip anyone with
      // a Convex-stored avatar, because Peek's own upload won — which is exactly
      // the shadowing that ticket removed. `image` is only ever the relay's
      // copy, so replacing it loses nothing.
      if (picture && picture !== existing.image) {
        patch.image = picture
      }
      if (Object.keys(patch).length) await ctx.db.patch(existing._id, patch)
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
    /**
     * The container, as `messages` is keyed — a topic or a DM (DMS-5). The row
     * written is identical either way; only this pair differs, which is the
     * whole of what "one projection, two container types" means here.
     */
    parentKind: containerKindArg,
    parentId: v.string(),
    authorId: v.id('users'),
    body: v.string(),
    createdAt: v.number(),
    nostrEventId: v.string(),
    nostrReferences: v.optional(v.array(v.string())),
    nostrBlockId: v.optional(v.string()),
    /** The sender's `imeta`, as rows — CON-12. No Convex blob behind them. */
    files: v.optional(v.array(fileAttachment)),
  },
  handler: async (ctx, { parentKind, parentId, authorId, body, createdAt, nostrEventId, nostrReferences, nostrBlockId, files }) => {
    const existing = await ctx.db
      .query('messages')
      .withIndex('by_nostrEventId', (q) => q.eq('nostrEventId', nostrEventId))
      .unique()
    if (existing) return { inserted: false }
    await ctx.db.insert('messages', {
      parentKind,
      parentId,
      authorId,
      body,
      createdAt,
      // The event id doubles as the stable client key, so the seam's id
      // contract holds for imported rows exactly as it does for Peek's own.
      seedKey: nostrEventId,
      nostrEventId,
      nostrPublishedAt: Date.now(),
      nostrReferences,
      nostrBlockId,
      fileAttachments: files,
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
    /** The sender's `imeta`, as rows — CON-12. No Convex blob behind them. */
    files: v.optional(v.array(fileAttachment)),
  },
  handler: async (ctx, { messageId, authorId, body, createdAt, nostrEventId, nostrReferences, files }) => {
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
      fileAttachments: files,
    })
    return { inserted: true }
  },
})

/**
 * Event ids of a container's published messages — the targets to look for
 * reactions on. A topic and a DM answer through the same `by_parent` index.
 *
 * Reactions cannot be found the way messages are: kind:7 has no `h` tag, and it
 * has no `created_at` relationship to the message it targets, so a `since`
 * cursor over the channel does not reach them. They have to be queried by
 * target, which means knowing every message Peek has in the channel — not just
 * the ones that arrived in the current sync window.
 *
 * Newest first and capped, so a long-running channel does not build an
 * unbounded filter. `total` is how many there were before the cap — the rows
 * are all read anyway, and the caller reports what the horizon left out
 * (PEE-21), which the capped list alone cannot say.
 */
export const listMessageEventIdsForContainer = internalQuery({
  args: { parentKind: containerKindArg, parentId: v.string(), limit: v.number() },
  handler: async (ctx, { parentKind, parentId, limit }): Promise<{ ids: string[]; total: number }> => {
    const rows = await ctx.db
      .query('messages')
      .withIndex('by_parent', (q) => q.eq('parentKind', parentKind).eq('parentId', parentId))
      .collect()
    const published = rows.filter((m) => m.nostrEventId).sort((a, b) => b.createdAt - a.createdAt)
    return { ids: published.slice(0, limit).map((m) => m.nostrEventId!), total: published.length }
  },
})

/**
 * Event ids of reactions Peek has already imported for a container.
 *
 * Needed to spot **retractions**. A kind:5 targets the reaction event, and once
 * the relay has that deletion it stops returning the reaction itself — so asking
 * "are any of the reactions I just fetched deleted?" can never find one. The
 * question has to be "are any of the reactions I already hold deleted?".
 */
export const listReactionEventIdsForContainer = internalQuery({
  args: { parentKind: containerKindArg, parentId: v.string(), limit: v.number() },
  handler: async (ctx, { parentKind, parentId, limit }) => {
    const messages = await ctx.db
      .query('messages')
      .withIndex('by_parent', (q) => q.eq('parentKind', parentKind).eq('parentId', parentId))
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

/**
 * Event ids of the messages and replies Peek holds for a container.
 *
 * The set to ask "have any of these been deleted?" about. Same reasoning as
 * `listReactionEventIdsForTopic`, and the same trap: once the relay holds a
 * kind:5 it stops returning the target, so asking about the events just fetched
 * could never find a deletion. The question has to be about what Peek already
 * holds.
 *
 * Everyone's events, not just foreign ones. Peek's own rows are removed locally
 * at the moment of deletion, so a kind:5 for one is a no-op here — but a
 * deletion published from another device by the same person is not, and
 * filtering by author would drop exactly that case.
 */
export const listDeletableEventIdsForContainer = internalQuery({
  args: { parentKind: containerKindArg, parentId: v.string(), limit: v.number() },
  handler: async (ctx, { parentKind, parentId, limit }) => {
    const messages = await ctx.db
      .query('messages')
      .withIndex('by_parent', (q) => q.eq('parentKind', parentKind).eq('parentId', parentId))
      .collect()
    const out: string[] = []
    for (const m of messages.sort((a, b) => b.createdAt - a.createdAt)) {
      if (m.nostrEventId) out.push(m.nostrEventId)
      if (out.length >= limit) return out
      const replies = await ctx.db
        .query('replies')
        .withIndex('by_message', (q) => q.eq('messageId', m._id))
        .collect()
      for (const r of replies) {
        if (r.nostrEventId) out.push(r.nostrEventId)
        if (out.length >= limit) return out
      }
    }
    return out
  },
})

/**
 * Apply a kind:5 to a message or reply Peek holds (PEEK-113).
 *
 * The relay already enforces that a kind:5 may only delete its own author's
 * event, so anything reaching here is legitimate. Re-checking authorship
 * locally is not possible anyway — the target may no longer be fetchable.
 *
 * A message takes its replies, reactions and attachment blobs with it, matching
 * what `messages.remove` does locally. **Nothing is published**: this is the
 * import side, and publishing a deletion for an event that was already deleted
 * elsewhere would be an echo.
 */
export const removeByNostrEventId = internalMutation({
  args: { nostrEventId: v.string() },
  handler: async (ctx, { nostrEventId }): Promise<{ removed: 'message' | 'reply' | null }> => {
    const message = await ctx.db
      .query('messages')
      .withIndex('by_nostrEventId', (q) => q.eq('nostrEventId', nostrEventId))
      .unique()
    if (message) {
      const replies = await ctx.db
        .query('replies')
        .withIndex('by_message', (q) => q.eq('messageId', message._id))
        .collect()
      for (const r of replies) {
        await deleteAttachmentBlobs(ctx, r.fileAttachments)
        await ctx.db.delete(r._id)
      }
      const reactions = await ctx.db
        .query('reactions')
        .withIndex('by_message', (q) => q.eq('messageId', message._id))
        .collect()
      for (const r of reactions) await ctx.db.delete(r._id)
      await deleteAttachmentBlobs(ctx, message.fileAttachments)
      await ctx.db.delete(message._id)
      return { removed: 'message' }
    }

    const reply = await ctx.db
      .query('replies')
      .withIndex('by_nostrEventId', (q) => q.eq('nostrEventId', nostrEventId))
      .unique()
    if (reply) {
      await deleteAttachmentBlobs(ctx, reply.fileAttachments)
      await ctx.db.delete(reply._id)
      return { removed: 'reply' }
    }
    return { removed: null }
  },
})

/**
 * Newest reply event ids in a container — reaction targets too (PEE-12). Same
 * shape as `listMessageEventIdsForContainer`: capped ids plus the true total.
 */
export const listReplyEventIdsForContainer = internalQuery({
  args: { parentKind: containerKindArg, parentId: v.string(), limit: v.number() },
  handler: async (ctx, { parentKind, parentId, limit }): Promise<{ ids: string[]; total: number }> => {
    const messages = await ctx.db
      .query('messages')
      .withIndex('by_parent', (q) => q.eq('parentKind', parentKind).eq('parentId', parentId))
      .collect()
    const out: { createdAt: number; id: string }[] = []
    for (const m of messages) {
      const replies = await ctx.db
        .query('replies')
        .withIndex('by_message', (q) => q.eq('messageId', m._id))
        .collect()
      for (const r of replies) {
        if (r.nostrEventId) out.push({ createdAt: r.createdAt, id: r.nostrEventId })
      }
    }
    out.sort((a, b) => b.createdAt - a.createdAt)
    return { ids: out.slice(0, limit).map((r) => r.id), total: out.length }
  },
})

/** Local reply for a relay event id — a kind:7 may target a reply (PEE-12). */
export const replyByNostrEventId = internalQuery({
  args: { nostrEventId: v.string() },
  handler: async (ctx, { nostrEventId }) => {
    const r = await ctx.db
      .query('replies')
      .withIndex('by_nostrEventId', (q) => q.eq('nostrEventId', nostrEventId))
      .unique()
    return r ? { messageId: r.messageId, replyId: r._id } : null
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

/**
 * Apply an edit that arrived from the relay — CON-8.
 *
 * Addressed by the TARGET's event id, which is stable: an edit is a new event
 * and never mutates what it edits, so the original keeps its id and the replies
 * pointing at it survive.
 *
 * **Older edits are ignored rather than applied.** A sync run may re-read an
 * edit it has already applied (`since` is inclusive), and a run that reaches
 * further back may see an *older* one for the same message. Comparing
 * `editedAt` makes both cases no-ops instead of a body that flickers between
 * two versions depending on which window the poll happened to fetch.
 *
 * Silent when the target is unknown: the message may simply not be Peek's, or
 * may arrive in a later run. `importMessage` is idempotent, so nothing is lost
 * — the next run that carries both applies the edit.
 */
export const applyEdit = internalMutation({
  args: {
    /** The event being edited, not the edit. */
    nostrEventId: v.string(),
    body: v.string(),
    /** Milliseconds — `ts` where the relay's own `created_at` agrees with it. */
    editedAt: v.number(),
  },
  handler: async (ctx, { nostrEventId, body, editedAt }) => {
    const message = await ctx.db
      .query('messages')
      .withIndex('by_nostrEventId', (q) => q.eq('nostrEventId', nostrEventId))
      .unique()
    if (message) {
      if ((message.editedAt ?? 0) >= editedAt) return { applied: false }
      await ctx.db.patch(message._id, { body, editedAt })
      return { applied: true }
    }

    const reply = await ctx.db
      .query('replies')
      .withIndex('by_nostrEventId', (q) => q.eq('nostrEventId', nostrEventId))
      .unique()
    if (!reply) return { applied: false }
    if ((reply.editedAt ?? 0) >= editedAt) return { applied: false }
    await ctx.db.patch(reply._id, { body, editedAt })
    return { applied: true }
  },
})

/** Import a reaction from the relay. Idempotent on the kind:7 event id. */
export const importReaction = internalMutation({
  args: {
    messageId: v.id('messages'),
    replyId: v.optional(v.id('replies')),
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

    /*
      The same reaction, made HERE, before it was published.

      `toggleReaction` inserts the row and the browser publishes afterwards,
      patching `nostrEventId` in on acceptance — so between those two moments,
      and permanently whenever the publish never records, Peek holds a row for
      this reaction with no event id. Inserting again would show the person
      reacting to their own message twice.

      This is what the old `!isLocal.has(pubkey)` filter in `syncReactions` was
      really guarding, and it guarded it far too widely: it skipped every
      reaction by anybody with a Peek account, so a reaction made in Ship could
      never come back. Reconciling on the row instead is narrow and does the
      job the filter was standing in for.
    */
    const unpublished = (
      await ctx.db
        .query('reactions')
        .withIndex('by_message_user', (q) => q.eq('messageId', args.messageId).eq('userId', args.userId))
        .collect()
    ).find(
      (r) =>
        r.emoji === args.emoji &&
        (r.replyId ?? null) === (args.replyId ?? null) &&
        !r.nostrEventId,
    )
    if (unpublished) {
      await ctx.db.patch(unpublished._id, { nostrEventId: args.nostrEventId })
      return { inserted: false, adopted: true }
    }

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

/**
 * The container row a sync writes its bookkeeping back to.
 *
 * One line, so that "which table" is decided in exactly one place. A `dm` and a
 * `topic` carry the same two fields for the same reason (`convex/schema.ts`),
 * and the mutations below do not branch on anything else.
 */
const containerRow = (ctx: { db: { get: (id: any) => any } }, parentKind: 'topic' | 'dm', parentId: string) =>
  ctx.db.get(parentKind === 'topic' ? (parentId as Id<'topics'>) : (parentId as Id<'dmConversations'>))

export const setContainerSyncCursor = internalMutation({
  args: { parentKind: containerKindArg, parentId: v.string(), nostrSyncedAt: v.number() },
  handler: async (ctx, { parentKind, parentId, nostrSyncedAt }) => {
    const row = await containerRow(ctx, parentKind, parentId)
    // Only ever move forward, so an out-of-order run cannot rewind the cursor
    // and re-import everything.
    if (row && (row.nostrSyncedAt ?? 0) < nostrSyncedAt) {
      await ctx.db.patch(row._id, { nostrSyncedAt })
    }
  },
})

/**
 * Record how many reaction targets the last sync left past the horizon
 * (PEE-21), so the view can say so — see `reactionTargetsOmitted` on `topics`
 * and, since DMS-5, on `dmConversations`.
 *
 * Unlike the cursor above this may go down: a deleted message brings the
 * count back under the cap, and the caption should go with it.
 */
export const setReactionTargetsOmitted = internalMutation({
  args: { parentKind: containerKindArg, parentId: v.string(), omitted: v.number() },
  handler: async (ctx, { parentKind, parentId, omitted }) => {
    const row = await containerRow(ctx, parentKind, parentId)
    if (row && (row.reactionTargetsOmitted ?? 0) !== omitted) {
      await ctx.db.patch(row._id, { reactionTargetsOmitted: omitted })
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
    // `topicKey` is the client-facing id: the stable seedKey where a topic has
    // one, otherwise the Convex `_id` (convex/schema.ts). Seeded topics carry a
    // seedKey, so taking a `v.id('topics')` here would reject exactly the
    // topics the demo uses.
    const normalized = ctx.db.normalizeId('topics', topicKey)
    if (normalized) {
      const doc = await ctx.db.get(normalized)
      if (doc) return doc.channelUuid ?? null
    }
    // No seedKey index on `topics`, so this mirrors `findTopicByKey` in
    // convex/topics.ts: collect and scan. Topics are few and this is the
    // fallback path only.
    const rows = await ctx.db.query('topics').collect()
    const found = rows.find((t) => t.seedKey === topicKey)
    return found?.channelUuid ?? null
  },
})

/**
 * Project a resolution assertion that arrived from the relay (PEEK-128).
 *
 * Idempotent on the event id, like `importMessage`: the id is a hash of the
 * event's own content, so re-polling can never produce a second row. That
 * matters more here than elsewhere — a duplicated assertion would not just
 * clutter the history, it would fold identically and mask a genuine repeat.
 *
 * **Trust is decided here, once, and stored** (decision 4). An assertion whose
 * author has no Peek account (`isExternal`) is recorded and renderable but is
 * not allowed to move Peek's own resolved state. Judging it at write time
 * rather than at read time is deliberate: re-judging later against changed
 * membership would silently rewrite what the history says happened.
 */
export const importResolution = internalMutation({
  args: {
    nostrEventId: v.string(),
    targetEventId: v.string(),
    authorId: v.id('users'),
    authorPubkey: v.string(),
    action: v.union(v.literal('resolved'), v.literal('reopened')),
    createdAtMs: v.number(),
    rationale: v.optional(v.string()),
    supportingEventId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ imported: boolean; messageId?: Id<'messages'> }> => {
    const existing = await ctx.db
      .query('resolutionAssertions')
      .withIndex('by_nostrEventId', (q) => q.eq('nostrEventId', args.nostrEventId))
      .unique()
    if (existing) return { imported: false, messageId: existing.messageId }

    const target = await ctx.db
      .query('messages')
      .withIndex('by_nostrEventId', (q) => q.eq('nostrEventId', args.targetEventId))
      .unique()
    // An assertion about a message Peek has not imported is dropped rather than
    // parked: the next sync brings both, and a row pointing at nothing cannot
    // be folded or rendered.
    if (!target) return { imported: false }

    const author = await ctx.db.get(args.authorId)
    const supporting = args.supportingEventId
      ? await ctx.db
          .query('replies')
          .withIndex('by_nostrEventId', (q) => q.eq('nostrEventId', args.supportingEventId))
          .unique()
      : null

    await ctx.db.insert('resolutionAssertions', {
      messageId: target._id,
      action: args.action,
      authorId: args.authorId,
      authorPubkey: args.authorPubkey,
      createdAt: args.createdAtMs,
      rationale: args.rationale,
      supportingReplyId: supporting?._id,
      trusted: !author?.isExternal,
      nostrEventId: args.nostrEventId,
    })
    return { imported: true, messageId: target._id }
  },
})

/** Re-fold a message's projection after assertions arrived from the relay. */
export const refoldResolution = internalMutation({
  args: { messageId: v.id('messages') },
  handler: async (ctx, { messageId }) => {
    await applyResolutionProjection(ctx, messageId)
  },
})
