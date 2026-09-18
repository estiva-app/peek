/**
 * Unsigned events out, event ids back in (PEEK-106).
 *
 * The half of publishing that Convex keeps once signing moves to the browser.
 * Splitting it this way is not a stylistic choice: the browser holds the only
 * Estiva ID token, and Convex holds the only copy of the rows an event is built
 * from. Neither can do the job alone, so the boundary runs between shaping the
 * event and signing it:
 *
 *   1. **here** — build the *unsigned* event from Peek's rows. No credential is
 *      needed to shape one, so no credential is passed
 *   2. the browser — sign via `/sign` and POST to the bridge
 *   3. **here** — record the event id, which is a fact rather than a secret
 *
 * Default runtime on purpose. `publish.ts` is `"use node"` and may therefore
 * only export actions, which is what forced every publish to *be* an action —
 * and an action is exactly what cannot receive a token without it appearing in
 * Convex's dashboard logs. Queries and mutations have no such problem.
 *
 * Authorship is checked here as well as at `/sign`. `/sign` would refuse to
 * sign as anyone but the token's subject anyway, but a refusal here says so
 * plainly instead of surfacing later as a signature mismatch.
 */
import { v } from 'convex/values'
import { mutation, query, type QueryCtx } from '../_generated/server'
import type { Doc } from '../_generated/dataModel'
import { buildDmOpen, buildEdit, buildMessage, buildReaction, buildResolution, imetaTag } from '@estiva-app/protocol'
import type { NostrTag } from '@estiva-app/protocol'
import { mentionedPubkeys, referencedAddresses, withinDriftWindow } from './refs'
import { viewerId } from '../users'
import { findDmForPair, resolveUserKey } from '../messages'
import type { UnsignedEvent } from '@estiva-app/protocol'

/**
 * Why a message cannot be published, or the event that would publish it.
 *
 * A discriminated result rather than `null`, because every reason here is one
 * a caller may legitimately hit and none of them is an error: an already-published
 * row, a DM, a message older than the relay's window. Returning `null` for all
 * of them is what turns "nothing happened" into something nobody can debug.
 */
export type UnsignedMessage =
  | { ok: true; unsigned: UnsignedEvent; alreadyPublished?: undefined }
  /**
   * `expected: true` means **this was never going to travel, and that is
   * fine** — a huddle, a row that never reached the relay. A caller telling
   * somebody about one of those would be crying wolf.
   *
   * A DM used to be on that list and no longer is (DMS-4): a DM message is an
   * ordinary `kind:9` against the DM's channel, so a refusal to publish one is
   * a refusal worth hearing.
   *
   * Everything else is a refusal worth saying out loud. The flag is here
   * rather than at the caller because only this file knows which reasons are
   * ordinary, and string-matching them from outside would rot the first time
   * one is reworded (PEE-24).
   */
  | { ok: false; reason: string; expected?: boolean }

/**
 * The `imeta` tags for a row's attachments — CON-12.
 *
 * **Only files that reached the relay.** A row whose blob upload failed carries
 * no `sha256`, and naming it here would produce an `imeta` pointing at nothing
 * — which `verify_imeta_blobs` refuses, taking the whole message down with it.
 * So a file that did not travel costs its own visibility elsewhere and nothing
 * more; the message still publishes.
 *
 * `m` must equal the MIME the relay stored, not the one the browser guessed, so
 * this uses what the upload descriptor returned rather than `contentType`.
 */
function imetaTagsFor(files: Doc<'messages'>['fileAttachments']): NostrTag[] {
  const out: NostrTag[] = []
  for (const f of files ?? []) {
    if (!f.sha256 || !f.mediaUrl) continue
    out.push(
      imetaTag({
        url: f.mediaUrl,
        m: f.contentType,
        x: f.sha256,
        size: f.size,
        dim: f.dim,
        thumb: f.thumbUrl,
        filename: f.name,
      }),
    )
  }
  return out
}

/**
 * The relay channel a message hangs off, or why it has none — DMS-4.
 *
 * Both parents that publish resolve from here, because a `kind:9` is the same
 * event either way: only the container differs. A topic's channel is minted by
 * its creator (`channelPlan`) and a DM's by the relay when the conversation is
 * opened (`unsignedDmOpen`, DMS-3) — neither is derivable from the row, so both
 * are a lookup and both can legitimately be missing for a moment.
 *
 * A huddle is the one parent that never travels: there is no Buzz container for
 * one, so `expected` says so rather than leaving a caller to warn about it.
 */
type ParentChannel = { ok: true; channelUuid: string } | { ok: false; reason: string; expected?: boolean }

async function parentChannel(ctx: QueryCtx, parentKind: string, parentId: string): Promise<ParentChannel> {
  if (parentKind === 'topic') {
    const topicId = ctx.db.normalizeId('topics', parentId)
    const topic = topicId ? await ctx.db.get(topicId) : null
    if (!topic) return { ok: false, reason: 'unknown topic' }
    // The happy path assumes the channel exists. It is created by
    // `publishTopicAsCreator` when the topic is made, and deliberately by the
    // topic's *creator* — publishing it as whoever spoke first would make the
    // wrong person its owner.
    if (!topic.channelUuid) return { ok: false, reason: 'the topic has no channel on the relay yet' }
    return { ok: true, channelUuid: topic.channelUuid }
  }
  if (parentKind === 'dm') {
    const dmId = ctx.db.normalizeId('dmConversations', parentId)
    const dm = dmId ? await ctx.db.get(dmId) : null
    if (!dm) return { ok: false, reason: 'unknown conversation' }
    // Refused rather than published `h`-less: an event with no channel is not a
    // private message with a missing tag, it is a message on nothing — visible
    // to whoever asks the relay for it. The conversation is opened on the DM's
    // first render and on its first message (`useEnsureDmChannel`), so this is
    // a wait, not a dead end.
    if (!dm.channelUuid) return { ok: false, reason: 'the DM has no channel on the relay yet' }
    return { ok: true, channelUuid: dm.channelUuid }
  }
  return { ok: false, reason: 'a huddle has no channel on the relay', expected: true }
}

export const unsignedMessage = query({
  args: { messageId: v.id('messages') },
  handler: async (ctx, { messageId }): Promise<UnsignedMessage> => {
    const m = await ctx.db.get(messageId)
    if (!m) return { ok: false, reason: 'unknown message' }
    // Idempotent — never publish the same row twice.
    if (m.nostrEventId) return { ok: false, reason: 'already published' }

    const me = await viewerId(ctx)
    if (!me || me !== m.authorId) return { ok: false, reason: 'only the author may publish their message' }

    // Checked before signing so an old row costs nothing and the reason is
    // legible, rather than arriving as the relay's generic drift rejection.
    if (!withinDriftWindow(m.createdAt)) {
      return { ok: false, reason: 'outside the relay drift window' }
    }

    const channel = await parentChannel(ctx, m.parentKind, m.parentId)
    if (!channel.ok) return channel

    const author = await ctx.db.get(m.authorId)
    if (!author?.nostrPubkey) return { ok: false, reason: 'author has no Estiva ID pubkey' }

    return {
      ok: true,
      unsigned: buildMessage(author.nostrPubkey, m.createdAt, {
        channelUuid: channel.channelUuid,
        content: m.body,
        about: referencedAddresses(m.body),
        mentions: mentionedPubkeys(m.body),
        mediaTags: imetaTagsFor(m.fileAttachments),
      }),
    }
  },
})

/**
 * A reply is a kind:9 with NIP-10 thread tags.
 *
 * Peek's replies are always **direct** replies — no nesting — so root and
 * parent are the same event, and `threadTags` emits the single
 * `["e", id, "", "reply"]` form Buzz uses rather than a root/reply pair.
 *
 * Refused when the parent has not been published: Buzz rejects a reply to an
 * event it does not know, and there is no id to point at.
 */
export const unsignedReply = query({
  args: { replyId: v.id('replies') },
  handler: async (ctx, { replyId }): Promise<UnsignedMessage> => {
    const r = await ctx.db.get(replyId)
    if (!r) return { ok: false, reason: 'unknown reply' }
    if (r.nostrEventId) return { ok: false, reason: 'already published' }

    const me = await viewerId(ctx)
    if (!me || me !== r.authorId) return { ok: false, reason: 'only the author may publish their reply' }
    if (!withinDriftWindow(r.createdAt)) return { ok: false, reason: 'outside the relay drift window' }

    const parent = await ctx.db.get(r.messageId)
    if (!parent) return { ok: false, reason: 'unknown message' }
    if (!parent.nostrEventId) {
      return { ok: false, reason: 'the message being replied to is not on the relay yet' }
    }
    const channel = await parentChannel(ctx, parent.parentKind, parent.parentId)
    if (!channel.ok) return channel

    const author = await ctx.db.get(r.authorId)
    if (!author?.nostrPubkey) return { ok: false, reason: 'author has no Estiva ID pubkey' }

    return {
      ok: true,
      unsigned: buildMessage(author.nostrPubkey, r.createdAt, {
        channelUuid: channel.channelUuid,
        content: r.body,
        threadRef: { rootId: parent.nostrEventId, parentId: parent.nostrEventId },
        mentions: mentionedPubkeys(r.body),
        // A reply carries files too, and CON-12 named `unsignedReply` as having
        // the identical gap. Fixing one and not the other would leave the same
        // defect on half the surface.
        mediaTags: imetaTagsFor(r.fileAttachments),
      }),
    }
  },
})

/**
 * An edit of a message or a reply, as a `kind:40003` — CON-8, RFC 0.4 §7.2.1.
 *
 * ## Why Peek needed this at all
 *
 * `editBody` patched Convex and published nothing, so a human edit never left
 * Peek and every other reader kept the original text indefinitely, with nothing
 * announcing the divergence. By ADR 0001's own rule that is a conformance
 * defect rather than a missing feature: *"Convex may never be the source of
 * truth for something the relay owns"*, and `messages.body` was exactly that
 * for the body of a `kind:9`.
 *
 * ## An edit is a new event
 *
 * `kind:9` and `kind:1111` are non-replaceable, so nothing is mutated: the
 * original keeps its event id, replies pointing at it survive, and a reader
 * folds the pair. `buildEdit` is the shared builder, so Ship and Peek cannot
 * drift into two shapes.
 *
 * ## Unlike every other builder here, this does NOT gate on the author
 *
 * `unsignedMessage` and `unsignedReply` refuse for anyone but the author,
 * correctly — you cannot publish somebody else's message *as* them. An edit is
 * different: the relay accepts one from the target's effective author **or**
 * the NIP-OA owner of an authoring agent, and re-checks channel membership on
 * the author path. No client can evaluate the second half, so refusing here
 * would hide the control from the one other party the relay would accept.
 *
 * The event is signed by the **viewer**, naming the target — which is exactly
 * what `validate_edit_ownership` expects to adjudicate.
 */
export const unsignedEdit = query({
  args: { key: v.string(), body: v.string() },
  handler: async (ctx, { key, body }): Promise<UnsignedMessage> => {
    const me = await viewerId(ctx)
    if (!me) return { ok: false, reason: 'not signed in' }
    const you = await ctx.db.get(me)
    if (!you?.nostrPubkey) return { ok: false, reason: 'no Estiva ID pubkey to sign with' }

    const target = await editTarget(ctx, key)
    if (!target) return { ok: false, reason: 'unknown message' }
    if (!target.nostrEventId) {
      // Nothing on the relay to edit, and nothing wrong: the message is
      // Peek-only (a huddle, or one that never published), so the Convex patch
      // is the whole of its record and no reader is left with stale text.
      return { ok: false, reason: 'the message being edited is not on the relay', expected: true }
    }
    if (!target.channelUuid) {
      return { ok: false, reason: 'its channel is not on the relay yet', expected: true }
    }

    return {
      ok: true,
      unsigned: buildEdit(you.nostrPubkey, Date.now(), {
        channelUuid: target.channelUuid,
        targetEventId: target.nostrEventId,
        body,
      }),
    }
  },
})

/**
 * The event id and channel of whatever `key` names — a message or a reply.
 *
 * The seam's edit is id-keyed across both tables (`editBody` resolves it the
 * same way), and an edit needs the channel because 40003 is in the relay's
 * `requires_h_channel_scope` — unlike a reaction or a deletion, where the
 * channel is derived from the target.
 */
async function editTarget(
  ctx: QueryCtx,
  key: string,
): Promise<{ nostrEventId?: string; channelUuid?: string } | null> {
  const channelOf = async (parentKind: string, parentId: string) => {
    const channel = await parentChannel(ctx, parentKind, parentId)
    return channel.ok ? channel.channelUuid : undefined
  }

  const bySeed = await ctx.db
    .query('messages')
    .withIndex('by_seedKey', (q) => q.eq('seedKey', key))
    .unique()
  const messageId = bySeed ? null : ctx.db.normalizeId('messages', key)
  const m = bySeed ?? (messageId ? await ctx.db.get(messageId) : null)
  if (m) return { nostrEventId: m.nostrEventId, channelUuid: await channelOf(m.parentKind, m.parentId) }

  const replyBySeed = await ctx.db
    .query('replies')
    .withIndex('by_seedKey', (q) => q.eq('seedKey', key))
    .unique()
  const replyId = replyBySeed ? null : ctx.db.normalizeId('replies', key)
  const r = replyBySeed ?? (replyId ? await ctx.db.get(replyId) : null)
  if (!r) return null
  const parent = await ctx.db.get(r.messageId)
  if (!parent) return null
  return { nostrEventId: r.nostrEventId, channelUuid: await channelOf(parent.parentKind, parent.parentId) }
}

export const recordReplyPublished = mutation({
  args: { replyId: v.id('replies'), nostrEventId: v.string() },
  handler: async (ctx, { replyId, nostrEventId }) => {
    const r = await ctx.db.get(replyId)
    if (!r) return
    const me = await viewerId(ctx)
    if (!me || me !== r.authorId) return
    await ctx.db.patch(replyId, { nostrEventId })
  },
})

/**
 * A reaction is a kind:7 pointing at the message's event.
 *
 * No drift check: unlike a message, a reaction is created now and carries the
 * current time, so it cannot fall outside the relay's window.
 */
export const unsignedReaction = query({
  args: { reactionId: v.id('reactions') },
  handler: async (ctx, { reactionId }): Promise<UnsignedMessage> => {
    const r = await ctx.db.get(reactionId)
    if (!r) return { ok: false, reason: 'unknown reaction' }
    if (r.nostrEventId) return { ok: false, reason: 'already published' }

    const me = await viewerId(ctx)
    if (!me || me !== r.userId) return { ok: false, reason: 'only the reactor may publish their reaction' }

    // A reply reaction points at the reply's own event (PEE-12).
    const target = r.replyId ? await ctx.db.get(r.replyId) : await ctx.db.get(r.messageId)
    if (!target?.nostrEventId) return { ok: false, reason: 'the message reacted to is not on the relay yet' }

    const reactor = await ctx.db.get(r.userId)
    if (!reactor?.nostrPubkey) return { ok: false, reason: 'reactor has no Estiva ID pubkey' }

    return {
      ok: true,
      unsigned: buildReaction(reactor.nostrPubkey, r.createdAt, {
        targetEventId: target.nostrEventId,
        emoji: r.emoji,
      }),
    }
  },
})

export const recordReactionPublished = mutation({
  args: { reactionId: v.id('reactions'), nostrEventId: v.string() },
  handler: async (ctx, { reactionId, nostrEventId }) => {
    // The row may already be gone — un-reacting deletes it and the publish is
    // async, so patching a deleted id would throw.
    const r = await ctx.db.get(reactionId)
    if (!r) return
    const me = await viewerId(ctx)
    if (!me || me !== r.userId) return
    await ctx.db.patch(reactionId, { nostrEventId })
  },
})

/**
 * Record that the relay accepted this message.
 *
 * Viewer-gated even though an event id is not a secret: without the check any
 * signed-in user could stamp an arbitrary id onto someone else's row, and every
 * later deletion and reply would then point at the wrong event.
 */
export const recordMessagePublished = mutation({
  args: { messageId: v.id('messages'), nostrEventId: v.string() },
  handler: async (ctx, { messageId, nostrEventId }) => {
    const m = await ctx.db.get(messageId)
    if (!m) return
    const me = await viewerId(ctx)
    if (!me || me !== m.authorId) return
    await ctx.db.patch(messageId, { nostrEventId, nostrPublishedAt: Date.now() })
  },
})

/**
 * A resolution assertion is a kind:9101 pointing at the message's event
 * (PEEK-128).
 *
 * No drift check: an assertion is made now and carries the current time, so
 * unlike a message it cannot fall outside the relay's window.
 *
 * The target message must already be on the relay. Asserting about an event
 * nobody can resolve would put a dangling claim on the channel, which is worse
 * than waiting — the message publishes first, and a resolution of an
 * unpublished message simply stays local.
 *
 * ## A DM's resolution travels too (DMS-11)
 *
 * This was the last builder still reading `parentKind !== 'topic'`, left that
 * way by DMS-4 because whether a DM message is *resolvable to other apps* is a
 * product question rather than a mechanical widening. It was answered by
 * measuring what already happens: a topic's resolution has been a `kind:9101`
 * on the relay since PEEK-128, so a DM's staying in Convex was an inconsistency
 * rather than a decision. Both now resolve their channel the same way, and the
 * assertion is readable by exactly the people who can read the message it is
 * about — a DM channel is private, so its `9101` is too.
 *
 * Huddles are still refused, by `parentChannel` and for its reason: there is no
 * Buzz container to put one in.
 */
export const unsignedResolution = query({
  args: { assertionId: v.id('resolutionAssertions') },
  handler: async (ctx, { assertionId }): Promise<UnsignedMessage> => {
    const a = await ctx.db.get(assertionId)
    if (!a) return { ok: false, reason: 'unknown assertion' }
    if (a.nostrEventId) return { ok: false, reason: 'already published' }

    const me = await viewerId(ctx)
    if (!me || me !== a.authorId) {
      return { ok: false, reason: 'only the asserter may publish their resolution' }
    }

    const target = await ctx.db.get(a.messageId)
    if (!target) return { ok: false, reason: 'unknown message' }
    if (!target.nostrEventId) {
      return { ok: false, reason: 'the message being resolved is not on the relay yet' }
    }

    const channel = await parentChannel(ctx, target.parentKind, target.parentId)
    if (!channel.ok) return channel

    const author = await ctx.db.get(a.authorId)
    if (!author?.nostrPubkey) return { ok: false, reason: 'asserter has no Estiva ID pubkey' }

    // Only carried when the supporting reply itself reached the relay; a local
    // reply id means nothing to another app.
    const supporting = a.supportingReplyId ? await ctx.db.get(a.supportingReplyId) : null

    return {
      ok: true,
      unsigned: buildResolution(author.nostrPubkey, a.createdAt, {
        channelUuid: channel.channelUuid,
        targetEventId: target.nostrEventId,
        action: a.action,
        supportingEventId: supporting?.nostrEventId ?? undefined,
        rationale: a.rationale,
      }),
    }
  },
})

export const recordResolutionPublished = mutation({
  args: { assertionId: v.id('resolutionAssertions'), nostrEventId: v.string() },
  handler: async (ctx, { assertionId, nostrEventId }) => {
    const a = await ctx.db.get(assertionId)
    if (!a) return
    const me = await viewerId(ctx)
    if (!me || me !== a.authorId) return
    await ctx.db.patch(assertionId, { nostrEventId })
  },
})

/**
 * Everything needed to establish a topic's channel on the relay.
 *
 * The UUID is **minted here rather than in the browser** so it comes from one
 * place, but it is deliberately not persisted yet: `recordChannel` writes it
 * only once the relay has accepted the create event, so no consumer — Ship,
 * `folderForTopic` — can ever see a Folder id the relay does not know.
 *
 * Members come back as pubkeys because that is all the add-member events need,
 * and the creator is filtered out: they own the channel already.
 */
export const channelPlan = query({
  args: { topicId: v.id('topics') },
  handler: async (
    ctx,
    { topicId },
  ): Promise<
    | { ok: true; channelUuid: string; title: string; alreadyPublished: boolean; memberPubkeys: string[] }
    | { ok: false; reason: string }
  > => {
    const topic = await ctx.db.get(topicId)
    if (!topic) return { ok: false, reason: `unknown topic ${topicId}` }

    const me = await viewerId(ctx)
    if (!me || me !== topic.creatorId) {
      // The channel belongs to the topic's creator. Letting anyone else create
      // it would make the wrong person its owner on the relay, permanently.
      return { ok: false, reason: 'only the topic creator may publish its channel' }
    }
    const creator = await ctx.db.get(topic.creatorId)
    if (!creator?.nostrPubkey) return { ok: false, reason: 'creator has no Estiva ID pubkey' }

    const rows = await ctx.db
      .query('topicMembers')
      .withIndex('by_topic', (q) => q.eq('topicId', topicId))
      .collect()
    const memberPubkeys: string[] = []
    for (const r of rows) {
      const u = await ctx.db.get(r.userId)
      if (u?.nostrPubkey && u.nostrPubkey !== creator.nostrPubkey) memberPubkeys.push(u.nostrPubkey)
    }

    return {
      ok: true,
      channelUuid: topic.channelUuid ?? crypto.randomUUID(),
      title: topic.title,
      alreadyPublished: Boolean(topic.channelUuid),
      memberPubkeys,
    }
  },
})

/** First write wins, so a racing second create cannot repoint an existing topic. */
export const recordChannel = mutation({
  args: { topicId: v.id('topics'), channelUuid: v.string() },
  handler: async (ctx, { topicId, channelUuid }) => {
    const topic = await ctx.db.get(topicId)
    if (!topic || topic.channelUuid) return
    const me = await viewerId(ctx)
    if (!me || me !== topic.creatorId) return
    await ctx.db.patch(topicId, { channelUuid })
  },
})

/**
 * Everything needed to open a DM's channel on the relay (DMS-3).
 *
 * ## Why this is shaped unlike `channelPlan`
 *
 * A topic's channel uuid is minted here and the browser is told what to create.
 * A DM's cannot be: the relay mints it and keys it by a hash of the participant
 * set, so there is exactly one channel for a given pair of people and no client
 * gets to choose — or compute — its id. The only way to learn it is to publish the
 * `41010` and read what comes back, which is why this query hands over an event
 * and `recordDmChannel` takes the answer.
 *
 * That same derivation is what makes this safe to call on every open. Opening
 * is idempotent at the relay — the same participants always name the same
 * channel — so there is no "does a DM already exist" question to ask first, and
 * `find_dm_by_participants` is the relay asking itself the same one.
 *
 * ## It does not create the conversation
 *
 * `ok: false` with `expected` when the pair has no row yet. Peek creates one on
 * the first message (`messages.send`) or on starring somebody, and making a
 * *viewing* a DM mint one would put empty conversations into Desk's listings
 * for anyone who clicked a name. The caller is reactive, so the row appearing
 * is what triggers the publish.
 *
 * `dmKey` is the partner's person key — the DM's stable id everywhere in the
 * app (§2.4), never a `dmConversations` id.
 */
export const unsignedDmOpen = query({
  args: { dmKey: v.string() },
  handler: async (
    ctx,
    { dmKey },
  ): Promise<
    | { ok: true; unsigned: UnsignedEvent; dmId: string }
    | { ok: false; reason: string; expected?: boolean }
  > => {
    const me = await viewerId(ctx)
    if (!me) return { ok: false, reason: 'not signed in', expected: true }
    const you = await ctx.db.get(me)
    if (!you?.nostrPubkey) return { ok: false, reason: 'no Estiva ID pubkey to sign with', expected: true }

    const partner = await resolveUserKey(ctx, dmKey)
    if (!partner) return { ok: false, reason: `unknown person '${dmKey}'` }
    if (partner._id === me) return { ok: false, reason: 'a DM needs somebody else', expected: true }
    // A seeded demo person has no Estiva ID, so there is nobody to open a
    // channel *with*. Expected: the app is usable against the mock fixture.
    if (!partner.nostrPubkey) return { ok: false, reason: 'that person has no Estiva ID pubkey', expected: true }

    const dm = await findDmForPair(ctx, me, partner._id)
    if (!dm) return { ok: false, reason: 'no conversation with that person yet', expected: true }
    if (dm.channelUuid) return { ok: false, reason: 'already has a channel', expected: true }

    return {
      ok: true,
      dmId: dm._id,
      unsigned: buildDmOpen(you.nostrPubkey, Date.now(), { otherPubkeys: [partner.nostrPubkey] }),
    }
  },
})

/**
 * Record the uuid the relay answered with. First write wins (DMS-3).
 *
 * The same rule as `storeChannelUuid` and for a sharper reason: two tabs open
 * the same DM, both publish, and both are told the same uuid — the relay's
 * derivation guarantees it. So the loser of the race is not wrong and must not
 * be treated as an error; it simply has nothing left to write.
 *
 * Only a participant may write it, which is not ceremony: `dmKey` is a person
 * key and a mistaken one would otherwise let somebody staple a channel to a
 * conversation they are not in.
 */
export const recordDmChannel = mutation({
  args: { dmId: v.id('dmConversations'), channelUuid: v.string() },
  handler: async (ctx, { dmId, channelUuid }) => {
    const dm = await ctx.db.get(dmId)
    if (!dm || dm.channelUuid) return
    const me = await viewerId(ctx)
    if (!me || (me !== dm.userLowId && me !== dm.userHighId)) return
    await ctx.db.patch(dmId, { channelUuid })
  },
})
