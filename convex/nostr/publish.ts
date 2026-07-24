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
import { buildAddMember, buildCreateChannel, buildMessage, buildProfile } from './events'
import { signEvent } from './sign'
import { decryptSecretKey, encryptSecretKey, generateKeypair } from './keys'
import { publishEvent, relayUrl } from './bridge'

interface Identity {
  pubkey: string
  secretKeyHex: string
}

/**
 * The relay's answer when a message targets a channel it does not know. Seen
 * verbatim from a live relay; used to detect "the channel needs creating first"
 * rather than assuming an ordering that might silently be wrong.
 */
const NOT_A_MEMBER = 'restricted: not a channel member'

/** Fetch or mint a user's keypair, returning the decrypted secret. */
async function identityFor(
  ctx: { runQuery: any; runMutation: any },
  userId: Id<'users'>,
): Promise<Identity> {
  const existing = await ctx.runQuery(internal.nostr.data.getUserKeys, { userId })
  if (!existing) throw new Error(`unknown user ${userId}`)
  if (existing.nostrPubkey && existing.nostrSecretKey) {
    return {
      pubkey: existing.nostrPubkey,
      secretKeyHex: await decryptSecretKey(existing.nostrSecretKey),
    }
  }
  const kp = generateKeypair()
  // First-write-wins: the mutation returns the effective values, so if another
  // publish minted first we adopt its key instead of splitting the identity.
  const stored = await ctx.runMutation(internal.nostr.data.storeKeypair, {
    userId,
    nostrPubkey: kp.publicKeyHex,
    nostrSecretKey: await encryptSecretKey(kp.secretKeyHex),
  })
  return {
    pubkey: stored.nostrPubkey,
    secretKeyHex: await decryptSecretKey(stored.nostrSecretKey),
  }
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

  const uuid =
    topic.channelUuid ??
    (
      await ctx.runMutation(internal.nostr.data.storeChannelUuid, {
        topicId,
        // Lowercase v4, which the relay advertises as its `h` grammar in NIP-11.
        channelUuid: crypto.randomUUID(),
      })
    ).channelUuid

  const res = await publishEvent(
    signEvent(
      buildCreateChannel(creator.pubkey, topic.createdAt, {
        channelUuid: uuid,
        name: topic.title,
        visibility: 'open',
        channelType: 'stream',
      }),
      creator.secretKeyHex,
    ),
    creator,
  )
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
        if (member.pubkey === channel.creator.pubkey) continue // creator is already owner
        const res = await publishEvent(
          signEvent(
            buildAddMember(channel.creator.pubkey, Date.now(), {
              channelUuid: channel.channelUuid,
              targetPubkey: member.pubkey,
              role: 'member',
            }),
            channel.creator.secretKeyHex,
          ),
          channel.creator,
        )
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

      const author = await identityFor(ctx, m.authorId)

      // Happy path assumes the channel exists, to avoid a round trip per message.
      let channelUuid = m.channelUuid
      if (!channelUuid) {
        const channel = await ensureChannel(ctx, m.topicId)
        if (!channel) return
        channelUuid = channel.channelUuid
      }

      const send = () =>
        publishEvent(
          signEvent(
            buildMessage(author.pubkey, m.createdAt, { channelUuid: channelUuid!, content: m.body }),
            author.secretKeyHex,
          ),
          author,
        )

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
      if (member.pubkey === channel.creator.pubkey) return // creator is already owner
      const res = await publishEvent(
        signEvent(
          buildAddMember(channel.creator.pubkey, Date.now(), {
            channelUuid: channel.channelUuid,
            targetPubkey: member.pubkey,
            role: 'member',
          }),
          channel.creator.secretKeyHex,
        ),
        channel.creator,
      )
      if (!res.ok) console.warn(`[nostr] add-member rejected: ${res.reason}`)
    } catch (e) {
      console.warn(`[nostr] publishMembership(${topicId}, ${userId}) failed:`, e)
    }
  },
})

/** Publish a user's profile as kind:0 so other clients render a person. */
export const publishProfile = internalAction({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => {
    if (!relayUrl()) return
    try {
      const u = await ctx.runQuery(internal.nostr.data.getUserKeys, { userId })
      if (!u) return
      const identity = await identityFor(ctx, userId)
      const res = await publishEvent(
        signEvent(
          buildProfile(identity.pubkey, Date.now(), {
            display_name: u.name,
            about: u.role || undefined,
          }),
          identity.secretKeyHex,
        ),
        identity,
      )
      if (!res.ok) console.warn(`[nostr] profile ${userId} rejected: ${res.reason}`)
    } catch (e) {
      console.warn(`[nostr] publishProfile(${userId}) failed:`, e)
    }
  },
})
