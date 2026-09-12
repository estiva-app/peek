/**
 * The reaction horizon reports itself — PEE-21, SPEC §6.6.
 *
 * `shareTargetBudget` (reactionTargets.test.ts) decides *which* targets a sync
 * asks about. This pins the other half: how many it did not ask about, and
 * that the number survives the trip from the action that knows it to the
 * query the topic view reads. A count that stops at the sync is the bug the
 * ticket names.
 *
 * `importChannel` is driven with no events on purpose: the targets are
 * computed from what Peek already holds, after the import, so an empty flush
 * — which the live socket sends constantly — is the run that has to get the
 * number right.
 */
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'
import { ESTIVA_ID_ISSUER } from './users'
import type { Id } from './_generated/dataModel'
import { REACTION_TARGET_LIMIT } from '../src/nostr/reactionHorizon'

const modules = import.meta.glob('./**/*.ts')

const PUBKEY = 'a'.repeat(64)
const asUser = (pubkey: string) => ({ issuer: ESTIVA_ID_ISSUER, subject: pubkey })
const CHANNEL = '12345678-1234-1234-1234-123456789abc'

/** A published event id: 64 hex chars, unique per index. */
const eventId = (n: number) => n.toString(16).padStart(64, '0')

/**
 * Ada, member of one relay-backed topic holding `messages` published
 * messages, `replies` published replies spread across them, and `unpublished`
 * messages with no event id — which are not targets and must not be counted.
 */
async function seed(
  t: ReturnType<typeof convexTest>,
  { messages, replies = 0, unpublished = 0 }: { messages: number; replies?: number; unpublished?: number },
) {
  return await t.run(async (ctx) => {
    const ada = await ctx.db.insert('users', { name: 'Ada', nostrPubkey: PUBKEY })
    const topicId = await ctx.db.insert('topics', {
      title: 'Planning',
      creatorId: ada,
      createdAt: 1,
      channelUuid: CHANNEL,
    })
    await ctx.db.insert('topicMembers', { topicId, userId: ada, addedAt: 1 })
    const messageIds: Id<'messages'>[] = []
    for (let i = 0; i < messages + unpublished; i++) {
      messageIds.push(
        await ctx.db.insert('messages', {
          parentKind: 'topic',
          parentId: topicId as string,
          authorId: ada,
          body: `message ${i}`,
          createdAt: 10 + i,
          ...(i < messages ? { nostrEventId: eventId(i) } : {}),
        }),
      )
    }
    for (let i = 0; i < replies; i++) {
      await ctx.db.insert('replies', {
        messageId: messageIds[i % messageIds.length]!,
        authorId: ada,
        body: `reply ${i}`,
        createdAt: 1000 + i,
        nostrEventId: eventId(100_000 + i),
      })
    }
    return { topicId }
  })
}

const sync = (t: ReturnType<typeof convexTest>, topicId: Id<'topics'>) =>
  t
    .withIdentity(asUser(PUBKEY))
    .action(api.nostr.sync.importChannel, { topicKey: topicId as string, events: [], profiles: [] })

const listed = async (t: ReturnType<typeof convexTest>, topicId: Id<'topics'>) => {
  const topics = await t.withIdentity(asUser(PUBKEY)).query(api.topics.list, {})
  return topics.find((x) => x.id === (topicId as string))!
}

describe('reporting the reaction horizon', () => {
  it('says how many messages were past the cap, and the view can read it', async () => {
    const t = convexTest(schema, modules)
    const { topicId } = await seed(t, { messages: REACTION_TARGET_LIMIT + 14 })

    const result = await sync(t, topicId)
    expect(result).toMatchObject({ ok: true, omitted: 14 })
    expect(result.targets).toHaveLength(REACTION_TARGET_LIMIT)

    // The trip: the row, then the query the topic view is drawn from.
    const row = await t.run((ctx) => ctx.db.get(topicId))
    expect(row?.reactionTargetsOmitted).toBe(14)
    expect((await listed(t, topicId)).reactionTargetsOmitted).toBe(14)
  })

  /*
    The count comes from the true totals, not the capped lists. Each list is
    capped at the horizon before it reaches the share, so `messages.length +
    replies.length - limit` — the arithmetic the ticket sketches — is right up
    to 200 and short by any amount past it. 150 messages and 80 replies: the
    capped sum says 180 - 100 = 80; the truth is 130.
  */
  it('counts past 200, where the capped lists alone would undercount', async () => {
    const t = convexTest(schema, modules)
    const { topicId } = await seed(t, { messages: 150, replies: 80 })

    const result = await sync(t, topicId)
    expect(result.omitted).toBe(130)
    expect(result.targets).toHaveLength(REACTION_TARGET_LIMIT)
  })

  it('counts replies in the same budget as messages', async () => {
    const t = convexTest(schema, modules)
    const { topicId } = await seed(t, { messages: 60, replies: 60 })

    expect((await sync(t, topicId)).omitted).toBe(20)
  })

  /* A message with no event id was never published, so it is not a target
     and not "unchecked" either — it cannot have a reaction on the relay. */
  it('ignores messages that were never published', async () => {
    const t = convexTest(schema, modules)
    const { topicId } = await seed(t, { messages: 90, unpublished: 30 })

    expect((await sync(t, topicId)).omitted).toBe(0)
  })

  it('records nothing under the cap, and the view reads that as 0', async () => {
    const t = convexTest(schema, modules)
    const { topicId } = await seed(t, { messages: 77 })

    expect((await sync(t, topicId)).omitted).toBe(0)
    const row = await t.run((ctx) => ctx.db.get(topicId))
    expect(row?.reactionTargetsOmitted).toBeUndefined()
    expect((await listed(t, topicId)).reactionTargetsOmitted).toBe(0)
  })

  /* Unlike the sync cursor, this may go down: a deletion brings a topic back
     under the cap, and the caption should go with it. */
  it('goes back to 0 when the topic shrinks under the cap', async () => {
    const t = convexTest(schema, modules)
    const { topicId } = await seed(t, { messages: REACTION_TARGET_LIMIT + 3 })
    await sync(t, topicId)

    await t.run(async (ctx) => {
      const rows = await ctx.db
        .query('messages')
        .withIndex('by_parent', (q) => q.eq('parentKind', 'topic').eq('parentId', topicId as string))
        .collect()
      for (const m of rows.slice(0, 3)) await ctx.db.delete(m._id)
    })

    expect((await sync(t, topicId)).omitted).toBe(0)
    expect((await listed(t, topicId)).reactionTargetsOmitted).toBe(0)
  })
})
