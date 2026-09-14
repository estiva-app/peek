/**
 * SHA-22: the profile cache has to be re-readable, not write-once.
 *
 * `users.image` is Peek's copy of another app's `kind:0` `picture`, and Estiva
 * ID is its only writer. The query that refreshes it used to ask only about
 * rows with a placeholder name or **no image at all**, which made the cache
 * write-once: once a row held a picture, nothing ever asked the relay about
 * that person again.
 *
 * It surfaced when Buzz started requiring a signed header on `/media/*` reads
 * that an `<img>` cannot send. Estiva ID republished every `picture` as a URL
 * it serves itself; Ship reads `kind:0` from the relay and picked the new one
 * up at once, and Peek kept rendering the old `/media/` URL with nothing that
 * would ever replace it.
 *
 * The row that mattered most held a *superseded* avatar hash rather than
 * merely an unmapped one — so the write-once bug predated all of this, and
 * both URLs answering `401` is what hid it. That is the case this file exists
 * to keep closed: **a person who already has a picture must still be asked
 * about.**
 */
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'
import { ESTIVA_ID_ISSUER } from './users'

/* Rooted here, like every other `convexTest` in this directory: the glob keys
   are how convex-test resolves a function reference, so a test one level down
   produces `../nostr/data.ts` and cannot find `nostr/data`. */
const modules = import.meta.glob('./**/*.ts')

const VIEWER = 'a'.repeat(64)
const SETTLED = 'b'.repeat(64)
const PLACEHOLDER = 'c'.repeat(64)
const OLD_URL = `https://estiva.estiva.app/media/${'d'.repeat(64)}.jpg`
const NEW_URL = `https://id.estiva.app/avatar/${'d'.repeat(64)}.jpg`

const asUser = (pubkey: string) => ({ issuer: ESTIVA_ID_ISSUER, subject: pubkey })

async function seed(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    await ctx.db.insert('users', { name: 'Ada', nostrPubkey: VIEWER })
    // The row the old filter skipped: a real name and a picture already set.
    await ctx.db.insert('users', { name: 'Grace', nostrPubkey: SETTLED, image: OLD_URL })
    // The row it did return, and still must.
    await ctx.db.insert('users', { name: `nostr:${PLACEHOLDER.slice(0, 8)}`, nostrPubkey: PLACEHOLDER })
    // No pubkey, so there is no `kind:0` to ask for.
    await ctx.db.insert('users', { name: 'Local only' })
  })
}

describe('pubkeysToRefresh', () => {
  it('includes someone who already has a picture', async () => {
    const t = convexTest(schema, modules)
    await seed(t)

    const pubkeys = await t.withIdentity(asUser(VIEWER)).query(api.nostr.sync.pubkeysToRefresh, {})

    // The regression: this row was excluded, so its stale URL was permanent.
    expect(pubkeys).toContain(SETTLED)
  })

  it('still includes someone under a placeholder name', async () => {
    const t = convexTest(schema, modules)
    await seed(t)

    const pubkeys = await t.withIdentity(asUser(VIEWER)).query(api.nostr.sync.pubkeysToRefresh, {})

    expect(pubkeys).toContain(PLACEHOLDER)
  })

  it('leaves out a row with no pubkey, which has no kind:0 to read', async () => {
    const t = convexTest(schema, modules)
    await seed(t)

    const pubkeys = await t.withIdentity(asUser(VIEWER)).query(api.nostr.sync.pubkeysToRefresh, {})

    expect(pubkeys).toHaveLength(3)
    expect(pubkeys.every((key) => /^[0-9a-f]{64}$/.test(key))).toBe(true)
  })

  it('returns nothing to a caller who is not signed in', async () => {
    const t = convexTest(schema, modules)
    await seed(t)

    expect(await t.query(api.nostr.sync.pubkeysToRefresh, {})).toEqual([])
  })
})

describe('recording what comes back', () => {
  it('replaces a picture that has moved', async () => {
    const t = convexTest(schema, modules)
    await seed(t)

    await t.run(async (ctx) => {
      await ctx.runMutation(internal.nostr.data.resolveExternalUser, {
        nostrPubkey: SETTLED,
        displayName: 'Grace',
        picture: NEW_URL,
      })
    })

    const row = await t.run(async (ctx) =>
      ctx.db
        .query('users')
        .withIndex('by_nostrPubkey', (q) => q.eq('nostrPubkey', SETTLED))
        .unique(),
    )
    expect(row?.image).toBe(NEW_URL)
    expect(row?.name).toBe('Grace')
  })

  it('follows a rename, for someone who has signed in here (RIC-2)', async () => {
    /*
      The row is settled: a real name, no `isExternal`, no placeholder — exactly
      what `adoptIdentity` leaves behind once the first refresh has filled it.
      The old guard patched the name only for an external or placeholder row,
      so this person could change their name in Estiva ID and Peek would keep
      the old one for ever: on their messages, and on every `nostr:npub…`
      mention of them — which is the case the mention was written as a key to
      survive.
    */
    const t = convexTest(schema, modules)
    await seed(t)

    await t.run(async (ctx) => {
      await ctx.runMutation(internal.nostr.data.resolveExternalUser, {
        nostrPubkey: SETTLED,
        displayName: 'Grace Hopper',
        picture: OLD_URL,
      })
    })

    const row = await t.run(async (ctx) =>
      ctx.db
        .query('users')
        .withIndex('by_nostrPubkey', (q) => q.eq('nostrPubkey', SETTLED))
        .unique(),
    )
    expect(row?.name).toBe('Grace Hopper')
    // And the resolver every mention reads answers with the new name at once.
    const names = await t.withIdentity(asUser(VIEWER)).query(api.people.mentionNames, {})
    expect(names.find((n) => n.pubkey === SETTLED)?.name).toBe('Grace Hopper')
  })

  it('keeps the name when the profile has none to offer', async () => {
    // A `kind:0` with only a picture must not blank a name Peek already holds.
    const t = convexTest(schema, modules)
    await seed(t)

    await t.run(async (ctx) => {
      await ctx.runMutation(internal.nostr.data.resolveExternalUser, {
        nostrPubkey: SETTLED,
        picture: NEW_URL,
      })
    })

    const row = await t.run(async (ctx) =>
      ctx.db
        .query('users')
        .withIndex('by_nostrPubkey', (q) => q.eq('nostrPubkey', SETTLED))
        .unique(),
    )
    expect(row?.name).toBe('Grace')
    expect(row?.image).toBe(NEW_URL)
  })

  it('writes nothing when the picture is unchanged', async () => {
    const t = convexTest(schema, modules)
    await seed(t)

    const before = await t.run(async (ctx) =>
      ctx.db
        .query('users')
        .withIndex('by_nostrPubkey', (q) => q.eq('nostrPubkey', SETTLED))
        .unique(),
    )

    await t.run(async (ctx) => {
      await ctx.runMutation(internal.nostr.data.resolveExternalUser, {
        nostrPubkey: SETTLED,
        displayName: 'Grace',
        picture: OLD_URL,
      })
    })

    const after = await t.run(async (ctx) =>
      ctx.db
        .query('users')
        .withIndex('by_nostrPubkey', (q) => q.eq('nostrPubkey', SETTLED))
        .unique(),
    )
    // Refreshing the whole roster is only cheap if a no-op really is one.
    expect(after?._creationTime).toBe(before?._creationTime)
    expect(after?.image).toBe(OLD_URL)
  })
})
