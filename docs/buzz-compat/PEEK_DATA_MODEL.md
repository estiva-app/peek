# Peek — Current Data Model (Phase 1)

**Scope:** the Peek repo only (`/home/miky/peek-app`), at commit `bd9e680`. Buzz was
not consulted for this document.

**Method:** read from source — `convex/schema.ts` is the authoritative table
definition; the function modules in `convex/*.ts` were read to establish what is
stored vs. derived, and `src/api/*` to establish the client seam and identity
handling. Where a fact is a runtime/infrastructure property of Convex rather than
something visible in this repo, it is labelled as such.

> **Caveat on dependencies:** `node_modules/` is not installed in this checkout, so
> the `authTables` definitions spread into the schema were not read from vendored
> source. They are library-owned tables from `@convex-dev/auth` ^0.0.94 and are
> described below as library-provided, not as Peek-authored schema.

---

## 1. Storage substrate

| Property | Value |
| --- | --- |
| Backend | **Convex** (managed cloud). Dev deployment `hallowed-stork-966`, URL injected as `VITE_CONVEX_URL` |
| Model | Document store. Every document gets a system `_id` (opaque, table-scoped) and `_creationTime` (ms) |
| Server code | TypeScript `query` / `mutation` functions in `convex/` — all reads and writes go through these; there is no direct client DB access |
| Blobs | Convex `_storage` system table (avatars + message/reply file uploads) |
| Auth | `@convex-dev/auth` — email + password only |
| HTTP surface | `convex/http.ts` mounts only the auth routes. **No public REST/webhook surface of Peek's own.** |

There is a second, non-Convex mode: when `VITE_CONVEX_URL` is absent (tests,
Storybook, checkouts without a deployment), the seam falls back to static mock
modules in `src/data/*` plus React context override stores
([src/api/store.tsx:29](../../src/api/store.tsx:29)). That path persists nothing and is out
of scope as a data model, but it matters for Phase 4: **the app runs with no
backend at all**, which makes it cheap to bolt an alternative emitter onto the
seam.

---

## 2. Persisted entities

Every table below is from [convex/schema.ts](../../convex/schema.ts). "Derived" columns note
values the UI shows that are deliberately *not* stored.

### 2.0 Library-owned auth tables (`...authTables`)

Spread in at [convex/schema.ts:40](../../convex/schema.ts:40). Owned by `@convex-dev/auth`:
account records, sessions, refresh tokens, verifiers, verification codes, rate
limits. Peek does not define or query them directly — the only touchpoint is
`getAuthUserId(ctx)` ([convex/users.ts:20](../../convex/users.ts:20)). The `users` table that
normally ships with `authTables` is **overridden** by Peek's own definition below.

### 2.1 `users`

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string, **required** | Display name. Collected at sign-up |
| `email` | string? | |
| `image` | string? | Auth-library field; unused by Peek's own flows |
| `emailVerificationTime`, `phone`, `phoneVerificationTime`, `isAnonymous` | ? | Auth-library fields, unused |
| `role` | string? | Free-text job title, shown in People |
| `avatarStorageId` | `Id<_storage>`? | Uploaded avatar blob |
| `seedKey` | string? | Stable fixture key (`'you'`, `'alice'`) — **dev fixture only** |

Indexes: `email`, `phone`, `by_seedKey`.

A user **is** their Convex `users._id`. There is no public key, no external
identifier, and no notion of an agent or bot principal anywhere in the schema.

### 2.2 `topics`

| Field | Type | Notes |
| --- | --- | --- |
| `title` | string | |
| `creatorId` | `Id<users>` | |
| `createdAt` | number (ms) | |
| `seedKey` | string? | Client-generated stable id (`t_<ts>_<seq>`), so the optimistic local object and the record are the same object |

**Derived, never stored:** `isResolved` — true iff the topic has ≥1 message and
every message is `resolved` ([convex/topics.ts:67](../../convex/topics.ts:67)).

Topics are Peek's channel equivalent. Note what is *absent*: no description, no
visibility/private flag, no archive state, no per-topic settings, and **no
workspace/org scoping** — `topics.list` returns every topic in the deployment to
every authenticated caller ([convex/topics.ts:45](../../convex/topics.ts:45)).

### 2.3 `topicMembers`

`topicId` → `userId`, `addedAt`. Indexes `by_topic`, `by_user`.

Membership is an *invite list*, not an access control list. It drives the members
pill and screener fan-out. Posting or replying in a topic silently inserts a
membership row (`ensureTopicMember`, [convex/topics.ts:17](../../convex/topics.ts:17)), and
`join` lets any authenticated user add themselves
([convex/topics.ts:216](../../convex/topics.ts:216)). Nothing reads membership to *deny* a read.

### 2.4 `dmConversations`

| Field | Type | Notes |
| --- | --- | --- |
| `userLowId` / `userHighId` | `Id<users>` | The pair, ordered by lexicographic id so the pair has one canonical row |
| `createdAt` | number | |
| `seedKey` | string? | |

Index `by_pair` (low, high) plus `by_low` / `by_high`. Created on demand on first
DM ([convex/messages.ts:309](../../convex/messages.ts:309)) or first star
([convex/desk.ts:98](../../convex/desk.ts:98)). Addressed client-side by the *partner's*
person key, never by a client-minted conversation id — so a client cannot name a
conversation it is not part of. DMs are strictly 2-party; there is no group DM.

### 2.5 `messages` — one polymorphic table

| Field | Type | Notes |
| --- | --- | --- |
| `parentKind` | `'topic' \| 'dm' \| 'huddle'` | |
| `parentId` | **string** | The parent's `_id` as a string — a union of three Id types cannot share one index, so type safety is restored in code |
| `authorId` | `Id<users>` | |
| `body` | string | Rich text serialized by Tiptap; `@Name` mentions and the `!@` urgent marker are **parsed out of the body text**, not stored as structured fields |
| `createdAt` | number (ms) | |
| `urgent` | boolean? | Computed at write time from `isUrgentBody(body)` |
| `highlightType` | enum? | `insight \| concern \| conclusion \| question \| summary` |
| `resolved` | boolean? | |
| `resolvedById` | `Id<users>`? | |
| `resolutionMessage` | string? | |
| `resolvedByReplyId` | `Id<replies>`? | Set when a `→ msg` reply resolved the parent |
| `resolvedAt` | number? | |
| `attachments` | string[]? | Figma frame ids — static integration mocks |
| `fileAttachments` | object[]? | Real uploads: `{storageId, name, contentType, size}` |
| `seedKey` | string? | Client-generated message id |

Indexes: `by_parent` (parentKind, parentId), `by_seedKey`.

**This is a mutable row, not an event.** `editBody` patches `body` in place with no
version history ([convex/messages.ts:365](../../convex/messages.ts:365)); `setResolution` and
`setHighlight` patch state fields; `remove` hard-deletes the row and cascades into
replies, reactions, watermarks and storage blobs
([convex/messages.ts:462](../../convex/messages.ts:462)). After an edit, the prior text is
unrecoverable. There is no `updatedAt`, no `editedAt`, no tombstone.

### 2.6 `replies`

`messageId`, `authorId`, `body`, `createdAt`, `urgent?`, `highlightType?`,
`attachments?`, `fileAttachments?`, `seedKey?`. Indexes `by_message`, `by_seedKey`.

A reply is a **first-class table, not a message with a parent pointer**. Replies
cannot nest (no reply-to-reply), cannot carry reactions
([convex/messages.ts:272](../../convex/messages.ts:272) — reply reactions stay session-local),
and cannot be resolved themselves. `replyCount` is derived.

### 2.7 `reactions`

One row per (message, user, emoji): `messageId`, `userId`, `emoji`, `createdAt`.
Indexes `by_message`, `by_message_user`. Toggling deletes the row
([convex/messages.ts:279](../../convex/messages.ts:279)) — an un-react leaves no trace.
Aggregation into pills happens at read time
([convex/messages.ts:84](../../convex/messages.ts:84)).

### 2.8 `huddles`

| Field | Type | Notes |
| --- | --- | --- |
| `topicId` | `Id<topics>` | Always parented to a topic |
| `state` | `'active' \| 'resolved'` | |
| `createdById` | `Id<users>` | |
| `createdAt` | number | |
| `originDmId` | `Id<dmConversations>`? | Set when promoted out of a DM |
| `promotedAt` | number? | |
| `seedMessageId` | `Id<messages>`? | The DM message the huddle anchors to — **never copied** |
| `seedKey` | string? | |

A huddle is a sub-thread/breakout inside a topic with its own member list. Promotion
from a DM is by *reference* to the original message, which is a genuinely
event-like design choice — the pointer, not a copy.

### 2.9 `huddleMembers`

`huddleId` → `userId`. Indexes `by_huddle`, `by_user`. Unlike topics, huddle
membership **is** consulted as a visibility rule — but only for unread rollup
([convex/unread.ts:56](../../convex/unread.ts:56), [convex/desk.ts:310](../../convex/desk.ts:310)),
never to block a read of huddle content. `huddles.list` returns all huddles to all
callers ([convex/huddles.ts:21](../../convex/huddles.ts:21)).

### 2.10 `readState`

`userId`, `containerId` (string), `lastReadAt`. Index `by_user_container`.

**Two granularities in one table** (ruling 2026-07-09): `containerId` is either a
topic/DM/huddle `_id` (clears `hasNewMessage`) or a *message* `_id` (clears
`hasNewReply`). Watermarks only move forward ([convex/readState.ts:41](../../convex/readState.ts:41)).
Absence of a row means "never opened", so everything is new.

### 2.11 `stars`

`userId`, `kind` (`topic|dm`), `targetId` (string `_id`), `createdAt`. Index `by_user`.

### 2.12 `screenerItems`

`userId`, `kind`, `targetId`, `preview` (240-char snippet), `messageId?`,
`snoozedUntil?`, `createdAt`. Index `by_user`.

The incoming-attention inbox. **Server-computed and denormalized**: `screenMessage`
([convex/screener.ts:106](../../convex/screener.ts:106)) fans a new message out to every user
whose rules match — DM'd you, @mentioned you, or added-you-to-a-topic-you've-never-opened.
Upserted one row per conversation, carrying a *copy* of the newest preview text.
Urgent messages skip the screener entirely and surface in Desk Urgent instead.

### 2.13 `deskOpenWork`

`userId`, `kind`, `targetId`, `addedAt`. Index `by_user`. Manually curated; closing
deletes the row.

---

## 3. Relationship map

```
users ──creator──> topics ──1:N──> topicMembers ──> users
  │                  │
  │                  ├──1:N──> huddles ──1:N──> huddleMembers ──> users
  │                  │            └── originDmId? ──> dmConversations
  │                  │            └── seedMessageId? ──> messages   (reference, not copy)
  │                  │
  │            (polymorphic parent: parentKind + parentId as string)
  │                  ▼
  ├──author──> messages ──1:N──> replies ──author──> users
  │               │  └──1:N──> reactions ──> users
  │               │  └── resolvedById? / resolvedByReplyId?
  │               │  └── fileAttachments[] ──> _storage
  │               ▼
  └──pair────> dmConversations (userLowId, userHighId)

per-user side tables, all keyed by userId + a stringly-typed targetId:
  readState · stars · screenerItems · deskOpenWork
```

**Referential integrity is application-level only.** The `parentId` /
`targetId` / `containerId` columns are plain strings — Convex enforces nothing
across them, and the cascade deletes in `topics.remove`
([convex/topics.ts:153](../../convex/topics.ts:153)) are hand-written sweeps over full table
scans.

---

## 4. Identity & auth model

**How a user is represented.** A row in `users`, identified by an opaque Convex
`_id`. Display name is a mutable string; there is no stable external identifier, no
public key, no DID, no cryptographic material of any kind. Names are used as
*lookup keys* in several places — `topics.create` and `huddles.create` resolve
invitees by matching `u.name === name` via a full table scan
([convex/topics.ts:101](../../convex/topics.ts:101), [convex/huddles.ts:139](../../convex/huddles.ts:139)) — so
identity is effectively name-addressed at the API boundary in those flows.

**How sessions work.** `@convex-dev/auth` with the `Password` provider only
([convex/auth.ts:12](../../convex/auth.ts:12)). Sign-up collects email + password + full name
and signs straight in. No email verification, no password reset, no OAuth. Session
state lives in the library's `authSessions`/`authRefreshTokens` tables; the client
holds a JWT and `convex/auth.config.ts` trusts `CONVEX_SITE_URL` as the issuer.
Server-side, every function resolves the caller with `getAuthUserId(ctx)`:
`viewerId` returns null when signed out, `viewerOrThrow` throws
([convex/users.ts:19-34](../../convex/users.ts:19)).

**Authorization.** Effectively binary — authenticated or not.

- Queries return empty for signed-out callers; mutations throw.
- **Only two ownership checks exist in the entire backend**: `screener.preview`
  refuses to read another user's inbox ([convex/screener.ts:192](../../convex/screener.ts:192)),
  and `desk.addToOpenWork` checks `item.userId !== you._id`
  ([convex/desk.ts:224](../../convex/desk.ts:224)).
- Everything else is open to any signed-in user. Notably: `dismissScreenerItem`,
  `snoozeScreenerItem` and `removeOpenWorkItem` normalize an id and delete/patch it
  **without checking the row belongs to the caller**
  ([convex/desk.ts:167-248](../../convex/desk.ts:167)); `messages.remove`,
  `messages.editBody`, `topics.remove` and `huddles.remove` never check authorship
  — any authenticated user can edit or delete anyone's message or nuke any topic.
- There is **no workspace/org/tenant concept at all**. One Convex deployment is
  one flat world; every user sees every topic and every huddle.

This is worth stating plainly because it is directly relevant to Phase 3: Peek
currently has *no* permission model to map onto anything.

**Client-side identity.** `useCurrentUser()` ([src/api/currentUser.ts:39](../../src/api/currentUser.ts:39))
returns the authed profile; the seam renders the viewer's own rows with the literal
label `'You'` by id comparison. In mock mode it returns a hardcoded
`{id:'you', name:'You'}`.

---

## 5. Real-time / sync mechanism

**Convex reactive queries over its WebSocket** — that is the entire mechanism.
`useQuery(api.messages.list, …)` subscribes; Convex tracks the read set of each
query function and re-pushes results to every subscribed client when a mutation
touches that set. There is no polling, no Peek-authored WebSocket, no SSE, no
webhook, no message bus, and no outbound integration surface.

Consequences that matter for interop:

- **Sync is Convex-proprietary.** The wire protocol is between the Convex client
  library and Convex's servers. There is no place to tee events to a third party
  short of writing one (a Convex action, a scheduled function, or a change feed).
- **Queries are recomputed, not diffed.** `messages.list` re-shapes every message in
  the container on every change, including a per-message reply and reaction fetch
  ([convex/messages.ts:194](../../convex/messages.ts:194)). The client receives state, never a
  delta.
- **Optimistic writes are local React state.** The override providers in
  `src/api/internal/*` hold the optimistic window until the reactive query catches
  up ([src/api/store.tsx:8](../../src/api/store.tsx:8)). Client-generated `seedKey`s exist
  precisely so the optimistic object and the persisted row are the same object —
  this is the closest thing Peek has to a client-minted stable event id, and it is
  the natural hook for an event id later.

---

## 6. Event-sourced / append-only vs. mutable-row state

**Peek is not event-sourced anywhere.** There is no log, no journal, no revision
table, no soft delete, no `updatedAt`. Every entity is a mutable row that is
patched in place and hard-deleted.

The few structures with append-only *character*:

| Structure | Append-only? | Reality |
| --- | --- | --- |
| `messages` / `replies` | In practice, mostly | Rows are appended and read in `createdAt` order — but `editBody` mutates and `remove` destroys, with no history |
| `reactions` | No | Per-user rows are the right shape, but un-reacting deletes the row instead of appending a retraction |
| `readState` | Monotonic, not append-only | One row per (user, container), patched forward only |
| `huddles.seedMessageId` | Reference semantics | Promotion points at the original message rather than copying — the one genuinely event-ish decision in the model |
| `screenerItems` | No | Upserted in place, carrying a denormalized copy of the preview |

Everything else — resolution, highlight, star, snooze, open-work — is a state field
or a row whose presence *is* the state. Each of those is a completed user action
whose history has been thrown away.

---

## 7. Durable business actions vs. ephemeral/local UI state

Using the requested distinction: **would this belong on a relay (a durable record of
something a person did, that other people's clients need), or is it app-local
viewing state?**

### 7A. Completed business actions — durable, relay-worthy

| Entity | The action | Notes for later mapping |
| --- | --- | --- |
| `users` (profile: name, role, avatar) | "I am this person, presented this way" | Profile metadata. The auth rows underneath are *not* durable — they are credentials |
| `topics` | "I created a channel called X" | Container creation |
| `topicMembers` | "X was added to / joined topic Y" | Currently a row with no author attribution — who added whom is not recorded, only `addedAt` |
| `dmConversations` | "A DM channel exists between A and B" | Arguably derivable from the messages themselves rather than a real action |
| `messages` | "I said this, here" | The core event. Includes the *state changes on it* — resolve, highlight, edit — which are actions in their own right but are currently stored as mutated fields, not as separate acts |
| `replies` | "I said this, in that thread" | Same event as a message in every meaningful respect; separate only by table |
| `reactions` | "I reacted 👍 to that" | Clean per-user action. The retraction is currently a delete |
| `huddles` | "I opened a breakout under this topic" / "I promoted this DM into one" | Container creation with a reference to an origin message |
| `huddleMembers` | "X is in this huddle" | As `topicMembers` |
| File uploads (`fileAttachments` → `_storage`) | "I attached this file" | The *metadata* is durable; the blob is a Convex-hosted URL with no content hash — nothing portable |

### 7B. Ephemeral / local UI state — stays app-local

| Entity | Why it stays local |
| --- | --- |
| `readState` | Per-viewer watermarks. Private, high-churn, meaningless to anyone else |
| `stars` | Personal bookmark. Private to the user; could sync across *their own* devices but is not a shared fact |
| `screenerItems` | **Fully derived.** Every row is recomputable from messages + membership + readState by re-running the `screenMessage` rules. It is a server-side cache of a notification decision, plus a denormalized preview string |
| `deskOpenWork` | Personal to-do curation. Private |
| `snoozedUntil` on a screener item | Private deferral |
| All derived values (`isResolved`, `replyCount`, `hasNewMessage`, `hasNewReply`, unread/urgent summaries) | Computed per-viewer at read time; already not stored |
| Mock-mode override providers, theme, dev auto-login opt-out | Pure client state (`localStorage`/`sessionStorage`, [src/lib/theme.tsx:29](../../src/lib/theme.tsx:29)) |
| Figma frames, Linear issues, `APP_FILES` (`src/data/*`) | Static third-party integration mocks. Not persisted at all, not real data |

### 7C. The awkward middle

Three things resist the split and will need an explicit ruling:

1. **`urgent` and `@mentions`.** Both are *parsed out of body text* at write time
   (`isUrgentBody`, `mentionsUser` — [convex/screener.ts:30-37](../../convex/screener.ts:30)).
   The durable fact ("this message is urgent", "this names Alice") exists only as a
   substring convention plus a derived boolean. Any protocol that wants structured
   mentions needs Peek to promote these to real fields.
2. **Resolution.** `resolved` + `resolvedById` + `resolutionMessage` + `resolvedAt`
   is a completed business action by *someone other than the message author*, stored
   as a mutation of the author's row. On an append-only substrate this has to become
   a separate act referencing the message.
3. **The screener.** Denormalized and per-user, so it reads as local state — but it
   encodes a real routing decision. Recommendation: treat it as local (7B), since it
   is fully recomputable, and recompute rather than replicate it.

---

## 8. Findings that will constrain any protocol mapping

Recorded here because they were found while reading, and they are the facts most
likely to bite in Phase 3:

1. **No org/workspace/tenant boundary exists.** Everything is one flat deployment.
   Any mapping to a per-org relay has to *invent* the boundary.
2. **No cryptographic identity.** No keypairs anywhere. Users are opaque row ids,
   and several flows address people by display-name string match.
3. **Rows are mutable and hard-deleted, with no history.** Edits destroy prior
   content; deletes cascade and leave no tombstone.
4. **Replies are a separate table from messages**, with different capabilities
   (no reactions, no resolution, no nesting).
5. **Ids are opaque and deployment-local.** `_id`s and `seedKey`s carry no meaning
   outside this deployment; `parentId`/`targetId`/`containerId` are untyped strings.
6. **`body` is Tiptap-serialized text with in-band conventions** (`@Name`, `!@`,
   `→ msg`) rather than structured content.
7. **Authorization is essentially absent** — see §4. Several mutations do not check
   ownership at all.
8. **The only sync path is Convex's proprietary reactive protocol**, with no
   outbound hook.

---

## Appendix — file map

| Concern | File |
| --- | --- |
| Schema (all tables) | [convex/schema.ts](../../convex/schema.ts) |
| Identity / viewer resolution | [convex/users.ts](../../convex/users.ts) |
| Auth provider config | [convex/auth.ts](../../convex/auth.ts), [convex/auth.config.ts](../../convex/auth.config.ts) |
| Messages (+ reactions, resolution, edits) | [convex/messages.ts](../../convex/messages.ts) |
| Replies | [convex/replies.ts](../../convex/replies.ts) |
| Topics + membership + cascade delete | [convex/topics.ts](../../convex/topics.ts) |
| Huddles + DM promotion | [convex/huddles.ts](../../convex/huddles.ts) |
| Read watermarks | [convex/readState.ts](../../convex/readState.ts) |
| Screener fan-out rules | [convex/screener.ts](../../convex/screener.ts) |
| Desk (stars, open work, urgent) | [convex/desk.ts](../../convex/desk.ts) |
| Unread derivation | [convex/unread.ts](../../convex/unread.ts) |
| Client data seam (the only import path for app data) | [src/api/index.ts](../../src/api/index.ts) |
| Convex client + provider composition | [src/api/store.tsx](../../src/api/store.tsx) |
| Auth gate | [src/auth/AuthGate.tsx](../../src/auth/AuthGate.tsx) |
