// @vitest-environment edge-runtime

/**
 * DMS-5 — a DM channel is projected by the code a topic uses.
 *
 * The ticket's own test is that the diff adds callers and arguments rather than
 * a projection, so what is worth pinning here is not "does a message arrive"
 * (that is `syncChannel`, unchanged and already covered) but the three joints
 * where a second container type could quietly go wrong:
 *
 *   1. **The row lands under the DM**, `parentKind: 'dm'` and the
 *      `dmConversations` id — not under a topic, and not nowhere.
 *   2. **The key is the partner's, and it is resolved through the pair.** A DM
 *      is addressed by the partner's person key everywhere client-side (§2.4),
 *      so the same key means a different conversation to a different viewer,
 *      and somebody who is in no conversation with that person gets nothing.
 *   3. **The cursor is the DM's own.** Two containers sharing one cursor would
 *      make each re-read from the other's high-water mark, and the symptom —
 *      messages that arrive late or not at all — would point anywhere but here.
 *
 * Plus the trap the ticket names by hand: an author with no Peek row must be
 * minted, not dropped. A DM's other participant is exactly the person most
 * likely not to have one.
 */
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'
import { ESTIVA_ID_ISSUER } from './users'
import type { Id } from './_generated/dataModel'

const modules = import.meta.glob('./**/*.ts')

const ADA = 'a'.repeat(64)
const BO = 'b'.repeat(64)
const STRANGER = 'c'.repeat(64)
const asUser = (pubkey: string) => ({ issuer: ESTIVA_ID_ISSUER, subject: pubkey })

const DM_CHANNEL = '11111111-2222-4333-8444-555555555555'
const eventId = (n: number) => n.toString(16).padStart(64, '0')

/** A `kind:9` on the DM channel, as the relay hands it back. */
const dmMessage = (n: number, pubkey: string, content: string, createdAt: number) => ({
  id: eventId(n),
  pubkey,
  created_at: createdAt,
  kind: 9,
  tags: [['h', DM_CHANNEL]],
  content,
  sig: '0'.repeat(128),
})

/**
 * Ada and Bo, with a DM between them that has been opened on the relay.
 *
 * `seedKey` is what a person key is, so `'bo'` is the key Ada's client uses to
 * name this conversation and `'ada'` the one Bo's does — the same row, named
 * from either end, which is the property the pair lookup exists for.
 */
async function seed(t: ReturnType<typeof convexTest>, { channel = true } = {}) {
  return await t.run(async (ctx) => {
    const ada = await ctx.db.insert('users', { name: 'Ada', seedKey: 'ada', nostrPubkey: ADA })
    const bo = await ctx.db.insert('users', { name: 'Bo', seedKey: 'bo', nostrPubkey: BO })
    const [low, high] = (ada as string) < (bo as string) ? [ada, bo] : [bo, ada]
    const dmId = await ctx.db.insert('dmConversations', {
      userLowId: low,
      userHighId: high,
      createdAt: 1,
      ...(channel ? { channelUuid: DM_CHANNEL } : {}),
    })
    return { ada, bo, dmId }
  })
}

const importDm = (
  t: ReturnType<typeof convexTest>,
  pubkey: string,
  containerKey: string,
  events: ReturnType<typeof dmMessage>[],
) =>
  t
    .withIdentity(asUser(pubkey))
    .action(api.nostr.sync.importChannel, {
      containerKind: 'dm',
      containerKey,
      events,
      profiles: [],
    })

describe('projecting a DM channel', () => {
  it('writes the message under the DM, through the topic projection', async () => {
    const t = convexTest(schema, modules)
    const { dmId } = await seed(t)

    const result = await importDm(t, ADA, 'bo', [dmMessage(1, BO, 'lunch?', 1_700_000_000)])
    expect(result.ok).toBe(true)

    const rows = await t.run((ctx) => ctx.db.query('messages').collect())
    expect(rows).toHaveLength(1)
    expect(rows[0]!.parentKind).toBe('dm')
    expect(rows[0]!.parentId).toBe(dmId as string)
    expect(rows[0]!.body).toBe('lunch?')
    // Seconds to milliseconds, as the topic path does it.
    expect(rows[0]!.createdAt).toBe(1_700_000_000_000)
  })

  it('advances the DM row’s own cursor and no topic’s', async () => {
    const t = convexTest(schema, modules)
    const { dmId } = await seed(t)

    await importDm(t, ADA, 'bo', [dmMessage(1, BO, 'lunch?', 1_700_000_000)])

    const dm = await t.run((ctx) => ctx.db.get(dmId))
    expect(dm!.nostrSyncedAt).toBe(1_700_000_000)
  })

  it('mints a Peek row for a participant who has never had one', async () => {
    /*
      The trap DMS-5 names. A DM's other participant is the person most likely
      to be relay-only, and dropping their messages would leave a conversation
      showing one side of itself.
    */
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('users', { name: 'Ada', seedKey: 'ada', nostrPubkey: ADA })
      const ext = await ctx.db.insert('users', { name: 'Ext', seedKey: 'ext' })
      const [low, high] = (ada as string) < (ext as string) ? [ada, ext] : [ext, ada]
      await ctx.db.insert('dmConversations', {
        userLowId: low,
        userHighId: high,
        createdAt: 1,
        channelUuid: DM_CHANNEL,
      })
    })

    await importDm(t, ADA, 'ext', [dmMessage(1, STRANGER, 'hello', 1_700_000_000)])

    const rows = await t.run((ctx) => ctx.db.query('messages').collect())
    expect(rows).toHaveLength(1)
    const author = await t.run((ctx) => ctx.db.get(rows[0]!.authorId))
    expect(author!.nostrPubkey).toBe(STRANGER)
  })

  it('does not mark anything read', async () => {
    // Projecting into a conversation nobody is looking at must raise its unread
    // count, which is the whole point. Read state moves in `useMarkRead`.
    const t = convexTest(schema, modules)
    await seed(t)

    await importDm(t, ADA, 'bo', [dmMessage(1, BO, 'lunch?', 1_700_000_000)])

    expect(await t.run((ctx) => ctx.db.query('readState').collect())).toEqual([])
  })

  it('refuses a DM that has no channel on the relay yet', async () => {
    // A wait, not a dead end: `useEnsureDmChannel` publishes the `kind:41010`
    // on the DM's first render.
    const t = convexTest(schema, modules)
    await seed(t, { channel: false })

    const result = await importDm(t, ADA, 'bo', [dmMessage(1, BO, 'lunch?', 1_700_000_000)])
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('dm')
    expect(await t.run((ctx) => ctx.db.query('messages').collect())).toEqual([])
  })
})

describe('whose conversation a key names', () => {
  it('resolves the same row from either end', async () => {
    const t = convexTest(schema, modules)
    const { dmId } = await seed(t)

    await importDm(t, ADA, 'bo', [dmMessage(1, BO, 'from Bo', 1_700_000_000)])
    await importDm(t, BO, 'ada', [dmMessage(2, ADA, 'from Ada', 1_700_000_001)])

    const rows = await t.run((ctx) => ctx.db.query('messages').collect())
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((m) => m.parentId))).toEqual(new Set([dmId as string]))
  })

  it('gives a stranger nothing for the same key', async () => {
    /*
      The privacy gate. `resolveParentId` looks a DM up by the *pair*, so a key
      naming somebody the viewer has no conversation with resolves to no row —
      rather than to somebody else's, which is what a lookup by conversation id
      would have allowed.
    */
    const t = convexTest(schema, modules)
    await seed(t)
    await t.run((ctx) =>
      ctx.db.insert('users', { name: 'Stranger', seedKey: 'stranger', nostrPubkey: STRANGER }),
    )

    const result = await importDm(t, STRANGER, 'bo', [dmMessage(1, BO, 'lunch?', 1_700_000_000)])
    expect(result.ok).toBe(false)
    expect(await t.run((ctx) => ctx.db.query('messages').collect())).toEqual([])
  })

  it('tells a participant the channel and a stranger nothing', async () => {
    const t = convexTest(schema, modules)
    await seed(t)
    await t.run((ctx) =>
      ctx.db.insert('users', { name: 'Stranger', seedKey: 'stranger', nostrPubkey: STRANGER }),
    )

    const plan = (pubkey: string) =>
      t
        .withIdentity(asUser(pubkey))
        .query(api.nostr.sync.syncPlan, { containerKind: 'dm', containerKey: 'bo' })

    expect(await plan(ADA)).toEqual({
      channelUuid: DM_CHANNEL,
      since: null,
      reactionTargetsOmitted: 0,
    })
    expect(await plan(STRANGER)).toBeNull()
    // And signed out, which is how the browser hook is allowed to call it.
    expect(
      await t.query(api.nostr.sync.syncPlan, { containerKind: 'dm', containerKey: 'bo' }),
    ).toBeNull()
  })
})

describe('the reaction horizon counts a DM separately', () => {
  it('records what it left out on the DM row, not on a topic', async () => {
    // `reactionTargetsOmitted` is the one field on the container that is Peek's
    // own bookkeeping rather than a mirror. It has to be per container or the
    // caption reports another conversation's number.
    const t = convexTest(schema, modules)
    const { ada, dmId } = await seed(t)
    await t.run(async (ctx) => {
      for (let i = 0; i < 3; i++) {
        await ctx.db.insert('messages', {
          parentKind: 'dm',
          parentId: dmId as string,
          authorId: ada as Id<'users'>,
          body: `old ${i}`,
          createdAt: 10 + i,
          nostrEventId: eventId(100 + i),
        })
      }
    })

    // Under the horizon, so nothing is omitted — and the field is written as 0
    // rather than left undefined only when it changes.
    await importDm(t, ADA, 'bo', [])
    const dm = await t.run((ctx) => ctx.db.get(dmId))
    expect(dm!.reactionTargetsOmitted ?? 0).toBe(0)

    const targets = await t.run((ctx) =>
      ctx.runQuery(internal.nostr.data.listMessageEventIdsForContainer, {
        parentKind: 'dm',
        parentId: dmId as string,
        limit: 100,
      }),
    )
    expect(targets.total).toBe(3)
  })
})
