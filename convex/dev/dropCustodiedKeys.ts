/**
 * Retire Peek's remaining custodied keys (PEEK-37 / PEEK-40).
 *
 * PEEK-37 exists to move Peek's custodied keys into Estiva ID. The only two
 * left are demo fixtures nobody signs in as, so they are being abandoned rather
 * than migrated — which reaches the same end state by a shorter road.
 *
 * Once no row has a `nostrSecretKey`:
 *
 *   * `listLocalUsersWithKeys` is empty, so no background reader borrows a key
 *   * `identityFor` returns null for everyone, so nothing decrypts anything
 *   * PEEK-40's done-when — "without ever decrypting a user secret" — is true,
 *     and its custodial branches become dead code to delete
 *
 * **Deliberately narrower than `seedDemo:wipe`.** That clears every table
 * including `users` and `topics`, which would take the Estiva ID identities,
 * their topics, and the Peek↔Ship folder pairing with it. Only the key material
 * needs to go.
 *
 * `nostrPubkey` is kept. It is what attributes the messages these users already
 * wrote, and `by_nostrPubkey` still has to resolve them.
 *
 * **Irreversible.** The secret is encrypted at rest but this deletes it, and
 * nothing else holds a copy — these identities can never sign again. That is
 * the intent; it is only safe because they are fixtures. Dry run by default.
 *
 * Delete this file once it has been run.
 */
import { v } from 'convex/values'
import { internalMutation } from '../_generated/server'

export const dropCustodiedKeys = internalMutation({
  args: {
    /** Pass `{"commit": true}` to actually clear. Defaults to a dry run. */
    commit: v.optional(v.boolean()),
  },
  handler: async (ctx, { commit }) => {
    const rows = await ctx.db.query('users').collect()
    const holders = rows.filter((u) => u.nostrSecretKey)

    // Pubkeys and names only — never the key material, not even in a dry run.
    const affected = holders.map((u) => ({
      userId: u._id,
      name: u.name,
      nostrPubkey: u.nostrPubkey ?? null,
      isExternal: u.isExternal ?? false,
    }))

    if (!commit) {
      return { dryRun: true, wouldClear: holders.length, affected }
    }

    for (const u of holders) {
      await ctx.db.patch(u._id, { nostrSecretKey: undefined })
    }
    return { dryRun: false, cleared: holders.length, affected }
  },
})
