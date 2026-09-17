/**
 * Screener auto-fill (§2.12; rules confirmed by the user 2026-07-09).
 *
 * The Screener is a *preview* of things that want your attention — not a log
 * of every message. An item appears when:
 *
 *   1. someone DMs you;
 *   2. a topic you were added to but have never opened gets a message;
 *   3. you are @mentioned.
 *
 * …and it is refreshed (never duplicated) by later activity: one row per
 * conversation, carrying the newest preview. Ordinary messages and replies in
 * topics you already follow do NOT screen — that's what keeps it quiet.
 *
 * URGENT overrides everything: an urgent message (written with `!@`) goes to
 * the Desk *Urgent* section and never to the Screener.
 *
 * ## The topic half is a fold now, and this file is half its old self (SHR-10)
 *
 * Rules 2 and 3 used to be evaluated **here, on write, for every user in the
 * workspace**. `screenMessage` collected `users` whole and, for each one, read
 * *their* `readState` to decide whether they had ever opened the container —
 * a cross-user read of private state, and the single thing ADR 0001 §3's
 * "server-side compute" candidate turned on when SHR-7 examined it. It also
 * cost O(users × their containers) per message sent, and again per reply.
 *
 * None of that survives. {@link candidates} hands the viewer the facts about
 * **their own** containers and `src/api/internal/screener.tsx` applies the
 * rules on the device, once, for one person. What is left of the fan-out is
 * the DM half (rule 1), which has no relay stream to fold from until DMS-3
 * gives `dmConversations` a channel uuid — `convex/nostr/sync.ts:527` states
 * that flatly. The seam is `kind`, which `screenerItems` already carries.
 *
 * "Later" and Dismiss are no longer here either for topics: they are the two
 * authored fields, and they live in the person's own `estiva-peek:screener:v1`
 * blob (`src/nostr/screener.ts`). `snoozedUntil` on a `screenerItems` row now
 * means a snoozed **DM** and nothing else.
 */
import { v } from 'convex/values'
import { query, type MutationCtx, type QueryCtx } from './_generated/server'
import { viewerId } from './users'
import type { Doc, Id } from './_generated/dataModel'

const PREVIEW_MAX = 240
const snippet = (body: string) => body.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_MAX)

/** `@Name` — also true for the urgent form `!@Name`. */
export function mentionsUser(body: string, name: string): boolean {
  return body.includes(`@${name}`)
}

/** The composer's urgent marker. */
export function isUrgentBody(body: string): boolean {
  return body.includes('!@')
}

/** Everyone who could be notified about a message in this container, minus its author. */
async function recipients(
  ctx: MutationCtx,
  kind: 'topic' | 'dm' | 'huddle',
  containerId: string,
  authorId: Id<'users'>,
): Promise<Id<'users'>[]> {
  if (kind === 'dm') {
    const dm = await ctx.db.get(containerId as Id<'dmConversations'>)
    if (!dm) return []
    const other = dm.userLowId === authorId ? dm.userHighId : dm.userLowId
    return [other]
  }
  if (kind === 'topic') {
    const rows = await ctx.db
      .query('topicMembers')
      .withIndex('by_topic', (q) => q.eq('topicId', containerId as Id<'topics'>))
      .collect()
    return rows.map((r) => r.userId).filter((id) => id !== authorId)
  }
  const rows = await ctx.db
    .query('huddleMembers')
    .withIndex('by_huddle', (q) => q.eq('huddleId', containerId as Id<'huddles'>))
    .collect()
  return rows.map((r) => r.userId).filter((id) => id !== authorId)
}

/** Where a message screens to: DMs to themselves, huddles to their parent topic. */
async function screenTarget(
  ctx: MutationCtx,
  kind: 'topic' | 'dm' | 'huddle',
  containerId: string,
): Promise<{ kind: 'topic' | 'dm'; targetId: string } | null> {
  if (kind === 'dm') return { kind: 'dm', targetId: containerId }
  if (kind === 'topic') return { kind: 'topic', targetId: containerId }
  const h = await ctx.db.get(containerId as Id<'huddles'>)
  return h ? { kind: 'topic', targetId: h.topicId as string } : null
}

async function findItem(ctx: MutationCtx, userId: Id<'users'>, kind: 'topic' | 'dm', targetId: string) {
  const rows = await ctx.db
    .query('screenerItems')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .collect()
  return rows.find((r) => r.kind === kind && r.targetId === targetId) ?? null
}

/**
 * Already committed to: an item in Desk Open Work must not screen (PEE-6).
 *
 * The Screener previews things that *want* your attention; Open Work holds
 * what you have already given it to. One conversation in both reads as a
 * duplicate — "you're trying to open an item that is already open" — and its
 * attention signal is the unread badge the Open Work row already carries.
 */
async function inOpenWork(
  ctx: MutationCtx | QueryCtx,
  userId: Id<'users'>,
  kind: 'topic' | 'dm',
  targetId: string,
): Promise<boolean> {
  const rows = await ctx.db
    .query('deskOpenWork')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .collect()
  return rows.some((w) => w.kind === kind && w.targetId === targetId)
}

/** One row per conversation: create it, or refresh its preview in place. */
async function upsert(
  ctx: MutationCtx,
  userId: Id<'users'>,
  kind: 'topic' | 'dm',
  targetId: string,
  preview: string,
  messageId: Id<'messages'>,
) {
  const existing = await findItem(ctx, userId, kind, targetId)
  const now = Date.now()
  if (existing) {
    // snoozedUntil is deliberately left alone (see header).
    await ctx.db.patch(existing._id, { preview, createdAt: now, messageId })
  } else {
    await ctx.db.insert('screenerItems', { userId, kind, targetId, preview, createdAt: now, messageId })
  }
}

/**
 * Fan a newly-sent **DM** out to the Screener that should show it (rule 1).
 *
 * Topics and huddles return here without writing anything. They are folded on
 * the device from {@link candidates} — see the header. This is the whole of
 * what SHR-10 left behind, and it is temporary in the same way `dmConversations`
 * is: once DMS-3 gives a DM a channel uuid, a DM *is* a channel, rule 1 is
 * answered by the same `kind:44100` the topic rules use, and this goes too.
 *
 * Deliberately unchanged in every other respect, because SHR-10's done-when is
 * that the DM half is untouched and still correct. That includes a behaviour
 * worth writing down rather than quietly fixing here: `users` is still
 * collected whole, so someone @mentioned inside a DM they are not part of gets
 * a row for a conversation they cannot open. The list of every user is what
 * makes that reachable. It is a pre-existing defect of rule 3 in DMs, it is not
 * what this ticket is about, and fixing it under cover of a migration is how a
 * regression gets attributed to the wrong change.
 */
export async function screenMessage(ctx: MutationCtx, m: Doc<'messages'>) {
  if (m.urgent) return // → Desk Urgent instead
  if (m.parentKind !== 'dm') return // topics and huddles are a fold (SHR-10)
  const target = await screenTarget(ctx, m.parentKind, m.parentId)
  if (!target) return

  const members = new Set(await recipients(ctx, m.parentKind, m.parentId, m.authorId))
  // A MENTION reaches you whether or not you're a member of the container —
  // being named is the point. Membership only gates the other rule.
  const candidates = await ctx.db.query('users').collect()

  for (const user of candidates) {
    if (user._id === m.authorId) continue
    // Every DM to you screens; or you were @mentioned in one. The
    // never-opened branch that read another person's `readState` was the topic
    // rule and is gone with it.
    if (!mentionsUser(m.body, user.name) && !members.has(user._id)) continue
    // Checked only for someone about to be screened: `candidates` is every
    // user, and most of them are not (PEE-6).
    if (!(await inOpenWork(ctx, user._id, target.kind, target.targetId))) {
      await upsert(ctx, user._id, target.kind, target.targetId, snippet(m.body), m._id)
    }
  }
}

/**
 * A reply screens to you when (ruling 2026-07-16, extending 2026-07-09):
 *
 *   - you are @mentioned in it; or
 *   - you PARTICIPATED in that thread — you wrote the parent message or an
 *     earlier reply in it; or
 *   - you already have a Screener item for the conversation (the reply
 *     refreshes it — "new replies in a thread you were mentioned in").
 *
 * Ordinary replies in threads you never touched still don't screen.
 */
export async function screenReply(ctx: MutationCtx, reply: Doc<'replies'>) {
  if (reply.urgent) return
  const parent = await ctx.db.get(reply.messageId)
  if (!parent) return
  if (parent.parentKind !== 'dm') return // topics and huddles are a fold (SHR-10)
  const target = await screenTarget(ctx, parent.parentKind, parent.parentId)
  if (!target) return

  const members = new Set(await recipients(ctx, parent.parentKind, parent.parentId, reply.authorId))
  const priorReplies = await ctx.db
    .query('replies')
    .withIndex('by_message', (q) => q.eq('messageId', parent._id))
    .collect()
  const participants = new Set<string>([
    parent.authorId as string,
    ...priorReplies.filter((r) => r._id !== reply._id).map((r) => r.authorId as string),
  ])
  for (const user of await ctx.db.query('users').collect()) {
    if (user._id === reply.authorId) continue
    const mentioned = mentionsUser(reply.body, user.name)
    if (!mentioned && !members.has(user._id)) continue
    const existing = await findItem(ctx, user._id, target.kind, target.targetId)
    if (
      (mentioned || existing || participants.has(user._id as string)) &&
      !(await inOpenWork(ctx, user._id, target.kind, target.targetId))
    ) {
      await upsert(ctx, user._id, target.kind, target.targetId, snippet(reply.body), parent._id)
    }
  }
}

/**
 * The hover preview (user request 2026-07-09): hovering a Screener item shows
 * more of the conversation than its two-line snippet.
 *
 * When we know which message triggered the item we show that message plus its
 * replies (the thread you were mentioned in); otherwise we fall back to the
 * conversation's most recent messages. Own rows are labelled by the client.
 */
export const preview = query({
  args: { itemId: v.string() },
  handler: async (ctx: QueryCtx, { itemId }) => {
    const me = await viewerId(ctx)
    if (!me) return null
    const id = ctx.db.normalizeId('screenerItems', itemId)
    const item = id ? await ctx.db.get(id) : null
    if (!item || item.userId !== me) return null // never leak someone else's inbox

    const users = await ctx.db.query('users').collect()
    const nameOf = new Map(users.map((u) => [u._id, u.name]))
    const row = (
      authorId: Id<'users'>,
      createdAt: number,
      body: string,
      kind: 'message' | 'reply',
    ) => ({
      authorId: authorId as string,
      authorName: nameOf.get(authorId) ?? 'Unknown',
      createdAt,
      body,
      kind,
    })

    const out: ReturnType<typeof row>[] = []

    if (item.messageId) {
      const m = await ctx.db.get(item.messageId)
      if (m) {
        out.push(row(m.authorId, m.createdAt, m.body, 'message'))
        const replies = await ctx.db
          .query('replies')
          .withIndex('by_message', (q) => q.eq('messageId', m._id))
          .collect()
        replies.sort((a, b) => a.createdAt - b.createdAt)
        for (const r of replies.slice(-4)) out.push(row(r.authorId, r.createdAt, r.body, 'reply'))
      }
    }

    if (out.length === 0) {
      const msgs = await ctx.db
        .query('messages')
        .withIndex('by_parent', (q) => q.eq('parentKind', item.kind).eq('parentId', item.targetId))
        .collect()
      msgs.sort((a, b) => a.createdAt - b.createdAt)
      for (const m of msgs.slice(-3)) out.push(row(m.authorId, m.createdAt, m.body, 'message'))
    }

    return out
  },
})

/**
 * The facts the viewer's own device needs to fold its Screener (SHR-10).
 *
 * ## What this is, and what it deliberately is not
 *
 * It is **not** the Screener, and it does not decide a single row. It answers
 * questions about the viewer's own containers — have I opened this, am I a
 * member, what arrived that I did not write, did I write in this thread — and
 * `src/api/internal/screener.tsx` applies §2.12's rules to the answers. That
 * split is the ticket: the five derived fields of `screenerItems` are computed
 * where they are used, and the two authored ones live in the person's blob.
 *
 * ## Why this is legitimate layer 3, stated the way the PR template asks
 *
 * ADR 0001 §3's third question is "does it need a query, an index, aggregation,
 * server-side compute or size". This adds **no state at all** — no table, no
 * field — so §3 does not apply to it in the first place; §5's rule is about
 * where truth lives, and the truth here is `messages`, `replies`, `topicMembers`
 * and the viewer's own `readState`, all of which are already layer 3 and stay
 * there. What moved to layer 2 is the pair of decisions, which is the whole of
 * what the person authored.
 *
 * The one thing that could have gone the other way is folding from the relay
 * instead — SHR-10's table of four relay-native inputs. Probed against
 * production rather than read out of buzz's source
 * (`scripts/probe-shr10-screener-inputs.ts`), one of the four is usable today:
 * `kind:44100` answers `#p:[self]` and refuses another pubkey's, 403. The
 * mention index cannot answer rule 3, because it is `p`-tag based and Peek
 * writes a mention as `@FullName` text — `mentionedPubkeys` only tags a
 * `nostr:npub1…` URI, which the composer never produces. `kind:39005` could not
 * be decided at all: fifteen readable channels held two top-level messages and
 * no thread with a reply. And a relay-sourced fold of *traffic* cannot see the
 * 41 topic messages that were never published (SHR-8). So the relay path is a
 * follow-up with a dependency, and this is the ungated shape of the same move.
 *
 * ## Cost, and the precedent for it
 *
 * One pass over `topics`, `messages` and `replies` for one viewer, which is the
 * shape `unread.summary` already has and the same order of work — with the
 * O(users × containers) fan-out that ran on **every message sent** deleted in
 * exchange. Bodies come back snippeted to `PREVIEW_MAX`, so the wire cost is
 * the preview the row was always going to draw.
 *
 * `mentionsMe` is the one predicate evaluated here rather than on the device,
 * and it is a fact about the viewer's *own* name — never another person's
 * state, which is the read this ticket exists to remove. It is here because the
 * alternative is worse in both directions: matching against the snippet would
 * silently miss a mention past the 240th character, and shipping every full
 * body so the client can match properly is exactly the payload the snippet
 * exists to avoid.
 */
export const candidates = query({
  args: {},
  handler: async (ctx: QueryCtx) => {
    const me = await viewerId(ctx)
    const empty: {
      containers: {
        kind: 'topic'
        targetId: string
        isMember: boolean
        everOpened: boolean
        events: {
          id: string
          preview: string
          createdAt: number
          isReply: boolean
          mentionsMe: boolean
          iWroteInThread: boolean
        }[]
      }[]
    } = { containers: [] }
    if (!me) return empty

    const meDoc = await ctx.db.get(me)
    if (!meDoc) return empty

    // My memberships and my read state. Both `by_user`, both mine — the two
    // reads that used to be done for everybody.
    const memberOf = new Set(
      (await ctx.db.query('topicMembers').withIndex('by_user', (q) => q.eq('userId', me)).collect()).map(
        (r) => r.topicId as string,
      ),
    )
    // `by_user_container` on its first key — there is no `by_user` on
    // `readState`, and a prefix of the compound index is the same scan.
    const opened = new Set(
      (
        await ctx.db
          .query('readState')
          .withIndex('by_user_container', (q) => q.eq('userId', me))
          .collect()
      ).map((r) => r.containerId),
    )

    // Replies grouped by thread, once. `iWroteInThread` is the refresh rule's
    // input (ruling 2026-07-16) and it is a fact about my own authorship over a
    // thread's authors, which every member of the container can already see.
    const repliesByMessage = new Map<string, Doc<'replies'>[]>()
    for (const r of await ctx.db.query('replies').collect()) {
      const key = r.messageId as string
      const list = repliesByMessage.get(key)
      if (list) list.push(r)
      else repliesByMessage.set(key, [r])
    }

    const messagesByContainer = new Map<string, Doc<'messages'>[]>()
    for (const m of await ctx.db.query('messages').collect()) {
      const key = `${m.parentKind}:${m.parentId}`
      const list = messagesByContainer.get(key)
      if (list) list.push(m)
      else messagesByContainer.set(key, [m])
    }

    // Huddle activity screens to the parent topic (`screenTarget`), and huddles
    // are private — so a huddle's messages are folded in only for a member.
    const huddleParent = new Map<string, Id<'topics'>>()
    for (const h of await ctx.db.query('huddles').collect()) {
      const members = await ctx.db
        .query('huddleMembers')
        .withIndex('by_huddle', (q) => q.eq('huddleId', h._id))
        .collect()
      if (members.some((r) => r.userId === me)) huddleParent.set(h._id as string, h.topicId)
    }

    const containers = []
    for (const topic of await ctx.db.query('topics').collect()) {
      const internalId = topic._id as string
      const sources = [`topic:${internalId}`]
      for (const [huddleId, parent] of huddleParent) {
        if ((parent as string) === internalId) sources.push(`huddle:${huddleId}`)
      }

      const events = []
      for (const source of sources) {
        for (const m of messagesByContainer.get(source) ?? []) {
          // Urgent never screens — it goes to Desk Urgent (§4.4). Dropped here
          // rather than on the device so an urgent body is not shipped to draw
          // a row that cannot exist.
          if (m.urgent) continue
          const threadReplies = repliesByMessage.get(m._id as string) ?? []
          /*
           * When I first spoke in this thread, or `undefined` if I never did.
           *
           * An instant rather than a boolean, because the rule is "you wrote
           * the parent message or an **earlier** reply in it" — the old code
           * spelled that `priorReplies.filter(r => r._id !== reply._id)`,
           * evaluated at write time when there was no later reply to confuse
           * it. A fold sees the whole thread at once, so a flat "did I ever
           * write here" would make replies that landed *before* mine screen
           * retroactively, and the Screener would fill up with conversations I
           * have since joined and read.
           */
          const myFirst = [
            ...(m.authorId === me ? [m.createdAt] : []),
            ...threadReplies.filter((r) => r.authorId === me).map((r) => r.createdAt),
          ].sort((a, b) => a - b)[0]
          if (m.authorId !== me) {
            events.push({
              id: m._id as string,
              preview: snippet(m.body),
              createdAt: m.createdAt,
              // `isReply` is what keeps the refresh rule off a top-level
              // message. Participation refreshes a *reply* (ruling 2026-07-16);
              // a new message in a topic you have opened and happen to have
              // replied in once still does not screen, and collapsing the two
              // here would make the Screener loud in exactly the busy topics
              // §2.12 is trying to keep out of it.
              isReply: false,
              mentionsMe: mentionsUser(m.body, meDoc.name),
              iWroteInThread: false,
            })
          }
          for (const r of threadReplies) {
            if (r.urgent || r.authorId === me) continue
            events.push({
              id: m._id as string, // the *message* the preview opens onto, as `screenerItems.messageId` was
              preview: snippet(r.body),
              createdAt: r.createdAt,
              isReply: true,
              mentionsMe: mentionsUser(r.body, meDoc.name),
              iWroteInThread: myFirst !== undefined && myFirst < r.createdAt,
            })
          }
        }
      }
      if (events.length === 0) continue
      events.sort((a, b) => b.createdAt - a.createdAt)

      containers.push({
        kind: 'topic' as const,
        targetId: topic.seedKey ?? internalId,
        isMember: memberOf.has(internalId),
        // Read state is keyed by the container the person opened, and the
        // Screener's rule 2 is about the topic — a huddle read does not count
        // as having opened its parent, exactly as before.
        everOpened: opened.has(internalId),
        events,
      })
    }
    return { containers }
  },
})
