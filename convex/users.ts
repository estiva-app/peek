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
import { internal } from './_generated/api'
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

/** Stored avatar file → a URL the browser can render (null when unset). */
export async function avatarUrl(ctx: QueryCtx | MutationCtx, u: Doc<'users'>): Promise<string | undefined> {
  if (!u.avatarStorageId) return undefined
  return (await ctx.storage.getUrl(u.avatarStorageId)) ?? undefined
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
    // Republish kind:0 so other clients show the new name/role. kind:0 is
    // replaceable, so this overwrites rather than accumulating.
    await ctx.scheduler.runAfter(0, internal.nostr.publish.publishProfile, { userId: you._id })
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
