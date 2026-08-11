/**
 * Reply reads + writes (domain model §2.6).
 *
 * Shape mirrors convex/messages.ts: ids are stable seedKeys where present
 * (see convex/schema.ts); rows carry real author names plus authorId - the
 * client seam renders the viewer's own rows as 'You' (Phase 3).
 */
import { v } from 'convex/values'
import { mutation, query, type QueryCtx, type MutationCtx } from './_generated/server'
import { internal } from './_generated/api'
import { highlightType, fileAttachment } from './schema'
import { viewerId, viewerOrThrow } from './users'
import { watermarks } from './readState'
import { isUrgentBody, screenReply } from './screener'
import { resolveFileAttachments, deleteAttachmentBlobs, userFaces } from './messages'
import { ensureTopicMember } from './topics'
import type { Doc } from './_generated/dataModel'

async function findMessageByKey(ctx: QueryCtx | MutationCtx, key: string): Promise<Doc<'messages'> | null> {
  const bySeed = await ctx.db
    .query('messages')
    .withIndex('by_seedKey', (q) => q.eq('seedKey', key))
    .unique()
  if (bySeed) return bySeed
  const normalized = ctx.db.normalizeId('messages', key)
  return normalized ? await ctx.db.get(normalized) : null
}

// The local name-only copy of this is gone (PEEK-43): a reply renders the same
// author chip a message does, so both resolve faces from the same place.

/** All replies of a message, oldest first. `messageKey` is a seedKey or _id. */
export const list = query({
  args: { messageKey: v.string() },
  handler: async (ctx, { messageKey }) => {
    const message = await findMessageByKey(ctx, messageKey)
    if (!message) return []
    const rows = await ctx.db
      .query('replies')
      .withIndex('by_message', (q) => q.eq('messageId', message._id))
      .collect()
    const faces = await userFaces(ctx)
    // isNew is derived from YOUR thread watermark for this message (§4.3) —
    // set when you open its thread panel, not when you open the container.
    const me = await viewerId(ctx)
    const threadWm = me ? (await watermarks(ctx, me)).get(message._id as string) : undefined
    const sorted = rows.sort((a, b) => a.createdAt - b.createdAt)
    const out = []
    for (const r of sorted) {
      out.push({
        id: r.seedKey ?? (r._id as string),
        authorId: r.authorId as string,
        authorName: faces.get(r.authorId)?.name ?? 'Unknown',
        authorAvatarUrl: faces.get(r.authorId)?.avatarUrl,
        createdAt: r.createdAt,
        body: r.body,
        isUrgent: r.urgent,
        highlightType: r.highlightType,
        attachments: r.attachments,
        files: await resolveFileAttachments(ctx, r.fileAttachments),
        isNew:
          me && r.authorId !== me && (threadWm === undefined || r.createdAt > threadWm)
            ? true
            : undefined,
      })
    }
    return out
  },
})

export const send = mutation({
  args: {
    messageKey: v.string(),
    /** Client-generated id — the optimistic local copy and this record are the same reply. */
    seedKey: v.string(),
    body: v.string(),
    highlightType: v.optional(highlightType),
    attachments: v.optional(v.array(v.string())),
    fileAttachments: v.optional(v.array(fileAttachment)),
  },
  handler: async (ctx, { messageKey, seedKey, body, highlightType, attachments, fileAttachments }) => {
    const message = await findMessageByKey(ctx, messageKey)
    if (!message) throw new Error(`Unknown message '${messageKey}'`)
    const you = await viewerOrThrow(ctx)
    const id = await ctx.db.insert('replies', {
      messageId: message._id,
      authorId: you._id,
      body,
      createdAt: Date.now(),
      urgent: isUrgentBody(body) || undefined,
      highlightType,
      attachments,
      fileAttachments,
      seedKey,
    })
    // Replying in a topic thread makes you a member too (QA #2.6).
    if (message.parentKind === 'topic') {
      const topicId = ctx.db.normalizeId('topics', message.parentId)
      if (topicId) await ensureTopicMember(ctx, topicId, you._id)
    }
    const inserted = await ctx.db.get(id)
    if (inserted) await screenReply(ctx, inserted)
    // Publish as a kind:9 with a NIP-10 `e` tag (docs/buzz-compat/). No-op
    // unless NOSTR_RELAY_URL is set; skipped if the parent isn't on the relay.
    await ctx.scheduler.runAfter(0, internal.nostr.publish.publishReply, { replyId: id })
    return id
  },
})

export const remove = mutation({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const bySeed = await ctx.db
      .query('replies')
      .withIndex('by_seedKey', (q) => q.eq('seedKey', key))
      .unique()
    const normalized = bySeed ? null : ctx.db.normalizeId('replies', key)
    const r = bySeed ?? (normalized ? await ctx.db.get(normalized) : null)
    if (r) {
      await deleteAttachmentBlobs(ctx, r.fileAttachments)
      await ctx.db.delete(r._id)
    }
  },
})
