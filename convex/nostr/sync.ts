/**
 * Stage 2 read path: project relay events back into Convex.
 *
 * This is what makes interop two-way. Without it Peek publishes into the
 * ecosystem but cannot see anything anyone else writes.
 *
 * **The relay read itself happens in the browser** (PEEK-106) — it needs the
 * viewer's Estiva ID token, and the bridge is NIP-98 gated on every route. What
 * is left here is the projection, which needs no credential and belongs next to
 * the database.
 *
 * **No `"use node"`.** It was here because signing needed entropy the default
 * runtime does not provide; nothing in this file signs any more. Removing it
 * matters beyond tidiness: a Node-runtime file may export *only actions*, so
 * with it in place `syncPlan` and `pubkeysMissingProfile` below could not exist
 * — and that failure appears at deploy, not at type-check or test.
 *
 * **Polling, not subscribing.** Convex functions are request-scoped and cannot
 * hold a WebSocket. Real-time later means a small external consumer holding the
 * socket and pushing into Convex; nothing here needs to change for that.
 */
import { v } from 'convex/values'
import { action, query } from '../_generated/server'
import { internal } from '../_generated/api'
import type { Id } from '../_generated/dataModel'
import { ASSERTION_SUBTYPE, KIND } from './events'
import type { SignedEvent } from './events'
import { viewerId } from '../users'

/** Cap per topic per run so one busy channel cannot starve the others. */
const PAGE_LIMIT = 200

/**
 * How many of a channel's newest messages to check for reactions each run.
 *
 * Reactions have no cursor (see `listMessageEventIdsForTopic`), so this is a
 * deliberate trade: reactions on messages older than the newest N are not
 * picked up. Fine for a PoC; a real implementation would subscribe over
 * WebSocket instead of re-querying by target.
 */
const REACTION_TARGET_LIMIT = 100

/**
 * The event this kind:9 is replying to, or null if it is top-level.
 *
 * Reads the NIP-10 marked form Buzz emits: prefer the `"reply"`-marked tag, fall
 * back to `"root"`. A direct reply in Buzz carries only the `"reply"` marker
 * (`thread_tags`, builders.rs:173), so checking for `"root"` alone would miss
 * every direct reply.
 */
function replyTargetOf(e: SignedEvent): string | null {
  const eTags = e.tags.filter((t) => t[0] === 'e' && typeof t[1] === 'string')
  if (eTags.length === 0) return null
  const marked = (marker: string) => eTags.find((t) => t[3] === marker)?.[1]
  return marked('reply') ?? marked('root') ?? eTags[0][1] ?? null
}

/**
 * kind:0 content → the fields Peek stores, tolerating anything malformed.
 *
 * Both name keys are read because both are written: Peek publishes
 * `display_name`, Linear-lite publishes `name`, and a person who has used both
 * apps should resolve either way rather than on a coin flip. Anything that
 * will not parse costs a name, never a sync run.
 */
function profileFrom(profile: SignedEvent | undefined): {
  displayName?: string
  picture?: string
} {
  if (!profile) return {}
  try {
    const meta = JSON.parse(profile.content)
    const str = (value: unknown) => (typeof value === 'string' && value ? value : undefined)
    return { displayName: str(meta.display_name) ?? str(meta.name), picture: str(meta.picture) }
  } catch {
    return {}
  }
}

/**
 * Import foreign reactions on a set of known events, and apply retractions.
 *
 * Two queries because kind:7 and kind:5 are addressed differently from kind:9:
 * neither carries an `h` tag, so both are filtered by the events they target.
 */
async function syncReactions(
  ctx: { runQuery: any; runMutation: any },
  reactions: SignedEvent[],
  deletions: SignedEvent[],
  isLocal: Set<string>,
  known: string[],
  deletable: string[],
): Promise<void> {
  for (const e of reactions.filter((r) => !isLocal.has(r.pubkey))) {
    const targetId = e.tags.find((t) => t[0] === 'e')?.[1]
    if (!targetId) continue
    const target = await ctx.runQuery(internal.nostr.data.messageByNostrEventId, {
      nostrEventId: targetId,
    })
    if (!target) continue
    const userId: Id<'users'> = await ctx.runMutation(
      internal.nostr.data.resolveExternalUser,
      { nostrPubkey: e.pubkey },
    )
    await ctx.runMutation(internal.nostr.data.importReaction, {
      messageId: target.messageId,
      userId,
      // NIP-25 puts the emoji in content. `+`/`-` are the plain like/dislike
      // form; Peek has no concept of those, so they are stored verbatim rather
      // than guessed at.
      emoji: e.content,
      createdAt: e.created_at * 1000,
      nostrEventId: e.id,
    })
  }

  // Retractions are checked against the reactions Peek ALREADY HOLDS, not the
  // ones just fetched: once the relay has a kind:5 for an event it stops
  // returning that event, so a deleted reaction is absent from the fetched set
  // and asking about those ids could never find its deletion. That is why the
  // browser queries kind:5 by `known` rather than by what it just read.
  await applyDeletions(ctx, deletions, known, deletable)
}

/**
 * Apply kind:5 retractions to whatever they target (PEEK-113).
 *
 * A deletion can point at a reaction, a message or a reply, and until this
 * existed only the first was handled — so a message deleted in Ship stayed
 * visible in Peek forever, which was the last functional gap in the interop
 * surface.
 *
 * Targets are matched against the ids Peek **already holds**, never the events
 * just fetched: once the relay has a kind:5 it stops returning the target, so a
 * deleted event is absent from the fetch and asking about those ids could never
 * find its own deletion. `known` and `deletable` are exactly that set.
 *
 * The relay already enforces that a kind:5 may only delete its own author's
 * event, so anything arriving here is legitimate. Re-verifying authorship
 * locally is not possible anyway — the target may no longer be fetchable.
 */
async function applyDeletions(
  ctx: { runQuery: any; runMutation: any },
  deletions: SignedEvent[],
  known: string[],
  deletable: string[],
): Promise<void> {
  if (known.length === 0 && deletable.length === 0) return
  const reactionIds = new Set(known)
  const contentIds = new Set(deletable)
  for (const d of deletions) {
    for (const tag of d.tags) {
      if (tag[0] !== 'e') continue
      const target = tag[1]
      if (reactionIds.has(target)) {
        await ctx.runMutation(internal.nostr.data.removeReactionByNostrEventId, {
          nostrEventId: target,
        })
      } else if (contentIds.has(target)) {
        await ctx.runMutation(internal.nostr.data.removeByNostrEventId, { nostrEventId: target })
      }
    }
  }
}

/**
 * Poll every known channel and import messages authored by identities Peek does
 * not own.
 *
 * Peek's own published messages are deliberately skipped: they already exist as
 * rows, and importing them would both duplicate and race the publish path's
 * `nostrEventId` write-back. Only foreign events are projected — which is
 * exactly the interop surface.
 */
/**
 * Sync one channel, as whoever `reader` is.
 *
 * Split out because *who reads* is the whole problem. Buzz answers a read from a
 * non-member with `403 relay_membership_required`, so the identity here decides
 * whether anything is visible at all — it is not a formality.
 */
async function syncTopic(
  ctx: { runQuery: any; runMutation: any },
  incoming: SignedEvent[],
  profileEvents: SignedEvent[],
  topic: { topicId: Id<'topics'>; channelUuid: string; since: number | null },
): Promise<void> {
    try {
      // Ship and Peek now share an Estiva ID pubkey. Filtering by author
      // therefore drops Ship's messages before thread routing. Imports are
      // already idempotent by event id, which is the correct boundary.
      if (incoming.length > 0) {
        // One profile lookup per run, not per message — the browser fetched
        // them alongside the messages for exactly that reason.
        const authors = [...new Set(incoming.map((e) => e.pubkey))]
        const profileByPubkey = new Map<string, { displayName?: string; picture?: string }>()
        for (const pk of authors) {
          profileByPubkey.set(pk, profileFrom(profileEvents.find((p) => p.pubkey === pk)))
        }

        for (const e of incoming) {
          const profile = profileByPubkey.get(e.pubkey) ?? {}
          const authorId: Id<'users'> = await ctx.runMutation(
            internal.nostr.data.resolveExternalUser,
            {
              nostrPubkey: e.pubkey,
              displayName: profile.displayName,
              picture: profile.picture,
            },
          )

          // A kind:9 carrying a NIP-10 `e` tag is a reply, not a top-level
          // message — Peek keeps those in a different table.
          const parentEventId = replyTargetOf(e)
          if (parentEventId) {
            const parent = await ctx.runQuery(internal.nostr.data.messageByNostrEventId, {
              nostrEventId: parentEventId,
            })
            if (!parent) {
              // Parent not imported (yet, or ever). Skipping is right: Peek's
              // replies table requires a messageId, and inventing one would
              // strand the reply under the wrong message.
              continue
            }
            const addresses = e.tags.filter((t) => t[0] === 'a').map((t) => t[1])
            await ctx.runMutation(internal.nostr.data.importReply, {
              messageId: parent.messageId,
              authorId,
              body: e.content,
              createdAt: e.created_at * 1000,
              nostrEventId: e.id,
              nostrReferences: addresses.length > 0 ? addresses : undefined,
            })
            continue
          }

          // Deliberately no `h`-tag learning here. Topics reach this loop from
          // `listSyncableTopics`, which filters on `channelUuid`, so
          // `topic.channelUuid` is set by construction and a branch guarded on
          // its absence can never run. These events were fetched *by*
          // `'#h': [topic.channelUuid]` in the first place, so the tag could
          // only ever confirm what we already queried with.

          // Extract NIP-27 `a` tag addresses (references to other apps' objects)
          const addresses = e.tags.filter((t) => t[0] === 'a').map((t) => t[1])

          await ctx.runMutation(internal.nostr.data.importMessage, {
            topicId: topic.topicId,
            authorId,
            body: e.content,
            // Nostr seconds → Peek milliseconds.
            createdAt: e.created_at * 1000,
            nostrEventId: e.id,
            nostrReferences: addresses.length > 0 ? addresses : undefined,
          })
        }
      }

      // Advance on ALL events seen, not just imported ones — otherwise a
      // channel containing only Peek's own messages would re-read them
      // forever.
      if (incoming.length > 0) {
        await ctx.runMutation(internal.nostr.data.setTopicSyncCursor, {
          topicId: topic.topicId,
          nostrSyncedAt: Math.max(...incoming.map((e) => e.created_at)),
        })
      }
    } catch (e) {
      console.warn(`[nostr] sync failed for channel ${topic.channelUuid}:`, e)
    }
}

/**
 * A signed Nostr event, as the browser read it off the relay.
 *
 * Validated rather than trusted: these arrive from the client now, so the shape
 * is declared. Their *content* is not trusted either — every import below is
 * keyed on the event id, which is the hash of the event's own fields, so a
 * forged event cannot overwrite a real one and a replayed one is a no-op.
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
 * What the browser needs before it can read a channel (PEEK-106).
 *
 * A query, so it costs no token. The relay reads themselves happen in the
 * browser — the only place the viewer's Estiva ID token exists — and the events
 * come back to `importChannel` below.
 */
export const syncPlan = query({
  args: { topicKey: v.string() },
  handler: async (
    ctx,
    { topicKey },
  ): Promise<{ channelUuid: string; since: number | null } | null> => {
    const me = await viewerId(ctx)
    if (!me) return null
    // `topics` has no seedKey index — same lookup shape as `syncableTopicByKey`.
    const normalized = ctx.db.normalizeId('topics', topicKey)
    const rows = await ctx.db.query('topics').collect()
    const topic = normalized
      ? rows.find((r) => (r._id as string) === (normalized as string))
      : rows.find((r) => r.seedKey === topicKey)
    if (!topic?.channelUuid) return null
    return { channelUuid: topic.channelUuid, since: topic.nostrSyncedAt ?? null }
  },
})

/**
 * Project a channel's messages, and say what to fetch next.
 *
 * Takes events rather than a token. That is the whole change: the projection
 * logic is unmoved — it is intricate and belongs next to the database — but the
 * relay read that fed it does not need a credential on this side.
 *
 * Returns the reaction targets and the reaction ids Peek already holds, because
 * the browser cannot know either. **Both are computed after the import**, so a
 * message that arrived in this same run can still receive its reactions.
 */
export const importChannel = action({
  args: {
    topicKey: v.string(),
    events: v.array(signedEvent),
    profiles: v.array(signedEvent),
  },
  handler: async (
    ctx,
    { topicKey, events, profiles },
  ): Promise<{
    ok: boolean
    targets?: string[]
    known?: string[]
    deletable?: string[]
    reason?: string
  }> => {
    const viewer = await ctx.runQuery(internal.users.viewerIdForAction, {})
    if (!viewer) return { ok: false, reason: 'not signed in' }

    const topic = await ctx.runQuery(internal.nostr.data.syncableTopicByKey, { topicKey })
    if (!topic) return { ok: false, reason: 'topic has no channel on the relay yet' }

    await syncTopic(ctx, events, profiles, topic)

    // Reactions are addressed by TARGET, not by channel or cursor: kind:7 has
    // no `h` tag, and its `created_at` bears no relation to the message it
    // targets, so the channel cursor never reaches it.
    //
    // The targets must be every message Peek holds in this channel — using only
    // the events from this sync window meant a reaction on any older message
    // was silently never imported (found by testing, not by reading).
    const targets: string[] = await ctx.runQuery(
      internal.nostr.data.listMessageEventIdsForTopic,
      { topicId: topic.topicId, limit: REACTION_TARGET_LIMIT },
    )
    const known: string[] = await ctx.runQuery(
      internal.nostr.data.listReactionEventIdsForTopic,
      { topicId: topic.topicId, limit: PAGE_LIMIT },
    )
    // What a kind:5 could be retracting (PEEK-113): messages and replies, not
    // just reactions. Computed after the import for the same reason as
    // `targets` — an event imported in this run can be deleted in it too.
    const deletable: string[] = await ctx.runQuery(
      internal.nostr.data.listDeletableEventIdsForTopic,
      { topicId: topic.topicId, limit: PAGE_LIMIT },
    )
    return { ok: true, targets, known, deletable }
  },
})

/**
 * Project foreign reactions, and apply retractions.
 *
 * A second round trip rather than one, because the browser cannot know which
 * events to ask about until the messages have been imported — `targets` and
 * `known` come out of `importChannel`.
 */
export const importReactions = action({
  args: {
    topicKey: v.string(),
    reactions: v.array(signedEvent),
    deletions: v.array(signedEvent),
    known: v.array(v.string()),
    deletable: v.array(v.string()),
  },
  handler: async (
    ctx,
    { topicKey, reactions, deletions, known, deletable },
  ): Promise<{ ok: boolean; reason?: string }> => {
    const viewer = await ctx.runQuery(internal.users.viewerIdForAction, {})
    if (!viewer) return { ok: false, reason: 'not signed in' }
    const topic = await ctx.runQuery(internal.nostr.data.syncableTopicByKey, { topicKey })
    if (!topic) return { ok: false, reason: 'topic has no channel on the relay yet' }

    const localPubkeys: string[] = await ctx.runQuery(internal.nostr.data.listLocalPubkeys, {})
    try {
      await syncReactions(ctx, reactions, deletions, new Set(localPubkeys), known, deletable)
      return { ok: true }
    } catch (e) {
      console.warn(`[nostr] importReactions(${topicKey}) failed:`, e)
      return { ok: false, reason: e instanceof Error ? e.message : 'import failed' }
    }
  },
})

/** Manual trigger, for testing without waiting for the cron. */
/**
 * Fill in names and faces for anyone still showing a placeholder (PEEK-72).
 *
 * `syncTopic` already resolves a profile for the author of every message it
 * imports — but only *newly* imported ones. Once the `since` cursor has passed
 * someone's messages they are never looked up again, so anyone whose row was
 * created before Estiva ID published their `kind:0` keeps `nostr:<8 chars>` and a
 * silhouette forever. That is not a rare edge: it is every person who was already
 * in a topic when this landed.
 *
 * So this asks the question the other way round — who is *missing* a profile —
 * rather than waiting for them to say something new.
 *
 * Reads as the viewer, like everything else, because the relay is NIP-98 gated.
 * `kind:0` is not channel-scoped, so membership is not in play; only auth is.
 *
 * Cheap and idempotent: one query for everyone, and `resolveExternalUser` writes
 * nothing when there is nothing new. The client calls it once after sign-in.
 */
/** Who is still showing a placeholder. A query, so it costs no token. */
/**
 * Project resolution assertions from the channel (PEEK-128).
 *
 * A separate round trip from `importChannel`, like reactions, because an
 * assertion can only be projected once its target message exists locally — and
 * in a first sync the target arrives in that same call.
 *
 * Unknown authors are resolved the same way message authors are, so a
 * resolution from someone with no Peek account still renders with a name.
 * `importResolution` then records it as untrusted, which keeps it visible as
 * history without letting it move Peek's own state.
 */
export const importResolutions = action({
  args: { topicKey: v.string(), assertions: v.array(signedEvent) },
  handler: async (ctx, { topicKey, assertions }): Promise<{ ok: boolean; imported?: number; reason?: string }> => {
    const viewer = await ctx.runQuery(internal.users.viewerIdForAction, {})
    if (!viewer) return { ok: false, reason: 'not signed in' }
    const topic = await ctx.runQuery(internal.nostr.data.syncableTopicByKey, { topicKey })
    if (!topic) return { ok: false, reason: 'topic has no channel on the relay yet' }

    const touched = new Set<string>()
    let imported = 0

    for (const e of assertions) {
      if (e.kind !== KIND.ASSERTION) continue
      const tag = (name: string) => e.tags.find((t) => t[0] === name)?.[1]
      if (tag('t') !== ASSERTION_SUBTYPE.RESOLUTION) continue

      const action = tag('action')
      if (action !== 'resolved' && action !== 'reopened') continue

      // The target is the first unmarked `e`; a marked one is the supporting
      // reply. Both share the tag name, so order and marker are what separate
      // them — see buildResolution.
      const eTags = e.tags.filter((t) => t[0] === 'e')
      const targetEventId = eTags.find((t) => t[3] !== 'support')?.[1]
      if (!targetEventId) continue
      const supportingEventId = eTags.find((t) => t[3] === 'support')?.[1]

      const authorId = await ctx.runMutation(internal.nostr.data.resolveExternalUser, {
        nostrPubkey: e.pubkey,
      })
      const result = await ctx.runMutation(internal.nostr.data.importResolution, {
        nostrEventId: e.id,
        targetEventId,
        authorId,
        authorPubkey: e.pubkey,
        action,
        createdAtMs: e.created_at * 1000,
        rationale: e.content || undefined,
        supportingEventId,
      })
      if (result.imported) imported += 1
      if (result.messageId) touched.add(result.messageId as string)
    }

    // Folded once per message, after the whole batch: assertions arrive in
    // relay order, and folding mid-batch would briefly project a state the
    // channel never actually held.
    for (const messageId of touched) {
      await ctx.runMutation(internal.nostr.data.refoldResolution, {
        messageId: messageId as Id<'messages'>,
      })
    }
    return { ok: true, imported }
  },
})

export const pubkeysMissingProfile = query({
  args: {},
  handler: async (ctx): Promise<string[]> => {
    const me = await viewerId(ctx)
    if (!me) return []
    const users = await ctx.db.query('users').collect()
    return users
      .filter((u) => u.nostrPubkey && (/^nostr:[0-9a-f]{8}$/.test(u.name) || !u.image))
      .map((u) => u.nostrPubkey as string)
  },
})

export const recordProfiles = action({
  args: { profiles: v.array(signedEvent) },
  handler: async (ctx, { profiles }): Promise<{ ok: boolean; updated?: number; reason?: string }> => {
    const viewer = await ctx.runQuery(internal.users.viewerIdForAction, {})
    if (!viewer) return { ok: false, reason: 'not signed in' }

    let updated = 0
    for (const event of profiles) {
      const profile = profileFrom(event)
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
