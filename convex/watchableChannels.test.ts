// @vitest-environment edge-runtime

/**
 * PEE-11 — which channels get a live subscription.
 *
 * Only the open topic had a relay read path before this, so a Ship-side change
 * to a topic nobody was looking at had no route into the inbox at all. The set
 * here is what makes one exist, and the two things worth pinning are its
 * *shape* — what a person is looking at, not what they could see — and its
 * *bound*, because a workspace can grow topics indefinitely while a Desk
 * cannot grow attention.
 */
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'
import { ESTIVA_ID_ISSUER } from './users'
import { WATCHABLE_LIMIT } from './nostr/sync'

const modules = import.meta.glob('./**/*.ts')

const PUBKEY = 'a'.repeat(64)
const asUser = (pubkey: string) => ({ issuer: ESTIVA_ID_ISSUER, subject: pubkey })

/** A viewer plus `count` topics, each with a channel. */
async function seed(t: ReturnType<typeof convexTest>, count: number) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert('users', { name: 'Ada', nostrPubkey: PUBKEY })
    const topics: { topicId: string; channelUuid: string }[] = []
    for (let i = 0; i < count; i++) {
      const channelUuid = `0000000${i.toString().padStart(1, '0')}-1111-4111-8111-11111111111${
        i % 10
      }`
      const topicId = await ctx.db.insert('topics', {
        title: `Topic ${i}`,
        creatorId: userId,
        createdAt: i,
        channelUuid,
      })
      topics.push({ topicId: topicId as string, channelUuid })
    }
    return { userId, topics }
  })
}

const watchable = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity(asUser(PUBKEY)).query(api.nostr.sync.watchableChannels, {})

describe('what gets watched', () => {
  it('watches nothing when signed out', async () => {
    // Reads happen as the viewer because only they are a member of their own
    // channels. With no identity there is nothing that could be subscribed to.
    const t = convexTest(schema, modules)
    await seed(t, 2)
    expect(await t.query(api.nostr.sync.watchableChannels, {})).toEqual([])
  })

  it('watches nothing when the Desk and inbox are empty', async () => {
    // Being a member of a workspace is not a reason to subscribe to it. The set
    // is what is on screen, not what is visible in principle.
    const t = convexTest(schema, modules)
    await seed(t, 5)
    expect(await watchable(t)).toEqual([])
  })

  it('watches a topic in the inbox', async () => {
    const t = convexTest(schema, modules)
    const { userId, topics } = await seed(t, 3)
    await t.run(async (ctx) => {
      await ctx.db.insert('screenerItems', {
        userId,
        kind: 'topic',
        targetId: topics[1]!.topicId,
        preview: 'something happened',
        createdAt: 1,
      })
    })

    expect(await watchable(t)).toEqual([
      {
        containerKind: 'topic',
        containerKey: topics[1]!.topicId,
        channelUuid: topics[1]!.channelUuid,
      },
    ])
  })

  it('watches open work and stars too', async () => {
    const t = convexTest(schema, modules)
    const { userId, topics } = await seed(t, 3)
    await t.run(async (ctx) => {
      await ctx.db.insert('deskOpenWork', {
        userId,
        kind: 'topic',
        targetId: topics[0]!.topicId,
        addedAt: 1,
      })
      await ctx.db.insert('stars', {
        userId,
        kind: 'topic',
        targetId: topics[2]!.topicId,
        createdAt: 1,
      })
    })

    const got = await watchable(t)
    expect(got.map((c) => c.channelUuid).sort()).toEqual(
      [topics[0]!.channelUuid, topics[2]!.channelUuid].sort(),
    )
  })

  it('subscribes once to a topic that is in two lists', async () => {
    // One channel, one REQ. The relay-side cost is per subscription, and a
    // duplicate would buy nothing.
    const t = convexTest(schema, modules)
    const { userId, topics } = await seed(t, 2)
    await t.run(async (ctx) => {
      for (const table of ['screenerItems', 'deskOpenWork', 'stars'] as const) {
        await ctx.db.insert(table, {
          userId,
          kind: 'topic',
          targetId: topics[0]!.topicId,
          ...(table === 'screenerItems' ? { preview: 'x', createdAt: 1 } : {}),
          ...(table === 'deskOpenWork' ? { addedAt: 1 } : {}),
          ...(table === 'stars' ? { createdAt: 1 } : {}),
        } as never)
      }
    })

    expect(await watchable(t)).toHaveLength(1)
  })

  it('watches a DM in the inbox, keyed by the partner', async () => {
    /*
      DMS-5. This test used to assert the opposite — "ignores DMs, which have no
      channel to subscribe to" — and it was right at the time: `dmConversations`
      had no `channelUuid` at all. DMS-3 gave it one and DMS-4 put the messages
      on it, so there is now a stream, and something other than this deployment
      can write into it.

      The key is the **partner's person key**, not the `dmConversations` id the
      row stores: that is how a DM is addressed everywhere client-side (§2.4),
      and it is what `syncableContainer` re-resolves through the pair.
    */
    const t = convexTest(schema, modules)
    const { userId } = await seed(t, 0)
    const { dmId, channelUuid } = await t.run(async (ctx) => {
      const partner = await ctx.db.insert('users', { name: 'Bo', seedKey: 'bo' })
      const [low, high] = (userId as string) < (partner as string) ? [userId, partner] : [partner, userId]
      const channelUuid = '00000009-1111-4111-8111-111111111119'
      const dmId = await ctx.db.insert('dmConversations', {
        userLowId: low,
        userHighId: high,
        createdAt: 0,
        channelUuid,
      })
      await ctx.db.insert('screenerItems', {
        userId,
        kind: 'dm',
        targetId: dmId as string,
        preview: 'hi',
        createdAt: 1,
      })
      return { dmId, channelUuid }
    })

    expect(await watchable(t)).toEqual([
      { containerKind: 'dm', containerKey: 'bo', channelUuid },
    ])
    // And never the raw row id, which nothing downstream would resolve.
    expect((await watchable(t))[0]!.containerKey).not.toBe(dmId as string)
  })

  it('skips a DM nobody has opened on the relay yet', async () => {
    // No `kind:41010` has landed, so there is no channel. A wait, not an error
    // — `useEnsureDmChannel` opens one on the DM's first render.
    const t = convexTest(schema, modules)
    const { userId } = await seed(t, 0)
    await t.run(async (ctx) => {
      const partner = await ctx.db.insert('users', { name: 'Bo', seedKey: 'bo' })
      const [low, high] = (userId as string) < (partner as string) ? [userId, partner] : [partner, userId]
      const dmId = await ctx.db.insert('dmConversations', {
        userLowId: low,
        userHighId: high,
        createdAt: 0,
      })
      await ctx.db.insert('stars', { userId, kind: 'dm', targetId: dmId as string, createdAt: 1 })
    })

    expect(await watchable(t)).toEqual([])
  })

  it('skips a DM the viewer is not a participant in', async () => {
    // The membership check, not decoration: a subscription is what turns a
    // channel uuid into readable messages, and a uuid is the only thing needed
    // to ask the relay for one.
    const t = convexTest(schema, modules)
    const { userId } = await seed(t, 0)
    await t.run(async (ctx) => {
      const bo = await ctx.db.insert('users', { name: 'Bo', seedKey: 'bo' })
      const cy = await ctx.db.insert('users', { name: 'Cy', seedKey: 'cy' })
      const [low, high] = (bo as string) < (cy as string) ? [bo, cy] : [cy, bo]
      const dmId = await ctx.db.insert('dmConversations', {
        userLowId: low,
        userHighId: high,
        createdAt: 0,
        channelUuid: '00000008-1111-4111-8111-111111111118',
      })
      await ctx.db.insert('stars', { userId, kind: 'dm', targetId: dmId as string, createdAt: 1 })
    })

    expect(await watchable(t)).toEqual([])
  })

  it('skips a topic that has no channel yet', async () => {
    // Created before Nostr emission was wired up. Nothing to subscribe to, and
    // not an error.
    const t = convexTest(schema, modules)
    const { userId } = await seed(t, 0)
    await t.run(async (ctx) => {
      const topicId = await ctx.db.insert('topics', {
        title: 'Old',
        creatorId: userId,
        createdAt: 0,
      })
      await ctx.db.insert('deskOpenWork', {
        userId,
        kind: 'topic',
        targetId: topicId as string,
        addedAt: 1,
      })
    })

    expect(await watchable(t)).toEqual([])
  })
})

describe('the bound', () => {
  it('stops at the limit however many topics are on the Desk', async () => {
    // `max_subscriptions` is 1024, which is a ceiling rather than a licence:
    // each subscription is a relay-side index entry and a fan-out check on
    // every event in the community.
    const t = convexTest(schema, modules)
    const { userId, topics } = await seed(t, WATCHABLE_LIMIT + 10)
    await t.run(async (ctx) => {
      for (const topic of topics) {
        await ctx.db.insert('deskOpenWork', {
          userId,
          kind: 'topic',
          targetId: topic.topicId,
          addedAt: 1,
        })
      }
    })

    expect(await watchable(t)).toHaveLength(WATCHABLE_LIMIT)
  })

  it('drops stars before the inbox when the bound bites', async () => {
    // Order is priority: things already asking for attention outrank things
    // merely kept. The bound has to cut from the least urgent end or it is
    // arbitrary.
    const t = convexTest(schema, modules)
    const { userId, topics } = await seed(t, WATCHABLE_LIMIT + 1)
    const inboxTopic = topics[topics.length - 1]!
    await t.run(async (ctx) => {
      await ctx.db.insert('screenerItems', {
        userId,
        kind: 'topic',
        targetId: inboxTopic.topicId,
        preview: 'urgent',
        createdAt: 1,
      })
      for (const topic of topics.slice(0, WATCHABLE_LIMIT)) {
        await ctx.db.insert('stars', {
          userId,
          kind: 'topic',
          targetId: topic.topicId,
          createdAt: 1,
        })
      }
    })

    const got = await watchable(t)
    expect(got).toHaveLength(WATCHABLE_LIMIT)
    expect(got.map((c) => c.channelUuid)).toContain(inboxTopic.channelUuid)
  })
})
