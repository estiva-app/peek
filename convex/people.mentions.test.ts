// @vitest-environment edge-runtime

/**
 * Who a `nostr:npub…` names — and why it is not the directory.
 *
 * Reported as "my tags are like this lately", with a mention drawn as a muted
 * `npub14znawww…` instead of a name. `personByPubkey` resolved against
 * `people.list`, which is the **suggestion** list: it excludes the viewer,
 * because you do not `@` yourself, and excludes identities that arrived from the
 * relay, because they are not members here. Both right for "who can I mention".
 *
 * Neither is right for "who is this key". A mention of you is still a mention,
 * and a relay-only row carries a name Peek already renders as the message
 * author — so the name was there all along and the resolver could not see it.
 */
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'
import { ESTIVA_ID_ISSUER } from './users'

const modules = import.meta.glob('./**/*.ts')

const ME = 'a1'.repeat(32)
const COLLEAGUE = 'b2'.repeat(32)
const RELAY_ONLY = 'c3'.repeat(32)
const NO_KEY_YET = 'd4'.repeat(32)

const asUser = (pubkey: string) => ({ issuer: ESTIVA_ID_ISSUER, subject: pubkey })

async function seed(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    await ctx.db.insert('users', { name: 'Miky', nostrPubkey: ME })
    await ctx.db.insert('users', { name: 'Katerina', nostrPubkey: COLLEAGUE })
    // What `resolveExternalUser` makes when somebody's message arrives from the
    // relay and Peek has no account for them.
    await ctx.db.insert('users', { name: 'Seen on the relay', nostrPubkey: RELAY_ONLY, isExternal: true })
    // A member who has never signed in with Estiva ID, so has no key to name.
    await ctx.db.insert('users', { name: 'Not signed in' })
  })
}

const namesFor = async (t: ReturnType<typeof convexTest>, pubkey: string) => {
  const rows = await t.withIdentity(asUser(pubkey)).query(api.people.mentionNames, {})
  return new Map(rows.map((r) => [r.pubkey, r.name]))
}

describe('resolving a mention', () => {
  it('names YOU, which the directory deliberately does not', async () => {
    // The directory excludes the viewer by id, so a mention of you drew your own
    // key in your own view while everyone else saw your name. Same shape as the
    // issue the mentions module comment describes, one layer down: fixed for the
    // name-matching path and missed for the pubkey path.
    const t = convexTest(schema, modules)
    await seed(t)
    expect((await namesFor(t, ME)).get(ME)).toBe('Miky')
  })

  it('names an identity Peek has only seen on the relay', async () => {
    // `people.list` filters these out with `isExternal`, correctly — they have
    // no account here and do not belong in the workspace directory. But Peek
    // knows their name and already renders it as the message author.
    const t = convexTest(schema, modules)
    await seed(t)
    expect((await namesFor(t, ME)).get(RELAY_ONLY)).toBe('Seen on the relay')
  })

  it('names a colleague, which is the case that already worked', async () => {
    const t = convexTest(schema, modules)
    await seed(t)
    expect((await namesFor(t, ME)).get(COLLEAGUE)).toBe('Katerina')
  })

  it('offers nothing for a member with no key, rather than a blank entry', async () => {
    // Nothing to resolve a mention against, and an entry with an empty pubkey
    // would match the empty string.
    const t = convexTest(schema, modules)
    await seed(t)
    const names = await namesFor(t, ME)
    expect(names.has('')).toBe(false)
    expect(names.has(NO_KEY_YET)).toBe(false)
    expect([...names.values()]).not.toContain('Not signed in')
  })

  it('answers the same for everyone, because a name is not viewer-specific', async () => {
    // `list` differs per viewer (it removes you). This must not, or a mention
    // would read differently depending on who is looking at it.
    const t = convexTest(schema, modules)
    await seed(t)
    const mine = await namesFor(t, ME)
    const theirs = await namesFor(t, COLLEAGUE)
    expect([...theirs.entries()].sort()).toEqual([...mine.entries()].sort())
  })
})
