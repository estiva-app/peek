// @vitest-environment edge-runtime

/**
 * Inbound deletion: a kind:5 written elsewhere removes the row here (PEEK-113).
 *
 * This is the half that was missing for the whole life of the interop surface —
 * a message deleted in Ship stayed visible in Peek forever. It failed the way
 * everything in this project fails: silently, with nothing to see in any log.
 *
 * The cascade is the part worth pinning. A deleted message takes its replies
 * and reactions with it, exactly as a local delete does; getting that wrong
 * leaves orphaned replies pointing at a message that no longer exists, which
 * renders as nothing and looks like the deletion simply not working.
 */
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')

const MESSAGE_EVENT = 'a'.repeat(64)
const REPLY_EVENT = 'b'.repeat(64)
const REACTION_EVENT = 'c'.repeat(64)
const UNKNOWN_EVENT = 'd'.repeat(64)

/** A topic with one published message, one published reply, one reaction. */
async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert('users', { name: 'Ada', nostrPubkey: 'f'.repeat(64) })
    const topicId = await ctx.db.insert('topics', {
      title: 'Interop',
      creatorId: userId,
      createdAt: Date.now(),
      channelUuid: '0d1c9f5a-6f7e-4a2b-9c3d-8e5f4a1b2c3d',
    })
    const messageId = await ctx.db.insert('messages', {
      parentKind: 'topic',
      parentId: topicId as string,
      authorId: userId,
      body: 'hello',
      createdAt: Date.now(),
      nostrEventId: MESSAGE_EVENT,
    })
    const replyId = await ctx.db.insert('replies', {
      messageId,
      authorId: userId,
      body: 'a reply',
      createdAt: Date.now(),
      nostrEventId: REPLY_EVENT,
    })
    const reactionId = await ctx.db.insert('reactions', {
      messageId,
      userId,
      emoji: '🎉',
      createdAt: Date.now(),
      nostrEventId: REACTION_EVENT,
    })
    return { topicId, messageId, replyId, reactionId }
  })
}

describe('removeByNostrEventId', () => {
  it('removes a message and everything hanging off it', async () => {
    const t = convexTest(schema, modules)
    const { messageId, replyId, reactionId } = await seed(t)

    const result = await t.mutation(internal.nostr.data.removeByNostrEventId, {
      nostrEventId: MESSAGE_EVENT,
    })

    expect(result).toEqual({ removed: 'message' })
    // Asserted outside `t.run`: a failing expect inside it is returned through
    // Convex's serializer, which cannot encode vitest's error and reports a
    // circular-structure error instead of the assertion that actually failed.
    const after = await t.run(async (ctx) => ({
      message: await ctx.db.get(messageId),
      reply: await ctx.db.get(replyId),
      reaction: await ctx.db.get(reactionId),
    }))
    expect(after.message).toBeNull()
    // Orphans are the failure mode: a reply pointing at a deleted message
    // renders as nothing and reads as "the deletion did not work".
    expect(after.reply).toBeNull()
    expect(after.reaction).toBeNull()
  })

  it('removes a reply without touching its message', async () => {
    const t = convexTest(schema, modules)
    const { messageId, replyId } = await seed(t)

    const result = await t.mutation(internal.nostr.data.removeByNostrEventId, {
      nostrEventId: REPLY_EVENT,
    })

    expect(result).toEqual({ removed: 'reply' })
    const after = await t.run(async (ctx) => ({
      reply: await ctx.db.get(replyId),
      message: await ctx.db.get(messageId),
    }))
    expect(after.reply).toBeNull()
    expect(after.message).not.toBeNull()
  })

  it('is a no-op for an event it does not hold', async () => {
    const t = convexTest(schema, modules)
    const { messageId } = await seed(t)

    const result = await t.mutation(internal.nostr.data.removeByNostrEventId, {
      nostrEventId: UNKNOWN_EVENT,
    })

    expect(result).toEqual({ removed: null })
    expect(await t.run(async (ctx) => ctx.db.get(messageId))).not.toBeNull()
  })
})

describe('listDeletableEventIdsForTopic', () => {
  it('lists messages and replies, so a kind:5 for either can be found', async () => {
    const t = convexTest(schema, modules)
    const { topicId } = await seed(t)

    const ids = await t.query(internal.nostr.data.listDeletableEventIdsForTopic, {
      topicId,
      limit: 100,
    })

    expect(ids).toContain(MESSAGE_EVENT)
    expect(ids).toContain(REPLY_EVENT)
    // Reactions are tracked separately — `listReactionEventIdsForTopic` — and a
    // reaction id here would send its kind:5 down the message-removal path.
    expect(ids).not.toContain(REACTION_EVENT)
  })

  it('skips rows that never reached the relay', async () => {
    const t = convexTest(schema, modules)
    const { topicId, messageId } = await seed(t)
    await t.run(async (ctx) => {
      await ctx.db.insert('messages', {
        parentKind: 'topic',
        parentId: topicId as string,
        authorId: (await ctx.db.get(messageId))!.authorId,
        body: 'never published',
        createdAt: Date.now(),
      })
    })

    const ids = await t.query(internal.nostr.data.listDeletableEventIdsForTopic, {
      topicId,
      limit: 100,
    })

    // An unpublished row has no event id to match a kind:5 against, so
    // including it could only produce undefined entries in the filter.
    expect(ids.every((id) => typeof id === 'string' && id.length === 64)).toBe(true)
    expect(ids).toHaveLength(2)
  })
})
