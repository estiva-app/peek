/**
 * Viewer identity + profile (Phase 3). Every function resolves the current
 * user from `ctx.auth` via Convex Auth — the hardcoded 'you' seed identity
 * is gone. Queries return empty results when unauthenticated (the client
 * gate keeps that momentary); mutations throw.
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

/** The authenticated user's id, or null when unauthenticated. */
export async function viewerId(ctx: QueryCtx | MutationCtx): Promise<Id<'users'> | null> {
  return getAuthUserId(ctx)
}

/** The authenticated user's doc, or null when unauthenticated. */
export async function viewer(ctx: QueryCtx | MutationCtx): Promise<Doc<'users'> | null> {
  const id = await getAuthUserId(ctx)
  return id ? ctx.db.get(id) : null
}

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
