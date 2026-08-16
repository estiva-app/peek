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
 * a profile is read from the relay's `kind:0`, never written here (PEEK-42).
 * Seeded demo people keep their client-side portraits (name-keyed
 * `avatarFor`) — the seam prefers an uploaded avatar and falls back to
 * those, so the demo dataset stays pixel-identical.
 */
import { v } from 'convex/values'
import { internalQuery, mutation, query, type QueryCtx, type MutationCtx } from './_generated/server'
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
 * The issuer check is load-bearing, not defensive — and it stays that way now
 * that Estiva ID is the only accepted issuer (PEEK-41), because `auth.config.ts`
 * is the only thing enforcing it and a second provider added there later would
 * silently reintroduce the ambiguity.
 *
 * That ambiguity was real: Convex Auth populated `getUserIdentity()` too, with a
 * `subject` of `<userId>|<sessionId>`, which is indistinguishable from a pubkey
 * by shape alone. Both confusions failed silently rather than loudly — a Convex
 * Auth subject read as a pubkey missed `by_nostrPubkey` and turned every
 * signed-in user into a stranger, and a pubkey read as a user id returned 64
 * hex characters where an `Id<'users'>` belonged.
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
 * Identity is a pubkey and nothing else since PEEK-41 removed Convex Auth.
 * There used to be a `getAuthUserId` fallback here for password accounts; with
 * no other issuer accepted, a token that is not Estiva ID's simply is not
 * authenticated.
 *
 * `null` carries two meanings, and the second is the one that surprises: not
 * signed in, **or** signed in with an Estiva ID token Peek has no row for yet.
 * That second case is authenticated but unknown, and `adoptIdentity` is what
 * turns it into a row.
 */
export async function viewerId(ctx: QueryCtx | MutationCtx): Promise<Id<'users'> | null> {
  const pubkey = pubkeyFromIdentity(await ctx.auth.getUserIdentity())
  if (pubkey === null) return null

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

/**
 * The viewer's id, for Node actions.
 *
 * Actions have no `ctx.db`, so they cannot call `viewerId` directly. Reading
 * `getUserIdentity().subject` in an action is not a substitute either: it is
 * the pubkey, not an `Id<'users'>`, and `nostr/act.ts` was once doing exactly
 * that (see `pubkeyFromIdentity`).
 */
export const viewerIdForAction = internalQuery({
  args: {},
  handler: async (ctx) => viewerId(ctx),
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
export async function avatarUrl(_ctx: QueryCtx | MutationCtx, u: Doc<'users'>): Promise<string | undefined> {
  // The relay's `kind:0` picture, and nothing else (PEEK-42). This used to
  // prefer a Convex-stored upload, which meant a Peek avatar silently shadowed
  // the real Estiva ID one for anyone who had ever set one here.
  return u.image
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

/**
 * Profile editing lives in Estiva ID now (PEEK-42).
 *
 * `updateProfile`, `generateAvatarUploadUrl`, `setAvatar` and `removeAvatar`
 * stood here. They wrote name, role and avatar into Peek's own row — a second
 * writer for something PEEK-31 had already made single-writer everywhere else,
 * and the divergence was visible rather than theoretical: `avatarUrl` preferred
 * the Convex upload, so a Peek avatar shadowed the real Estiva ID picture for
 * anyone who had ever set one.
 *
 * `https://id.estiva.app/account` is where a profile is edited now, and the
 * relay's `kind:0` is how it arrives — `nostr/data.ts`'s `resolveExternalUser`
 * and the sync profile pass already do that work.
 *
 * `avatarStorageId` and the blobs behind it are gone too. It took two releases:
 * a field cannot leave the validator while any row still carries it, so a sweep
 * had to clear the column and delete the files first.
 */
