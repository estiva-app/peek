/**
 * Merge the duplicate identities the pubkey-overwrite bug left behind.
 *
 * Before PR #8, `identityFor` minted a fresh keypair *over* a user's real
 * pubkey. `viewerId` resolves people by `by_nostrPubkey`, so the moment that
 * happened the person stopped matching their own row: the next sign-in found
 * nothing, `adoptIdentity` inserted a second row, the next publish minted over
 * that one too, and round it went. Production ended up with four rows carrying
 * one person's display name and four pubkeys that are nobody's.
 *
 * The rows are not junk — they authored real messages while they were the
 * viewer. So this **merges** rather than deletes: content moves to the row the
 * person actually signs in as, then the empty husk goes.
 *
 * ## What is deliberately not fixed
 *
 * Those messages were published to the relay signed by the *minted* key, so
 * their `nostrEventId` points at an event the relay attributes to a pubkey
 * nobody holds. Reassigning `authorId` makes Peek agree with itself; it cannot
 * make the relay agree, and rewriting history there is neither possible nor
 * desirable. Peek shows them as yours, the relay shows them as an orphan key,
 * and that divergence is the permanent cost of the original bug.
 *
 * Delete this file once it has been run.
 */
import { v } from 'convex/values'
import { internalMutation, internalQuery } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'

/** Rows holding a minted key: a pubkey Peek custodies that nobody signs in as. */
async function orphans(ctx: { db: any }): Promise<Doc<'users'>[]> {
  const rows: Doc<'users'>[] = await ctx.db.query('users').collect()
  return rows.filter((u) => u.nostrSecretKey)
}

/**
 * What each orphan owns, so a merge is a decision rather than a leap.
 *
 * Counts every table that references `users`, because missing one leaves a
 * dangling id that no query will complain about until something reads it.
 */
export const report = internalQuery({
  args: {},
  handler: async (ctx) => {
    const [users, topics, topicMembers, dms, messages, replies, reactions, huddles, huddleMembers, readState, stars, screener, deskWork] =
      await Promise.all([
        ctx.db.query('users').collect(),
        ctx.db.query('topics').collect(),
        ctx.db.query('topicMembers').collect(),
        ctx.db.query('dmConversations').collect(),
        ctx.db.query('messages').collect(),
        ctx.db.query('replies').collect(),
        ctx.db.query('reactions').collect(),
        ctx.db.query('huddles').collect(),
        ctx.db.query('huddleMembers').collect(),
        ctx.db.query('readState').collect(),
        ctx.db.query('stars').collect(),
        ctx.db.query('screenerItems').collect(),
        ctx.db.query('deskOpenWork').collect(),
      ])

    const held = users.filter((u) => u.nostrSecretKey)
    const signInRows = users
      .filter((u) => u.nostrPubkey && !u.nostrSecretKey)
      .map((u) => ({ userId: u._id, name: u.name, nostrPubkey: u.nostrPubkey, isExternal: u.isExternal ?? false }))

    return {
      // The rows a person could actually sign in as — the merge targets.
      signInCandidates: signInRows,
      orphans: held.map((u) => {
        const id = u._id
        return {
          userId: id,
          name: u.name,
          nostrPubkey: u.nostrPubkey,
          owns: {
            topicsCreated: topics.filter((t) => t.creatorId === id).length,
            topicMemberships: topicMembers.filter((m) => m.userId === id).length,
            dmConversations: dms.filter((d) => d.userLowId === id || d.userHighId === id).length,
            messagesAuthored: messages.filter((m) => m.authorId === id).length,
            messagesResolved: messages.filter((m) => m.resolvedById === id).length,
            repliesAuthored: replies.filter((r) => r.authorId === id).length,
            reactions: reactions.filter((r) => r.userId === id).length,
            huddlesCreated: huddles.filter((h) => h.createdById === id).length,
            huddleMemberships: huddleMembers.filter((h) => h.userId === id).length,
            readState: readState.filter((r) => r.userId === id).length,
            stars: stars.filter((s) => s.userId === id).length,
            screenerItems: screener.filter((s) => s.userId === id).length,
            deskOpenWork: deskWork.filter((d) => d.userId === id).length,
          },
        }
      }),
    }
  },
})

/**
 * Move every orphan's content onto `intoUserId`, then delete the orphan row.
 *
 * Dry run by default. Deletions are unrecoverable and there is no export step
 * here, so the default has to be the safe one.
 */
export const merge = internalMutation({
  args: {
    /** The row the person actually signs in as — their real pubkey, no secret. */
    intoUserId: v.id('users'),
    commit: v.optional(v.boolean()),
  },
  handler: async (ctx, { intoUserId, commit }) => {
    const target = await ctx.db.get(intoUserId)
    if (!target) throw new Error(`unknown target user ${intoUserId}`)
    if (target.nostrSecretKey) {
      // Merging into a row that is itself an orphan would just move the problem.
      throw new Error(`target ${intoUserId} holds a custodied key — pick the row with no secret`)
    }

    const toMerge = (await orphans(ctx)).filter((u) => u._id !== intoUserId)
    const moved: Record<string, number> = {}
    const skipped: Record<string, number> = {}
    const bump = (bag: Record<string, number>, key: string) => {
      bag[key] = (bag[key] ?? 0) + 1
    }

    for (const orphan of toMerge) {
      const from = orphan._id

      // Straight reassignments: nothing enforces uniqueness on these.
      for (const t of await ctx.db.query('topics').collect()) {
        if (t.creatorId !== from) continue
        if (commit) await ctx.db.patch(t._id, { creatorId: intoUserId })
        bump(moved, 'topics.creatorId')
      }
      for (const m of await ctx.db.query('messages').collect()) {
        if (m.authorId === from) {
          if (commit) await ctx.db.patch(m._id, { authorId: intoUserId })
          bump(moved, 'messages.authorId')
        }
        if (m.resolvedById === from) {
          if (commit) await ctx.db.patch(m._id, { resolvedById: intoUserId })
          bump(moved, 'messages.resolvedById')
        }
      }
      for (const r of await ctx.db.query('replies').collect()) {
        if (r.authorId !== from) continue
        if (commit) await ctx.db.patch(r._id, { authorId: intoUserId })
        bump(moved, 'replies.authorId')
      }
      for (const h of await ctx.db.query('huddles').collect()) {
        if (h.createdById !== from) continue
        if (commit) await ctx.db.patch(h._id, { createdById: intoUserId })
        bump(moved, 'huddles.createdById')
      }

      // Reassignments that can collide, because the target may already have a
      // row for the same pair. A duplicate here is not harmless: it double-counts
      // members and can make one person react to a message twice.
      const dedupe = async <T extends { _id: Id<any> }>(
        rows: T[],
        isFrom: (row: T) => boolean,
        conflicts: (row: T, existing: T) => boolean,
        patch: (row: T) => Promise<void>,
        label: string,
      ) => {
        const mine = rows.filter(isFrom)
        for (const row of mine) {
          const clash = rows.find((other) => other._id !== row._id && conflicts(row, other))
          if (clash) {
            if (commit) await ctx.db.delete(row._id)
            bump(skipped, `${label} (duplicate, dropped)`)
            continue
          }
          if (commit) await patch(row)
          bump(moved, label)
        }
      }

      const members = await ctx.db.query('topicMembers').collect()
      await dedupe(
        members,
        (m) => m.userId === from,
        (m, o) => o.topicId === m.topicId && o.userId === intoUserId,
        async (m) => ctx.db.patch(m._id, { userId: intoUserId }),
        'topicMembers.userId',
      )

      const hMembers = await ctx.db.query('huddleMembers').collect()
      await dedupe(
        hMembers,
        (m) => m.userId === from,
        (m, o) => o.huddleId === m.huddleId && o.userId === intoUserId,
        async (m) => ctx.db.patch(m._id, { userId: intoUserId }),
        'huddleMembers.userId',
      )

      const rs = await ctx.db.query('readState').collect()
      await dedupe(
        rs,
        (r) => r.userId === from,
        (r, o) => o.containerId === r.containerId && o.userId === intoUserId,
        async (r) => ctx.db.patch(r._id, { userId: intoUserId }),
        'readState.userId',
      )

      const rx = await ctx.db.query('reactions').collect()
      await dedupe(
        rx,
        (r) => r.userId === from,
        (r, o) => o.messageId === r.messageId && o.emoji === r.emoji && o.userId === intoUserId,
        async (r) => ctx.db.patch(r._id, { userId: intoUserId }),
        'reactions.userId',
      )

      // Same shape three times — all keyed on (userId, kind, targetId) — but
      // written out rather than looped over table names, because collapsing
      // them needs a cast that erases exactly the typing worth having here.
      const sameTarget = (r: { kind: string; targetId: string }, o: { userId: Id<'users'>; kind: string; targetId: string }) =>
        o.userId === intoUserId && o.kind === r.kind && o.targetId === r.targetId

      const starRows = await ctx.db.query('stars').collect()
      await dedupe(starRows, (r) => r.userId === from, sameTarget, async (r) => ctx.db.patch(r._id, { userId: intoUserId }), 'stars.userId')

      const screenerRows = await ctx.db.query('screenerItems').collect()
      await dedupe(screenerRows, (r) => r.userId === from, sameTarget, async (r) => ctx.db.patch(r._id, { userId: intoUserId }), 'screenerItems.userId')

      const deskRows = await ctx.db.query('deskOpenWork').collect()
      await dedupe(deskRows, (r) => r.userId === from, sameTarget, async (r) => ctx.db.patch(r._id, { userId: intoUserId }), 'deskOpenWork.userId')

      // DMs are a canonically ordered pair, so reassigning can produce a
      // self-pair or a duplicate of one the target already has. Both are worse
      // than dropping a conversation nobody can reach: the orphan is the same
      // person, so a DM "between" them is not a real thread.
      for (const d of await ctx.db.query('dmConversations').collect()) {
        const involves = d.userLowId === from || d.userHighId === from
        if (!involves) continue
        const other = d.userLowId === from ? d.userHighId : d.userLowId
        if (other === intoUserId) {
          if (commit) await ctx.db.delete(d._id)
          bump(skipped, 'dmConversations (self-pair, dropped)')
          continue
        }
        const [lo, hi] =
          (intoUserId as string) < (other as string) ? [intoUserId, other] : [other, intoUserId]
        if (commit) await ctx.db.patch(d._id, { userLowId: lo, userHighId: hi })
        bump(moved, 'dmConversations')
      }

      if (commit) await ctx.db.delete(from)
      bump(moved, 'users (orphan deleted)')
    }

    return {
      dryRun: !commit,
      target: { userId: intoUserId, name: target.name, nostrPubkey: target.nostrPubkey ?? null },
      orphansMerged: toMerge.length,
      moved,
      skipped,
    }
  },
})
