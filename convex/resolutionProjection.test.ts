// @vitest-environment edge-runtime

/**
 * Resolution as an append-only log, and the projection folded from it
 * (PEEK-128).
 *
 * The wire format is covered in `nostr/resolution.test.ts`. What is pinned here
 * is the database behaviour that could break silently: a foreign assertion must
 * be recorded without being able to move Peek's state, a message resolved
 * before assertions existed must still render its history, and re-polling the
 * relay must not duplicate anything.
 */
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')

const MESSAGE_EVENT = 'a'.repeat(64)
const LOCAL_PUBKEY = 'c'.repeat(64)
const FOREIGN_PUBKEY = 'd'.repeat(64)
const ASSERTION_EVENT = 'e'.repeat(64)
const SECOND_ASSERTION = 'f'.repeat(64)

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const localId = await ctx.db.insert('users', { name: 'Ada', nostrPubkey: LOCAL_PUBKEY })
    const foreignId = await ctx.db.insert('users', {
      name: 'Stranger',
      nostrPubkey: FOREIGN_PUBKEY,
      isExternal: true,
    })
    const topicId = await ctx.db.insert('topics', {
      title: 'Interop',
      creatorId: localId,
      createdAt: Date.now(),
      channelUuid: '0d1c9f5a-6f7e-4a2b-9c3d-8e5f4a1b2c3d',
    })
    const messageId = await ctx.db.insert('messages', {
      parentKind: 'topic',
      parentId: topicId as string,
      authorId: localId,
      body: 'hello',
      createdAt: Date.now(),
      nostrEventId: MESSAGE_EVENT,
    })
    return { localId, foreignId, topicId, messageId }
  })
}

describe('importResolution', () => {
  it('records a foreign assertion but does not let it flip local state', async () => {
    const t = convexTest(schema, modules)
    const { messageId } = await seed(t)

    const result = await t.mutation(internal.nostr.data.importResolution, {
      nostrEventId: ASSERTION_EVENT,
      targetEventId: MESSAGE_EVENT,
      authorId: (await t.run(async (ctx) =>
        (await ctx.db.query('users').filter((q) => q.eq(q.field('nostrPubkey'), FOREIGN_PUBKEY)).unique())!._id,
      )),
      authorPubkey: FOREIGN_PUBKEY,
      action: 'resolved',
      createdAtMs: Date.now(),
    })
    expect(result.imported).toBe(true)

    await t.mutation(internal.nostr.data.refoldResolution, { messageId })

    const after = await t.run(async (ctx) => ({
      message: await ctx.db.get(messageId),
      assertions: await ctx.db.query('resolutionAssertions').collect(),
    }))
    // Recorded, and visible as history…
    expect(after.assertions).toHaveLength(1)
    expect(after.assertions[0].trusted).toBe(false)
    // …but Peek's own state is untouched (decision 4).
    expect(after.message?.resolved).toBeUndefined()
  })

  it('lets an assertion from someone with a Peek account move state', async () => {
    const t = convexTest(schema, modules)
    const { messageId, localId } = await seed(t)

    await t.mutation(internal.nostr.data.importResolution, {
      nostrEventId: ASSERTION_EVENT,
      targetEventId: MESSAGE_EVENT,
      authorId: localId,
      authorPubkey: LOCAL_PUBKEY,
      action: 'resolved',
      createdAtMs: Date.now(),
      rationale: 'done upstream',
    })
    await t.mutation(internal.nostr.data.refoldResolution, { messageId })

    const message = await t.run(async (ctx) => await ctx.db.get(messageId))
    expect(message?.resolved).toBe(true)
    expect(message?.resolutionMessage).toBe('done upstream')
  })

  it('is idempotent — re-polling the relay cannot duplicate an assertion', async () => {
    const t = convexTest(schema, modules)
    const { messageId, localId } = await seed(t)
    const args = {
      nostrEventId: ASSERTION_EVENT,
      targetEventId: MESSAGE_EVENT,
      authorId: localId,
      authorPubkey: LOCAL_PUBKEY,
      action: 'resolved' as const,
      createdAtMs: Date.now(),
    }
    expect((await t.mutation(internal.nostr.data.importResolution, args)).imported).toBe(true)
    expect((await t.mutation(internal.nostr.data.importResolution, args)).imported).toBe(false)

    const rows = await t.run(async (ctx) => await ctx.db.query('resolutionAssertions').collect())
    expect(rows).toHaveLength(1)
    expect(messageId).toBeDefined()
  })

  it('drops an assertion about a message it has never seen', async () => {
    const t = convexTest(schema, modules)
    const { localId } = await seed(t)

    const result = await t.mutation(internal.nostr.data.importResolution, {
      nostrEventId: ASSERTION_EVENT,
      targetEventId: 'b'.repeat(64), // no such message
      authorId: localId,
      authorPubkey: LOCAL_PUBKEY,
      action: 'resolved',
      createdAtMs: Date.now(),
    })
    expect(result.imported).toBe(false)
    expect(await t.run(async (ctx) => await ctx.db.query('resolutionAssertions').collect())).toHaveLength(0)
  })

  it('folds resolve then reopen back to open', async () => {
    const t = convexTest(schema, modules)
    const { messageId, localId } = await seed(t)
    const base = Date.now()

    await t.mutation(internal.nostr.data.importResolution, {
      nostrEventId: ASSERTION_EVENT, targetEventId: MESSAGE_EVENT, authorId: localId,
      authorPubkey: LOCAL_PUBKEY, action: 'resolved', createdAtMs: base,
    })
    await t.mutation(internal.nostr.data.importResolution, {
      nostrEventId: SECOND_ASSERTION, targetEventId: MESSAGE_EVENT, authorId: localId,
      authorPubkey: LOCAL_PUBKEY, action: 'reopened', createdAtMs: base + 1000,
    })
    await t.mutation(internal.nostr.data.refoldResolution, { messageId })

    const message = await t.run(async (ctx) => await ctx.db.get(messageId))
    expect(message?.resolved).toBeUndefined()
    expect(message?.resolvedAt).toBeUndefined()
  })
})

describe('legacy rows', () => {
  it('keeps rendering a message resolved before assertions existed', async () => {
    const t = convexTest(schema, modules)
    const { messageId, localId } = await seed(t)
    const resolvedAt = Date.now() - 60_000
    await t.run(async (ctx) => {
      await ctx.db.patch(messageId, {
        resolved: true,
        resolvedById: localId,
        resolutionMessage: 'from before PEEK-128',
        resolvedAt,
      })
    })

    // No assertion rows exist, so the history is synthesized (decision 5) and
    // re-folding must not erase state it never recorded.
    await t.mutation(internal.nostr.data.refoldResolution, { messageId })

    const message = await t.run(async (ctx) => await ctx.db.get(messageId))
    expect(message?.resolved).toBe(true)
    expect(message?.resolutionMessage).toBe('from before PEEK-128')
    expect(message?.resolvedAt).toBe(resolvedAt)
  })
})
