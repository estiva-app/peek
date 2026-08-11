/**
 * Viewer identity + profile (Phase 3). Every function resolves the current
 * user from `ctx.auth` — the hardcoded 'you' seed identity is gone. Queries
 * return empty results when unauthenticated (the client gate keeps that
 * momentary); mutations throw.
 *
 * Two issuers are accepted while the migration runs (PEEK-39). An Estiva ID
 * token is keyed by pubkey, which is what lets a stranger seen on the relay and
 * the account that later signs in be one row; a Convex Auth session still
 * resolves the old way, because it is the only working sign-in until PEEK-41
 * deletes it. `pubkeyFromIdentity` is the seam between the two.
 *
 * Avatars are real uploads: the file lives in Convex storage and the user
 * doc keeps its `avatarStorageId`; reads hand the client a resolved URL.
 * Seeded demo people keep their client-side portraits (name-keyed
 * `avatarFor`) — the seam prefers an uploaded avatar and falls back to
 * those, so the demo dataset stays pixel-identical.
 */
import { v } from 'convex/values'
import { getAuthUserId } from '@convex-dev/auth/server'
import { mutation, query, type QueryCtx, type MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'

/**
 * The issuer Estiva ID stamps on every token it signs (PEEK-38).
 *
 * Must stay identical to `domain` in `convex/auth.config.ts`: Convex only
 * accepts a token whose `iss` equals that string, and this is the other half of
 * the same agreement — the half that decides what the accepted token *means*.
 */
export const ESTIVA_ID_ISSUER = 'https://id.estiva.app'

/**
 * The Nostr pubkey a set of credentials authenticates, or null when they did
 * not come from Estiva ID.
 *
 * The issuer check is load-bearing, not defensive. Convex Auth populates
 * `getUserIdentity()` as well, with a `subject` of `<userId>|<sessionId>`, and
 * `getAuthUserId` splits that claim without ever looking at who issued it. The
 * two identities are therefore indistinguishable by `subject` alone, and both
 * confusions fail silently rather than loudly:
 *
 *   * read a Convex Auth subject as a pubkey and `by_nostrPubkey` misses, so
 *     every signed-in user turns into a stranger;
 *   * read an Estiva ID subject with `getAuthUserId` and it returns a 64-char
 *     pubkey where an `Id<'users'>` is expected.
 *
 * Split out as a plain function so it is testable without a deployment — the
 * discrimination is the subtle part of PEEK-39, not the query around it.
 */
export function pubkeyFromIdentity(identity: { issuer: string; subject: string } | null): string | null {
  if (!identity) return null
  // Tolerate a trailing slash on the issuer and nothing else. Anything looser
  // here is an account-takeover surface, since the pubkey it yields is what the
  // viewer is resolved from.
  const issuer = identity.issuer.replace(/\/$/, '')
  return issuer === ESTIVA_ID_ISSUER ? identity.subject : null
}

/**
 * The authenticated user's id, or null when unauthenticated.
 *
 * Estiva ID identities resolve by pubkey (PEEK-39); everything else still goes
 * through Convex Auth, which stays the only working sign-in until PEEK-41
 * removes it. Note the null here has a second meaning it did not have before: an
 * Estiva ID token Peek has no row for yet is authenticated but unknown, and
 * `adoptIdentity` is what turns it into a row.
 */
export async function viewerId(ctx: QueryCtx | MutationCtx): Promise<Id<'users'> | null> {
  const pubkey = pubkeyFromIdentity(await ctx.auth.getUserIdentity())
  if (pubkey === null) return getAuthUserId(ctx)

  const user = await ctx.db
    .query('users')
    .withIndex('by_nostrPubkey', (q) => q.eq('nostrPubkey', pubkey))
    .unique()
  return user?._id ?? null
}

/** The authenticated user's doc, or null when unauthenticated. */
export async function viewer(ctx: QueryCtx | MutationCtx): Promise<Doc<'users'> | null> {
  const id = await viewerId(ctx)
  return id ? ctx.db.get(id) : null
}

/**
 * Bind the signed-in Estiva ID identity to a Peek user row, and return its id.
 *
 * Separate from `viewer()` because that runs inside queries and a query cannot
 * write. The client calls this once after sign-in. Two cases, and the first is
 * the one this ticket exists for:
 *
 *   * **a row already carries this pubkey** — someone Peek had only ever seen on
 *     the relay, created by `nostr/data.ts`'s `resolveExternalUser`. Adopt that
 *     row rather than making a second one: every message they already wrote
 *     points at this `_id`, so their history comes with them at no cost.
 *     Clearing `isExternal` is what moves them from "seen elsewhere" to "has an
 *     account here" — `people.ts` filters the directory on exactly that flag.
 *   * **no row** — someone genuinely new. Insert one.
 *
 * Idempotent: signing in again finds the row and patches nothing.
 */
export const adoptIdentity = mutation({
  args: { name: v.optional(v.string()) },
  handler: async (ctx, { name }) => {
    const pubkey = pubkeyFromIdentity(await ctx.auth.getUserIdentity())
    if (!pubkey) throw new Error('Not signed in with Estiva ID')
    const trimmed = name?.trim()

    const existing = await ctx.db
      .query('users')
      .withIndex('by_nostrPubkey', (q) => q.eq('nostrPubkey', pubkey))
      .unique()

    if (existing) {
      if (existing.isExternal) {
        // `undefined` removes the field, which is what the directory filter reads.
        await ctx.db.patch(existing._id, {
          isExternal: undefined,
          // Their own name now beats whatever the relay's kind:0 supplied.
          ...(trimmed ? { name: trimmed } : {}),
        })
      }
      return existing._id
    }

    // Same display-name convention as `resolveExternalUser`, so a person looks
    // identical whether Peek met them here or on the relay first. No key
    // material: Estiva ID holds it, and Peek stopped custodying keys (PEEK-37).
    return ctx.db.insert('users', {
      name: trimmed || `nostr:${pubkey.slice(0, 8)}`,
      nostrPubkey: pubkey,
    })
  },
})

/** The authenticated user's doc; throws for mutations that must not run signed out. */
export async function viewerOrThrow(ctx: QueryCtx | MutationCtx): Promise<Doc<'users'>> {
  const u = await viewer(ctx)
  if (!u) throw new Error('Not signed in')
  return u
}

/**
 * A user's avatar → a URL the browser can render (undefined when they have none).
 *
 * Two sources, in order. An uploaded file is a Peek user's own avatar and wins.
 * `image` is a `picture` URL that arrived from the relay (`nostr/sync.ts`) and
 * belongs to someone with no Peek account — it is the only face this app will
 * ever have for them, and without this fallback they render as a silhouette
 * even though another app published a perfectly good avatar.
 */
export async function avatarUrl(ctx: QueryCtx | MutationCtx, u: Doc<'users'>): Promise<string | undefined> {
  if (!u.avatarStorageId) return u.image
  return (await ctx.storage.getUrl(u.avatarStorageId)) ?? u.image
}

/** The signed-in user's own profile — drives the client's useCurrentUser(). */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const u = await viewer(ctx)
    if (!u) return null
    return {
      id: u._id as string,
      name: u.name,
      email: u.email,
      role: u.role,
      seedKey: u.seedKey,
      avatarUrl: await avatarUrl(ctx, u),
    }
  },
})

/** Edit your own display name / role. Empty role clears it. */
export const updateProfile = mutation({
  args: { name: v.string(), role: v.optional(v.string()) },
  handler: async (ctx, { name, role }) => {
    const you = await viewerOrThrow(ctx)
    const trimmed = name.trim()
    if (!trimmed) throw new Error('Name cannot be empty')
    await ctx.db.patch(you._id, {
      name: trimmed,
      role: role?.trim() ? role.trim() : undefined,
    })
    // No kind:0 publish. Estiva ID is the sole publisher (PEEK-31), so this
    // name is local to Peek until PEEK-72 reads it from there instead.
  },
})

/** Short-lived URL the client POSTs the image file to (Convex file storage). */
export const generateAvatarUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await viewerOrThrow(ctx)
    return ctx.storage.generateUploadUrl()
  },
})

/** Attach an uploaded file as the avatar; the previous one is deleted. */
export const setAvatar = mutation({
  args: { storageId: v.id('_storage') },
  handler: async (ctx, { storageId }) => {
    const you = await viewerOrThrow(ctx)
    if (you.avatarStorageId) await ctx.storage.delete(you.avatarStorageId)
    await ctx.db.patch(you._id, { avatarStorageId: storageId })
    // Same as updateProfile: this avatar is Peek-local now. The published one
    // is whatever Estiva ID holds, and moving it off Convex storage onto a
    // content-addressed Blossom blob is PEEK-42.
  },
})

/** Drop the uploaded avatar (falls back to the silhouette). */
export const removeAvatar = mutation({
  args: {},
  handler: async (ctx) => {
    const you = await viewerOrThrow(ctx)
    if (you.avatarStorageId) await ctx.storage.delete(you.avatarStorageId)
    await ctx.db.patch(you._id, { avatarStorageId: undefined })
  },
})
