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
import { internalAction } from '../_generated/server'
import { internal } from '../_generated/api'
import type { Id } from '../_generated/dataModel'
import {
  buildAddMember,
  buildCreateChannel,
  buildDeletion,
  buildMessage,
  buildReaction,
} from './events'
import { publishEvent, relayUrl, serviceIdentity, signWithIdentityService } from './bridge'

interface Identity {
  pubkey: string
  token: string
}

/**
 * The relay's answer when a message targets a channel it does not know. Seen
 * verbatim from a live relay; used to detect "the channel needs creating first"
 * rather than assuming an ordering that might silently be wrong.
 */
const NOT_A_MEMBER = 'restricted: not a channel member'

/**
 * The relay rejects any event whose `created_at` is more than ±15 minutes from
 * server time — `MAX_TIMESTAMP_DRIFT_SECS` in `handlers/ingest.rs:1480`,
 * hard-coded and applied to every ingested event, not just NIP-98 auth.
 *
 * Consequence: **Peek's existing history cannot be backfilled with its real
 * timestamps.** Live traffic is unaffected. Rather than falsify `created_at` to
 * sneak old messages past the check — which would corrupt the shared record for
 * every other app reading it — out-of-window messages are skipped and logged.
 *
 * Container events (channel create, membership, profile) are different: they
 * describe state we are establishing *now*, so they legitimately carry the
 * current time and an old topic can still be published.
 */
const MAX_DRIFT_MS = 900_000

function withinDriftWindow(createdAtMs: number): boolean {
  return Math.abs(createdAtMs - Date.now()) <= MAX_DRIFT_MS
}

/**
 * Sign through the identity service instead of local key custody.
 *
 * The token comes from the backend service credential. The event author pubkey
 * comes from the user row, so published actions still appear as the acting
 * user instead of the service account.
 */
export async function identityFor(
  ctx: { runQuery: any; runMutation: any },
  userId: Id<'users'>,
): Promise<Identity | null> {
  const auth = await serviceIdentity()
  if (!auth) return null

  const keys = await ctx.runQuery(internal.nostr.data.getUserKeys, { userId })
  if (!keys?.nostrPubkey) return null

  return { pubkey: keys.nostrPubkey, token: auth.token! }
}

/**
 * One place to say why a publish was skipped, so the reason is legible in logs
 * instead of being inferred from silence.
 */
function skipUnsigned(what: string, userId: Id<'users'>): null {
  console.warn(
    `[nostr] ${what} skipped: Peek has no identity-service credential for user ${userId}. ` +
      `Signing now goes through Estiva ID, so nothing local is decrypted or minted.`,
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
): Promise<{ channelUuid: string; creator: Identity } | null> {
  const topic = await ctx.runQuery(internal.nostr.data.getTopic, { topicId })
  if (!topic) return null
  const creator = await identityFor(ctx, topic.creatorId)
  if (!creator) return skipUnsigned(`channel for topic ${topicId}`, topic.creatorId)

  const uuid =
    topic.channelUuid ??
    (
      await ctx.runMutation(internal.nostr.data.storeChannelUuid, {
        topicId,
        // Lowercase v4, which the relay advertises as its `h` grammar in NIP-11.
        channelUuid: crypto.randomUUID(),
      })
    ).channelUuid

  const signed = await signWithIdentityService(
    // Date.now(), not topic.createdAt: we are creating this channel on the
    // relay now, and a Peek topic older than 15 minutes would otherwise be
    // rejected by the drift check and could never be published at all.
    buildCreateChannel(creator.pubkey, Date.now(), {
      channelUuid: uuid,
      name: topic.title,
      visibility: 'open',
      channelType: 'stream',
    }),
    creator,
  )
  const res = await publishEvent(signed, creator)
  if (!res.ok) {
    console.warn(`[nostr] channel create rejected for topic ${topicId}: ${res.reason}`)
    return null
  }
  return { channelUuid: uuid, creator }
}

/** Publish a topic as a NIP-29 channel (kind:9007) plus its membership. */
export const publishTopic = internalAction({
  args: { topicId: v.id('topics') },
  handler: async (ctx, { topicId }) => {
    if (!relayUrl()) return
    try {
      const channel = await ensureChannel(ctx, topicId)
      if (!channel) return
      const memberIds: Id<'users'>[] = await ctx.runQuery(
        internal.nostr.data.getTopicMemberIds,
        { topicId },
      )
      for (const userId of memberIds) {
        const member = await identityFor(ctx, userId)
        if (!member) {
          skipUnsigned(`membership for topic ${topicId}`, userId)
          continue
        }
        if (member.pubkey === channel.creator.pubkey) continue // creator is already owner
        const signed = await signWithIdentityService(
          buildAddMember(channel.creator.pubkey, Date.now(), {
            channelUuid: channel.channelUuid,
            targetPubkey: member.pubkey,
            role: 'member',
          }),
          channel.creator,
        )
        const res = await publishEvent(signed, channel.creator)
        if (!res.ok) console.warn(`[nostr] add-member rejected: ${res.reason}`)
      }
    } catch (e) {
      console.warn(`[nostr] publishTopic(${topicId}) failed:`, e)
    }
  },
})

/** Publish one message as kind:9. */
export const publishMessage = internalAction({
  args: { messageId: v.id('messages') },
  handler: async (ctx, { messageId }) => {
    if (!relayUrl()) return
    try {
      const m = await ctx.runQuery(internal.nostr.data.getMessageContext, { messageId })
      if (!m) return // DM, huddle, or deleted — out of scope for Stage 1
      if (m.alreadyPublished) return // idempotent: never publish the same row twice

      // Checked before signing so old rows cost nothing and the reason is
      // legible, rather than surfacing as the relay's generic drift rejection.
      if (!withinDriftWindow(m.createdAt)) {
        console.warn(
          `[nostr] message ${messageId} skipped: createdAt is outside the relay's ±15min ` +
            `window, and rewriting it would falsify the shared record. Backfill needs a ` +
            `separate decision — see docs/buzz-compat/FRICTION.md.`,
        )
        return
      }

      const author = await identityFor(ctx, m.authorId)
      if (!author) {
        skipUnsigned(`message ${messageId}`, m.authorId)
        return
      }

      // Happy path assumes the channel exists, to avoid a round trip per message.
      let channelUuid = m.channelUuid
      if (!channelUuid) {
        const channel = await ensureChannel(ctx, m.topicId)
        if (!channel) return
        channelUuid = channel.channelUuid
      }

      const send = async () => {
        const signed = await signWithIdentityService(
          buildMessage(author.pubkey, m.createdAt, { channelUuid: channelUuid!, content: m.body }),
          author,
        )
        return publishEvent(signed, author)
      }

      let res = await send()

      // The channel can be absent even when Peek has a UUID for it — a wiped or
      // rebuilt relay is the common case in development. The relay says exactly
      // this when that happens, so recreate the channel and retry once.
      if (!res.ok && res.reason?.includes(NOT_A_MEMBER)) {
        const channel = await ensureChannel(ctx, m.topicId)
        if (channel) res = await send()
      }

      if (!res.ok) {
        console.warn(`[nostr] message ${messageId} rejected: ${res.reason}`)
        return
      }
      if (res.eventId) {
        await ctx.runMutation(internal.nostr.data.markMessagePublished, {
          messageId,
          nostrEventId: res.eventId,
        })
      }
    } catch (e) {
      console.warn(`[nostr] publishMessage(${messageId}) failed:`, e)
    }
  },
})

/**
 * Publish a single membership addition as kind:9000.
 *
 * Separate from `publishTopic` so the common case — someone joining, or being
 * added implicitly by posting — costs one request rather than republishing the
 * whole member list.
 */
export const publishMembership = internalAction({
  args: { topicId: v.id('topics'), userId: v.id('users') },
  handler: async (ctx, { topicId, userId }) => {
    if (!relayUrl()) return
    try {
      const channel = await ensureChannel(ctx, topicId)
      if (!channel) return
      const member = await identityFor(ctx, userId)
      if (!member) {
        skipUnsigned(`membership for topic ${topicId}`, userId)
        return
      }
      if (member.pubkey === channel.creator.pubkey) return // creator is already owner
      const signed = await signWithIdentityService(
        buildAddMember(channel.creator.pubkey, Date.now(), {
          channelUuid: channel.channelUuid,
          targetPubkey: member.pubkey,
          role: 'member',
        }),
        channel.creator,
      )
      const res = await publishEvent(signed, channel.creator)
      if (!res.ok) console.warn(`[nostr] add-member rejected: ${res.reason}`)
    } catch (e) {
      console.warn(`[nostr] publishMembership(${topicId}, ${userId}) failed:`, e)
    }
  },
})

/**
 * Publish a reply as a kind:9 carrying a NIP-10 `e` tag.
 *
 * Peek's replies are always **direct** replies to a message — no nesting — so
 * root and parent are the same event and `threadTags` emits the single
 * `["e", id, "", "reply"]` form Buzz uses.
 *
 * Skipped when the parent message has not been published: Buzz rejects replies
 * to events it does not know, and there is no id to point at.
 */
export const publishReply = internalAction({
  args: { replyId: v.id('replies') },
  handler: async (ctx, { replyId }) => {
    if (!relayUrl()) return
    try {
      const r = await ctx.runQuery(internal.nostr.data.getReplyContext, { replyId })
      if (!r || r.alreadyPublished) return
      if (!r.channelUuid || !r.parentEventId) {
        console.warn(
          `[nostr] reply ${replyId} skipped: parent message is not on the relay yet`,
        )
        return
      }
      if (!withinDriftWindow(r.createdAt)) return

      const author = await identityFor(ctx, r.authorId)
      if (!author) {
        skipUnsigned(`reply ${replyId}`, r.authorId)
        return
      }
      const signed = await signWithIdentityService(
        buildMessage(author.pubkey, r.createdAt, {
          channelUuid: r.channelUuid,
          content: r.body,
          threadRef: { rootId: r.parentEventId, parentId: r.parentEventId },
        }),
        author,
      )
      const res = await publishEvent(signed, author)
      if (!res.ok) {
        console.warn(`[nostr] reply ${replyId} rejected: ${res.reason}`)
        return
      }
      if (res.eventId) {
        await ctx.runMutation(internal.nostr.data.markReplyPublished, {
          replyId,
          nostrEventId: res.eventId,
        })
      }
    } catch (e) {
      console.warn(`[nostr] publishReply(${replyId}) failed:`, e)
    }
  },
})

/** Publish a reaction as kind:7 pointing at the target message's event. */
export const publishReaction = internalAction({
  args: { reactionId: v.id('reactions') },
  handler: async (ctx, { reactionId }) => {
    if (!relayUrl()) return
    try {
      const r = await ctx.runQuery(internal.nostr.data.getReactionContext, { reactionId })
      if (!r || r.alreadyPublished) return
      if (!r.targetEventId) return // target not on the relay — nothing to react to
      if (!withinDriftWindow(r.createdAt)) return

      const author = await identityFor(ctx, r.userId)
      if (!author) {
        skipUnsigned(`reaction ${reactionId}`, r.userId)
        return
      }
      const signed = await signWithIdentityService(
        buildReaction(author.pubkey, r.createdAt, {
          targetEventId: r.targetEventId,
          emoji: r.emoji,
        }),
        author,
      )
      const res = await publishEvent(signed, author)
      if (!res.ok) {
        console.warn(`[nostr] reaction ${reactionId} rejected: ${res.reason}`)
        return
      }
      if (res.eventId) {
        await ctx.runMutation(internal.nostr.data.markReactionPublished, {
          reactionId,
          nostrEventId: res.eventId,
        })
      }
    } catch (e) {
      console.warn(`[nostr] publishReaction(${reactionId}) failed:`, e)
    }
  },
})

/**
 * Retract a reaction with a kind:5 deletion.
 *
 * Takes the event id and the reacting user rather than a row id, because by the
 * time this runs the Convex row is already gone — un-reacting deletes it.
 */
export const publishReactionRemoval = internalAction({
  args: { userId: v.id('users'), nostrEventId: v.string() },
  handler: async (ctx, { userId, nostrEventId }) => {
    if (!relayUrl()) return
    try {
      const author = await identityFor(ctx, userId)
      if (!author) {
        skipUnsigned(`deletion of ${nostrEventId}`, userId)
        return
      }
      const signed = await signWithIdentityService(
        buildDeletion(author.pubkey, Date.now(), { targetEventId: nostrEventId }),
        author,
      )
      const res = await publishEvent(signed, author)
      if (!res.ok) console.warn(`[nostr] reaction deletion rejected: ${res.reason}`)
    } catch (e) {
      console.warn(`[nostr] publishReactionRemoval failed:`, e)
    }
  },
})

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
