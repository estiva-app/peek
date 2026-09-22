// @vitest-environment edge-runtime

/**
 * CON-8 — an edit leaves Peek, and the row is not the only record of it.
 *
 * `editBody` was a `ctx.db.patch` and nothing else, so a human edit never
 * reached the relay: the original `kind:9` body stayed, and Ship's conversation
 * view — and every other reader — showed stale text indefinitely with nothing
 * announcing the divergence. ADR 0001: *"Convex may never be the source of truth
 * for something the relay owns."*
 *
 * It also checked **nobody**. Not the author, not even a signed-in viewer — the
 * same shape as `remove` before PEE-18, with the UI's `isOwnMessage` the only
 * thing holding it shut.
 */
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'
import { ESTIVA_ID_ISSUER } from './users'

const modules = import.meta.glob('./**/*.ts')

const ADA = 'a'.repeat(64)
const AGENT = 'b'.repeat(64)
const TARGET = 'e'.repeat(64)
const asUser = (pubkey: string) => ({ issuer: ESTIVA_ID_ISSUER, subject: pubkey })

/*
  `parent: 'huddle'` for the editBody cases: a topic takes no writes since the
  CON-8 stop (Stop writing messages to Convex), so the author rules are pinned
  on a container that still does. `unsignedEdit` reads a topic's channel.
*/
async function seed(t: ReturnType<typeof convexTest>, opts: { published?: boolean; parent?: 'topic' | 'huddle' } = {}) {
  return await t.run(async (ctx) => {
    const ada = await ctx.db.insert('users', { name: 'Ada', nostrPubkey: ADA })
    const agent = await ctx.db.insert('users', { name: 'Claude', nostrPubkey: AGENT })
    const topicId = await ctx.db.insert('topics', {
      title: 'Planning',
      creatorId: agent,
      createdAt: 1,
      channelUuid: '11111111-1111-4111-8111-111111111111',
    })
    for (const userId of [ada, agent]) {
      await ctx.db.insert('topicMembers', { topicId, userId, addedAt: 1 })
    }
    const huddleId =
      opts.parent === 'huddle'
        ? await ctx.db.insert('huddles', { topicId, state: 'active', createdById: agent, createdAt: 1 })
        : undefined
    const messageId = await ctx.db.insert('messages', {
      parentKind: huddleId ? 'huddle' : 'topic',
      parentId: (huddleId ?? topicId) as string,
      authorId: agent,
      body: "the agent's original words",
      createdAt: 10,
      seedKey: 'msg-1',
      ...(opts.published === false ? {} : { nostrEventId: TARGET }),
    })
    return { ada, agent, messageId }
  })
}

describe('editBody', () => {
  it('patches for the author', async () => {
    const t = convexTest(schema, modules)
    const { messageId } = await seed(t, { parent: 'huddle' })
    const out = await t.withIdentity(asUser(AGENT)).mutation(api.messages.editBody, { key: 'msg-1', body: 'corrected' })

    expect(out.patched).toBe(true)
    expect((await t.run(async (ctx) => await ctx.db.get(messageId)))?.body).toBe('corrected')
  })

  /*
    The hole. Before this there was no viewer at all, so any caller could
    rewrite anybody's message — and only in Peek, since nothing was published.
  */
  it('does NOT patch for someone who is not the author', async () => {
    const t = convexTest(schema, modules)
    const { messageId } = await seed(t, { parent: 'huddle' })
    const out = await t.withIdentity(asUser(ADA)).mutation(api.messages.editBody, { key: 'msg-1', body: 'not yours' })

    expect(out.patched).toBe(false)
    expect((await t.run(async (ctx) => await ctx.db.get(messageId)))?.body).toBe("the agent's original words")
  })

  it('refuses a non-author outright when the message never reached the relay', async () => {
    const t = convexTest(schema, modules)
    await seed(t, { published: false, parent: 'huddle' })
    await expect(
      t.withIdentity(asUser(ADA)).mutation(api.messages.editBody, { key: 'msg-1', body: 'x' }),
    ).rejects.toThrow(/only the author/)
  })

  it('refuses a topic message even for its author (CON-8 stop)', async () => {
    const t = convexTest(schema, modules)
    const { messageId } = await seed(t)
    await expect(
      t.withIdentity(asUser(AGENT)).mutation(api.messages.editBody, { key: 'msg-1', body: 'corrected' }),
    ).rejects.toThrow(/read-only/)
    expect((await t.run(async (ctx) => await ctx.db.get(messageId)))?.body).toBe("the agent's original words")
  })

  it('refuses a caller who is not signed in at all', async () => {
    const t = convexTest(schema, modules)
    await seed(t)
    await expect(t.mutation(api.messages.editBody, { key: 'msg-1', body: 'x' })).rejects.toThrow()
  })
})

describe('unsignedEdit', () => {
  it('builds a kind:40003 naming the target, in the target’s channel', async () => {
    const t = convexTest(schema, modules)
    await seed(t)
    const built = await t
      .withIdentity(asUser(AGENT))
      .query(api.nostr.outbox.unsignedEdit, { key: 'msg-1', body: 'corrected' })

    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.unsigned.kind).toBe(40003)
    expect(built.unsigned.content).toBe('corrected')
    expect(built.unsigned.tags).toContainEqual(['e', TARGET])
    expect(built.unsigned.tags).toContainEqual(['h', '11111111-1111-4111-8111-111111111111'])
  })

  /*
    Unlike `unsignedMessage` and `unsignedReply`, which refuse for anyone but the
    author — you cannot publish somebody else's message AS them. An edit is
    signed by the viewer and names the target, which is what the relay's
    `validate_edit_ownership` expects to adjudicate.
  */
  it('builds one for a non-author too, because the relay decides', async () => {
    const t = convexTest(schema, modules)
    await seed(t)
    const built = await t
      .withIdentity(asUser(ADA))
      .query(api.nostr.outbox.unsignedEdit, { key: 'msg-1', body: 'corrected' })

    expect(built.ok).toBe(true)
    if (built.ok) expect(built.unsigned.pubkey).toBe(ADA)
  })

  /*
    PEE-24 — the discriminator the whole reporting design rests on.

    Peek patches its row before publishing, so a failed publish leaves the app
    looking right and every other reader showing the old text. That has to be
    said out loud — but only when it is actually wrong. A DM or a row that never
    reached the relay was never going to travel, and reporting those would train
    people to dismiss the message that matters.

    The flag lives here because only this file knows which reasons are ordinary.
    A caller matching on the strings would rot the first time one is reworded.
  */
  it('declines when there is nothing on the relay to edit, and calls it expected', async () => {
    const t = convexTest(schema, modules)
    await seed(t, { published: false })
    const built = await t
      .withIdentity(asUser(AGENT))
      .query(api.nostr.outbox.unsignedEdit, { key: 'msg-1', body: 'x' })
    expect(built.ok).toBe(false)
    if (!built.ok) expect(built.expected).toBe(true)
  })

  it('does NOT call a signed-out caller expected — that one is worth saying', async () => {
    const t = convexTest(schema, modules)
    await seed(t)
    const built = await t.query(api.nostr.outbox.unsignedEdit, { key: 'msg-1', body: 'x' })
    expect(built.ok).toBe(false)
    if (!built.ok) expect(built.expected).toBeFalsy()
  })

  it('does NOT call an unknown message expected either', async () => {
    const t = convexTest(schema, modules)
    await seed(t)
    const built = await t
      .withIdentity(asUser(AGENT))
      .query(api.nostr.outbox.unsignedEdit, { key: 'no-such-message', body: 'x' })
    expect(built.ok).toBe(false)
    if (!built.ok) expect(built.expected).toBeFalsy()
  })
})

describe('applyEdit — an edit arriving from the relay', () => {
  it('replaces the body and records when', async () => {
    const t = convexTest(schema, modules)
    const { messageId } = await seed(t)
    await t.run(async (ctx) =>
      ctx.runMutation(internal.nostr.data.applyEdit, { nostrEventId: TARGET, body: 'from Ship', editedAt: 5_000 }),
    )
    const m = await t.run(async (ctx) => await ctx.db.get(messageId))
    expect(m?.body).toBe('from Ship')
    expect(m?.editedAt).toBe(5_000)
  })

  /*
    `since` is inclusive, so a run re-reads edits it has already applied; and a
    run reaching further back can see an OLDER edit for the same message.
    Without this the body would flicker between versions depending on which
    window the poll happened to fetch.
  */
  it('ignores an edit older than the one already applied', async () => {
    const t = convexTest(schema, modules)
    const { messageId } = await seed(t)
    const apply = (body: string, editedAt: number) =>
      t.run(async (ctx) => ctx.runMutation(internal.nostr.data.applyEdit, { nostrEventId: TARGET, body, editedAt }))

    await apply('newer', 9_000)
    await apply('older', 1_000)
    expect((await t.run(async (ctx) => await ctx.db.get(messageId)))?.body).toBe('newer')
  })

  it('is silent for a target Peek does not hold', async () => {
    const t = convexTest(schema, modules)
    await seed(t)
    const out = await t.run(async (ctx) =>
      ctx.runMutation(internal.nostr.data.applyEdit, { nostrEventId: 'f'.repeat(64), body: 'x', editedAt: 1 }),
    )
    expect(out).toEqual({ applied: false })
  })
})
