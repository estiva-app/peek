/**
 * Convex schema — generated from PRDs/Peek-Domain-Model.md §2 (Phase 0).
 * Field-level rationale, derivation rules, and the coverage check against
 * the old mock shapes live in that document; keep the two in sync.
 *
 * Production starts EMPTY (decision 2026-07-08); convex/dev/seedDemo.ts is
 * the optional dev-only fixture.
 */
import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export const highlightType = v.union(
  v.literal('insight'),
  v.literal('concern'),
  v.literal('conclusion'),
  v.literal('question'),
  v.literal('summary'),
)

/** Polymorphic message parent — one messages table (domain model §3). */
export const parentKind = v.union(v.literal('topic'), v.literal('dm'), v.literal('huddle'))

/** A real uploaded file (Phase 5). The blob lives in Convex `_storage`; the
 *  record carries the metadata a card needs to render its chip. Kept separate
 *  from `attachments` (Figma frame ids), which stay a plain string[]. */
export const fileAttachment = v.object({
  storageId: v.id('_storage'),
  name: v.string(),
  contentType: v.string(),
  size: v.number(),
})

/** Star / screener / desk targets. */
export const containerKind = v.union(v.literal('topic'), v.literal('dm'))

export default defineSchema({
  // Convex Auth's bookkeeping tables (authAccounts, authSessions, …) are gone
  // with it (PEEK-41). Any rows left in them are simply no longer declared:
  // "schemas only validate documents in the tables listed in the schema", so
  // they neither block a push nor are reachable from a typed query.

  // §2.1 — replaces PEOPLE + the 'You' literal + AVATAR_BY_NAME.
  //
  // `email` survives Convex Auth's removal as a plain profile field, sourced
  // from the identity service rather than from a credential row.
  //
  // Convex Auth's own columns (`emailVerificationTime`, `phoneVerificationTime`,
  // `isAnonymous`) are gone. They were kept one release longer than the code
  // that used them, because Convex fails an entire push with "Object contains
  // extra field … that is not in the validator" for every row still carrying
  // one — so a sweep had to confirm nobody did before they could leave. Nobody
  // did: the Password provider ran with no verification, and the phone and
  // anonymous providers were never configured, so nothing ever wrote them.
  users: defineTable({
    name: v.string(),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    // ── Peek profile fields ──
    role: v.optional(v.string()),
    /** Stable key for idempotent seeding ('you', 'alice', …). Fixture-only. */
    seedKey: v.optional(v.string()),
    // ── Nostr identity (docs/buzz-compat/IMPLEMENTATION_PLAN.md §3.1) ──
    /** 64-char lowercase hex x-only public key. Absent until first minted. */
    nostrPubkey: v.optional(v.string()),
    /** True for identities that arrived FROM the relay rather than signing up
     *  to Peek — someone using a different app on a shared channel. They have
     *  no Peek account, so they never get a secret key and are excluded from
     *  the People directory. */
    isExternal: v.optional(v.boolean()),
  })
    .index('email', ['email'])
    .index('phone', ['phone'])
    .index('by_seedKey', ['seedKey'])
    .index('by_nostrPubkey', ['nostrPubkey']),

  // §2.2 — isResolved is DERIVED (§4.1), never stored
  topics: defineTable({
    title: v.string(),
    creatorId: v.id('users'),
    createdAt: v.number(),
    /** Stable client key, returned as `id` where present (Phase 2 close-out
     *  ruling): the demo fixture writes mock ids ('1'..'9') so seeded data
     *  renders pixel-identically, and client mutations write their generated
     *  optimistic id so the local copy and the record are the same object.
     *  Absent on records created server-side only. */
    seedKey: v.optional(v.string()),
    /** NIP-29 channel UUID for this topic on the relay — `crypto.randomUUID()`
     *  at create time, carried as the `h` tag on every event in the channel.
     *  Absent on topics created before Nostr emission was wired up. */
    channelUuid: v.optional(v.string()),
    /** Sync cursor: the newest `created_at` (Nostr seconds) already projected
     *  from the relay into `messages`. Absent means "never synced". */
    nostrSyncedAt: v.optional(v.number()),
  }).index('by_channelUuid', ['channelUuid']),

  // §2.3 — invitees; membership drives the members pill, not participation
  topicMembers: defineTable({
    topicId: v.id('topics'),
    userId: v.id('users'),
    addedAt: v.number(),
  })
    .index('by_topic', ['topicId'])
    .index('by_user', ['userId']),

  // §2.4 — kills the numeric DM id scheme; pair canonically ordered
  dmConversations: defineTable({
    /** Lexicographically smaller user id of the pair. */
    userLowId: v.id('users'),
    userHighId: v.id('users'),
    createdAt: v.number(),
    /** Stable client key — mock numeric DM id as a string (see topics). */
    seedKey: v.optional(v.string()),
  })
    .index('by_pair', ['userLowId', 'userHighId'])
    .index('by_low', ['userLowId'])
    .index('by_high', ['userHighId']),

  // §2.5 — ONE table, polymorphic parent {parentKind, parentId} (§3).
  // parentId is the parent's _id as a string: a union of three Id types
  // can't share one index; the kind+id pair restores safety in code.
  messages: defineTable({
    parentKind,
    parentId: v.string(),
    authorId: v.id('users'),
    body: v.string(),
    createdAt: v.number(),
    urgent: v.optional(v.boolean()),
    highlightType: v.optional(highlightType),
    resolved: v.optional(v.boolean()),
    resolvedById: v.optional(v.id('users')),
    resolutionMessage: v.optional(v.string()),
    /** Set when resolution came from a `→ msg` reply — drives inline editing. */
    resolvedByReplyId: v.optional(v.id('replies')),
    resolvedAt: v.optional(v.number()),
    /** Figma frame ids (static integration mocks, §6). */
    attachments: v.optional(v.array(v.string())),
    /** Real uploaded files (Phase 5) — separate lane from Figma `attachments`. */
    fileAttachments: v.optional(v.array(fileAttachment)),
    /** Stable client key — mock or client-generated message id (see topics). */
    seedKey: v.optional(v.string()),
    /** The Nostr event id this message was published as (sha256 of the event's
     *  own content, so it cannot be pre-computed from `seedKey`). Set by the
     *  publish action on relay acceptance; absent means "not published yet or
     *  publish failed". */
    nostrEventId: v.optional(v.string()),
    nostrPublishedAt: v.optional(v.number()),
    /** NIP-27 `a` tag addresses from imported events (references to other apps'
     *  objects like Ship projects/issues). Stored separately so they persist
     *  even if the message body is edited. */
    nostrReferences: v.optional(v.array(v.string())),
  })
    .index('by_parent', ['parentKind', 'parentId'])
    .index('by_seedKey', ['seedKey'])
    .index('by_nostrEventId', ['nostrEventId']),

  // §2.6 — replyCount is DERIVED (§4.2); isNew is DERIVED via readState (§4.3)
  replies: defineTable({
    messageId: v.id('messages'),
    authorId: v.id('users'),
    body: v.string(),
    createdAt: v.number(),
    urgent: v.optional(v.boolean()),
    highlightType: v.optional(highlightType),
    attachments: v.optional(v.array(v.string())),
    /** Real uploaded files (Phase 5) — separate lane from Figma `attachments`. */
    fileAttachments: v.optional(v.array(fileAttachment)),
    /** Stable client key — mock or client-generated reply id (see topics). */
    seedKey: v.optional(v.string()),
    /** Nostr event id once published (a kind:9 with a NIP-10 `e` tag). */
    nostrEventId: v.optional(v.string()),
    /** NIP-27 `a` tag addresses from imported events (references to other apps' objects). */
    nostrReferences: v.optional(v.array(v.string())),
  })
    .index('by_message', ['messageId'])
    .index('by_seedKey', ['seedKey'])
    .index('by_nostrEventId', ['nostrEventId']),

  // §2.7 — per-user rows; counts + "yours" aggregate in the query (§4.6)
  reactions: defineTable({
    messageId: v.id('messages'),
    userId: v.id('users'),
    emoji: v.string(),
    createdAt: v.number(),
    /** Nostr event id of the kind:7 once published. Kept so retracting the
     *  reaction can publish a kind:5 deletion pointing at it. */
    nostrEventId: v.optional(v.string()),
  })
    .index('by_message', ['messageId'])
    .index('by_message_user', ['messageId', 'userId'])
    .index('by_nostrEventId', ['nostrEventId']),

  /**
   * Resolve/reopen history — append-only (PEEK-128).
   *
   * The columns on `messages` (`resolved`, `resolvedById`, …) stay, but they
   * are now a *projection* folded from these rows rather than the truth. Every
   * existing reader keeps working while this becomes the source; retiring them
   * is a later sweep, because removing a field fails the entire Convex push for
   * every row still carrying it (CLAUDE.md).
   *
   * Rows are never mutated or deleted. A reopen is another row, which is what
   * makes the history renderable at all — the single-slot columns could only
   * ever say where a thread ended up, never what happened to it.
   */
  resolutionAssertions: defineTable({
    messageId: v.id('messages'),
    action: v.union(v.literal('resolved'), v.literal('reopened')),
    /** The asserting user, when they have a Peek account. Absent for an
     *  assertion that arrived from the relay authored by someone who does not. */
    authorId: v.optional(v.id('users')),
    /** Always present: the pubkey that signed, or would sign, this assertion.
     *  Identity on the wire is the pubkey, not the Convex row. */
    authorPubkey: v.optional(v.string()),
    createdAt: v.number(),
    /** Peek's `resolutionMessage` — the event's content. */
    rationale: v.optional(v.string()),
    /** The `→ msg` reply that carried the resolution, when there was one. */
    supportingReplyId: v.optional(v.id('replies')),
    /**
     * Whether Peek lets this assertion move its own state (PEEK-128 decision 4).
     *
     * Foreign assertions are recorded and can be shown, but an untrusted actor
     * must not flip local state — so the fold is fed only trusted rows. Stored
     * rather than derived at read time because trust is judged when the
     * assertion arrives, and re-judging it later against changed membership
     * would silently rewrite history.
     */
    trusted: v.boolean(),
    /** Set once the relay has it. Absent = local-only, including legacy rows. */
    nostrEventId: v.optional(v.string()),
  })
    .index('by_message', ['messageId'])
    .index('by_nostrEventId', ['nostrEventId']),

  // §2.8 — lastActivity/card preview DERIVED (§4.5); promotion never copies
  // messages (§3 edge case 1)
  huddles: defineTable({
    topicId: v.id('topics'),
    state: v.union(v.literal('active'), v.literal('resolved')),
    createdById: v.id('users'),
    createdAt: v.number(),
    originDmId: v.optional(v.id('dmConversations')),
    promotedAt: v.optional(v.number()),
    seedMessageId: v.optional(v.id('messages')),
    /** Stable client key — mock or client-generated huddle id (see topics). */
    seedKey: v.optional(v.string()),
  })
    .index('by_topic', ['topicId'])
    .index('by_originDm', ['originDmId']),

  // §2.9
  huddleMembers: defineTable({
    huddleId: v.id('huddles'),
    userId: v.id('users'),
  })
    .index('by_huddle', ['huddleId'])
    .index('by_user', ['userId']),

  // §2.10 — TWO granularities (ruling 2026-07-09): containerId is a
  // topic/dmConversation/huddle _id (clears hasNewMessage), OR a message _id
  // for one thread's replies (clears hasNewReply/isNew). See convex/readState.ts.
  readState: defineTable({
    userId: v.id('users'),
    containerId: v.string(),
    lastReadAt: v.number(),
  }).index('by_user_container', ['userId', 'containerId']),

  // §2.11 — titles/avatars/status/unread derived from the target
  stars: defineTable({
    userId: v.id('users'),
    kind: containerKind,
    targetId: v.string(),
    createdAt: v.number(),
  }).index('by_user', ['userId']),

  // §2.12 — the incoming-message inbox (urgent diverts to Desk Urgent).
  // Lifecycle: Add-to-Open-work (delete + deskOpenWork row) / Later
  // (snoozedUntil) / Dismiss (delete).
  screenerItems: defineTable({
    userId: v.id('users'),
    kind: containerKind,
    targetId: v.string(),
    preview: v.string(),
    /** The message that triggered/refreshed this item — drives the hover preview. */
    messageId: v.optional(v.id('messages')),
    snoozedUntil: v.optional(v.number()),
    createdAt: v.number(),
  }).index('by_user', ['userId']),

  // §2.13 — manually curated, kept until closed (closing deletes the row)
  deskOpenWork: defineTable({
    userId: v.id('users'),
    kind: containerKind,
    targetId: v.string(),
    addedAt: v.number(),
  }).index('by_user', ['userId']),
})
