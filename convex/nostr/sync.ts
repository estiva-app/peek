/**
 * Profiles from the relay, cached into `users` (PEEK-72).
 *
 * This file used to be the whole Stage 2 read path: it projected channel
 * messages, replies, reactions, edits and resolutions back into Convex. FOL-23
 * removed that projection with the Convex topics — every surface it fed now
 * reads the relay directly — and left only the profile cache, which `users`
 * still renders from.
 *
 * **The relay read itself happens in the browser** (PEEK-106) — it needs the
 * viewer's Estiva ID token, and the bridge is NIP-98 gated on every route.
 *
 * **No `"use node"`.** A Node-runtime file may export *only actions*, so with
 * it in place `pubkeysToRefresh` below could not exist — and that failure
 * appears at deploy, not at type-check or test.
 */
import { v } from 'convex/values'
import { action, query } from '../_generated/server'
import { internal } from '../_generated/api'
import { parseProfile } from '@estiva-app/protocol'
import { viewerId } from '../users'

/**
 * A signed Nostr event, as the browser read it off the relay.
 *
 * Validated rather than trusted: these arrive from the client, so the shape is
 * declared.
 */
const signedEvent = v.object({
  id: v.string(),
  pubkey: v.string(),
  created_at: v.number(),
  kind: v.number(),
  tags: v.array(v.array(v.string())),
  content: v.string(),
  sig: v.string(),
})

/**
 * Every pubkey whose `kind:0` is worth re-reading — which is all of them.
 *
 * This used to return only rows with a placeholder name or **no image at all**,
 * which is what the old name `pubkeysMissingProfile` described. It made the
 * cache write-once: a row that already held a picture was never asked about
 * again, so a profile edited in Estiva ID never reached Peek. The caller has
 * always been called `syncStaleProfilesFromRelay` — *stale*, not *missing* —
 * and the narrowing here is what quietly made that untrue.
 *
 * Found via SHA-22. Buzz now requires a signed header on `/media/*` reads that
 * an `<img>` cannot send, so Estiva ID republished every `picture` as a URL it
 * serves itself. Ship reads `kind:0` straight from the relay and picked the new
 * URL up immediately; Peek renders `users.image`, and every row still held the
 * old `/media/` URL with nothing that would ever replace it.
 *
 * Cheap enough to be unconditional. `users` is already `collect()`ed here, the
 * client batches every author into one `{kinds:[0], authors:[…]}` filter, this
 * runs once per sign-in (`auth/AuthGate.tsx`) and is not awaited, and
 * `resolveExternalUser` patches only when a value actually differs — so a
 * workspace where nothing changed does one relay query and no writes.
 */
export const pubkeysToRefresh = query({
  args: {},
  handler: async (ctx): Promise<string[]> => {
    const me = await viewerId(ctx)
    if (!me) return []
    const users = await ctx.db.query('users').collect()
    return users.filter((u) => u.nostrPubkey).map((u) => u.nostrPubkey as string)
  },
})

/**
 * Fill in names and faces from the `kind:0`s the client read. Reads as the
 * viewer, like everything else, because the relay is NIP-98 gated; `kind:0` is
 * not channel-scoped, so membership is not in play, only auth.
 */
export const recordProfiles = action({
  args: { profiles: v.array(signedEvent) },
  handler: async (ctx, { profiles }): Promise<{ ok: boolean; updated?: number; reason?: string }> => {
    const viewer = await ctx.runQuery(internal.users.viewerIdForAction, {})
    if (!viewer) return { ok: false, reason: 'not signed in' }

    let updated = 0
    for (const event of profiles) {
      const profile = parseProfile(event)
      // Nobody has published one yet. Estiva ID writes `kind:0` when a person
      // saves their profile, so someone who never has simply has none.
      if (!profile.displayName && !profile.picture) continue
      await ctx.runMutation(internal.nostr.data.resolveExternalUser, {
        nostrPubkey: event.pubkey,
        displayName: profile.displayName,
        picture: profile.picture,
      })
      updated += 1
    }
    return { ok: true, updated }
  },
})
