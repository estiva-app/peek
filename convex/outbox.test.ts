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
import { encodeNpub, KIND } from '@estiva-app/protocol'

const modules = import.meta.glob('./**/*.ts')

const PUBKEY = 'a'.repeat(64)
const OTHER_PUBKEY = 'b'.repeat(64)
const EVENT_ID = 'c'.repeat(64)
const CHANNEL = '0d1c9f5a-6f7e-4a2b-9c3d-8e5f4a1b2c3d'

/** An Estiva ID identity, shaped the way `pubkeyFromIdentity` expects. */
const asUser = (pubkey: string) => ({ issuer: ESTIVA_ID_ISSUER, subject: pubkey })

/** A topic with a published channel, one member, and one message from them. */
async function seed(t: ReturnType<typeof convexTest>, opts: { channelUuid?: string | null; body?: string } = {}) {
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
      body: opts.body ?? 'hello',
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

  it('tags each person the body mentions, so a `#p` filter finds it (RIC-2)', async () => {
    /*
      NIP-27: an inline `nostr:npub…` is accompanied by a `p` tag. The composer
      writes the key into the body; this is the half that was believed to exist
      and did not — no kind:9 on production carried a `p` tag, because nothing
      passed `mentions` to the builder.
    */
    const t = convexTest(schema, modules)
    const { messageId } = await seed(t, {
      body: `ping nostr:${encodeNpub(OTHER_PUBKEY)} and again nostr:${encodeNpub(OTHER_PUBKEY)}, not @Ada`,
    })

    const built = await t.withIdentity(asUser(PUBKEY)).query(api.nostr.outbox.unsignedMessage, { messageId })

    expect(built.ok).toBe(true)
    if (!built.ok) return
    // Once per person, however often they are named; the display-name form
    // carries no key and so cannot be tagged.
    expect(built.unsigned.tags.filter((tag) => tag[0] === 'p')).toEqual([['p', OTHER_PUBKEY]])
  })

  it('carries no `p` tag when nobody is mentioned, so the wire shape is unchanged', async () => {
    const t = convexTest(schema, modules)
    const { messageId } = await seed(t)

    const built = await t.withIdentity(asUser(PUBKEY)).query(api.nostr.outbox.unsignedMessage, { messageId })

    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.unsigned.tags.some((tag) => tag[0] === 'p')).toBe(false)
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

  it('tags a person mentioned in a reply too (RIC-2)', async () => {
    // The same gap on the other half of the surface, as CON-12 found for files.
    const t = convexTest(schema, modules)
    const { messageId, authorId } = await seed(t)
    const replyId = await t.run(async (ctx) => {
      await ctx.db.patch(messageId, { nostrEventId: EVENT_ID })
      return ctx.db.insert('replies', {
        messageId,
        authorId,
        body: `nostr:${encodeNpub(OTHER_PUBKEY)} see above`,
        createdAt: Date.now(),
      })
    })

    const built = await t.withIdentity(asUser(PUBKEY)).query(api.nostr.outbox.unsignedReply, { replyId })

    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.unsigned.tags).toContainEqual(['p', OTHER_PUBKEY])
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

/**
 * DMS-4 — a DM message is a `kind:9` like any other, on the DM's own channel.
 *
 * These are the tests for the guard that used to read `parentKind !== 'topic'`.
 * The one that matters most is the refusal: a DM whose channel has not been
 * opened yet must produce **no event at all**, because an `h`-less `kind:9` is
 * not a private message with a tag missing — it is a message on nothing, which
 * the relay hands to whoever asks.
 */
describe('a DM message', () => {
  const DM_CHANNEL = '7f3a1e2b-5c4d-4e6f-8a9b-0c1d2e3f4a5b'

  /** Two people, their conversation, and one message from Ada in it. */
  async function seedDm(
    t: ReturnType<typeof convexTest>,
    opts: { channelUuid?: string | null; parentKind?: 'dm' | 'huddle' } = {},
  ) {
    return await t.run(async (ctx) => {
      const authorId = await ctx.db.insert('users', { name: 'Ada', nostrPubkey: PUBKEY })
      const partnerId = await ctx.db.insert('users', { name: 'Bo', nostrPubkey: OTHER_PUBKEY })
      const [userLowId, userHighId] =
        (authorId as string) < (partnerId as string) ? [authorId, partnerId] : [partnerId, authorId]
      const dmId = await ctx.db.insert('dmConversations', {
        userLowId,
        userHighId,
        createdAt: Date.now(),
        ...(opts.channelUuid === null ? {} : { channelUuid: opts.channelUuid ?? DM_CHANNEL }),
      })
      const messageId = await ctx.db.insert('messages', {
        parentKind: opts.parentKind ?? 'dm',
        parentId: dmId as string,
        authorId,
        body: 'just between us',
        createdAt: Date.now(),
      })
      return { authorId, partnerId, dmId, messageId }
    })
  }

  it('builds a kind:9 against the DM’s channel', async () => {
    const t = convexTest(schema, modules)
    const { messageId } = await seedDm(t)

    const built = await t.withIdentity(asUser(PUBKEY)).query(api.nostr.outbox.unsignedMessage, { messageId })

    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.unsigned.kind).toBe(KIND.STREAM_MESSAGE)
    expect(built.unsigned.content).toBe('just between us')
    expect(built.unsigned.tags).toContainEqual(['h', DM_CHANNEL])
  })

  it('refuses rather than publishing one with no channel to be in', async () => {
    const t = convexTest(schema, modules)
    const { messageId } = await seedDm(t, { channelUuid: null })

    const built = await t.withIdentity(asUser(PUBKEY)).query(api.nostr.outbox.unsignedMessage, { messageId })

    expect(built).toEqual({ ok: false, reason: 'the DM has no channel on the relay yet' })
  })

  it('still refuses a huddle, which has no container on the relay at all', async () => {
    const t = convexTest(schema, modules)
    const { messageId } = await seedDm(t, { parentKind: 'huddle' })

    const built = await t.withIdentity(asUser(PUBKEY)).query(api.nostr.outbox.unsignedMessage, { messageId })

    expect(built).toEqual({ ok: false, reason: 'a huddle has no channel on the relay', expected: true })
  })

  it('keeps the author gate — the partner may not publish it as Ada', async () => {
    const t = convexTest(schema, modules)
    const { messageId } = await seedDm(t)

    const built = await t
      .withIdentity(asUser(OTHER_PUBKEY))
      .query(api.nostr.outbox.unsignedMessage, { messageId })

    expect(built).toEqual({ ok: false, reason: 'only the author may publish their message' })
  })

  it('keeps first-publish-wins', async () => {
    const t = convexTest(schema, modules)
    const { messageId } = await seedDm(t)
    await t.run(async (ctx) => ctx.db.patch(messageId, { nostrEventId: EVENT_ID }))

    const built = await t.withIdentity(asUser(PUBKEY)).query(api.nostr.outbox.unsignedMessage, { messageId })

    expect(built).toEqual({ ok: false, reason: 'already published' })
  })

  it('keeps the drift window', async () => {
    const t = convexTest(schema, modules)
    const { messageId } = await seedDm(t)
    await t.run(async (ctx) => ctx.db.patch(messageId, { createdAt: Date.now() - 60 * 60 * 1000 }))

    const built = await t.withIdentity(asUser(PUBKEY)).query(api.nostr.outbox.unsignedMessage, { messageId })

    expect(built).toEqual({ ok: false, reason: 'outside the relay drift window' })
  })

  it('threads a reply onto the same channel', async () => {
    const t = convexTest(schema, modules)
    const { messageId, authorId } = await seedDm(t)
    const replyId = await t.run(async (ctx) => {
      await ctx.db.patch(messageId, { nostrEventId: EVENT_ID })
      return ctx.db.insert('replies', { messageId, authorId, body: 'and back', createdAt: Date.now() })
    })

    const built = await t.withIdentity(asUser(PUBKEY)).query(api.nostr.outbox.unsignedReply, { replyId })

    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.unsigned.tags).toContainEqual(['h', DM_CHANNEL])
    expect(built.unsigned.tags.filter((tag) => tag[0] === 'e')).toEqual([['e', EVENT_ID, '', 'reply']])
  })

  /*
    An edit of a DM message publishes too, and it has to: the body of a `kind:9`
    is the relay's to own (ADR 0001 §5), so patching Convex alone would leave
    every other reader of that channel on the old text — the divergence CON-8
    removed for topics. Before DMS-4 this branch was unreachable, because a DM
    message never had an event id to edit.
  */
  it('publishes an edit of one, in the DM’s channel', async () => {
    const t = convexTest(schema, modules)
    const { messageId } = await seedDm(t)
    await t.run(async (ctx) => ctx.db.patch(messageId, { nostrEventId: EVENT_ID }))

    const built = await t
      .withIdentity(asUser(PUBKEY))
      .query(api.nostr.outbox.unsignedEdit, { key: messageId, body: 'corrected' })

    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.unsigned.tags).toContainEqual(['e', EVENT_ID])
    expect(built.unsigned.tags).toContainEqual(['h', DM_CHANNEL])
  })

  /*
    DMS-11. The last builder that read `parentKind !== 'topic'`, and the reason
    it stopped: a topic's resolution has been a kind:9101 on the relay since
    PEEK-128, so a DM's staying in Convex was an inconsistency rather than a
    decision. The assertion is as private as what it is about — a DM channel is
    private, so only the two participants can read either.
  */
  it('publishes a resolution of one, in the DM’s channel', async () => {
    const t = convexTest(schema, modules)
    const { messageId, authorId } = await seedDm(t)
    const assertionId = await t.run(async (ctx) => {
      await ctx.db.patch(messageId, { nostrEventId: EVENT_ID })
      return ctx.db.insert('resolutionAssertions', {
        messageId,
        authorId,
        action: 'resolved',
        trusted: true,
        createdAt: Date.now(),
      })
    })

    const built = await t
      .withIdentity(asUser(PUBKEY))
      .query(api.nostr.outbox.unsignedResolution, { assertionId })

    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.unsigned.kind).toBe(KIND.ASSERTION)
    expect(built.unsigned.tags).toContainEqual(['e', EVENT_ID])
    expect(built.unsigned.tags).toContainEqual(['h', DM_CHANNEL])
  })

  it('refuses a resolution of a huddle message, which has no channel', async () => {
    const t = convexTest(schema, modules)
    const { messageId, authorId } = await seedDm(t, { parentKind: 'huddle' })
    const assertionId = await t.run(async (ctx) => {
      await ctx.db.patch(messageId, { nostrEventId: EVENT_ID })
      return ctx.db.insert('resolutionAssertions', {
        messageId,
        authorId,
        action: 'resolved',
        trusted: true,
        createdAt: Date.now(),
      })
    })

    const built = await t
      .withIdentity(asUser(PUBKEY))
      .query(api.nostr.outbox.unsignedResolution, { assertionId })

    expect(built).toEqual({ ok: false, reason: 'a huddle has no channel on the relay', expected: true })
  })

  /*
    The rule this keeps: an assertion about an event nobody can resolve would be
    a dangling claim on the channel. It is also the state every DM resolution
    taken before DMS-11 is in — the row exists, the target has no event id, and
    the refusal is the right answer rather than a backlog to flush.
  */
  it('still refuses while the message being resolved is not on the relay', async () => {
    const t = convexTest(schema, modules)
    const { messageId, authorId } = await seedDm(t)
    const assertionId = await t.run(async (ctx) =>
      ctx.db.insert('resolutionAssertions', {
        messageId,
        authorId,
        action: 'resolved',
        trusted: true,
        createdAt: Date.now(),
      }),
    )

    const built = await t
      .withIdentity(asUser(PUBKEY))
      .query(api.nostr.outbox.unsignedResolution, { assertionId })

    expect(built).toEqual({ ok: false, reason: 'the message being resolved is not on the relay yet' })
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
