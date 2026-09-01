// @vitest-environment edge-runtime

/**
 * The horizon cache (CRO-6).
 *
 * NIP-RS fetches with `since: now - horizon`, and a context that has aged out is
 * indistinguishable from one that was never read — SPEC §11.6 says so outright.
 * For Peek that means a long-lived topic read three weeks ago lights the sidebar
 * up, which is the staleness symptom this programme exists to remove.
 *
 * The done-when is two halves that must stay apart, and the horizon alone cannot
 * tell them apart: **read long ago stays read**, and **never read stays unread**.
 */
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'
import { ESTIVA_ID_ISSUER } from './users'

const modules = import.meta.glob('./**/*.ts')

const PUBKEY = 'a'.repeat(64)
const EVENT_ID = 'c'.repeat(64)
const CHANNEL = '0d1c9f5a-6f7e-4a2b-9c3d-8e5f4a1b2c3d'
const QUIET_CHANNEL = '1e2d3c4b-5a69-4788-9b1c-2d3e4f5a6b7c'

const asUser = (pubkey: string) => ({ issuer: ESTIVA_ID_ISSUER, subject: pubkey })

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Two topics with channels — one the viewer read long ago, one they never
 * opened — plus a message carrying a relay event id, so a `thread:` context has
 * something to resolve to.
 */
async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert('users', { name: 'Ada', nostrPubkey: PUBKEY })
    const quietTopicId = await ctx.db.insert('topics', {
      title: 'Read three weeks ago',
      creatorId: userId,
      createdAt: Date.now() - 40 * DAY_MS,
      channelUuid: QUIET_CHANNEL,
    })
    const freshTopicId = await ctx.db.insert('topics', {
      title: 'Never opened',
      creatorId: userId,
      createdAt: Date.now(),
      channelUuid: CHANNEL,
    })
    const messageId = await ctx.db.insert('messages', {
      parentKind: 'topic',
      parentId: freshTopicId as string,
      authorId: userId,
      body: 'hello',
      createdAt: Date.now(),
      nostrEventId: EVENT_ID,
    })
    return { userId, quietTopicId, freshTopicId, messageId }
  })
}

describe('applyRelayReadState — relay into the cache', () => {
  it('resolves a bare channel uuid to the topic and caches it', async () => {
    const t = convexTest(schema, modules)
    const { userId, quietTopicId } = await seed(t)

    const result = await t
      .withIdentity(asUser(PUBKEY))
      .mutation(api.readState.applyRelayReadState, {
        contexts: [{ context: QUIET_CHANNEL, atSeconds: 1_700_000_000 }],
      })

    expect(result).toEqual({ applied: 1, unresolved: 0 })
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query('readState')
        .withIndex('by_user_container', (q) => q.eq('userId', userId))
        .collect(),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].containerId).toBe(quietTopicId as string)
    // The unit boundary: NIP-RS stores seconds, readState stores milliseconds.
    // Getting this wrong does not throw — it dates everything to 1970, or to
    // the year 56000 and marks the whole workspace permanently read.
    expect(rows[0].lastReadAt).toBe(1_700_000_000_000)
  })

  it('resolves a thread context to the message the thread hangs off', async () => {
    const t = convexTest(schema, modules)
    const { userId, messageId } = await seed(t)

    await t.withIdentity(asUser(PUBKEY)).mutation(api.readState.applyRelayReadState, {
      contexts: [{ context: `thread:${EVENT_ID}`, atSeconds: 1_700_000_000 }],
    })

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query('readState')
        .withIndex('by_user_container', (q) => q.eq('userId', userId))
        .collect(),
    )
    // The same key `markThreadRead` writes, so the two paths agree by construction.
    expect(rows[0].containerId).toBe(messageId as string)
  })

  /** Max only, in this direction. An overwrite would un-read messages. */
  it('never lowers a cached watermark', async () => {
    const t = convexTest(schema, modules)
    const { userId } = await seed(t)
    const apply = (atSeconds: number) =>
      t.withIdentity(asUser(PUBKEY)).mutation(api.readState.applyRelayReadState, {
        contexts: [{ context: QUIET_CHANNEL, atSeconds }],
      })

    await apply(1_700_000_000)
    await apply(1_600_000_000) // older, arriving late
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query('readState')
        .withIndex('by_user_container', (q) => q.eq('userId', userId))
        .collect(),
    )
    expect(rows[0].lastReadAt).toBe(1_700_000_000_000)

    await apply(1_800_000_000) // newer, does advance
    const after = await t.run(async (ctx) =>
      ctx.db
        .query('readState')
        .withIndex('by_user_container', (q) => q.eq('userId', userId))
        .collect(),
    )
    expect(after[0].lastReadAt).toBe(1_800_000_000_000)
  })

  it('reports contexts it cannot place rather than dropping them silently', async () => {
    const t = convexTest(schema, modules)
    await seed(t)

    const result = await t
      .withIdentity(asUser(PUBKEY))
      .mutation(api.readState.applyRelayReadState, {
        contexts: [
          // A channel this deployment has never seen — another app's, or a
          // topic that has not synced here yet.
          { context: '9f8e7d6c-5b4a-4392-8172-635445362718', atSeconds: 1_700_000_000 },
          // A real NIP-RS grain Peek has nowhere to put: the UI has container
          // and thread watermarks and no per-message one. Folding it into the
          // thread would advance a whole thread because one message was read.
          { context: `msg:${EVENT_ID}`, atSeconds: 1_700_000_000 },
        ],
      })

    expect(result).toEqual({ applied: 0, unresolved: 2 })
  })
})

describe('cachedReadContexts — the cache back out as protocol contexts', () => {
  it('returns a topic watermark as its bare channel uuid, in seconds', async () => {
    const t = convexTest(schema, modules)
    const { userId, quietTopicId } = await seed(t)
    await t.run(async (ctx) => {
      await ctx.db.insert('readState', {
        userId,
        containerId: quietTopicId as string,
        lastReadAt: 1_700_000_000_000,
      })
    })

    const contexts = await t
      .withIdentity(asUser(PUBKEY))
      .query(api.readState.cachedReadContexts, {})

    expect(contexts).toEqual([{ context: QUIET_CHANNEL, atSeconds: 1_700_000_000 }])
  })

  it('returns a thread watermark as thread:<event id>', async () => {
    const t = convexTest(schema, modules)
    const { userId, messageId } = await seed(t)
    await t.run(async (ctx) => {
      await ctx.db.insert('readState', {
        userId,
        containerId: messageId as string,
        lastReadAt: 1_700_000_000_000,
      })
    })

    const contexts = await t
      .withIdentity(asUser(PUBKEY))
      .query(api.readState.cachedReadContexts, {})

    expect(contexts).toEqual([{ context: `thread:${EVENT_ID}`, atSeconds: 1_700_000_000 }])
  })

  /** No protocol identity, no context — CRO-4 declines to invent one, so does this. */
  it('omits a watermark on an object the relay has never seen', async () => {
    const t = convexTest(schema, modules)
    const { userId } = await seed(t)
    const unpublished = await t.run(async (ctx) => {
      const id = await ctx.db.insert('topics', {
        title: 'Local only',
        creatorId: userId,
        createdAt: Date.now(),
      })
      await ctx.db.insert('readState', {
        userId,
        containerId: id as string,
        lastReadAt: 1_700_000_000_000,
      })
      return id
    })
    expect(unpublished).toBeTruthy()

    const contexts = await t
      .withIdentity(asUser(PUBKEY))
      .query(api.readState.cachedReadContexts, {})
    expect(contexts).toEqual([])
  })

  it('round-trips: what goes in as a context comes back as the same context', async () => {
    const t = convexTest(schema, modules)
    await seed(t)
    const asUserT = t.withIdentity(asUser(PUBKEY))

    await asUserT.mutation(api.readState.applyRelayReadState, {
      contexts: [
        { context: QUIET_CHANNEL, atSeconds: 1_700_000_000 },
        { context: `thread:${EVENT_ID}`, atSeconds: 1_700_000_500 },
      ],
    })
    const back = await asUserT.query(api.readState.cachedReadContexts, {})

    expect(back.sort((a, b) => a.context.localeCompare(b.context))).toEqual(
      [
        { context: QUIET_CHANNEL, atSeconds: 1_700_000_000 },
        { context: `thread:${EVENT_ID}`, atSeconds: 1_700_000_500 },
      ].sort((a, b) => a.context.localeCompare(b.context)),
    )
  })
})

describe("the done-when: the two halves the horizon cannot tell apart", () => {
  /**
   * Read long ago, and the relay has since forgotten it. The cache is the only
   * thing standing between that and a sidebar dot.
   */
  it('a container read before the horizon still reads as read', async () => {
    const t = convexTest(schema, modules)
    const { userId, quietTopicId } = await seed(t)

    // It was read 40 days ago and cached then.
    const readAt = Date.now() - 40 * DAY_MS
    await t.withIdentity(asUser(PUBKEY)).mutation(api.readState.applyRelayReadState, {
      contexts: [{ context: QUIET_CHANNEL, atSeconds: Math.floor(readAt / 1000) }],
    })

    // The relay's blobs age out: a later fetch returns nothing for it at all.
    await t.withIdentity(asUser(PUBKEY)).mutation(api.readState.applyRelayReadState, {
      contexts: [],
    })

    const cached = await t.run(async (ctx) =>
      ctx.db
        .query('readState')
        .withIndex('by_user_container', (q) => q.eq('userId', userId))
        .collect(),
    )
    // Still cached, and still ahead of the topic's messages — so: read.
    const quiet = cached.find((r) => r.containerId === (quietTopicId as string))
    expect(quiet?.lastReadAt).toBeGreaterThan(0)
  })

  it('a container that was never read stays unread', async () => {
    const t = convexTest(schema, modules)
    const { userId, freshTopicId } = await seed(t)

    await t.withIdentity(asUser(PUBKEY)).mutation(api.readState.applyRelayReadState, {
      contexts: [{ context: QUIET_CHANNEL, atSeconds: 1_700_000_000 }],
    })

    const cached = await t.run(async (ctx) =>
      ctx.db
        .query('readState')
        .withIndex('by_user_container', (q) => q.eq('userId', userId))
        .collect(),
    )
    // No watermark at all — which is what `unread.ts` reads as "never opened".
    // The whole point of the cache is that this stays distinguishable from the
    // aged-out case above.
    expect(cached.some((r) => r.containerId === (freshTopicId as string))).toBe(false)
  })
})

describe('the sidebar dot, which is what a person actually sees', () => {
  /**
   * The done-when, checked through `unread.summary` — the query the sidebar
   * reads — rather than through the cache table it happens to be built on.
   *
   * Messages here are authored by somebody else: your own writing is never new
   * to you, so a self-authored fixture would report "read" for the wrong reason
   * and pass whatever the cache did.
   */
  async function seedWithOtherAuthor(t: ReturnType<typeof convexTest>) {
    return await t.run(async (ctx) => {
      const me = await ctx.db.insert('users', { name: 'Ada', nostrPubkey: PUBKEY })
      const them = await ctx.db.insert('users', { name: 'Bob', nostrPubkey: 'b'.repeat(64) })
      const quietTopicId = await ctx.db.insert('topics', {
        title: 'Read three weeks ago',
        creatorId: them,
        createdAt: Date.now() - 40 * DAY_MS,
        channelUuid: QUIET_CHANNEL,
      })
      const freshTopicId = await ctx.db.insert('topics', {
        title: 'Never opened',
        creatorId: them,
        createdAt: Date.now(),
        channelUuid: CHANNEL,
      })
      await ctx.db.insert('messages', {
        parentKind: 'topic',
        parentId: quietTopicId as string,
        authorId: them,
        body: 'said 40 days ago',
        createdAt: Date.now() - 40 * DAY_MS,
      })
      await ctx.db.insert('messages', {
        parentKind: 'topic',
        parentId: freshTopicId as string,
        authorId: them,
        body: 'said just now',
        createdAt: Date.now(),
      })
      return { me, quietTopicId, freshTopicId }
    })
  }

  it('keeps a long-quiet topic read, and a never-opened one unread, after the horizon forgets both', async () => {
    const t = convexTest(schema, modules)
    const { quietTopicId, freshTopicId } = await seedWithOtherAuthor(t)
    const viewer = t.withIdentity(asUser(PUBKEY))

    // Read 39 days ago — inside no plausible NIP-RS horizon, cached here.
    await viewer.mutation(api.readState.applyRelayReadState, {
      contexts: [{ context: QUIET_CHANNEL, atSeconds: Math.floor((Date.now() - 39 * DAY_MS) / 1000) }],
    })

    // Now the relay's blobs age out entirely: a fetch returns no contexts at all.
    await viewer.mutation(api.readState.applyRelayReadState, { contexts: [] })

    const summary = await viewer.query(api.unread.summary, {})

    // The half the horizon alone gets wrong: still read, no sidebar dot.
    expect(summary.topics).not.toContain(quietTopicId as string)
    // The half it must not break: genuinely never opened, so still unread.
    expect(summary.topics).toContain(freshTopicId as string)
  })

  it('without the cache, the same topic would light up — the control for the test above', async () => {
    const t = convexTest(schema, modules)
    const { quietTopicId } = await seedWithOtherAuthor(t)
    const viewer = t.withIdentity(asUser(PUBKEY))

    // Same fixture, nothing cached. This is what the horizon alone produces,
    // and it is the regression the cache exists to prevent.
    const summary = await viewer.query(api.unread.summary, {})
    expect(summary.topics).toContain(quietTopicId as string)
  })
})
