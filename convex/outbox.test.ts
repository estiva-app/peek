// @vitest-environment edge-runtime

/**
 * The first tests in this repo that run a Convex query or mutation.
 *
 * Everything under `convex/` was previously covered only where it happened to
 * be a pure function — the builders, nip19, nip98. Mutations and queries had no
 * harness at all, which is why "240 tests pass" has never been evidence about
 * this layer, and why every bug in this project has been a silent skip inside
 * it rather than a thrown error.
 *
 * These cover `outbox.ts` (PEEK-106), where the failure mode is precise and
 * invisible: a wrong `reason` means the browser quietly publishes nothing, and
 * the app looks exactly the same as when it works.
 */
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'
import { ESTIVA_ID_ISSUER } from './users'
import { KIND } from './nostr/events'

const modules = import.meta.glob('./**/*.ts')

const PUBKEY = 'a'.repeat(64)
const OTHER_PUBKEY = 'b'.repeat(64)
const EVENT_ID = 'c'.repeat(64)
const CHANNEL = '0d1c9f5a-6f7e-4a2b-9c3d-8e5f4a1b2c3d'

/** An Estiva ID identity, shaped the way `pubkeyFromIdentity` expects. */
const asUser = (pubkey: string) => ({ issuer: ESTIVA_ID_ISSUER, subject: pubkey })

/** A topic with a published channel, one member, and one message from them. */
async function seed(t: ReturnType<typeof convexTest>, opts: { channelUuid?: string | null } = {}) {
  return await t.run(async (ctx) => {
    const authorId = await ctx.db.insert('users', { name: 'Ada', nostrPubkey: PUBKEY })
    const topicId = await ctx.db.insert('topics', {
      title: 'Interop',
      creatorId: authorId,
      createdAt: Date.now(),
      ...(opts.channelUuid === null ? {} : { channelUuid: opts.channelUuid ?? CHANNEL }),
    })
    const messageId = await ctx.db.insert('messages', {
      parentKind: 'topic',
      parentId: topicId as string,
      authorId,
      body: 'hello',
      createdAt: Date.now(),
    })
    return { authorId, topicId, messageId }
  })
}

describe('unsignedMessage', () => {
  it('builds a kind:9 for the author', async () => {
    const t = convexTest(schema, modules)
    const { messageId } = await seed(t)

    const built = await t
      .withIdentity(asUser(PUBKEY))
      .query(api.nostr.outbox.unsignedMessage, { messageId })

    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.unsigned.kind).toBe(KIND.STREAM_MESSAGE)
    expect(built.unsigned.pubkey).toBe(PUBKEY)
    expect(built.unsigned.content).toBe('hello')
    // The channel binding is what routes it to the right Folder in Ship.
    expect(built.unsigned.tags).toContainEqual(['h', CHANNEL])
    // An unsigned event must carry no signature — the browser adds it.
    expect(built.unsigned).not.toHaveProperty('sig')
  })

  it('refuses somebody else’s message', async () => {
    const t = convexTest(schema, modules)
    const { messageId } = await seed(t)
    await t.run(async (ctx) => {
      await ctx.db.insert('users', { name: 'Mallory', nostrPubkey: OTHER_PUBKEY })
    })

    const built = await t
      .withIdentity(asUser(OTHER_PUBKEY))
      .query(api.nostr.outbox.unsignedMessage, { messageId })

    expect(built).toEqual({ ok: false, reason: 'only the author may publish their message' })
  })

  it('refuses when unauthenticated', async () => {
    const t = convexTest(schema, modules)
    const { messageId } = await seed(t)
    const built = await t.query(api.nostr.outbox.unsignedMessage, { messageId })
    expect(built.ok).toBe(false)
  })

  it('is idempotent: a published row is refused rather than rebuilt', async () => {
    const t = convexTest(schema, modules)
    const { messageId } = await seed(t)
    await t.run(async (ctx) => ctx.db.patch(messageId, { nostrEventId: EVENT_ID }))

    const built = await t
      .withIdentity(asUser(PUBKEY))
      .query(api.nostr.outbox.unsignedMessage, { messageId })

    expect(built).toEqual({ ok: false, reason: 'already published' })
  })

  it('refuses a topic whose channel is not on the relay yet', async () => {
    const t = convexTest(schema, modules)
    const { messageId } = await seed(t, { channelUuid: null })

    const built = await t
      .withIdentity(asUser(PUBKEY))
      .query(api.nostr.outbox.unsignedMessage, { messageId })

    expect(built).toEqual({ ok: false, reason: 'the topic has no channel on the relay yet' })
  })

  it('refuses a message older than the relay’s ±15 minute window', async () => {
    const t = convexTest(schema, modules)
    const { messageId } = await seed(t)
    await t.run(async (ctx) => ctx.db.patch(messageId, { createdAt: Date.now() - 60 * 60 * 1000 }))

    const built = await t
      .withIdentity(asUser(PUBKEY))
      .query(api.nostr.outbox.unsignedMessage, { messageId })

    expect(built).toEqual({ ok: false, reason: 'outside the relay drift window' })
  })
})

describe('unsignedReply', () => {
  it('threads onto the parent with the single NIP-10 reply tag', async () => {
    const t = convexTest(schema, modules)
    const { messageId, authorId } = await seed(t)
    const replyId = await t.run(async (ctx) => {
      await ctx.db.patch(messageId, { nostrEventId: EVENT_ID })
      return ctx.db.insert('replies', {
        messageId,
        authorId,
        body: 'reply body',
        createdAt: Date.now(),
      })
    })

    const built = await t.withIdentity(asUser(PUBKEY)).query(api.nostr.outbox.unsignedReply, { replyId })

    expect(built.ok).toBe(true)
    if (!built.ok) return
    // Peek's replies are always direct, so Buzz expects ONE `e` tag marked
    // "reply" — not a root/reply pair. Getting this wrong changes the event id.
    const eTags = built.unsigned.tags.filter((tag) => tag[0] === 'e')
    expect(eTags).toEqual([['e', EVENT_ID, '', 'reply']])
  })

  it('refuses while the parent message is not on the relay', async () => {
    const t = convexTest(schema, modules)
    const { messageId, authorId } = await seed(t)
    const replyId = await t.run(async (ctx) =>
      ctx.db.insert('replies', { messageId, authorId, body: 'early', createdAt: Date.now() }),
    )

    const built = await t.withIdentity(asUser(PUBKEY)).query(api.nostr.outbox.unsignedReply, { replyId })

    expect(built).toEqual({
      ok: false,
      reason: 'the message being replied to is not on the relay yet',
    })
  })
})

describe('unsignedReaction', () => {
  it('builds a kind:7 pointing at the target event', async () => {
    const t = convexTest(schema, modules)
    const { messageId, authorId } = await seed(t)
    const reactionId = await t.run(async (ctx) => {
      await ctx.db.patch(messageId, { nostrEventId: EVENT_ID })
      return ctx.db.insert('reactions', {
        messageId,
        userId: authorId,
        emoji: '🎉',
        createdAt: Date.now(),
      })
    })

    const built = await t
      .withIdentity(asUser(PUBKEY))
      .query(api.nostr.outbox.unsignedReaction, { reactionId })

    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.unsigned.kind).toBe(KIND.REACTION)
    expect(built.unsigned.content).toBe('🎉')
    expect(built.unsigned.tags).toContainEqual(['e', EVENT_ID])
  })
})

describe('recordMessagePublished', () => {
  it('stamps the event id for the author', async () => {
    const t = convexTest(schema, modules)
    const { messageId } = await seed(t)

    await t
      .withIdentity(asUser(PUBKEY))
      .mutation(api.nostr.outbox.recordMessagePublished, { messageId, nostrEventId: EVENT_ID })

    const row = await t.run(async (ctx) => ctx.db.get(messageId))
    expect(row?.nostrEventId).toBe(EVENT_ID)
  })

  it('will not let one user stamp another’s row', async () => {
    const t = convexTest(schema, modules)
    const { messageId } = await seed(t)
    await t.run(async (ctx) => {
      await ctx.db.insert('users', { name: 'Mallory', nostrPubkey: OTHER_PUBKEY })
    })

    await t
      .withIdentity(asUser(OTHER_PUBKEY))
      .mutation(api.nostr.outbox.recordMessagePublished, { messageId, nostrEventId: EVENT_ID })

    // Left untouched: a wrong id here would misdirect every later deletion and
    // reply, which all point at whatever this field says.
    const row = await t.run(async (ctx) => ctx.db.get(messageId))
    expect(row?.nostrEventId).toBeUndefined()
  })
})
