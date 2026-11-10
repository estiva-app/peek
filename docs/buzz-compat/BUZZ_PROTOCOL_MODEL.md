# Buzz — Protocol & Event Model (Phase 2)

**Scope:** the Buzz repo only (`/home/miky/buzz`, `github.com/block/buzz`), at commit
`b78a684c`. Peek was not consulted for this document, and `PEEK_DATA_MODEL.md` was
not re-read while writing it.

**Method:** `crates/buzz-core/src/kind.rs` is the self-declared authoritative kind
registry and is treated as such. Everything about *behaviour* — what the relay
enforces, what it merely accepts — is cited to the handler that implements it.
Where the repo's prose docs (`VISION_*.md`, `README.md`) make a claim, that claim
is either confirmed against code or marked as unverified.

**Not built:** the Rust workspace was not compiled for this phase (`Cargo.lock` is
present, `target/` is not). All statements are from source reading. Phase 4 covers
running it.

---

## 1. Shape of the system

Buzz is **a Nostr relay that is also the application backend**. It is not a client
that talks to someone else's relay: `crates/buzz-relay` is an Axum server exposing

- a **Nostr WebSocket** (`EVENT` / `REQ` / `CLOSE` / `AUTH` / `COUNT`),
- a **REST/bridge API** (`crates/buzz-relay/src/api/`) for the first-party clients,
- **Blossom media** endpoints (`PUT /media/upload`, `GET /media/{sha256}.{ext}`),
- **git** endpoints (`crates/buzz-relay/src/api/git/`),

backed by Postgres (`crates/buzz-db`) and Redis (`crates/buzz-pubsub`, for presence,
typing and cross-node fan-out). Clients: `web/`, `desktop/` (Tauri), `mobile/`,
`admin-web/`, plus `crates/buzz-cli`.

The relay holds its own keypair (`state.relay_keypair`) and **signs events itself**
for state it owns — group metadata, membership notifications, snapshots. That is a
structural fact worth stating early: some of Buzz's model is not user-signed data
at all, it is relay-signed projection.

---

## 2. Event kinds

Source: [`crates/buzz-core/src/kind.rs`](/home/miky/buzz/crates/buzz-core/src/kind.rs)
(784 lines; `ALL_KINDS` at line 488 is the registry, with a `no_duplicate_kind_values`
test). Payload shapes below are from
[`crates/buzz-sdk/src/builders.rs`](/home/miky/buzz/crates/buzz-sdk/src/builders.rs)
where a builder exists.

### 2.1 Reused standard NIPs

Buzz reuses far more of the standard than it invents. Kinds it takes as-is:

| Kind | NIP | Use in Buzz |
| --- | --- | --- |
| 0 | NIP-01 | Profile metadata. Synced into `users` (display_name, avatar, about, NIP-05) |
| 1 | NIP-01 | Text note (flat reply model only — `build_note`, builders.rs:738) |
| 3 | NIP-02 | Contact list |
| 5 | NIP-09 | Deletion request. Self-authored, **plus the owning human deleting their agent's events** |
| 7 | NIP-25 | Reaction. Content is the emoji; `["e", target]`. Channel is derived from the *target's* `#e` tag — a client-supplied `#h` is ignored |
| 1059 | NIP-17 | Gift-wrapped DM |
| 1063 | NIP-94 | File metadata |
| 1617/1618/1619/1621/1630-1633 | NIP-34 | git patch / PR / PR update / issue / status |
| 1984 | NIP-56 | Report to moderators |
| 9000-9022 | NIP-29 | Group admin verbs (see below) |
| 10000/10001/10003/10030/30000/30003/30030 | NIP-51, NIP-30 | Mute / pin / bookmark / emoji lists and sets |
| 10002 | NIP-65 | Relay list metadata |
| 22242 | NIP-42 | AUTH (never stored) |
| 24242 | BUD-01 | Blossom upload auth |
| 27235 | NIP-98 | HTTP auth |
| 30023 | NIP-23 | Long-form content |
| 30617/30618 | NIP-34 | Repo announcement / repo state |
| 30315 | NIP-38 | User status |
| 39000/39001/39002/39003 | NIP-29 | Addressable group metadata / admins / members / roles |

**NIP-29 is the backbone.** Channels are NIP-29 groups; the `h` tag carries a
channel **UUID**. `NOSTR.md:1` states third-party NIP-29 clients connect directly
and the older NIP-28 proxy has been removed.

### 2.2 Custom kinds Buzz defines

Grouped as the registry groups them. "Payload" is from the SDK builder where one
exists; otherwise from the registry doc comment and handler.

#### Stream messaging (the chat core)

| Kind | Name | Payload |
| --- | --- | --- |
| **9** | `KIND_STREAM_MESSAGE` | *NIP-29 group chat.* `content` = message text (max 64 KiB); tags: `["h", <channel-uuid>]` required, optional NIP-10 `["e", …]` thread tags, `["p", <hex>]` mentions (deduped, max 50), `["broadcast","1"]`, `imeta` media tags. [`build_message`, builders.rs:219](/home/miky/buzz/crates/buzz-sdk/src/builders.rs) |
| 40002 | `KIND_STREAM_MESSAGE_V2` | Rich content. On the wire but **Buzz-only** — no standard NIP-29 client renders it (`NOSTR.md`) |
| 40003 | `KIND_STREAM_MESSAGE_EDIT` | Edit. `content` = new text; tags `["h",…]`, `["e", <target>]`. [`build_edit`, builders.rs:378](/home/miky/buzz/crates/buzz-sdk/src/builders.rs). Buzz-only |
| 40004 | `KIND_STREAM_MESSAGE_PINNED` | Pinned message |
| 40005 | `KIND_STREAM_MESSAGE_BOOKMARKED` | Bookmarked message |
| 40006 | `KIND_STREAM_MESSAGE_SCHEDULED` | Scheduled for future delivery |
| 40007 | `KIND_STREAM_REMINDER` | Reminder on a message/time |
| 40008 | `KIND_STREAM_MESSAGE_DIFF` | Unified-diff message + `DiffMeta` (`repo_url` must be http(s)) |
| 40099 | `KIND_SYSTEM_MESSAGE` | Channel state change (join, leave, rename) |
| 40100 | `KIND_CANVAS` | Channel canvas — a shared rich document. Also materialized as `channels.canvas` |

Note the registry's own history comments: V1 used 10001/10002/10004 for messages —
**replaceable-range kinds, called out in-code as "wrong"** — and forum kinds used
30001–30003. The current numbering is a deliberate correction.

#### Relay-only sidecars (client submission rejected — `is_relay_only_kind`, kind.rs:663)

| Kind | Name |
| --- | --- |
| 40901 | `KIND_CHANNEL_SUMMARY` — channel metadata with computed fields |
| 40902 | `KIND_PRESENCE_SNAPSHOT` — bulk presence |
| 13534 | `KIND_NIP43_MEMBERSHIP_LIST` — relay membership snapshot |
| 30622 | `KIND_DM_VISIBILITY` — per-viewer hidden-DM set (NIP-DV) |
| 39005 | `KIND_THREAD_SUMMARY` — `{reply_count, descendant_count, last_reply_at, participants}`, synthesized at query time, never stored |
| 39006 | `KIND_WINDOW_BOUNDS` — `{has_more, next_cursor}`; "the only authority on exhaustion — clients must not infer `has_more` from row counts" |

39005/39006 are worth flagging: **derived read-model overlays delivered as signed
events**. They are Buzz's answer to "reply count" and "pagination" without storing
either as user data.

#### Direct messages (41000-41999)

| Kind | Name |
| --- | --- |
| 41001 | `KIND_DM_CREATED` |
| 41010 | `KIND_DM_OPEN` — open/create a DM; `p` tags = participants ([`build_dm_open`, builders.rs:1544](/home/miky/buzz/crates/buzz-sdk/src/builders.rs)) |
| 41011 | `KIND_DM_ADD_MEMBER` — DMs can become group DMs |
| 41012 | `KIND_DM_HIDE` — hide from sidebar |

A DM is **not a special table**: it is a channel with `channel_type='dm'` and
`visibility='private'` ([`crates/buzz-db/src/dm.rs:3`](/home/miky/buzz/crates/buzz-db/src/dm.rs)),
carrying a `participant_hash`. Message *contents* go over NIP-17 gift wraps
(kind 1059); the channel exists so discovery, membership and sidebar state work.

#### Membership notifications

| Kind | Name |
| --- | --- |
| 44100 | `KIND_MEMBER_ADDED_NOTIFICATION` — relay-signed, `p`=target, `h`=channel |
| 44101 | `KIND_MEMBER_REMOVED_NOTIFICATION` — relay-signed |
| 8000/8001 | NIP-43 member added / removed (relay-level, not channel-level) |
| 28936 | NIP-43 user leave request (user-signed, ephemeral) |

#### Agents

| Kind | Name | Notes |
| --- | --- | --- |
| 10100 | `KIND_AGENT_PROFILE` | Replaceable, **agent-authored**. Content is JSON; `channel_add_policy` is required — the handler rejects the event without it ([`handle_agent_profile`, side_effects.rs:1078](/home/miky/buzz/crates/buzz-relay/src/handlers/side_effects.rs)) |
| 30174 | `KIND_AGENT_ENGRAM` | NIP-AE. Encrypted agent memory; `d_tag` is an HMAC over the agent↔owner conversation key |
| 30175 | `KIND_PERSONA` | NIP-AP. Owner-authored persona definition; `d_tag` = plaintext slug |
| 30176 | `KIND_TEAM` | NIP-AP. Owner-authored grouping of personas |
| 30177 | `KIND_MANAGED_AGENT` | NIP-AP. Owner-authored; `d_tag` = the agent's pubkey. Explicitly an **opt-IN allowlist projection** — must never carry the agent's secret key, NIP-OA auth tag, env vars or runtime fields, "since these events are world-readable on the relay" |
| 44200 | `KIND_AGENT_TURN_METRIC` | NIP-AM. Append-only per-turn token usage, NIP-44 encrypted to the owner, `p`-gated |
| 24200 | `KIND_AGENT_OBSERVER_FRAME` | Ephemeral encrypted telemetry/control frame |
| 24243 | `KIND_NOSTR_IDENTITY_BINDING` | One-time identity binding proof, ephemeral, never stored |

Agent shutdown is explicitly **a convention, not a kind**: the owner sends a kind:9
with content `"!shutdown"` and a `#p` tag naming the agent (kind.rs:344).

#### Agent job protocol (43000-43999)

43001 request · 43002 accepted · 43003 progress · 43004 result · 43005 cancel ·
43006 error. The registry states outright: *"Not using NIP-90 kinds (5000–6999) —
Buzz requires auth chains (depth ≤ 3, breadth ≤ 10)."*

#### Workflows (46000-46999) + 30620

30620 `KIND_WORKFLOW_DEF` (parameterized replaceable, `d`=workflow uuid); 46020
trigger; 46030/46031 approval grant/deny; and an execution event stream
46001–46012 (triggered, step started/completed/failed, completed, failed,
cancelled, approval requested/granted/denied). `is_workflow_execution_kind`
(kind.rs:632) excludes these from triggering workflows — loop prevention.

#### Forum (45000-45999)

45001 post · 45002 vote (`content` = `"+"`/`"-"`) · 45003 comment. All `h`-tagged.

#### Huddles — audio/video (48100-48106)

48100 started · 48101 participant joined · 48102 participant left · 48103 ended ·
48106 guidelines. Plus ephemeral 24810 `KIND_HUDDLE_REACTION` (emoji burst,
channel-scoped, never stored).

> ⚠️ **Terminology trap for anyone mapping another product onto this:** a Buzz
> "huddle" is a live A/V session, not a sub-thread.

#### Moderation & governance

1984 report (NIP-56) · 9040 ban · 9041 unban · 9042 timeout · 9043 untimeout ·
9044 resolve report. These are *commands*: validated and executed directly,
**never stored as events**, each writing a `moderation_actions` audit row
(kind.rs:216). 9030–9033 are NIP-43 relay-membership admin commands. 9035/9036 +
8002/8003/13535 are NIP-IA identity archival. 48001 `KIND_AUDIT_ENTRY`.

#### Other

42000 product feedback (sidecarred, never stored as an event) · 20001 presence ·
20002 typing · 24134 NIP-AB device pairing · 30078 NIP-RS read state · 30300 NIP-ER
reminder · 30350 NIP-PL push lease.

### 2.3 Buzz's own NIP drafts

`docs/nips/` holds 14 drafts: **NIP-AA, AE, AM, AO, AP, CW, DV, ER, GS, IA, OA, PL,
RS, WP**. These are the proprietary surface, written as specs rather than as
undocumented behaviour — NIP-OA in particular is written to be implementable by
anyone (§4).

---

## 3. Storage semantics

Three replacement regimes, all standard-Nostr:

- **Regular** — append-only, never replaced (kind 9, 44200, forum, jobs).
- **Replaceable** (0, 3, 41, 10000–19999) — one per `(pubkey, kind)`.
- **Parameterized replaceable** (30000–39999) — one per `(pubkey, kind, d_tag)`,
  latest `created_at` wins.
- **Ephemeral** (20000–29999) — never stored; Redis pub/sub only.

Deletion is NIP-09 tombstones (kind 5) or admin kind 9005 — *not* row removal:
`get_event_by_id_including_deleted` (side_effects.rs:215) exists precisely because
deleted events are retained. **Edits are new events (40003) pointing at the target
with an `e` tag; the original event is never mutated.** Both are core properties of
the substrate, not Buzz choices.

---

## 4. Identity model

### 4.1 Human keypairs

A human is a **secp256k1 keypair**; the x-only pubkey *is* the identity. Auth is
NIP-42: the relay issues a challenge proactively, the client returns a signed
kind:22242 event, and `verify_auth_event` does **pure crypto verification — no API
tokens, no JWT, no DB token lookups** ([`handlers/auth.rs:42`](/home/miky/buzz/crates/buzz-relay/src/handlers/auth.rs)).
kind:22242 is never stored. NIP-98 (27235) covers HTTP, BUD-01 (24242) covers media
upload.

Profile is kind:0, synced into `users`. NIP-05 handles must canonicalize to the
relay's own domain — off-domain or invalid handles are silently cleared (`NOSTR.md`).

`BUZZ_PUBKEY_ALLOWLIST=true` gates which external pubkeys may authenticate, checked
against a `pubkey_allowlist` table, **fail-closed** on DB error.

### 4.2 Agent keypairs

An agent has **its own independent keypair** and authors its own events. It is not
a delegated signer and never signs as the human. In `users`, an agent is exactly a
row whose `agent_owner_pubkey IS NOT NULL` — that column *is* the agent
discriminator ([`crates/buzz-db/src/usage.rs:40`](/home/miky/buzz/crates/buzz-db/src/usage.rs)).

### 4.3 The second signature: NIP-OA "Owner Attestation" — exact mechanics

Spec: [`docs/nips/NIP-OA.md`](/home/miky/buzz/docs/nips/NIP-OA.md).
Implementation: [`crates/buzz-sdk/src/nip_oa.rs`](/home/miky/buzz/crates/buzz-sdk/src/nip_oa.rs).

**The tag.** An event may carry zero or one `auth` tag, with exactly four elements:

```json
["auth", "<owner-pubkey-hex>", "<conditions>", "<sig-hex>"]
```

More than one `auth` tag ⇒ the event is treated as having *no* valid tag
(`extract_auth_tag_json`, [auth.rs:26](/home/miky/buzz/crates/buzz-relay/src/handlers/auth.rs)).

**The preimage.** This is the whole mechanism:

```
preimage = "nostr:agent-auth:" || agent_pubkey_hex || ":" || conditions
message  = SHA256(preimage)
sig      = BIP-340 Schnorr(message, owner_secret_key)
```

`build_preimage` at [nip_oa.rs:110](/home/miky/buzz/crates/buzz-sdk/src/nip_oa.rs),
`hash_preimage` at :114, signing in `compute_auth_tag` at :143, verification in
`verify_auth_tag` at :180.

**Conditions** are `&`-separated clauses, each `kind=<0-65535>`,
`created_at<<t>` or `created_at><t>`, canonical base-10, no whitespace, no empty
clauses (`validate_conditions`, nip_oa.rs:36). The exact string is part of the
preimage — implementers **must not** reorder, dedupe or normalize it. Empty string
is valid and imposes no constraint. Self-attestation (owner == agent) is rejected
at both compute and verify.

**What it means — and doesn't.** NIP-OA explicitly separates itself from NIP-26:
*"NIP-26 assigns the event to the delegator semantically, and that semantic MUST
NOT be reused for agent provenance."* An event with a valid `auth` tag **remains
authored by `event.pubkey`** (the agent). Clients MUST NOT display the owner as
author, MUST NOT merge the event into owner-authored timelines or pubkey-filtered
results, and SHOULD display provenance only as something distinct from authorship
("authorized by \<owner\>"). The tag is a **reusable capability** — the same tag may
appear on many events by that agent, provided each satisfies the conditions.

**The relay's use of it.** Per the spec, relays need no changes and MUST NOT rewrite
authorship. Buzz's relay nevertheless *consumes* it, at the connection level:

1. On NIP-42 AUTH, the `auth` tag is extracted from the signed AUTH event itself —
   integrity-protected by the event's own signature, so tampering fails NIP-42
   before the tag is ever inspected (auth.rs:75-78).
2. `extract_nip_oa_owner` verifies it via `nip_oa::verify_auth_tag`
   ([api/mod.rs:160](/home/miky/buzz/crates/buzz-relay/src/api/mod.rs)).
3. `materialize_nip_oa_owner` (api/mod.rs:174) persists the relationship:
   `ensure_user` for both principals, then `set_agent_owner`, which is a
   **conditional UPDATE — `WHERE agent_owner_pubkey IS NULL`** — making
   *first-write-wins* atomic with no TOCTOU race
   ([`user.rs:291`](/home/miky/buzz/crates/buzz-db/src/user.rs)). An existing
   mapping is accepted only if it names the same owner.
4. Once materialized, `is_agent_owner(community, target, actor)`
   ([user.rs:354](/home/miky/buzz/crates/buzz-db/src/user.rs)) is the authorization
   primitive. It powers, among others, **the owning human's right to delete their
   agent's events** (`validate_standard_deletion_event`, side_effects.rs:179).
5. It also drives a **ban cascade**: a ban on the cryptographically-proven owner
   cascades to its agents; a ban on an agent is agent-only. The owner is read from
   the self-proving auth tag with no DB round-trip (auth.rs:96-106).

**Security properties as stated.** Owner and agent keys are independent; agent-key
compromise does not imply owner-key compromise. The spec is candid that
`created_at<…` clauses constrain a *self-declared* field the agent controls, so
they are not wall-clock expiry — anyone needing freshness must enforce it
separately. Including the tag deliberately links owner and agent keys, and
verifiers may correlate on that pair.

**Related but separate:** `effective_message_author`
([ingest.rs:729](/home/miky/buzz/crates/buzz-relay/src/handlers/ingest.rs),
side_effects.rs:2271) resolves the real actor behind a *relay-signed* event via an
`actor` or `p` tag. That is workflow attribution, not NIP-OA.

---

## 5. Relay architecture — one relay, N communities, no cross-org sync

Three separate questions get conflated by the prose docs, so they are separated here.

### 5.1 Is it one relay per org?

**No — a deployment can host many communities, but the boundary is the host.**
`crates/buzz-relay/src/tenant.rs` is "row-zero host binding": the community is
resolved from the connection host *before any handler observes tenant data*.

- `communities` is a real table with `UNIQUE(lower(host))`
  ([`schema/schema.sql:53`](/home/miky/buzz/schema/schema.sql)); creating one is an
  INSERT, never DDL. `community_id UUID NOT NULL REFERENCES communities(id)` is
  carried on every scoped row.
- Host resolution **fails closed**: an unmapped host is rejected with a *generic*
  error, and there is "deliberately no path that yields a default or fallback
  community" (tenant.rs, `BindError::UnmappedHost`).
- A client-supplied community — a token stamp or an `h` tag — "may narrow or
  authenticate authority but can never override the host-derived community".
- `docs/multi-tenant-relay.md` is a formal spec (TLA+ / Tamarin) treating isolation
  as non-interference; the schema and tenant module show it is implemented, not
  aspirational.

`NOSTR.md` states the wire format deliberately does **not** grow a tenant tag: a
pubkey can join multiple communities and repost its profile in each, but *"DMs and
profiles do not inherit across community domains."*

### 5.2 Is there multi-relay sync?

**Between processes of the same deployment, yes. Between organizations, no.**

`crates/buzz-relay-mesh` is an **inter-pod QUIC mesh** (iroh endpoint per relay
runtime, scuttlebutt membership gossip, fenced wire contract) whose stated purpose
is moving tunnel traffic *between pods of one relay cluster*
([`lib.rs:1-20`](/home/miky/buzz/crates/buzz-relay-mesh/src/lib.rs)). Its own docs
say single-instance deployments never construct a mesh, and *"mesh membership is a
hint; the Redis fenced generation is the arbiter."* This is horizontal scaling.

`VISION_MESH.md` uses "mesh" for something else again — **sharing idle GPUs** among
members of one community for LLM inference. Not event replication either.

### 5.3 Cross-org replication — explicit finding

**There is none.** Searching the whole repo for `federat*` returns exactly one hit,
and it is a parenthetical in a Helm chart README
([`deploy/charts/buzz/README.md:115`](/home/miky/buzz/deploy/charts/buzz/README.md)):
"Rotating it = new identity (federation peers will not recognize the relay)" —
referring to a capability that has no implementation in this tree. There is no
outbound relay client, no outbox, no upstream/mirror configuration, and no
event-forwarding path from one Buzz deployment to another.

kind:10002 (NIP-65 relay list metadata) *is* accepted and stored, so users can
*declare* other relays — but nothing in Buzz acts on that declaration.

The practical consequence: **a Buzz community is reachable only by connecting to
its host.** Two orgs on two Buzz deployments have no protocol-level path to see
each other's events. Any client can of course connect to both and merge locally,
because it is all standard Nostr — but that is client-side aggregation, not
replication, and DMs and profiles explicitly do not carry across.

---

## 6. Permission model — relay-enforced, not convention

This is where Buzz diverges hardest from vanilla Nostr, where relays are typically
dumb stores.

**Channels.** Two visibility modes, `open` (searchable, anyone can join) and
`private` (hidden, invite-only) — [`crates/buzz-db/src/channel.rs:3`](/home/miky/buzz/crates/buzz-db/src/channel.rs).
Channel types include `stream`, `forum`, `dm`. Rows carry `archived_at`,
`deleted_at`, `topic_required`, `max_members`, `ttl_seconds`, plus `topic`/`purpose`
with setter and timestamp.

**Write path.** `required_scope_for_kind`
([ingest.rs:198](/home/miky/buzz/crates/buzz-relay/src/handlers/ingest.rs)) maps every
kind to a required scope — `UsersWrite`, `MessagesWrite`, `ChannelsWrite`,
`AdminChannels`, `AdminUsers` — and **returns `Err` for unknown kinds, which the
relay rejects**. Buzz does not accept arbitrary Nostr events. kind:9002 even splits
dynamically: an `archived` tag demands `AdminChannels`, otherwise `ChannelsWrite`.

**Read path.** `filter_fanout_by_access`
([handlers/event.rs:115](/home/miky/buzz/crates/buzz-relay/src/handlers/event.rs)) is
the single chokepoint for delivery, and it fails closed at every step:

1. Receiver-side tenant label — a connection bound to community A may never receive
   an event labelled community B, even from a stale or injected match.
2. `AUTHOR_ONLY_KINDS` (NIP-ER reminders, NIP-PL push leases) are delivered only to
   the event's own author.
3. For a `private` channel, per-connection `is_member_cached`.
4. **If visibility cannot be determined, delivery is dropped** — "do not leak a
   possibly-private channel's events".

**`P_GATED_KINDS`** (kind.rs:139) — observer frames, membership notifications, gift
wraps, DM visibility, agent turn metrics — are readable only by pubkeys named in the
event's `#p` tag, enforced at the *filter* layer: a REQ that could match one of
these is closed unless the filter's `#p` exactly equals the authenticated reader's
pubkey. For stored kinds in this set the storage layer additionally writes a **NULL
`search_tsv`** so they cannot surface through NIP-50 full-text search, with a
regression test named in the comment
(`p_gated_persistent_kinds_have_storage_null_tsvector`).

**`RESULT_GATED_KINDS`** close the kindless `{ids:[…]}` read path: even a reader who
knows an event id must match the `#p` tag.

**Roles.** `MemberRole` (owner / admin / member) per channel, plus relay-level
membership via NIP-43 (9030–9032) and community moderation (9040–9044) with
ban/timeout state checked at AUTH time — before the allowlist and membership gates,
so *"a ban must block connection auth even for open channels — enforcement is
structural, not filtered later"* (auth.rs:93-99).

**Per-user policy.** `channel_add_policy` ∈ `anyone | owner_only | nobody`
([user.rs:374](/home/miky/buzz/crates/buzz-db/src/user.rs)) — who may add *you* to a
channel. Agents publish theirs in kind:10100, where it is a required field.

**One honest caveat, stated by Buzz itself:** the NIP-29 kind:39000 `closed` tag is
*always* emitted by convention, but *"open channels are still readable/writable by
non-members at runtime. The tag reflects the membership model, not access
enforcement"* (`NOSTR.md`). So the discovery event overstates enforcement for open
channels; enforcement for private ones is real and is at the relay.

---

## 7. Folders / files / components equivalents

There is **no folder tree and no generic file/component hierarchy.** The
container is the channel, and the only nesting is `channel → thread`. What exists
instead:

| Concern | Mechanism |
| --- | --- |
| **Threads** | NIP-10 `["e", <root>, "", "reply"]`. WS-submitted replies create `thread_metadata` atomically; **unknown parents are rejected**. `ThreadRef` in the SDK; kind:39005 supplies reply counts as a synthesized overlay |
| **Documents** | kind:40100 `KIND_CANVAS` — one shared rich document per channel, also stored as `channels.canvas`. Not a file tree; a canvas per room |
| **Long-form** | kind:30023 (NIP-23), parameterized replaceable, author-owned, stored globally (`channel_id = NULL`) |
| **File blobs** | **Blossom** — content-addressed by sha256. `PUT /media/upload` (BUD-02), `GET /media/{sha256}.{ext}` (BUD-01), `crates/buzz-media` (storage, validation, thumbnails, bucket index). Attachment to a message is via `imeta` tags; kind:1063 (NIP-94) exists for standalone file metadata |
| **Code** | **git is first-class** — NIP-34 repo announcements (30617), repo state (30618), patches (1617), PRs (1618/1619), issues (1621), statuses (1630–1633), served over the relay's own git endpoints, with `git-credential-nostr` and `git-sign-nostr` for Nostr-keyed git auth and signing. `docs/git-on-object-storage.md` covers the backing store |
| **Automation** | Workflow definitions (30620) + an execution event stream (46001–46012) |
| **Agent config** | Personas (30175), teams (30176), managed agents (30177) — addressable, owner-authored, world-readable-by-design |

`VISION_PROJECTS.md` describes a projects concept; it was **not** verified against
code for this document, and no project entity appears in the kind registry.

---

## 8. Findings that will matter for any interop mapping

1. **Kind 9 + `h`-tagged channel UUID is the entire chat core.** One kind, one
   required tag, standard NIP-29. That is a small and well-defined target.
2. **Channel ids are UUIDs, not opaque local ids** — client-mintable and stable.
3. **Ingest allowlists kinds.** Unknown kinds are rejected outright — there is no
   "just write whatever" path.
4. **NIP-42 is mandatory and pure-crypto.** No password, no bearer token, no session
   cookie. An emitting system must hold a secp256k1 key.
5. **Authorization is relay-enforced and fails closed**, at both write (scopes) and
   read (fan-out filter, p-gating, search suppression).
6. **Agent identity is a second independent keypair plus a reusable Schnorr
   attestation**, never delegated signing — and the relay materializes it into a
   first-write-wins DB column.
7. **Edits and deletes are new events**, never mutations of the original.
8. **Derived state ships as relay-signed synthesized events** (39005/39006, 40901,
   40902) rather than as fields on user data.
9. **No cross-org replication exists.** The host is the boundary; the mesh is
   intra-cluster; federation is one word in a Helm README.
10. **The community boundary lives outside the wire format** — resolved from the
    connection host, deliberately never a tag.

---

## Appendix — file map

| Concern | Path |
| --- | --- |
| Kind registry (authoritative) | `crates/buzz-core/src/kind.rs` |
| Event builders / payload shapes | `crates/buzz-sdk/src/builders.rs` |
| NIP-OA implementation | `crates/buzz-sdk/src/nip_oa.rs` |
| NIP-OA spec | `docs/nips/NIP-OA.md` |
| Buzz NIP drafts (14) | `docs/nips/` |
| NIP-42 AUTH + ban cascade | `crates/buzz-relay/src/handlers/auth.rs` |
| Ingest scopes + kind allowlist | `crates/buzz-relay/src/handlers/ingest.rs` |
| Fan-out access filter | `crates/buzz-relay/src/handlers/event.rs` |
| Side effects (agent profile, deletions) | `crates/buzz-relay/src/handlers/side_effects.rs` |
| Host→community binding | `crates/buzz-relay/src/tenant.rs` |
| Agent↔owner persistence | `crates/buzz-db/src/user.rs` |
| Channels / visibility / roles | `crates/buzz-db/src/channel.rs` |
| DMs as private channels | `crates/buzz-db/src/dm.rs` |
| Postgres schema | `schema/schema.sql`, `migrations/` |
| Inter-pod QUIC mesh | `crates/buzz-relay-mesh/` |
| Third-party client compatibility matrix | `NOSTR.md` |
| Multi-tenant formal spec | `docs/multi-tenant-relay.md` |
