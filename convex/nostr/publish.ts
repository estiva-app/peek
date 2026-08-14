'use node'

/**
 * Publish Peek writes to a Buzz relay as signed Nostr events.
 *
 * `"use node"` because signing needs entropy that Convex's default runtime does
 * not provide. Node-runtime files may only export actions — the queries and
 * mutations these call live in `./data.ts`.
 *
 * **Publishing never breaks Peek.** Every action swallows its errors and logs
 * them: the Convex row is already written by the time these run, so a relay that
 * is down, misconfigured, or rejecting must not surface as a failed user action.
 * When `NOSTR_RELAY_URL` is unset, everything here is a no-op — that is the
 * feature flag.
 */
import { v } from 'convex/values'
import { action, internalAction } from '../_generated/server'
import { internal } from '../_generated/api'
import type { Id } from '../_generated/dataModel'
import { buildAddMember, buildCreateChannel } from './events'
import { publishEvent, relayUrl, signAs, type RelayAuth } from './bridge'

/**
 * Who a publish is attributed to, and how it will be signed.
 *
 * Same shape as `RelayAuth` on purpose: the bridge needs exactly this to sign
 * both the content event and its NIP-98 auth event, and having two near-identical
 * types invited passing one where the other was meant.
 */
type Identity = RelayAuth & { pubkey: string }

/**
 * The creator's short-lived Estiva ID token arrives from the authenticated
 * browser. Unlike a client-credentials token, it is bound to that person, so
 * `/sign` will return an event authored by the creator's actual pubkey.
 *
 * The token is used only for this action invocation; it is never stored in a
 * Convex document or written to logs.
 */
export async function identityForCreatorToken(
  ctx: { runQuery: any },
  userId: Id<'users'>,
  token: string,
): Promise<Identity | null> {
  const keys = await ctx.runQuery(internal.nostr.data.getUserKeys, { userId })
  if (!keys?.nostrPubkey) return null
  return { pubkey: keys.nostrPubkey, token }
}

/**
 * One place to say why a publish was skipped, so the reason is legible in logs
 * instead of being inferred from silence.
 */
function skipUnsigned(what: string, userId: Id<'users'>): null {
  console.warn(
    `[nostr] ${what} skipped: Peek holds no signing key for user ${userId}, and scheduled ` +
      `work cannot see their Estiva ID token. The client publishes this with its own token ` +
      `instead; signing here as anyone else would misattribute the event.`,
  )
  return null
}

/**
 * Ensure the topic's channel exists on the relay, returning its UUID.
 *
 * Idempotent in both directions: a duplicate create comes back as
 * `accepted:false, "duplicate: channel already exists"`, which `publishEvent`
 * reports as ok, so re-running is safe.
 */
async function ensureChannel(
  ctx: { runQuery: any; runMutation: any },
  topicId: Id<'topics'>,
  creatorOverride?: Identity,
): Promise<{ channelUuid: string; creator: Identity } | null> {
  console.log(`[TRACE] ensureChannel START topicId=${topicId}`)
  const topic = await ctx.runQuery(internal.nostr.data.getTopic, { topicId })
  if (!topic) { console.log(`[TRACE] ensureChannel: topic not found`); return null }
  console.log(`[TRACE] ensureChannel: topic found, creatorId=${topic.creatorId}, existing channelUuid=${topic.channelUuid ?? 'NONE'}`)

  // Only `publishTopicAsCreator` can supply one: Peek holds no keys, and
  // scheduled work cannot see anyone's token.
  if (!creatorOverride) return skipUnsigned(`channel for topic ${topicId}`, topic.creatorId)
  const creator = creatorOverride

  const uuid = topic.channelUuid ?? crypto.randomUUID()
  console.log(`[TRACE] ensureChannel: uuid=${uuid} (${topic.channelUuid ? 'existing' : 'newly minted'})`)

  const unsigned = buildCreateChannel(creator.pubkey, Date.now(), {
    channelUuid: uuid,
    name: topic.title,
    visibility: 'open',
    channelType: 'stream',
  })
  console.log(`[TRACE] ensureChannel: buildCreateChannel kind=${unsigned.kind}, pubkey=${unsigned.pubkey}, tags=${JSON.stringify(unsigned.tags)}`)

  let signed
  try {
    signed = await signAs(unsigned, creator)
    if (signed.pubkey !== creator.pubkey) {
      throw new Error(
        `POST /sign returned ${signed.pubkey}, expected creator ${creator.pubkey}; refusing service authorship`,
      )
    }
    console.log(`[TRACE] ensureChannel: signAs OK, eventId=${signed.id}`)
  } catch (e) {
    console.error(`[TRACE] ensureChannel: signAs THREW:`, e)
    throw e
  }

  const res = await publishEvent(signed, creator)
  console.log(`[TRACE] ensureChannel: publishEvent result=${JSON.stringify(res)}`)
  if (!res.ok) {
    console.warn(`[nostr] channel create rejected for topic ${topicId}: ${res.reason}`)
    return null
  }

  // Persist channelUuid only after the relay has accepted the channel event,
  // so downstream consumers (Ship, folderForTopic) never see a folderId
  // that the relay does not yet know about.
  if (!topic.channelUuid) {
    await ctx.runMutation(internal.nostr.data.storeChannelUuid, {
      topicId,
      channelUuid: uuid,
    })
    console.log(`[TRACE] ensureChannel: storeChannelUuid DONE for topicId=${topicId}, uuid=${uuid}`)
  } else {
    console.log(`[TRACE] ensureChannel: channelUuid already persisted, skipping storeChannelUuid`)
  }

  return { channelUuid: uuid, creator }
}

/**
 * Create and persist a topic channel using the Estiva ID token of the person
 * who just created the topic. This is deliberately an action, not a scheduled
 * job: Convex does not expose the caller's raw bearer token to scheduled work,
 * while Estiva ID correctly refuses to sign as anyone other than that token's
 * subject.
 */
export const publishTopicAsCreator = action({
  args: { topicId: v.id('topics'), estivaAccessToken: v.string() },
  handler: async (ctx, { topicId, estivaAccessToken }) => {
    if (!relayUrl()) return { ok: false, reason: 'NOSTR_RELAY_URL is unset' }

    const [topic, viewerId] = await Promise.all([
      ctx.runQuery(internal.nostr.data.getTopic, { topicId }),
      ctx.runQuery(internal.users.viewerIdForAction, {}),
    ])
    if (!topic) return { ok: false, reason: `unknown topic ${topicId}` }
    if (!viewerId || viewerId !== topic.creatorId) {
      return { ok: false, reason: 'only the topic creator may publish its channel' }
    }

    const creator = await identityForCreatorToken(ctx, topic.creatorId, estivaAccessToken)
    if (!creator) return { ok: false, reason: 'creator has no Estiva ID pubkey' }

    try {
      const channel = await ensureChannel(ctx, topicId, creator)
      if (!channel) return { ok: false, reason: 'relay rejected channel creation' }

      // The creator's accepted kind:9007 establishes the folder. Memberships
      // come after it, so an invited person never receives a reference to an
      // unknown channel. They are signed by the creator's real identity too.
      const memberIds: Id<'users'>[] = await ctx.runQuery(
        internal.nostr.data.getTopicMemberIds,
        { topicId },
      )
      for (const userId of memberIds) {
        const member = await ctx.runQuery(internal.nostr.data.getUserKeys, { userId })
        if (!member?.nostrPubkey || member.nostrPubkey === creator.pubkey) continue
        const signed = await signAs(
          buildAddMember(creator.pubkey, Date.now(), {
            channelUuid: channel.channelUuid,
            targetPubkey: member.nostrPubkey,
            role: 'member',
          }),
          creator,
        )
        if (signed.pubkey !== creator.pubkey) {
          throw new Error(`POST /sign returned ${signed.pubkey}, expected creator ${creator.pubkey}`)
        }
        const result = await publishEvent(signed, creator)
        if (!result.ok) console.warn(`[nostr] add-member rejected: ${result.reason}`)
      }
      return { ok: true, channelUuid: channel.channelUuid }
    } catch (error) {
      console.warn(`[nostr] publishTopicAsCreator(${topicId}) failed:`, error)
      return { ok: false, reason: error instanceof Error ? error.message : 'channel publish failed' }
    }
  },
})

/**
 * Messages are published from the BROWSER now (PEEK-106).
 *
 * `publishMessageWith` and `publishMessageAsAuthor` stood here. They took the
 * author's bearer token as a Convex action argument, and Convex surfaces
 * arguments in its dashboard logs, so every message sent parked a credential
 * that can sign as that person in log retention. The replacement is
 * `nostr/outbox.ts` (build the unsigned event) plus `src/api/actions.ts` (sign
 * it and publish it), and no token crosses the boundary.
 *
 * **One behaviour was deleted rather than moved, deliberately.** The old code
 * caught the relay's `restricted: not a channel member` and called
 * `ensureChannel` to recreate the channel before retrying. That retry has been
 * dead since PEEK-40: `ensureChannel` refuses without a `creatorOverride`, and
 * neither the retry nor the missing-channel branch ever passed one, so both
 * have returned null for every message since Peek stopped holding keys. It was
 * unreachable code that read as a working safety net — which is worse than not
 * having one.
 *
 * Rebuilding it properly is a real option and belongs to its own ticket rather
 * than to this refactor: the browser *does* hold a token, so a viewer who is
 * the topic's creator could recreate the channel. A viewer who is not cannot,
 * and must not — the channel belongs to the creator, and publishing it as
 * whoever spoke first would make the wrong person its owner.
 */

/**
 * Replies, reactions and retractions publish from the BROWSER now (PEEK-106).
 *
 * `publishReplyWith` / `publishReplyAsAuthor`, `publishReactionWith` /
 * `publishReactionAsAuthor`, and `publishRemovalWith` /
 * `publishReactionRemovalAsAuthor` stood here. All six took the user's bearer
 * token as a Convex action argument, and Convex surfaces arguments in its
 * dashboard logs.
 *
 * They are replaced by `nostr/outbox.ts` (`unsignedReply`, `unsignedReaction`,
 * and the matching `record…Published` mutations) plus `src/api/actions.ts`,
 * which signs and publishes. A retraction needs no query at all: the row is
 * already deleted, so the kind:5 is built from the id `toggleReaction` hands
 * back, exactly as message deletion works.
 *
 * The NIP-10 detail that was here is now in `outbox.unsignedReply`, and it is
 * still the thing to get right: Peek's replies are always direct, so root and
 * parent are the same event and Buzz expects the single
 * `["e", id, "", "reply"]` form rather than a root/reply pair.
 */

/**
 * Deleting a message tombstones it from the BROWSER, not from here (PEEK-106).
 *
 * There was a `publishDeletionAsAuthor` action in this spot. It worked, but it
 * took the user's bearer token as a Convex action argument, and Convex surfaces
 * arguments in its dashboard logs — so every delete parked a token that can
 * sign as that person in log retention. `src/api/actions.ts` now signs the
 * kind:5 via `/sign` and POSTs it to the bridge itself, and the token never
 * leaves the tab.
 *
 * This path went first because it needs nothing from Convex to build the event:
 * a kind:5 is just the target id, and the viewer's pubkey is in their own
 * token. The paths still below all assemble their event from rows, so they need
 * an "unsigned event" query before they can move the same way.
 */

/**
 * **Peek does not publish kind:0. Estiva ID does, and it is the only writer.**
 *
 * There was a `publishProfile` here. It built a profile from Peek's own `users`
 * table and published it — and Ship did the same from its own table, which is
 * exactly why one human could arrive in the two apps as two different people.
 * Two writers and no agreement is not a bug in either publisher; it is the
 * shape. One writer is the fix (PEEK-31).
 *
 * The identity service owns this now: `PUT /me/profile` on Estiva ID writes the
 * profile and publishes the `kind:0`, signing with the custodied key. Its
 * `/sign` endpoint refuses `kind:0` for every app, always — so this is not a
 * convention that a later change could quietly undo. An app *cannot* get a
 * profile signed even if it asks.
 *
 * `buildProfile` stays in `events.ts`: the compat harness still uses it to
 * check our NIP-01 serialization against Buzz's Rust, and that check is the
 * reason this app's events are byte-compatible at all.
 *
 * Still open, and deliberately not solved here: Peek's own profile dialog keeps
 * writing `name`, `role` and the avatar to the local `users` table, which now
 * goes no further than Peek. Those fields are read from Estiva ID once PEEK-72
 * lands; until then, treat Peek's copy as a cache that nothing refreshes.
 */
