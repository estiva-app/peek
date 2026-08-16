/**
 * DEV-ONLY demo fixture (domain model §5 + per-table seed notes).
 *
 * Production starts EMPTY — never run this against prod. It transforms the
 * src/data mocks into real records:
 *   - display names → userIds ('You' → the seed user)
 *   - date labels + clock strings → real UTC ms that render back to the
 *     exact mock labels in Europe/London (per-label year resolution)
 *   - aggregated reactions {emoji, count, owner} → per-user rows
 *   - numeric DM keys → dmConversations docs
 *   - unread flags → one readState watermark per container, placed just
 *     before the earliest flagged item (§2.10; known drift accepted)
 * Mock narrative content is preserved verbatim. Mock replyCounts double as
 * checksums — mismatches are returned, not fatal (a few are wrong in the
 * mocks themselves).
 *
 * Run:  npx convex run dev/seedDemo:seed '{"wipe": true}'
 */
import { v } from 'convex/values'
import { internalAction, internalMutation, type MutationCtx } from '../_generated/server'
import { internal } from '../_generated/api'
import type { Id, TableNames } from '../_generated/dataModel'
import { TOPICS, TOPIC_CONVERSATIONS, type ConversationData } from '../../src/data/topicData'
import { DM_CONVERSATIONS } from '../../src/data/dmData'
import { REPLIES } from '../../src/data/replyData'
import { TOPIC_HUDDLES } from '../../src/data/huddleData'
import { SCREENER_ITEMS } from '../../src/data/screenerData'
import { STARRED_ENTRIES, OPEN_WORK_ITEMS } from '../../src/data/deskData'
import { resolveDateLabel, dayTimeToUtc, type SeedDay } from './seedDates'

// People are duplicated here (not imported from peopleData.ts) because that
// module imports .png avatar assets, which the Convex bundler can't load.
// Avatars stay client-side (name-keyed avatarFor) until Phase 3 profiles.
const SEED_PEOPLE = [
  { seedKey: 'alice',  name: 'Alice Johnson',  role: 'Product Designer' },
  { seedKey: 'amie',   name: 'Amie Miles',     role: 'Engineering Manager' },
  { seedKey: 'daniel', name: 'Daniel Stanton', role: 'Backend Engineer' },
  { seedKey: 'greg',   name: 'Greg Bothman',   role: 'Customer Success Lead' },
  { seedKey: 'hallie', name: 'Hallie Pratt',   role: 'Product Marketing' },
  { seedKey: 'jake',   name: 'Jake Walter',    role: 'Software Engineer' },
  { seedKey: 'juan',   name: 'Juan Foley',     role: 'Frontend Engineer' },
  { seedKey: 'zack',   name: 'Zack Bright',    role: 'Data Analyst' },
  { seedKey: 'bob',    name: 'Bob Chen',       role: 'Payments Engineer, Stripe' },
] as const

// Referenced by static huddle member lists but absent from PEOPLE (§1).
const SEED_EXTRAS = [
  { seedKey: 'carlos', name: 'Carlos Rivera' },
  { seedKey: 'maya',   name: 'Maya Patel' },
] as const

/** The seed user — "You". `seedAs` binds her to a real Estiva ID pubkey. */
const SEED_YOU = { seedKey: 'you', name: 'Cath' } as const
export const DEMO_EMAIL = 'demo@peek.dev'

/** Mock conversation number → partner (mirrors src/api/directory.ts).
 *  `key` is the partner's person key — the DM's real id (§2.4). */
const DM_SEED: Array<{ mockConvId: number; key: string; name: string }> = [
  { mockConvId: 1, key: 'alice',  name: 'Alice Johnson' },
  { mockConvId: 2, key: 'daniel', name: 'Daniel Stanton' },
  { mockConvId: 3, key: 'hallie', name: 'Hallie Pratt' },
  { mockConvId: 4, key: 'greg',   name: 'Greg Bothman' },
  { mockConvId: 5, key: 'juan',   name: 'Juan Foley' },
  { mockConvId: 6, key: 'amie',   name: 'Amie Miles' },
  { mockConvId: 7, key: 'zack',   name: 'Zack Bright' },
]

const ALL_TABLES: TableNames[] = [
  'users', 'topics', 'topicMembers', 'dmConversations', 'messages',
  'replies', 'reactions', 'huddles', 'huddleMembers', 'readState',
  'stars', 'screenerItems', 'deskOpenWork',
  // Convex Auth's tables used to be wiped here too. They left the schema with
  // it (PEEK-41) and are therefore no longer in `TableNames`, so typed code
  // cannot reach them at all. Any rows still in them are inert — nothing reads
  // them and no sign-in consults them — and clearing them is a one-off from the
  // dashboard rather than something this fixture should pretend to own.
]

async function wipeAll(ctx: MutationCtx) {
  for (const table of ALL_TABLES) {
    const rows = await ctx.db.query(table).collect()
    for (const row of rows) await ctx.db.delete(row._id)
  }
}

/** Empty the database completely (the "fresh workspace" state production
 *  launches in). Run: npx convex run dev/seedDemo:wipe */
export const wipe = internalMutation({
  args: {},
  handler: async (ctx) => {
    await wipeAll(ctx)
    return { wiped: true }
  },
})

export const seed = internalMutation({
  args: { wipe: v.optional(v.boolean()) },
  handler: async (ctx, { wipe }) => {
    if (wipe) await wipeAll(ctx)
    // The seed user (seedKey 'you') may already exist — `seedAs`
    // creates the account first; the seed then reuses that user as "You".
    const users = await ctx.db.query('users').collect()
    const existingYou = users.find((u) => u.seedKey === 'you')
    if (users.some((u) => u.seedKey !== 'you'))
      return { skipped: 'users table not empty — pass {"wipe": true} to reseed' }

    const anchor = Date.now()
    const justNow = anchor - 45_000
    const timeFor = (day: SeedDay, clock: string): number =>
      clock === 'Just now' ? justNow : dayTimeToUtc(day, clock)

    // ── users ──
    const byName: Record<string, Id<'users'>> = {}
    const youId = existingYou?._id ?? (await ctx.db.insert('users', { ...SEED_YOU }))
    byName[SEED_YOU.name] = youId
    byName['You'] = youId // mock authorName convention → seed user
    for (const p of [...SEED_PEOPLE, ...SEED_EXTRAS]) {
      byName[p.name] = await ctx.db.insert('users', { ...p })
    }
    const userIdOf = (name: string): Id<'users'> => {
      const id = byName[name]
      if (!id) throw new Error(`Seed: unknown person name "${name}"`)
      return id
    }

    // ── shared bookkeeping ──
    const msgIdByMock: Record<string, Id<'messages'>> = {}
    const msgMeta: Record<string, { day: SeedDay; containerId: string }> = {}
    const flagged: Record<string, number[]> = {}
    /** Per-message (thread) flags — a reply marked isNew makes that THREAD unread. */
    const threadFlagged: Record<string, number[]> = {}
    const containerIds: string[] = []
    const flag = (containerId: string, at: number) =>
      (flagged[containerId] ??= []).push(at)
    let counts = { messages: 0, replies: 0, reactions: 0 }

    const insertMessage = async (
      conv: ConversationData,
      parentKind: 'topic' | 'dm' | 'huddle',
      parentId: string,
      day: SeedDay,
    ) => {
      const createdAt = timeFor(day, conv.timestamp)
      const id = await ctx.db.insert('messages', {
        parentKind,
        parentId,
        authorId: userIdOf(conv.authorName),
        body: conv.body,
        createdAt,
        urgent: conv.isUrgent ? true : undefined,
        highlightType: conv.highlightType,
        resolved: conv.isResolved ? true : undefined,
        resolvedById: conv.resolvedBy ? userIdOf(conv.resolvedBy) : undefined,
        resolutionMessage: conv.resolutionMessage,
        resolvedAt: conv.isResolved ? createdAt : undefined,
        attachments: conv.attachments,
        seedKey: conv.id,
      })
      counts.messages++
      msgIdByMock[conv.id] = id
      msgMeta[conv.id] = { day, containerId: parentId }
      if (conv.hasNewMessage) flag(parentId, createdAt)

      // Aggregated {emoji, count, owner} → per-user rows (§2.7): 'yours'
      // includes the seed user; remaining reactors round-robin over the
      // people excluding the author.
      for (const r of conv.reactions ?? []) {
        const others = SEED_PEOPLE.map((p) => p.name).filter((n) => n !== conv.authorName)
        const reactors = (r.owner === 'yours' ? ['You', ...others] : others).slice(0, r.count)
        for (let i = 0; i < reactors.length; i++) {
          await ctx.db.insert('reactions', {
            messageId: id,
            userId: userIdOf(reactors[i]),
            emoji: r.emoji,
            createdAt: createdAt + (i + 1) * 60_000,
          })
          counts.reactions++
        }
      }
      return id
    }

    // ── topics + their messages ──
    const topicIdByMock: Record<string, Id<'topics'>> = {}
    for (const t of TOPICS) {
      const groups = TOPIC_CONVERSATIONS[t.id] ?? []
      const firstGroup = groups[0]
      const firstConv = firstGroup?.convs[0]
      const firstDay = firstGroup ? resolveDateLabel(firstGroup.dateLabel, anchor) : null
      const createdAt = firstConv && firstDay ? timeFor(firstDay, firstConv.timestamp) : anchor
      const topicId = await ctx.db.insert('topics', {
        title: t.title,
        creatorId: firstConv ? userIdOf(firstConv.authorName) : youId,
        createdAt,
        seedKey: t.id,
        channelUuid: crypto.randomUUID(),
      })
      topicIdByMock[t.id] = topicId
      containerIds.push(topicId)
      // t.isResolved is NOT stored — derived (§4.1); verified consistent
      // with per-message resolved flags for topics 4 and 5.
      for (const group of groups) {
        const day = resolveDateLabel(group.dateLabel, anchor)
        for (const conv of group.convs) await insertMessage(conv, 'topic', topicId, day)
      }

      // topicMembers (§2.3). The mock TOPICS carry no invitee list, so the
      // seeded members are the people who actually appear in the topic —
      // everyone who wrote a message or a reply in it, plus the seed user.
      // Without these rows the table was empty, so nothing could be screened
      // and the members pill had nobody to show.
      const memberNames = new Set<string>(['You'])
      for (const group of groups) {
        for (const conv of group.convs) {
          memberNames.add(conv.authorName)
          for (const r of REPLIES[conv.id] ?? []) memberNames.add(r.authorName)
        }
      }
      const seenMember = new Set<string>()
      for (const name of memberNames) {
        const userId = userIdOf(name)
        if (seenMember.has(userId)) continue
        seenMember.add(userId)
        await ctx.db.insert('topicMembers', { topicId, userId, addedAt: createdAt })
      }
    }

    // ── DM conversations + their messages ──
    const dmIdByMock: Record<number, Id<'dmConversations'>> = {}
    // Person key → that person's DM with the seed user (the §2.4 addressing).
    const dmIdByPerson: Record<string, Id<'dmConversations'>> = {}
    for (const { mockConvId: dmId, key: personKey, name } of DM_SEED) {
      const otherId = userIdOf(name)
      const [userLowId, userHighId] =
        (youId as string) < (otherId as string) ? [youId, otherId] : [otherId, youId]
      const groups = DM_CONVERSATIONS[dmId] ?? []
      const firstGroup = groups[0]
      const firstConv = firstGroup?.convs[0]
      const createdAt = firstConv && firstGroup
        ? timeFor(resolveDateLabel(firstGroup.dateLabel, anchor), firstConv.timestamp)
        : anchor
      const convId = await ctx.db.insert('dmConversations', {
        userLowId,
        userHighId,
        createdAt,
        seedKey: String(dmId),
      })
      dmIdByMock[dmId] = convId
      dmIdByPerson[personKey] = convId
      containerIds.push(convId)
      for (const group of groups) {
        const day = resolveDateLabel(group.dateLabel, anchor)
        for (const conv of group.convs) await insertMessage(conv, 'dm', convId, day)
      }
    }

    // ── huddles + members + their messages ──
    // Static huddles are never DM-promoted (no originDmId in the mocks);
    // promotion happens at runtime and never copies messages (§3).
    let huddleCount = 0
    for (const [mockTopicId, huddles] of Object.entries(TOPIC_HUDDLES)) {
      const topicId = topicIdByMock[mockTopicId]
      if (!topicId) throw new Error(`Seed: huddles reference unknown topic "${mockTopicId}"`)
      for (const h of huddles) {
        const day = resolveDateLabel(h.lastActivity, anchor)
        const createdAt = h.conversation ? timeFor(day, h.conversation.timestamp) : anchor
        const huddleId = await ctx.db.insert('huddles', {
          topicId,
          state: h.state,
          createdById: userIdOf(h.conversation?.authorName ?? 'You'),
          createdAt,
          seedKey: h.id,
        })
        huddleCount++
        containerIds.push(huddleId)
        for (const member of h.members) {
          await ctx.db.insert('huddleMembers', { huddleId, userId: userIdOf(member) })
        }
        for (const conv of [...(h.conversation ? [h.conversation] : []), ...(h.extraConvs ?? [])]) {
          await insertMessage(conv, 'huddle', huddleId, day)
        }
      }
    }

    // ── replies (same day as their parent message; 'Just now' → anchor−45s) ──
    const replyCountByMock: Record<string, number> = {}
    for (const [mockMsgId, replies] of Object.entries(REPLIES)) {
      const messageId = msgIdByMock[mockMsgId]
      const meta = msgMeta[mockMsgId]
      if (!messageId || !meta) throw new Error(`Seed: replies reference unknown message "${mockMsgId}"`)
      for (const r of replies) {
        const createdAt = timeFor(meta.day, r.timestamp)
        await ctx.db.insert('replies', {
          messageId,
          authorId: userIdOf(r.authorName),
          body: r.body,
          createdAt,
          urgent: r.isUrgent ? true : undefined,
          highlightType: r.highlightType,
          attachments: r.attachments,
          seedKey: r.id,
        })
        counts.replies++
        replyCountByMock[mockMsgId] = (replyCountByMock[mockMsgId] ?? 0) + 1
        // A new reply makes the THREAD unread, not the container — opening the
        // topic must not clear a "1 new reply" badge (§4.3).
        if (r.isNew) (threadFlagged[messageId] ??= []).push(createdAt)
      }
    }

    // ── readState: watermarks per container AND per thread (§2.10, §4.3) ──
    // Each is placed 1s before its earliest flagged item; anything unflagged is
    // fully read as of the anchor. Without the thread watermarks every seeded
    // thread would render as having unread replies.
    for (const containerId of containerIds) {
      const times = flagged[containerId]
      await ctx.db.insert('readState', {
        userId: youId,
        containerId,
        lastReadAt: times?.length ? Math.min(...times) - 1000 : anchor,
      })
    }
    for (const mockMsgId of Object.keys(replyCountByMock)) {
      const messageId = msgIdByMock[mockMsgId] as string
      const times = threadFlagged[messageId]
      await ctx.db.insert('readState', {
        userId: youId,
        containerId: messageId,
        lastReadAt: times?.length ? Math.min(...times) - 1000 : anchor,
      })
    }

    // ── stars / screener / open work (per-user, seed user) ──
    for (let i = 0; i < STARRED_ENTRIES.length; i++) {
      const e = STARRED_ENTRIES[i]
      await ctx.db.insert('stars', {
        userId: youId,
        kind: e.kind,
        targetId: e.kind === 'dm' ? dmIdByPerson[e.dmId] : topicIdByMock[e.topicId],
        createdAt: anchor - i,
      })
    }
    for (let i = 0; i < SCREENER_ITEMS.length; i++) {
      const item = SCREENER_ITEMS[i]
      // Schema fix (§2.12): the mock DM item has only authorName — map to
      // that person's DM conversation.
      const targetId =
        item.kind === 'topic' ? topicIdByMock[item.topicId] : dmIdByPerson[item.dmId]
      await ctx.db.insert('screenerItems', {
        userId: youId,
        kind: item.kind,
        targetId,
        preview: item.preview,
        createdAt: anchor - i,
      })
    }
    for (let i = 0; i < OPEN_WORK_ITEMS.length; i++) {
      const item = OPEN_WORK_ITEMS[i]
      if (item.kind === 'dm') continue // seed fixture is topics-only
      await ctx.db.insert('deskOpenWork', {
        userId: youId,
        kind: 'topic',
        targetId: topicIdByMock[item.topicId],
        addedAt: anchor - i,
      })
    }

    // ── checksum: mock replyCount vs inserted replies (§5) ──
    const mismatches: Array<{ id: string; mock: number; inserted: number }> = []
    const checkConv = (conv: ConversationData) => {
      if (conv.replyCount == null) return
      const inserted = replyCountByMock[conv.id] ?? 0
      if (inserted !== conv.replyCount) {
        mismatches.push({ id: conv.id, mock: conv.replyCount, inserted })
      }
    }
    for (const groups of Object.values(TOPIC_CONVERSATIONS)) groups.forEach((g) => g.convs.forEach(checkConv))
    for (const groups of Object.values(DM_CONVERSATIONS)) groups.forEach((g) => g.convs.forEach(checkConv))
    for (const huddles of Object.values(TOPIC_HUDDLES)) {
      for (const h of huddles) [...(h.conversation ? [h.conversation] : []), ...(h.extraConvs ?? [])].forEach(checkConv)
    }

    return {
      anchor,
      users: 1 + SEED_PEOPLE.length + SEED_EXTRAS.length,
      topics: TOPICS.length,
      dmConversations: DM_SEED.length,
      huddles: huddleCount,
      ...counts,
      readState: containerIds.length,
      // Non-fatal: some mock replyCounts disagree with the REPLIES data
      // itself (they were hand-written); the inserted counts are the truth.
      replyCountMismatches: mismatches,
    }
  },
})

/**
 * Seed the demo data and hand the seed user "Cath" to a real identity.
 *
 * Run:  npx convex run dev/seedDemo:seedAs '{"pubkey": "<64 hex>", "wipe": true}'
 *
 * There was a `seedWithLogin` here that called Convex Auth's `createAccount` to
 * mint a demo@peek.dev / password login. Convex Auth is gone (PEEK-41), and
 * with it the idea of an account Peek can create on its own: identity lives in
 * Estiva ID, and Peek only ever recognises a pubkey.
 *
 * So instead of creating credentials, this **adopts** them. Pass the pubkey you
 * sign in with — `sessionStorage`'s stored token carries it, or read it off
 * your row in the `users` table — and the seed user is stamped with it, so
 * signing in through Estiva ID lands you on Cath with the whole demo dataset
 * behind you rather than as a brand new person in an empty workspace.
 *
 * Idempotent, and safe to point at a pubkey that already has its own row: the
 * pubkey is only stamped when nobody else holds it, because two rows sharing
 * one pubkey is the exact corruption `by_nostrPubkey` lookups cannot survive —
 * `.unique()` throws and every signed-in read fails.
 */
export const seedAs = internalAction({
  args: { pubkey: v.string(), wipe: v.optional(v.boolean()) },
  handler: async (ctx, { pubkey, wipe }): Promise<unknown> => {
    if (!/^[0-9a-f]{64}$/.test(pubkey)) {
      throw new Error('pubkey must be 64 lowercase hex characters')
    }
    if (wipe) await ctx.runMutation(internal.dev.seedDemo.wipe, {})
    const seeded = await ctx.runMutation(internal.dev.seedDemo.seed, {})
    await ctx.runMutation(internal.dev.seedDemo.bindSeedUser, { pubkey })
    return seeded
  },
})

/** Stamp the seed user with a pubkey, unless somebody else already holds it. */
export const bindSeedUser = internalMutation({
  args: { pubkey: v.string() },
  handler: async (ctx, { pubkey }) => {
    const holder = await ctx.db
      .query('users')
      .withIndex('by_nostrPubkey', (q) => q.eq('nostrPubkey', pubkey))
      .unique()
    if (holder) return { bound: false, reason: `already held by ${holder.name}` }

    const you = await ctx.db
      .query('users')
      .withIndex('by_seedKey', (q) => q.eq('seedKey', SEED_YOU.seedKey))
      .unique()
    if (!you) return { bound: false, reason: 'seed user not found — run the seed first' }

    await ctx.db.patch(you._id, { nostrPubkey: pubkey, email: DEMO_EMAIL })
    return { bound: true }
  },
})
