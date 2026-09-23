// @vitest-environment edge-runtime

/**
 * CON-8, *Stop writing messages to Convex* — a topic takes no more writes.
 *
 * The census (`scripts/probe-shr8-census.ts`) read 0 after CON-12 and then
 * drifted to 1 from a message posted afterwards. The UI is read-only now, but a
 * tab opened before the deploy still holds the old composer, so the mutations
 * refuse on their own. Every path below wrote a row before this.
 *
 * Huddles and DMs keep their writes — the last cases pin that the refusal is
 * the topic's, not a blanket one.
 */
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'
import { ESTIVA_ID_ISSUER } from './users'

const modules = import.meta.glob('./**/*.ts')

const ADA = 'a'.repeat(64)
const BEA = 'b'.repeat(64)
const asAda = { issuer: ESTIVA_ID_ISSUER, subject: ADA }

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const ada = await ctx.db.insert('users', { name: 'Ada', nostrPubkey: ADA })
    await ctx.db.insert('users', { name: 'Bea', nostrPubkey: BEA, seedKey: 'bea' })
    const topicId = await ctx.db.insert('topics', { title: 'Planning', creatorId: ada, createdAt: 1, seedKey: 'planning' })
    await ctx.db.insert('topicMembers', { topicId, userId: ada, addedAt: 1 })
    const huddleId = await ctx.db.insert('huddles', { topicId, state: 'active', createdById: ada, createdAt: 1, seedKey: 'h-1' })
    const messageId = await ctx.db.insert('messages', {
      parentKind: 'topic',
      parentId: topicId as string,
      authorId: ada,
      body: 'original',
      createdAt: 10,
      seedKey: 'msg-1',
    })
    const replyId = await ctx.db.insert('replies', {
      messageId,
      authorId: ada,
      body: 'original reply',
      createdAt: 20,
      seedKey: 'reply-1',
    })
    return { ada, topicId, huddleId, messageId, replyId }
  })
}

/** Everything in the four tables a topic write lands in, to prove none moved. */
const snapshot = (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => ({
    messages: await ctx.db.query('messages').collect(),
    replies: await ctx.db.query('replies').collect(),
    reactions: await ctx.db.query('reactions').collect(),
    resolutions: await ctx.db.query('resolutionAssertions').collect(),
  }))

describe('a topic is read-only in Convex', () => {
  const refused: [string, (t: ReturnType<typeof convexTest>) => Promise<unknown>][] = [
    ['a new topic message', (t) =>
      t.withIdentity(asAda).mutation(api.messages.send, { parentKind: 'topic', parentKey: 'planning', seedKey: 'new', body: 'hi' })],
    ['a reply in a topic thread', (t) =>
      t.withIdentity(asAda).mutation(api.replies.send, { messageKey: 'msg-1', seedKey: 'new-reply', body: 'hi' })],
    ['a reaction on a topic message', (t) =>
      t.withIdentity(asAda).mutation(api.messages.toggleReaction, { key: 'msg-1', emoji: '👍' })],
    ['a reaction on a topic reply', (t) =>
      t.withIdentity(asAda).mutation(api.messages.toggleReaction, { key: 'reply-1', emoji: '👍' })],
    ['an edit of a topic message', (t) =>
      t.withIdentity(asAda).mutation(api.messages.editBody, { key: 'msg-1', body: 'changed' })],
    ['an edit of a topic reply', (t) =>
      t.withIdentity(asAda).mutation(api.messages.editBody, { key: 'reply-1', body: 'changed' })],
    ["a change to a topic message's files", (t) =>
      t.withIdentity(asAda).mutation(api.messages.editFiles, { key: 'msg-1', files: [] })],
    ["a change to a topic reply's files", (t) =>
      t.withIdentity(asAda).mutation(api.messages.editFiles, { key: 'reply-1', files: [] })],
    ['resolving a topic message', (t) =>
      t.withIdentity(asAda).mutation(api.messages.setResolution, { key: 'msg-1', resolved: true })],
    ['highlighting a topic message', (t) =>
      t.withIdentity(asAda).mutation(api.messages.setHighlight, { key: 'msg-1', highlightType: 'insight' })],
    ['highlighting a topic reply', (t) =>
      t.withIdentity(asAda).mutation(api.messages.setHighlight, { key: 'reply-1', highlightType: 'insight' })],
  ]

  for (const [what, write] of refused) {
    it(`refuses ${what} and writes nothing`, async () => {
      const t = convexTest(schema, modules)
      await seed(t)
      const before = await snapshot(t)
      await expect(write(t)).rejects.toThrow(/read-only/)
      expect(await snapshot(t)).toEqual(before)
    })
  }

  /*
    Huddles are disabled as well (Miky, 2026-09-23): nothing of a huddle is on
    the relay, so each new row would be Convex's only copy.
  */
  const huddleRefused: [string, (t: ReturnType<typeof convexTest>) => Promise<unknown>][] = [
    ['a huddle message', (t) =>
      t.withIdentity(asAda).mutation(api.messages.send, { parentKind: 'huddle', parentKey: 'h-1', seedKey: 'hm', body: 'hi' })],
    ['a new huddle', (t) =>
      t.withIdentity(asAda).mutation(api.huddles.create, { topicKey: 'planning', seedKey: 'h-2', memberNames: ['Bea'] })],
    ['a huddle promoted from a DM', (t) =>
      t.withIdentity(asAda).mutation(api.huddles.createFromDm, { topicKey: 'planning', seedKey: 'h-3', originDmKey: 'bea', seedMessageKey: 'msg-1', memberNames: ['Bea'] })],
  ]

  for (const [what, write] of huddleRefused) {
    it(`refuses ${what} and writes nothing`, async () => {
      const t = convexTest(schema, modules)
      await seed(t)
      const before = await t.run(async (ctx) => ({
        messages: await ctx.db.query('messages').collect(),
        huddles: await ctx.db.query('huddles').collect(),
        huddleMembers: await ctx.db.query('huddleMembers').collect(),
      }))
      await expect(write(t)).rejects.toThrow(/huddles are disabled/)
      expect(
        await t.run(async (ctx) => ({
          messages: await ctx.db.query('messages').collect(),
          huddles: await ctx.db.query('huddles').collect(),
          huddleMembers: await ctx.db.query('huddleMembers').collect(),
        })),
      ).toEqual(before)
    })
  }

  it('still takes a DM', async () => {
    const t = convexTest(schema, modules)
    await seed(t)
    await t.withIdentity(asAda).mutation(api.messages.send, { parentKind: 'dm', parentKey: 'bea', seedKey: 'dm', body: 'hi' })
    const rows = await t.run(async (ctx) => await ctx.db.query('messages').collect())
    expect(rows.some((m) => m.seedKey === 'dm' && m.parentKind === 'dm')).toBe(true)
  })
})
