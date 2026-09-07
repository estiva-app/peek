// @vitest-environment edge-runtime

/**
 * PEE-18 — `remove` deleted anybody's message, and CON-3's gate removal rests
 * on this being fixed.
 *
 * The old mutation read the viewer only to decide what to *tombstone*, never
 * whether the delete could happen. A `mutation` is a client-callable API
 * surface, so any authenticated user could pass somebody else's key and remove
 * the message, its replies and its reactions from Peek for everybody — while
 * the relay copies survived, because no kind:5 was published for events they did
 * not author. Peek's UI gated the control on `isOwnMessage`, which is why nobody
 * hit it; the mutation is the boundary, not the menu.
 *
 * These pin the two paths, and the second is the interesting one: a non-author
 * is NOT refused outright — that would reproduce SHI-14 inside the backend,
 * since the relay accepts a deletion from the author or the NIP-OA owner of an
 * authoring agent and no client can tell which it is looking at. Instead nothing
 * is deleted and the target comes back for the relay to adjudicate.
 */
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'
import { ESTIVA_ID_ISSUER } from './users'

const modules = import.meta.glob('./**/*.ts')

const ADA = 'a'.repeat(64)
const AGENT = 'b'.repeat(64)
const asUser = (pubkey: string) => ({ issuer: ESTIVA_ID_ISSUER, subject: pubkey })

/** An agent's message, with a reply and a reaction hanging off it. */
async function seed(t: ReturnType<typeof convexTest>, opts: { published?: boolean } = {}) {
  return await t.run(async (ctx) => {
    const ada = await ctx.db.insert('users', { name: 'Ada', nostrPubkey: ADA })
    const agent = await ctx.db.insert('users', { name: 'Claude', nostrPubkey: AGENT })
    const topicId = await ctx.db.insert('topics', { title: 'Planning', creatorId: agent, createdAt: 1 })
    for (const userId of [ada, agent]) {
      await ctx.db.insert('topicMembers', { topicId, userId, addedAt: 1 })
    }
    const messageId = await ctx.db.insert('messages', {
      parentKind: 'topic',
      parentId: topicId as string,
      authorId: agent,
      body: "the agent's message",
      createdAt: 10,
      seedKey: 'msg-1',
      ...(opts.published === false ? {} : { nostrEventId: 'e'.repeat(64) }),
    })
    const replyId = await ctx.db.insert('replies', {
      messageId,
      authorId: agent,
      body: "the agent's reply",
      createdAt: 20,
      seedKey: 'reply-1',
      nostrEventId: 'f'.repeat(64),
    })
    return { ada, agent, messageId, replyId }
  })
}

describe('messages.remove', () => {
  it('deletes for the author, and hands back their own events to tombstone', async () => {
    const t = convexTest(schema, modules)
    const { messageId } = await seed(t)
    const out = await t.withIdentity(asUser(AGENT)).mutation(api.messages.remove, { key: 'msg-1' })

    expect(out.removed).toBe(true)
    expect(out.nostrEventIds).toContain('e'.repeat(64))
    expect(await t.run(async (ctx) => await ctx.db.get(messageId))).toBeNull()
  })

  /*
    The hole. Before the fix this returned `{ nostrEventIds: [] }` and the row
    was gone — deleted for everyone in Peek, alive on the relay for every other
    reader, with nothing announcing the divergence.
  */
  it('does NOT delete anything for someone who is not the author', async () => {
    const t = convexTest(schema, modules)
    const { messageId, replyId } = await seed(t)
    const out = await t.withIdentity(asUser(ADA)).mutation(api.messages.remove, { key: 'msg-1' })

    expect(out.removed).toBe(false)
    expect(await t.run(async (ctx) => await ctx.db.get(messageId))).not.toBeNull()
    expect(await t.run(async (ctx) => await ctx.db.get(replyId))).not.toBeNull()
  })

  /*
    …and it is not a refusal either. Ada may be the agent's NIP-OA owner, which
    only the relay knows, so she gets the target to ask about. The row then goes
    through the sync's `applyDeletions` if — and only if — the relay accepted.
  */
  it('  …but hands back the target, so the relay can adjudicate', async () => {
    const t = convexTest(schema, modules)
    await seed(t)
    const out = await t.withIdentity(asUser(ADA)).mutation(api.messages.remove, { key: 'msg-1' })
    expect(out.nostrEventIds).toEqual(['e'.repeat(64)])
  })

  /* Nothing on the relay means no adjudicator, so there is no path that could
     ever complete. Refusing is honest; leaving it pending is not. */
  it('refuses a non-author outright when the message never reached the relay', async () => {
    const t = convexTest(schema, modules)
    await seed(t, { published: false })
    await expect(
      t.withIdentity(asUser(ADA)).mutation(api.messages.remove, { key: 'msg-1' }),
    ).rejects.toThrow(/only the author/)
  })

  it('refuses a caller who is not signed in at all', async () => {
    const t = convexTest(schema, modules)
    await seed(t)
    await expect(t.mutation(api.messages.remove, { key: 'msg-1' })).rejects.toThrow()
  })

  /* A second click, or a sync that got there first, is not a failure. */
  it('is idempotent for a message that is already gone', async () => {
    const t = convexTest(schema, modules)
    await seed(t)
    const who = t.withIdentity(asUser(AGENT))
    await who.mutation(api.messages.remove, { key: 'msg-1' })
    const again = await who.mutation(api.messages.remove, { key: 'msg-1' })
    expect(again).toEqual({ removed: true, nostrEventIds: [] })
  })
})

describe('replies.remove — the same hole, which PEE-18 did not name', () => {
  it('deletes for the author', async () => {
    const t = convexTest(schema, modules)
    const { replyId } = await seed(t)
    const out = await t.withIdentity(asUser(AGENT)).mutation(api.replies.remove, { key: 'reply-1' })

    expect(out.removed).toBe(true)
    expect(out.nostrEventIds).toContain('f'.repeat(64))
    expect(await t.run(async (ctx) => await ctx.db.get(replyId))).toBeNull()
  })

  it('leaves somebody else’s reply in place and asks the relay instead', async () => {
    const t = convexTest(schema, modules)
    const { replyId } = await seed(t)
    const out = await t.withIdentity(asUser(ADA)).mutation(api.replies.remove, { key: 'reply-1' })

    expect(out.removed).toBe(false)
    expect(out.nostrEventIds).toEqual(['f'.repeat(64)])
    expect(await t.run(async (ctx) => await ctx.db.get(replyId))).not.toBeNull()
  })
})
