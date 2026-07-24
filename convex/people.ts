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
      })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  },
})
