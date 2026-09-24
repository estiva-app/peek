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
 *
 * Only the DM channel events are left. The topic, message, reply, edit,
 * reaction and resolution builders went with the Convex topics (FOL-23): every
 * one of those is built and published by the browser now.
 */
import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import { buildDmHide, buildDmOpen } from '@estiva-app/protocol'
import { viewerId } from '../users'
import { findDmForPair, resolveUserKey } from '../messages'
import type { UnsignedEvent } from '@estiva-app/protocol'

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
 *
 * ## `reopen` is the unhide (DMS-6)
 *
 * There is no unhide command on the relay. `open_dm` clears the caller's own
 * `hidden_at` when the DM already exists (`buzz-db/src/dm.rs`) and republishes
 * their `kind:30622` snapshot on that path, so publishing the same `41010`
 * again is how a hidden DM comes back. `reopen` asks for the event even when
 * the row already has a channel — the one case the plain call refuses, because
 * for the plain call "already has a channel" means there is nothing to learn.
 * The answer names the same uuid and `recordDmChannel` has nothing to write.
 */
export const unsignedDmOpen = query({
  args: { dmKey: v.string(), reopen: v.optional(v.boolean()) },
  handler: async (
    ctx,
    { dmKey, reopen },
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
    if (dm.channelUuid && !reopen) return { ok: false, reason: 'already has a channel', expected: true }

    return {
      ok: true,
      dmId: dm._id,
      unsigned: buildDmOpen(you.nostrPubkey, Date.now(), { otherPubkeys: [partner.nostrPubkey] }),
    }
  },
})

/**
 * Everything needed to hide a DM from the viewer's own sidebar (DMS-6).
 *
 * A `kind:41012` naming the DM's channel. The relay sets the caller's own
 * `hidden_at` and nothing else — the conversation, its participants and its
 * history all survive, the partner is not told — and then republishes the
 * caller's `kind:30622` snapshot, which is what the sidebar reads. Nothing is
 * written here: Convex holds no hidden flag, because the relay owns that state
 * and the newest snapshot is the whole of it (`fetchHiddenDms`).
 *
 * A DM with no channel cannot be hidden, and the refusal is expected: the
 * channel is opened on the DM's first render (`useEnsureDmChannel`), so this is
 * a wait rather than a dead end, and the UI offers the action only once
 * `dmChannels` lists the row.
 */
export const unsignedDmHide = query({
  args: { dmKey: v.string() },
  handler: async (
    ctx,
    { dmKey },
  ): Promise<
    | { ok: true; unsigned: UnsignedEvent; channelUuid: string }
    | { ok: false; reason: string; expected?: boolean }
  > => {
    const me = await viewerId(ctx)
    if (!me) return { ok: false, reason: 'not signed in', expected: true }
    const you = await ctx.db.get(me)
    if (!you?.nostrPubkey) return { ok: false, reason: 'no Estiva ID pubkey to sign with', expected: true }

    const partner = await resolveUserKey(ctx, dmKey)
    if (!partner) return { ok: false, reason: `unknown person '${dmKey}'` }
    if (partner._id === me) return { ok: false, reason: 'a DM needs somebody else', expected: true }

    const dm = await findDmForPair(ctx, me, partner._id)
    if (!dm) return { ok: false, reason: 'no conversation with that person yet', expected: true }
    if (!dm.channelUuid) return { ok: false, reason: 'the DM has no channel on the relay yet', expected: true }

    return {
      ok: true,
      channelUuid: dm.channelUuid,
      unsigned: buildDmHide(you.nostrPubkey, Date.now(), { channelUuid: dm.channelUuid }),
    }
  },
})

/**
 * The viewer's DMs that have a channel on the relay, as `dmKey → channelUuid`.
 *
 * The relay's hidden set (`kind:30622`) names channels; the app names DMs by
 * the partner's person key (§2.4). This is the join, and it is the only thing
 * Convex contributes to the hidden set — which row a uuid is — not whether it
 * is hidden. A DM without a channel is left out because nothing on the relay
 * can name it, so it can be neither hidden nor listed there.
 */
export const dmChannels = query({
  args: {},
  handler: async (ctx): Promise<{ dmKey: string; channelUuid: string }[]> => {
    const me = await viewerId(ctx)
    if (!me) return []
    const [asLow, asHigh] = await Promise.all([
      ctx.db.query('dmConversations').withIndex('by_low', (q) => q.eq('userLowId', me)).collect(),
      ctx.db.query('dmConversations').withIndex('by_high', (q) => q.eq('userHighId', me)).collect(),
    ])
    const out: { dmKey: string; channelUuid: string }[] = []
    for (const dm of [...asLow, ...asHigh]) {
      if (!dm.channelUuid) continue
      const partner = await ctx.db.get(dm.userLowId === me ? dm.userHighId : dm.userLowId)
      if (!partner) continue
      out.push({ dmKey: partner.seedKey ?? (partner._id as string), channelUuid: dm.channelUuid })
    }
    return out
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
