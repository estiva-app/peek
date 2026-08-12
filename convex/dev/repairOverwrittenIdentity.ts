/**
 * One-off repair for identities `identityFor` overwrote before it was fixed.
 *
 * The bug: a user with a `nostrPubkey` but no `nostrSecretKey` — what
 * `adoptIdentity` creates for anyone signing in through Estiva ID — fell past a
 * `pubkey && secret` guard and had a freshly minted keypair written over their
 * real pubkey. From that moment `viewerId()` could not find them by
 * `by_nostrPubkey`: queries returned empty, mutations threw "Not signed in".
 *
 * The fix stops it happening again; it cannot undo what already happened,
 * because nothing in the row records the pubkey that was replaced. So the real
 * pubkey is passed in explicitly rather than guessed — it is readable from the
 * signed-in browser, or from Estiva ID.
 *
 * Deliberately **not** self-healing on sign-in. A heuristic that re-attaches
 * identities by name or timing would eventually attach the wrong person to the
 * wrong history, which is the same class of silent damage as the original bug.
 *
 * Delete this file once the affected rows are repaired.
 */
import { v } from 'convex/values'
import { internalMutation, internalQuery } from '../_generated/server'

/** Rows carrying a minted key that no signed-in identity can match. */
export const suspects = internalQuery({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query('users').collect()
    return users
      .filter((u) => u.nostrPubkey && u.nostrSecretKey && !u.isExternal)
      .map((u) => ({ userId: u._id, name: u.name, nostrPubkey: u.nostrPubkey, email: u.email ?? null }))
  },
})

export const repair = internalMutation({
  args: {
    userId: v.id('users'),
    /** The pubkey the person actually signs in with, from Estiva ID. */
    pubkey: v.string(),
  },
  handler: async (ctx, { userId, pubkey }) => {
    const u = await ctx.db.get(userId)
    if (!u) throw new Error(`unknown user ${userId}`)

    // If a second row already holds the real pubkey, a later sign-in created a
    // duplicate person and their history is split across two rows. Merging is a
    // judgement call about which history is whose, so refuse rather than pick.
    const clash = await ctx.db
      .query('users')
      .withIndex('by_nostrPubkey', (q) => q.eq('nostrPubkey', pubkey))
      .unique()
    if (clash && clash._id !== userId) {
      throw new Error(`row ${clash._id} already holds ${pubkey} — merge needed, refusing to guess`)
    }

    const before = { nostrPubkey: u.nostrPubkey ?? null, hadSecret: !!u.nostrSecretKey }
    // The minted secret goes with it: Peek does not custody this identity, and
    // leaving it behind would let the old code path treat them as custodied again.
    await ctx.db.patch(userId, { nostrPubkey: pubkey, nostrSecretKey: undefined })
    return { userId, name: u.name, before, after: { nostrPubkey: pubkey, hadSecret: false } }
  },
})
