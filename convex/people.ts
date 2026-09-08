/**
 * People reads — the workspace directory (domain model §2.1).
 *
 * `id` is the stable seedKey where present (see convex/schema.ts) and the
 * authenticated viewer is excluded by id (People lists everyone else).
 * `avatarUrl` is the person's uploaded avatar when they have one; seeded
 * demo people have none and fall back to their client-side portrait.
 */
import { query } from './_generated/server'
import { avatarUrl, viewerId } from './users'

export const list = query({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query('users').collect()
    const me = await viewerId(ctx)
    const out = []
    for (const u of users) {
      if (u._id === me) continue
      // Identities that arrived from the relay are not Peek members — they have
      // no account here. Their messages still render (the author lookup is by
      // id), but they do not belong in the workspace directory.
      if (u.isExternal) continue
      out.push({
        id: u.seedKey ?? (u._id as string),
        name: u.name,
        role: u.role ?? '',
        avatarUrl: await avatarUrl(ctx, u),
        // The key a mention names on the wire (SPEC §13.1). Optional because a
        // person who has not signed in with Estiva ID has none yet.
        pubkey: u.nostrPubkey,
      })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  },
})

/**
 * Who a `nostr:npub…` in a body names — pubkey to name, for **everyone**.
 *
 * Separate from {@link list} because they answer different questions, and
 * reusing one for both is what broke mentions. "Who can I `@`?" excludes you
 * (you do not mention yourself) and excludes identities that arrived from the
 * relay (they are not members here). **"Who does this key name?" excludes
 * neither** — a mention of you is still a mention, and a key Peek has only ever
 * seen on the relay still belongs to somebody Peek can name.
 *
 * `adoptIdentity` explains why the second case exists at all: a row created by
 * `resolveExternalUser` carries a name and a `nostrPubkey`, and Peek already
 * renders that name as the message author. So the name was always there — the
 * resolver just could not see it.
 *
 * Discloses nothing new. Every name here is already visible as a message
 * author, which is where these rows came from.
 */
export const mentionNames = query({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query('users').collect()
    const out: Array<{ pubkey: string; name: string }> = []
    for (const u of users) {
      if (!u.nostrPubkey) continue
      out.push({ pubkey: u.nostrPubkey, name: u.name })
    }
    return out
  },
})
