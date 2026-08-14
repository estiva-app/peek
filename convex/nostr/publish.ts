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
import {
  buildAddMember,
  buildCreateChannel,
  buildDeletion,
  buildMessage,
  buildReaction,
} from './events'
import { publishEvent, relayUrl, signAs, type RelayAuth } from './bridge'
import { maybeDecryptSecretKey } from './keys'
import { decodeNaddr, findNaddrs, pointerToAddress } from './nip19'

/**
 * Who a publish is attributed to, and how it will be signed.
 *
 * Same shape as `RelayAuth` on purpose: the bridge needs exactly this to sign
 * both the content event and its NIP-98 auth event, and having two near-identical
 * types invited passing one where the other was meant.
 */
type Identity = RelayAuth & { pubkey: string }

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
 * How scheduled work signs for a user, or `null` when it cannot.
 *
 * Returning `null` is a real answer, not a failure: for an Estiva ID identity
 * there is no way for background work to sign, and the honest response is to
 * skip rather than to publish under some other name.
 */
export async function identityFor(
  ctx: { runQuery: any; runMutation: any },
  userId: Id<'users'>,
): Promise<Identity | null> {
  const keys = await ctx.runQuery(internal.nostr.data.getUserKeys, { userId })
  if (!keys?.nostrPubkey) return null

  // Custodied key: a legacy Convex Auth user whose secret Peek still holds.
  // Signed locally, exactly as before Estiva ID existed. PEEK-37 moves these
  // keys out and PEEK-41 retires the accounts; until then this is the only way
  // scheduled work can publish for them.
  if (keys.nostrSecretKey) {
    return {
      pubkey: keys.nostrPubkey,
      secretKeyHex: await maybeDecryptSecretKey(keys.nostrSecretKey),
    }
  }

  // An Estiva ID identity. Peek holds no key, and scheduled actions cannot see
  // the caller's bearer token — Convex does not expose it to background work.
  // A service credential is not a substitute: `/sign` signs as the token's
  // subject, so a service token would publish somebody else's name onto this
  // person's message. The client republishes with its own token instead
  // (`publishTopicAsCreator`); callers here skip and say so.
  return null
}

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
 * Preserve a pasted Ship reference as the explicit address association its
 * manifest declares for comments. Bad lookalikes stay ordinary message text.
 */
function referencedAddresses(body: string): string[] {
  const addresses = new Set<string>()
  for (const naddr of findNaddrs(body)) {
    try {
      addresses.add(pointerToAddress(decodeNaddr(naddr)))
    } catch {
      // Text is free-form; one malformed pointer cannot block a message.
    }
  }
  return [...addresses]
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

  const creator = creatorOverride ?? (await identityFor(ctx, topic.creatorId))
  if (!creator) {
    console.log(`[TRACE] ensureChannel: identityFor returned null for creatorId=${topic.creatorId}`)
    return skipUnsigned(`channel for topic ${topicId}`, topic.creatorId)
  }
  console.log(`[TRACE] ensureChannel: identityFor returned pubkey=${creator.pubkey}, hasToken=${!!creator.token}`)

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

/** Publish a topic as a NIP-29 channel (kind:9007) plus its membership. */
export const publishTopic = internalAction({
  args: { topicId: v.id('topics') },
  handler: async (ctx, { topicId }) => {
    console.log(`[TRACE] publishTopic START topicId=${topicId}, relayUrl=${relayUrl() ?? 'UNSET'}`)
    if (!relayUrl()) { console.log(`[TRACE] publishTopic: NOSTR_RELAY_URL unset, aborting`); return }
    try {
      const channel = await ensureChannel(ctx, topicId)
      if (!channel) { console.log(`[TRACE] publishTopic: ensureChannel returned null, aborting`); return }
      console.log(`[TRACE] publishTopic: channel created, uuid=${channel.channelUuid}, creatorPubkey=${channel.creator.pubkey}`)
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
        const signed = await signAs(
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
      console.log(`[TRACE] publishTopic COMPLETE for topicId=${topicId}`)
    } catch (e) {
      console.warn(`[nostr] publishTopic(${topicId}) failed:`, e)
    }
  },
})

/**
 * Publish one message as kind:9.
 *
 * `authorOverride` carries the author's own Estiva ID token, supplied by the
 * authenticated browser. Scheduled work cannot obtain one — Convex does not
 * expose the caller's bearer token to background jobs — so without it this can
 * only publish for users whose key Peek custodies. Same split as
 * `ensureChannel`'s `creatorOverride`, for the same reason.
 *
 * Returns a reason rather than throwing: the row is already written, and a
 * relay problem must never look like a failed send.
 */
async function publishMessageWith(
  ctx: { runQuery: any; runMutation: any },
  messageId: Id<'messages'>,
  authorOverride?: Identity,
): Promise<{ ok: boolean; reason?: string }> {
  const m = await ctx.runQuery(internal.nostr.data.getMessageContext, { messageId })
  if (!m) return { ok: false, reason: 'not a topic message' } // DM, huddle, or deleted
  if (m.alreadyPublished) return { ok: true } // idempotent: never publish the same row twice

  // Checked before signing so old rows cost nothing and the reason is
  // legible, rather than surfacing as the relay's generic drift rejection.
  if (!withinDriftWindow(m.createdAt)) {
    console.warn(
      `[nostr] message ${messageId} skipped: createdAt is outside the relay's ±15min ` +
        `window, and rewriting it would falsify the shared record. Backfill needs a ` +
        `separate decision — see docs/buzz-compat/FRICTION.md.`,
    )
    return { ok: false, reason: 'outside the relay drift window' }
  }

  const author = authorOverride ?? (await identityFor(ctx, m.authorId))
  if (!author) {
    skipUnsigned(`message ${messageId}`, m.authorId)
    return { ok: false, reason: 'no signing identity for the author' }
  }

  // Happy path assumes the channel exists, to avoid a round trip per message.
  let channelUuid = m.channelUuid
  if (!channelUuid) {
    // Deliberately not created with the author's identity: the channel belongs
    // to the topic's creator, and publishing it as whoever spoke first would
    // make the wrong person its owner. When the creator is an Estiva ID user
    // this needs their token, which only `publishTopicAsCreator` has.
    const channel = await ensureChannel(ctx, m.topicId)
    if (!channel) return { ok: false, reason: 'the topic has no channel on the relay yet' }
    channelUuid = channel.channelUuid
  }

  const send = async () => {
    const signed = await signAs(
      buildMessage(author.pubkey, m.createdAt, {
        channelUuid: channelUuid!,
        content: m.body,
        about: referencedAddresses(m.body),
      }),
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
    return { ok: false, reason: res.reason }
  }
  if (res.eventId) {
    await ctx.runMutation(internal.nostr.data.markMessagePublished, {
      messageId,
      nostrEventId: res.eventId,
    })
  }
  return { ok: true }
}

/** Publish one message as kind:9, for users whose key Peek custodies. */
export const publishMessage = internalAction({
  args: { messageId: v.id('messages') },
  handler: async (ctx, { messageId }) => {
    if (!relayUrl()) return
    try {
      await publishMessageWith(ctx, messageId)
    } catch (e) {
      console.warn(`[nostr] publishMessage(${messageId}) failed:`, e)
    }
  },
})

/**
 * Publish a message using the author's own Estiva ID token.
 *
 * The browser calls this straight after `messages.send`, because that is the
 * only place the token exists. Verifying the caller *is* the author matters:
 * `/sign` would refuse to sign as anyone else anyway, but failing here says so
 * plainly instead of surfacing as a signature error.
 */
export const publishMessageAsAuthor = action({
  args: { messageId: v.id('messages'), estivaAccessToken: v.string() },
  handler: async (ctx, { messageId, estivaAccessToken }): Promise<{ ok: boolean; reason?: string }> => {
    if (!relayUrl()) return { ok: false, reason: 'NOSTR_RELAY_URL is unset' }

    const [m, viewerId] = await Promise.all([
      ctx.runQuery(internal.nostr.data.getMessageContext, { messageId }),
      ctx.runQuery(internal.users.viewerIdForAction, {}),
    ])
    if (!m) return { ok: false, reason: 'not a topic message' }
    if (!viewerId || viewerId !== m.authorId) {
      return { ok: false, reason: 'only the author may publish their message' }
    }

    const author = await identityForCreatorToken(ctx, m.authorId, estivaAccessToken)
    if (!author) return { ok: false, reason: 'author has no Estiva ID pubkey' }

    try {
      return await publishMessageWith(ctx, messageId, author)
    } catch (e) {
      console.warn(`[nostr] publishMessageAsAuthor(${messageId}) failed:`, e)
      return { ok: false, reason: e instanceof Error ? e.message : 'publish failed' }
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
      const signed = await signAs(
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
      const signed = await signAs(
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
      const signed = await signAs(
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
      const signed = await signAs(
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
