// @vitest-environment edge-runtime

/**
 * PEE-12 — reactions on replies persist (they were session-local).
 *
 * "Reactions on Claude's messages are lost after browser reload." An agent's
 * messages in a topic are usually REPLIES, and a reply reaction was silently
 * dropped by `toggleReaction` — visible only as component state until the tab
 * died. These pin the modeled path: persisted on toggle, aggregated by the
 * replies list (a fresh query IS the reload story), excluded from the parent
 * message's own pill, removed on re-toggle, and cleaned up with the reply.
 */
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'
import { ESTIVA_ID_ISSUER } from './users'
import type { Id } from './_generated/dataModel'

const modules = import.meta.glob('./**/*.ts')

const PUBKEY = 'a'.repeat(64)
/** The reply's author — Ada reads it, Claude wrote it. */
const AGENT = 'b'.repeat(64)
const asUser = (pubkey: string) => ({ issuer: ESTIVA_ID_ISSUER, subject: pubkey })

/** Ada (the viewer) plus an agent whose conversation-root and reply she reads. */
async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const ada = await ctx.db.insert('users', { name: 'Ada', nostrPubkey: PUBKEY })
    const claude = await ctx.db.insert('users', { name: 'Claude (steered by Miky)', nostrPubkey: 'b'.repeat(64) })
    const topicId = await ctx.db.insert('topics', { title: 'Planning', creatorId: claude, createdAt: 1 })
    for (const userId of [ada, claude]) {
      await ctx.db.insert('topicMembers', { topicId, userId, addedAt: 1 })
    }
    const messageId = await ctx.db.insert('messages', {
      parentKind: 'topic',
      parentId: topicId as string,
      authorId: claude,
      body: 'the plan, as a conversation root',
      createdAt: 10,
    })
    const replyId = await ctx.db.insert('replies', {
      messageId,
      authorId: claude,
      body: 'and the detail, as a reply',
      createdAt: 20,
      nostrEventId: 'e'.repeat(64),
    })
    return { ada, claude, topicId, messageId, replyId }
  })
}

const listReplies = (t: ReturnType<typeof convexTest>, messageId: Id<'messages'>) =>
  t.withIdentity(asUser(PUBKEY)).query(api.replies.list, { messageKey: messageId as string })

describe('reactions on replies', () => {
  it('persists a reply reaction and serves it back — the reload story', async () => {
    const t = convexTest(schema, modules)
    const { messageId, replyId } = await seed(t)

    await t
      .withIdentity(asUser(PUBKEY))
      .mutation(api.messages.toggleReaction, { key: replyId as string, emoji: '👍' })

    // A fresh query is exactly what a reloaded tab runs.
    const replies = await listReplies(t, messageId)
    expect(replies[0]!.reactions).toEqual([
      { emoji: '👍', count: 1, owner: 'yours', names: ['You'] },
    ])
  })

  it("stays off the parent message's own pill", async () => {
    const t = convexTest(schema, modules)
    const { topicId, messageId, replyId } = await seed(t)

    await t
      .withIdentity(asUser(PUBKEY))
      .mutation(api.messages.toggleReaction, { key: replyId as string, emoji: '👍' })

    const { rows } = await t
      .withIdentity(asUser(PUBKEY))
      .query(api.messages.list, { parentKind: 'topic', parentKey: topicId as string, limit: 50 })
    expect(rows.find((r) => r.id === (messageId as string))!.reactions).toBeUndefined()
  })

  it('re-toggling removes it, exactly like a message reaction', async () => {
    const t = convexTest(schema, modules)
    const { messageId, replyId } = await seed(t)
    const toggle = () =>
      t
        .withIdentity(asUser(PUBKEY))
        .mutation(api.messages.toggleReaction, { key: replyId as string, emoji: '👍' })

    await toggle()
    await toggle()
    const replies = await listReplies(t, messageId)
    expect(replies[0]!.reactions).toBeUndefined()
  })

  /*
    Deleted **as the reply's author**, which it was not until PEE-18.

    This used to delete Claude's reply as Ada, and it passed — because
    `replies.remove` deleted whatever it was handed. So the test was quietly
    resting on the authorization hole while asserting something else entirely.
    Fixing the mutation broke it, which is the test doing its second job.

    Ada's reaction on Claude's reply is still the interesting fixture: the rows
    cleaned up here belong to somebody other than the person deleting.
  */
  it('deleting the reply takes its reaction rows with it', async () => {
    const t = convexTest(schema, modules)
    const { replyId } = await seed(t)

    await t
      .withIdentity(asUser(PUBKEY))
      .mutation(api.messages.toggleReaction, { key: replyId as string, emoji: '👍' })
    await t.withIdentity(asUser(AGENT)).mutation(api.replies.remove, { key: replyId as string })

    const rows = await t.run(async (ctx) => await ctx.db.query('reactions').collect())
    expect(rows).toEqual([])
  })
})
