// @vitest-environment edge-runtime

/**
 * PEE-6 — an item already in Open Work must not show in the Screener.
 *
 * "Because then it feels like duplicate. You're trying to open item that is
 * already open."
 *
 * What is left of the rule on this side is read-time: `screenerList` skips a
 * DM row whose conversation is in Open work. The write-time half ran in the
 * Screener fan-out, which went with the last Convex message write (FOL-23), and
 * the topic half went with the Convex topics.
 */
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'
import { ESTIVA_ID_ISSUER } from './users'
import type { Id } from './_generated/dataModel'

const modules = import.meta.glob('./**/*.ts')

const PUBKEY = 'a'.repeat(64)
const asUser = (pubkey: string) => ({ issuer: ESTIVA_ID_ISSUER, subject: pubkey })

/**
 * Ada (the viewer) with a DM each to Bob and Cy, and a topic row left over
 * from before FOL-23.
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
    const topic = await ctx.db.insert('topics', { title: 'Legacy', creatorId: bob, createdAt: 1 })
    return { ada, bob, cy, dms, topic }
  })
}

describe('open work silences the screener (the DM half)', () => {
  it('a row whose DM is in Open work is not listed', async () => {
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
    expect(listed.map((item) => item.authorName)).toEqual(['Cy'])
  })

  it('a legacy topic row is never listed', async () => {
    const t = convexTest(schema, modules)
    const { ada, topic } = await seed(t)
    await t.run(async (ctx) => {
      await ctx.db.insert('screenerItems', {
        userId: ada,
        kind: 'topic',
        targetId: topic as string,
        preview: 'stale',
        createdAt: 1,
      })
    })

    const listed = await t.withIdentity(asUser(PUBKEY)).query(api.desk.screenerList, {})
    expect(listed).toEqual([])
  })
})

describe('the hover preview', () => {
  it('falls back to the conversation’s newest three messages', async () => {
    const t = convexTest(schema, modules)
    const { ada, bob, dms } = await seed(t)
    const itemId = await t.run(async (ctx) => {
      // Explicit instants: the preview takes the newest three.
      for (const [i, body] of ['first', 'second', 'third', 'fourth'].entries()) {
        await ctx.db.insert('messages', {
          parentKind: 'dm',
          parentId: dms[0] as string,
          authorId: bob,
          body,
          createdAt: 1_000 + i,
        })
      }
      return await ctx.db.insert('screenerItems', {
        userId: ada,
        kind: 'dm',
        targetId: dms[0] as string,
        preview: 'fourth',
        createdAt: 1,
      })
    })

    const rows = await t.withIdentity(asUser(PUBKEY)).query(api.screener.preview, { itemId })
    expect(rows?.map((r) => r.body)).toEqual(['second', 'third', 'fourth'])
  })

  it('answers nobody else’s inbox', async () => {
    const t = convexTest(schema, modules)
    const { bob, dms } = await seed(t)
    const itemId = await t.run(
      async (ctx) =>
        await ctx.db.insert('screenerItems', {
          userId: bob,
          kind: 'dm',
          targetId: dms[0] as string,
          preview: 'Bob’s',
          createdAt: 1,
        }),
    )

    expect(await t.withIdentity(asUser(PUBKEY)).query(api.screener.preview, { itemId })).toBeNull()
  })
})
