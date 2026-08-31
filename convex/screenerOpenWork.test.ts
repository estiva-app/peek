// @vitest-environment edge-runtime

/**
 * PEE-6 — an item already in Open Work must not show in the Screener.
 *
 * "Because then it feels like duplicate. You're trying to open item that is
 * already open." The rule is enforced in three places and each gets a test:
 * the screening writers skip a holder, the list read heals rows that already
 * exist, and the Desk "+" picker clears the row the Screener's own Open
 * button always cleared from the other direction.
 */
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'
import { ESTIVA_ID_ISSUER } from './users'
import { screenMessage } from './screener'
import type { Doc, Id } from './_generated/dataModel'

const modules = import.meta.glob('./**/*.ts')

const PUBKEY = 'a'.repeat(64)
const asUser = (pubkey: string) => ({ issuer: ESTIVA_ID_ISSUER, subject: pubkey })

/** Ada (the viewer) and Bob, members of two topics Bob posts into. */
async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const ada = await ctx.db.insert('users', { name: 'Ada', nostrPubkey: PUBKEY })
    const bob = await ctx.db.insert('users', { name: 'Bob', nostrPubkey: 'b'.repeat(64) })
    const topics: Id<'topics'>[] = []
    for (const title of ['Committed to', 'Fresh']) {
      const topicId = await ctx.db.insert('topics', { title, creatorId: bob, createdAt: 1 })
      for (const userId of [ada, bob]) {
        await ctx.db.insert('topicMembers', { topicId, userId, addedAt: 1 })
      }
      topics.push(topicId)
    }
    return { ada, bob, topics }
  })
}

async function post(
  t: ReturnType<typeof convexTest>,
  authorId: Id<'users'>,
  topicId: Id<'topics'>,
  body: string,
) {
  await t.run(async (ctx) => {
    const messageId = await ctx.db.insert('messages', {
      parentKind: 'topic',
      parentId: topicId as string,
      authorId,
      body,
      createdAt: Date.now(),
    })
    const message = (await ctx.db.get(messageId)) as Doc<'messages'>
    await screenMessage(ctx, message)
  })
}

const screenerRowsFor = (t: ReturnType<typeof convexTest>, userId: Id<'users'>) =>
  t.run(async (ctx) =>
    (await ctx.db.query('screenerItems').collect()).filter((r) => r.userId === userId),
  )

describe('open work silences the screener', () => {
  it('new activity in a held item does not screen — a fresh one still does', async () => {
    const t = convexTest(schema, modules)
    const { ada, bob, topics } = await seed(t)
    await t.run(async (ctx) => {
      await ctx.db.insert('deskOpenWork', {
        userId: ada,
        kind: 'topic',
        targetId: topics[0] as string,
        addedAt: 1,
      })
    })

    await post(t, bob, topics[0]!, 'news in the topic Ada already opened')
    await post(t, bob, topics[1]!, 'news in a topic Ada never touched')

    const rows = await screenerRowsFor(t, ada)
    // The un-held topic screens (Ada never opened it); the held one is silent.
    expect(rows.map((r) => r.targetId)).toEqual([topics[1] as string])
  })

  it('a stale row is healed at read time', async () => {
    const t = convexTest(schema, modules)
    const { ada, topics } = await seed(t)
    await t.run(async (ctx) => {
      // The duplicate as production data already has it: screened first,
      // added to Open Work later by a path that forgot to clean up.
      for (const [i, topicId] of topics.entries()) {
        await ctx.db.insert('screenerItems', {
          userId: ada,
          kind: 'topic',
          targetId: topicId as string,
          preview: `preview ${i}`,
          createdAt: i,
        })
      }
      await ctx.db.insert('deskOpenWork', {
        userId: ada,
        kind: 'topic',
        targetId: topics[0] as string,
        addedAt: 1,
      })
    })

    const listed = await t.withIdentity(asUser(PUBKEY)).query(api.desk.screenerList, {})
    expect(listed.map((item) => item.topicTitle)).toEqual(['Fresh'])
  })

  it('the Desk "+" picker clears the screener row it obsoletes', async () => {
    const t = convexTest(schema, modules)
    const { ada, topics } = await seed(t)
    await t.run(async (ctx) => {
      await ctx.db.insert('screenerItems', {
        userId: ada,
        kind: 'topic',
        targetId: topics[0] as string,
        preview: 'wants attention',
        createdAt: 1,
      })
    })

    await t
      .withIdentity(asUser(PUBKEY))
      .mutation(api.desk.addTopicsToOpenWork, { topicKeys: [topics[0] as string] })

    expect(await screenerRowsFor(t, ada)).toEqual([])
    const open = await t.run(async (ctx) => await ctx.db.query('deskOpenWork').collect())
    expect(open.map((w) => w.targetId)).toEqual([topics[0] as string])
  })
})
