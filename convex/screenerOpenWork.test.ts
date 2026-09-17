// @vitest-environment edge-runtime

/**
 * PEE-6 — an item already in Open Work must not show in the Screener.
 *
 * "Because then it feels like duplicate. You're trying to open item that is
 * already open."
 *
 * The rule used to be enforced in three server-side places, and this file
 * pinned all three. SHR-10 folded the topic half onto the device, so the rule
 * now lives in two places and this file covers the one that is still here:
 * **the DM half**. The topic half's PEE-6 is a `Set` intersection in
 * `src/api/internal/screener.tsx`, pinned by `src/api/screenerFold.test.ts`.
 *
 * The fourth test below is the one that would otherwise be missing: it is not
 * about PEE-6 at all, it is the proof that topics stopped writing rows. Without
 * it, "no duplicate row" and "no row at all" look identical from here, and a
 * regression that re-enabled the fan-out would pass every other test in the file.
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

/**
 * Ada (the viewer) and Bob, with two DM conversations between them and two
 * topics they are both in.
 *
 * Two DMs between the same pair is not a shape production has — `dmConversations`
 * is keyed by the ordered pair — but PEE-6 needs a held conversation and a free
 * one, and the rows this exercises are keyed by `targetId` alone. The second
 * partner is Cy, so the pairs are genuinely distinct.
 */
async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const ada = await ctx.db.insert('users', { name: 'Ada', nostrPubkey: PUBKEY })
    const bob = await ctx.db.insert('users', { name: 'Bob', nostrPubkey: 'b'.repeat(64) })
    const cy = await ctx.db.insert('users', { name: 'Cy', nostrPubkey: 'c'.repeat(64) })

    const dms: Id<'dmConversations'>[] = []
    for (const partner of [bob, cy]) {
      const [userLowId, userHighId] =
        (ada as string) < (partner as string) ? [ada, partner] : [partner, ada]
      dms.push(await ctx.db.insert('dmConversations', { userLowId, userHighId, createdAt: 1 }))
    }

    const topics: Id<'topics'>[] = []
    for (const title of ['Committed to', 'Fresh']) {
      const topicId = await ctx.db.insert('topics', { title, creatorId: bob, createdAt: 1 })
      for (const userId of [ada, bob]) {
        await ctx.db.insert('topicMembers', { topicId, userId, addedAt: 1 })
      }
      topics.push(topicId)
    }
    return { ada, bob, cy, dms, topics }
  })
}

async function post(
  t: ReturnType<typeof convexTest>,
  authorId: Id<'users'>,
  parent: { kind: 'dm' | 'topic'; id: string },
  body: string,
) {
  await t.run(async (ctx) => {
    const messageId = await ctx.db.insert('messages', {
      parentKind: parent.kind,
      parentId: parent.id,
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

describe('open work silences the screener (the DM half)', () => {
  it('new activity in a held DM does not screen — a fresh one still does', async () => {
    const t = convexTest(schema, modules)
    const { ada, bob, cy, dms } = await seed(t)
    await t.run(async (ctx) => {
      await ctx.db.insert('deskOpenWork', {
        userId: ada,
        kind: 'dm',
        targetId: dms[0] as string,
        addedAt: 1,
      })
    })

    await post(t, bob, { kind: 'dm', id: dms[0] as string }, 'a DM Ada already has open')
    await post(t, cy, { kind: 'dm', id: dms[1] as string }, 'a DM Ada has not')

    const rows = await screenerRowsFor(t, ada)
    // The un-held DM screens; the held one is silent.
    expect(rows.map((r) => r.targetId)).toEqual([dms[1] as string])
  })

  it('a stale row is healed at read time', async () => {
    const t = convexTest(schema, modules)
    const { ada, dms } = await seed(t)
    await t.run(async (ctx) => {
      // The duplicate as production data already has it: screened first,
      // added to Open Work later by a path that forgot to clean up.
      for (const [i, dmId] of dms.entries()) {
        await ctx.db.insert('screenerItems', {
          userId: ada,
          kind: 'dm',
          targetId: dmId as string,
          preview: `preview ${i}`,
          createdAt: i,
        })
      }
      await ctx.db.insert('deskOpenWork', {
        userId: ada,
        kind: 'dm',
        targetId: dms[0] as string,
        addedAt: 1,
      })
    })

    const listed = await t.withIdentity(asUser(PUBKEY)).query(api.desk.screenerList, {})
    expect(listed.map((item) => (item.kind === 'dm' ? item.authorName : null))).toEqual(['Cy'])
  })

  it('a legacy topic row is never listed, held or not', async () => {
    const t = convexTest(schema, modules)
    const { ada, topics } = await seed(t)
    await t.run(async (ctx) => {
      // Written before SHR-10 shipped. Nothing creates one now, nothing sweeps
      // it, and `screenerList` must not draw it — the fold owns topics, and a
      // row from both sources is the duplicate PEE-6 is about.
      for (const [i, topicId] of topics.entries()) {
        await ctx.db.insert('screenerItems', {
          userId: ada,
          kind: 'topic',
          targetId: topicId as string,
          preview: `stale ${i}`,
          createdAt: i,
        })
      }
    })

    const listed = await t.withIdentity(asUser(PUBKEY)).query(api.desk.screenerList, {})
    expect(listed).toEqual([])
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

describe('the topic half no longer writes rows (SHR-10)', () => {
  it('a message in a topic Ada was added to and never opened screens nothing', async () => {
    const t = convexTest(schema, modules)
    const { ada, bob, topics } = await seed(t)

    // Rule 2 at its strongest: Ada is a member, has never opened it, and the
    // topic is not in her open work. Under the old writer this was one row.
    await post(t, bob, { kind: 'topic', id: topics[1] as string }, 'news in a topic Ada never touched')
    expect(await screenerRowsFor(t, ada)).toEqual([])
  })

  it('an @mention in a topic screens nothing either — that rule moved too', async () => {
    const t = convexTest(schema, modules)
    const { ada, bob, topics } = await seed(t)

    await post(t, bob, { kind: 'topic', id: topics[0] as string }, 'over to @Ada on this one')
    expect(await screenerRowsFor(t, ada)).toEqual([])
  })

  it('an @mention in a DM still screens — the DM half is untouched', async () => {
    const t = convexTest(schema, modules)
    const { ada, bob, dms } = await seed(t)

    await post(t, bob, { kind: 'dm', id: dms[0] as string }, 'over to @Ada on this one')
    const rows = await screenerRowsFor(t, ada)
    expect(rows.map((r) => r.kind)).toEqual(['dm'])
  })
})
