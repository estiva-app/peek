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
import { foldReactionRows, resolveFileAttachments, deleteAttachmentBlobs, refuseReadOnlyWrite, userFaces, type RemoveOutcome } from './messages'
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
    // Reply reactions live on the parent's index, keyed by replyId (PEE-12).
    // One collect for the whole thread, folded per reply below — this is what
    // makes a reaction on a reply survive a reload.
    const reactionRows = await ctx.db
      .query('reactions')
      .withIndex('by_message', (q) => q.eq('messageId', message._id))
      .collect()
    const reactionsByReply = new Map<string, typeof reactionRows>()
    for (const r of reactionRows) {
      if (!r.replyId) continue
      const key = r.replyId as string
      reactionsByReply.set(key, [...(reactionsByReply.get(key) ?? []), r])
    }
    const sorted = rows.sort((a, b) => a.createdAt - b.createdAt)
    const out = []
    for (const r of sorted) {
      out.push({
        reactions: foldReactionRows(reactionsByReply.get(r._id as string) ?? [], me ?? undefined, faces),
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
        nostrReferences: r.nostrReferences,
        // The event id, so a reply can be linked to (PEE-17). Recorded on
        // publish since RIC-2 and never returned until now — a message had no
        // URL, so nothing had asked for it.
        nostrEventId: r.nostrEventId,
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
    refuseReadOnlyWrite(message)
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
    const inserted = await ctx.db.get(id)
    if (inserted) await screenReply(ctx, inserted)
    // Published by the browser after this returns (see `messages.send`).
    return id
  },
})

/**
 * Delete a reply, returning its relay event id so the browser can tombstone it
 * (see `messages.remove` for why the id comes back from the mutation and why
 * only the viewer's own event qualifies).
 */
/**
 * Delete a reply — or ask the relay whether you may.
 *
 * **The same hole `messages.remove` had**, and PEE-18 named only that one. It
 * read the viewer to decide what to tombstone and never to decide whether the
 * delete could happen, so any authenticated caller could remove anybody's reply
 * from Peek while the relay's copy survived. Fixing one and leaving this would
 * have read as a complete fix and been half of one.
 *
 * Same two paths and the same reasoning as `messages.remove` — see its comment
 * for why author-only would reproduce SHI-14 inside Peek's backend.
 */
export const remove = mutation({
  args: { key: v.string() },
  handler: async (ctx, { key }): Promise<RemoveOutcome> => {
    const bySeed = await ctx.db
      .query('replies')
      .withIndex('by_seedKey', (q) => q.eq('seedKey', key))
      .unique()
    const normalized = bySeed ? null : ctx.db.normalizeId('replies', key)
    const r = bySeed ?? (normalized ? await ctx.db.get(normalized) : null)
    if (!r) return { removed: true, nostrEventIds: [] }
    const you = await viewerOrThrow(ctx)

    if (r.authorId !== you._id) {
      if (!r.nostrEventId) {
        throw new Error('only the author may delete a reply that is not on the relay')
      }
      return { removed: false, nostrEventIds: [r.nostrEventId] }
    }

    const mine = r.nostrEventId ? [r.nostrEventId] : []
    // Its reactions go with it (PEE-12). Only the viewer's own published ones
    // can be tombstoned — the relay refuses a kind:5 for anyone else's event.
    const reactionRows = await ctx.db
      .query('reactions')
      .withIndex('by_message', (q) => q.eq('messageId', r.messageId))
      .collect()
    for (const reaction of reactionRows) {
      if (reaction.replyId !== r._id) continue
      if (reaction.nostrEventId && reaction.userId === you._id) mine.push(reaction.nostrEventId)
      await ctx.db.delete(reaction._id)
    }
    await deleteAttachmentBlobs(ctx, r.fileAttachments)
    await ctx.db.delete(r._id)
    return { removed: true, nostrEventIds: mine }
  },
})
