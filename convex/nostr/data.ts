/**
 * Database access for the relay profile cache (`sync.ts`).
 *
 * This held the whole Nostr publish and projection pipeline's queries and
 * mutations — the message, reply, reaction, edit and resolution imports, and
 * their publish bookkeeping. FOL-23 removed them with the Convex topics; only
 * the profile write that `recordProfiles` still makes is left.
 */
import { v } from 'convex/values'
import { internalMutation } from '../_generated/server'

/**
 * Resolve a relay pubkey to a Peek user, creating an external placeholder if
 * this is someone Peek has never seen.
 *
 * `name` is required on `users`, so a display name is always written: the
 * kind:0 `display_name` when the relay has one, otherwise a truncated pubkey.
 * `picture` is stored when published — it is the only face Peek will ever have
 * for someone who does not have a Peek account. Never mints key material —
 * Peek does not custody keys for people who are not its users.
 */
export const resolveExternalUser = internalMutation({
  args: {
    nostrPubkey: v.string(),
    displayName: v.optional(v.string()),
    /** kind:0 `picture` — an avatar URL chosen by whichever app published it. */
    picture: v.optional(v.string()),
  },
  handler: async (ctx, { nostrPubkey, displayName, picture }) => {
    const existing = await ctx.db
      .query('users')
      .withIndex('by_nostrPubkey', (q) => q.eq('nostrPubkey', nostrPubkey))
      .unique()
    if (existing) {
      // The relay's `kind:0` is the profile, and this row is Peek's cache of it
      // (PEEK-42). Estiva ID is its sole publisher (PEEK-31) and the only place
      // a name or a picture is edited (`api/profile.ts`), so whatever it says
      // now replaces whatever Peek held.
      //
      // The name used to be guarded — patched only for an `isExternal` row or a
      // `nostr:<8 chars>` placeholder, "so a name someone typed into Peek still
      // wins". Nobody can type one into Peek any more, and the guard's real
      // effect was that a rename in Estiva ID never reached anyone who had
      // signed in here: their author line, and every `nostr:npub…` mention of
      // them, kept the old name for ever while Ship — which reads `kind:0`
      // straight from the relay — showed the new one (RIC-2). A mention that
      // names a key is only an improvement on one that names a display name if
      // the key resolves to the *current* name, so the name now follows the
      // relay exactly as the picture already did.
      const patch: { name?: string; image?: string } = {}
      if (displayName && displayName !== existing.name) {
        patch.name = displayName
      }
      // Nothing outranks the relay now (PEEK-42). This used to skip anyone with
      // a Convex-stored avatar, because Peek's own upload won — which is exactly
      // the shadowing that ticket removed. `image` is only ever the relay's
      // copy, so replacing it loses nothing.
      if (picture && picture !== existing.image) {
        patch.image = picture
      }
      if (Object.keys(patch).length) await ctx.db.patch(existing._id, patch)
      return existing._id
    }
    return ctx.db.insert('users', {
      name: displayName || `nostr:${nostrPubkey.slice(0, 8)}`,
      image: picture,
      nostrPubkey,
      isExternal: true,
    })
  },
})
