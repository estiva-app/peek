# Peek ↔ Buzz — Compatibility & Gap Analysis (Phase 3)

Reads [`PEEK_DATA_MODEL.md`](PEEK_DATA_MODEL.md) and
[`BUZZ_PROTOCOL_MODEL.md`](BUZZ_PROTOCOL_MODEL.md) together. Claims about the
channels + messages surface have been checked against Buzz's real code — see
[`INTEROP_PROOF.md`](INTEROP_PROOF.md).

---

## 0. Input

Graded against **NfB RFC 0.2** (Nostr for Business), supplied directly. The RFC is
prose describing three architectural layers rather than a numbered decision list, so
§3 decomposes it into the commitments it actually makes and grades each. Where the
RFC is explicitly deferred ("detailed consolidation model deferred to the AI RFC",
"and later agents"), that is noted rather than graded.

Everything outside §3 was written before the RFC arrived and is unchanged — §5's
cross-org finding was reached independently and turns out to hit the RFC's single
most load-bearing commitment.

---

## 1. Entity mapping table

Legend for **Verdict**: **1:1** = maps onto an existing Buzz kind with no semantic
loss · **1:1 lossy** = existing kind, but Peek data is dropped or downgraded ·
**New kind** = no Buzz kind carries this · **Local** = should not go on a relay
at all.

### 1A. Durable business actions (Peek §7A)

| Peek entity | Nearest Buzz kind | Structural delta | Verdict | Effort |
| --- | --- | --- | --- | --- |
| `users` (name, role, avatar) | **kind:0** NIP-01 metadata | `name`→`display_name`, `role`→`about` (or a custom field), avatar must become a URL. Buzz also syncs NIP-05, which must canonicalize to the relay's domain | 1:1 lossy | **Small** (fields) |
| `users` (identity itself) | **secp256k1 keypair** | Peek has *no key material anywhere*. Buzz identity **is** the pubkey | ✗ no mapping | **Large** |
| `authAccounts` / `authSessions` (Convex Auth password) | **NIP-42** (kind:22242) | Buzz auth is pure Schnorr challenge–response — "no API tokens, no JWT, no DB token lookups" (`handlers/auth.rs:42`). Email+password has no counterpart | ✗ conflict, see §3.1 | **Large** |
| `topics` | **kind:9007** create-group (+ relay-signed **39000** metadata) | Needs a channel **UUID** (Peek ids are opaque) and a `visibility` Peek does not have. `title`→`name`. **Proven byte-identical** in Phase 4 | 1:1 | **Small** |
| `topicMembers` | **kind:9000** put-user (+ **39002**, **44100**) | Peek's row records only `addedAt` — *who* added whom is not stored. Buzz's add is an authored, authorized event. Peek's implicit "posting joins you" becomes an explicit 9000 or 9021 | 1:1 lossy | **Medium** |
| `messages` where `parentKind='topic'` | **kind:9** stream message | **None.** `h`-tag channel UUID + content. Verified structurally identical to `build_message` | **1:1** | **Small** |
| `messages` where `parentKind='huddle'` | **kind:9** (if huddles become channels) | Depends entirely on the huddle decision below | 1:1 | **Small** (after huddles) |
| `messages` where `parentKind='dm'` | **kind:1059** NIP-17 gift wrap | Peek stores DM bodies as **plaintext rows in the shared `messages` table**. Buzz DMs are gift-wrapped with ephemeral keys. This is not a mapping, it is implementing NIP-17 + NIP-44 | 1:1 lossy → in practice a rewrite | **Large** |
| `replies` | **kind:9** + NIP-10 `["e", root, "", "reply"]` | Buzz has no reply *table* — a reply is a message with thread tags, and threads nest arbitrarily. Peek's replies are second-class (no reactions, no resolution, no nesting). Buzz rejects replies with unknown parents | 1:1 (after Peek-side merge) | **Medium** |
| `reactions` | **kind:7** NIP-25 | Clean per-user rows both sides. Un-reacting differs: Peek deletes the row, Buzz publishes a **kind:5** deletion of the reaction event | 1:1 | **Small** |
| `dmConversations` | channel with `channel_type='dm'`, **kind:41010** | Peek: strictly 2-party, canonical `(low,high)` id ordering. Buzz: a private channel with a `participant_hash`, and **41011** can add members (group DMs) | 1:1 lossy | **Medium** |
| `huddles` | ⚠️ **nothing** | **False friend:** a Buzz "huddle" (48100–48103) is a live A/V session. Peek's huddle is a persistent sub-thread with its own membership, parented to a topic, optionally anchored to a DM message. Options: (a) model as a nested channel — Buzz has no nesting; (b) model as a NIP-10 thread — loses per-huddle membership; (c) new kind | **New kind** | **Medium–Large** |
| `huddleMembers` | **9000/9001** if huddles become channels | Same as `topicMembers` | 1:1 lossy | **Medium** |
| `messages.editBody` | **kind:40003** edit | Buzz's edit is a *new event* with `["e", target]`; Peek patches the row and destroys history. Also flagged Buzz-only — "no standard NIP-29 client renders these" | 1:1 (Peek must stop mutating) | **Medium** |
| `messages.remove` | **kind:5** NIP-09 / **9005** admin | Peek hard-deletes and cascades into replies/reactions/watermarks/blobs. Nostr tombstones; Buzz explicitly retains (`get_event_by_id_including_deleted`) | 1:1 lossy | **Medium** |
| `messages.resolved` + `resolvedById` + `resolutionMessage` + `resolvedAt` + `resolvedByReplyId` | ⚠️ **nothing** | A completed action **by someone other than the author**, currently stored as a mutation of the author's row. Append-only demands a separate event referencing the message | **New kind** | **Medium** |
| `messages.highlightType` | ⚠️ **nothing** | 5-value enum (insight/concern/conclusion/question/summary). Cheapest path: a tag on kind:9 — but Buzz's ingest allowlists kinds, not tags, so an unknown tag rides along unrendered | **New kind** (or tag convention) | **Small–Medium** |
| `messages.urgent` | ⚠️ **nothing** | Derived at write time from `!@` in body text. No Buzz urgency concept | **New kind** (or tag) | **Small** |
| `@mentions` (in-band `@Name`) | **`["p", <hex>]`** tags | Buzz wants structured pubkey tags (deduped, max 50). Peek resolves mentions by **display-name string match** — there is no pubkey to put in the tag until identity exists | 1:1 *after* identity | **Medium** |
| `fileAttachments` → `_storage` | **Blossom** + `imeta` / **kind:1063** | Buzz is content-addressed by sha256. Convex `storageId`s carry no hash, so every blob must be re-uploaded to compute one | 1:1 lossy | **Medium** |
| `attachments` (Figma frame ids) | — | Static integration mocks, not real data | N/A | — |

### 1B. Local/ephemeral state (Peek §7B)

| Peek entity | Nearest Buzz kind | Delta | Verdict | Effort |
| --- | --- | --- | --- | --- |
| `readState` | **kind:30078** NIP-RS read state | Genuinely good fit — parameterized replaceable, per-user, NIP-44 encrypted to self, `channel_id=NULL`. Peek's *two* granularities (container + per-thread) both fit inside one blob | 1:1 | **Medium** |
| `stars` | **NIP-51 bookmark list (10003)** / bookmark set (30003) | Peek stars *containers* (topics/DMs); Buzz's message-level analogue is 40005. A NIP-51 list with `a`/`h` references is the closer fit | 1:1 lossy | **Small–Medium** |
| `deskOpenWork` | **NIP-51 set (30003)** with a custom `d` tag | Personal curation; the shape fits a named list | 1:1 lossy | **Small–Medium** |
| `screenerItems` | ⚠️ deliberately **nothing** | Fully recomputable from messages + membership + readState. **Recommendation: keep local, recompute.** Replicating a denormalized per-user notification cache onto a relay is the wrong move | **Local** | **Small** |
| Derived (`isResolved`, `replyCount`, unread flags) | **39005/39006** relay-signed overlays | Buzz ships derived read-model state as synthesized signed events; Peek computes it in the query. Both work; no conflict | Local | — |
| Theme, dev auto-login, mock-mode stores | — | Client state | **Local** | — |

### 1C. Buzz surface with no Peek counterpart

Not gaps in Peek — just the size of what Peek would *not* be using: agents
(10100, NIP-OA, personas 30175, teams 30176, managed agents 30177, engrams 30174,
turn metrics 44200), the agent job protocol (43001–43006), workflows (30620,
46001–46012), git/NIP-34 (repos, patches, PRs, issues, statuses), forum
(45001–45003), canvas (40100), A/V huddles (48100–48106), moderation
(1984, 9040–9044), NIP-43 relay membership, identity archival (NIP-IA),
push leases (NIP-PL), reminders (NIP-ER), presence/typing (20001/20002).

---

## 2. Where the models actually collide

Ordered by how much they hurt. These are not mapping problems — no table fixes them.

### 2.1 Identity: password accounts vs. keypairs — **Large**

Peek: a `users` row with an opaque `_id`, email+password via `@convex-dev/auth`, and
several flows that address people by **display-name string match**
(`convex/topics.ts:101`, `convex/huddles.ts:139`). Buzz: the pubkey **is** the user,
and every write is a Schnorr signature the relay verifies with no DB lookup.

There is no adapter. Peek must either (a) generate and custody keys server-side —
which is what the Phase 4 probe simulated, and it means Peek can forge any user's
messages — or (b) put keys in users' hands, which is a product decision about
recovery, device sync and onboarding, not an engineering task.

### 2.2 Mutable rows vs. append-only events — **Medium, pervasive**

Peek patches `body` in place with no history and hard-deletes with cascades. Nostr
has no update and no delete: an edit is a **new event** (40003), a delete is a
**tombstone** (kind:5), and Buzz retains deleted events by design. Every mutation
site in `convex/messages.ts` becomes an emit site, and `messages.remove`'s cascade
(replies, reactions, watermarks, blobs) has no relay equivalent — those events stay.

### 2.3 No authorization vs. relay-enforced authorization — **Medium**

Peek has effectively **two** ownership checks in the whole backend
(`screener.preview`, `desk.addToOpenWork`). Today any authenticated Peek user can
edit or delete **anyone's** message and delete **any** topic, and `topics.list`
returns every topic to everyone.

Buzz fails closed at both ends: `required_scope_for_kind` rejects unknown kinds and
maps every known one to a scope; `filter_fanout_by_access` drops delivery when
visibility cannot even be determined. Emitting to Buzz therefore doesn't just add
security — it **changes Peek's current behaviour**, and some existing flows will
start being refused. That is an improvement, but it is a behaviour change to plan
for, not a silent upgrade.

### 2.4 No tenancy vs. host-bound communities — **Medium**

Peek is one flat Convex deployment: no workspace, org or tenant concept exists.
Buzz binds community to the **connection host** at "row zero", before any handler
sees data, and fails closed on an unmapped host — deliberately never a wire tag.
So "one Peek workspace" must become "one host". Peek has no entity to hang that on;
it has to be invented.

### 2.5 Ids and time — **Small, but everywhere**

Opaque Convex `_id`s and stringly-typed `parentId`/`targetId`/`containerId` vs.
channel **UUIDs** and content-hash event ids. Plus **milliseconds → seconds**:
Peek sorts by `createdAt`, so same-second messages become order-ambiguous once
emitted (observed in Phase 4).

### 2.6 In-band conventions vs. structured fields — **Medium**

`@Name`, `!@` (urgent) and `→ msg` (resolution) are **substrings of Tiptap-
serialized body text**, parsed at write time. Buzz wants structured tags. Anything
in-band is invisible to a Buzz client.

### 2.7 DMs — **Large**

Peek DM bodies are plaintext rows in the shared `messages` table, readable by any
authenticated caller who can name the conversation. Buzz DMs are NIP-17 gift wraps
with ephemeral signing keys, `#p`-gated, excluded from search. Moving Peek DMs to
Buzz means implementing NIP-44 encryption — it is not a schema change.

### 2.8 Huddles — **Medium–Large, and a naming trap**

Peek's huddle (persistent sub-thread + membership, parented to a topic, sometimes
anchored to a DM message) and Buzz's huddle (live A/V session) share only a word.
Buzz has **no nested container**. Every option loses something.

---

## 3. Compatibility with the locked NfB decisions (RFC 0.2)

**Verdicts:** ✅ **Compatible** — Buzz already does this, or does it a compatible way ·
🟡 **Partial** — a usable primitive exists but not the thing the RFC specifies ·
❌ **Absent** — no counterpart; additive work ·
⛔ **Conflict** — Buzz is built on an incompatible assumption; something must give.

### 3.1 Scorecard

| # | RFC commitment | Verdict | Evidence | Severity |
| --- | --- | --- | --- | --- |
| **1.1** | Folder / File / Component three-tier structure | ❌ **Absent** | No folder concept exists anywhere in Buzz (`grep -rni "\bfolder" crates/` → no hits). No generic File object, no Component. The container is the channel; the only nesting is channel → NIP-10 thread. Nearest analogues are *typed, non-generic*: canvas (40100, one doc per channel), long-form (30023), git repos (NIP-34), Blossom blobs | **High** |
| **1.1a** | *(implied)* Extend the protocol with new object kinds | ⛔ **Conflict** | `required_scope_for_kind` (`handlers/ingest.rs:198`) **returns `Err` for unknown kinds and the relay rejects them.** You cannot define File/Component kinds client-side and publish them to a stock Buzz relay — this requires patching the relay's Rust ingest path | **High** |
| **1.2** | Files are shared evolving histories; revision is first-class | ✅ **Compatible** | The best-aligned decision in the RFC. Nostr is append-only by construction. Buzz edits are new events (40003) carrying `["e", target]`; deletes are tombstones and deleted events are deliberately retained (`get_event_by_id_including_deleted`). NIP-34 patches/PR-updates are literally revision history | — |
| **1.3a** | Cross-org collaboration is a **first-class protocol feature** | ⛔ **Conflict — total** | It does not exist in any form. See §5: one `federat*` hit repo-wide, in a Helm README, describing something unimplemented | **Critical** |
| **1.3b** | Shared state syncs via signed events **replicated between relays** | ⛔ **Conflict — total** | No outbound relay client, no outbox, no mirroring, no forwarding path between deployments. The mesh (`buzz-relay-mesh`) is inter-**pod** QUIC for scaling one cluster; `VISION_MESH.md` is GPU sharing. Neither replicates events | **Critical** |
| **1.3c** | A File exists on **each** participating org's relay; each side keeps its own copy | ⛔ **Conflict** | Buzz multi-tenancy is the **opposite shape**: many orgs *inside one deployment*, sharing one Postgres, isolated by `community_id` + RLS. That is co-tenancy under one operator, not two operators holding independent copies | **Critical** |
| **1.3d** | No host database, no org that "owns" the shared project | ⛔ **Conflict** | Follows from 1.3c — in Buzz there *is* a single host database, and one operator runs it | **Critical** |
| **1.3e** | Apps read primarily from their own org's relay | ✅ **Compatible** | A client connects to its community's host and reads from it. This part needs nothing | — |
| **1.3f** | Trust anchored to domains via **DNS-based verification** between orgs | 🟡 **Partial — wrong purpose** | Buzz has domain machinery, but for different jobs: the community is resolved from the connection **host** at row zero (`tenant.rs`), and NIP-05 handles must canonicalize to the relay's own domain or are silently cleared. Both are *inward* (which tenant is this / is this handle ours). Neither is *mutual* proof between two orgs. A building block, not the feature | **High** |
| **1.3g** | Either side keeps its copy if the relationship ends | ❌ **Absent** | Nothing to keep — there is no second copy (1.3b) | **Critical** |
| **1.4a** | **Highlights** — mark a File/Component as significant; append-only; scoped to person, **team**, or org | 🟡 **Partial** | Nearest: pin list (10001), bookmark list (10003), pinned message (40004), bookmarked message (40005). Two mismatches: NIP-51 lists are **replaceable, not append-only** (state, not a log of markings), and they are **pubkey-scoped only** — no team or org scoping. Also nothing to attach to below channel/message level, since Components don't exist. *Peek's `highlightType` enum is closer to this RFC intent than anything in Buzz* | **Medium** |
| **1.4b** | **Raw memory** — append-only log of observations, on the org's relay, org-owned and portable | 🟡 **Partial** | Buzz has append-only agent-scoped logs — NIP-AM turn metrics (44200) are explicitly "append-only, never replaced" — and NIP-AE engrams (30174). But engrams are *parameterized replaceable* (so not a log) and are **encrypted per agent↔owner conversation key**, i.e. agent-private, not org-owned. `buzz-audit`'s hash-chained log is org-scoped and append-only but is a moderation/audit trail | **Medium** |
| **1.4c** | Raw data lives on the relay; **derived data does not** | ✅ **Compatible** — with a nuance worth knowing | Buzz honours the storage half strictly: kind:39005 (thread summary — reply counts, participants) and 39006 (window bounds) are *"synthesized at query time, never stored"*. But it **delivers** derived data as relay-signed events, and makes them authoritative: clients "must not infer `has_more` from row counts". Compatible with the letter of the principle; adds a delivery pattern the RFC hasn't considered | **Low** |
| **1.4d** | Consolidation stays app-local | ✅ **Compatible** | Nothing in Buzz forces summarization onto the relay | — |
| **2.1a** | Identity: **users** | ✅ **Compatible** | secp256k1 pubkey *is* the user | — |
| **2.1b** | Identity: **organizations** | ✅ **Compatible** | `communities` table, host-bound at row zero, fail-closed on unmapped host | — |
| **2.1c** | Identity: **teams** | 🟡 **Partial — false friend** | `KIND_TEAM` (30176) exists but its own doc comment says it is *"a user-facing grouping of **personas**"* — an **agent** team, not a human one. Humans get per-channel roles (owner/admin/member) and relay-level NIP-43 membership. A human team as a grantable principal does not exist | **Medium** |
| **2.1d** | Identity: **apps** | ❌ **Absent** | An app is just a keypair. No app identity, no registry | **Medium** |
| **2.1e** | Identity: **agents** (RFC: "and later") | ✅ **Compatible — Buzz is ahead** | Fully shipped: independent agent keypairs, NIP-OA owner attestation, `users.agent_owner_pubkey`, managed agents (30177), personas (30175), engrams, turn metrics, ban cascade owner→agents | — |
| **2.2** | One authentication mechanism across all compatible apps | ✅ **Compatible — strongly** | NIP-42 pure Schnorr challenge–response, *"no API tokens, no JWT, no DB token lookups"* (`handlers/auth.rs:42`). This is exactly the RFC's "not 50 separate auth systems" claim, implemented | — |
| **2.3a** | Permissions: which identities can access which resources | ✅ **Compatible — Buzz is ahead** | Relay-enforced and fail-closed at both ends: kind→scope allowlist on write; `filter_fanout_by_access` on read, which drops delivery when visibility can't even be determined; `#p`-gating with search suppression; per-channel roles; `channel_add_policy`; moderation with ban cascade | — |
| **2.3b** | Permissions scoped to **protocol resources** (i.e. Files/Components) | ❌ **Absent** | Permissions are scoped to channels and kinds. With no File or Component, there is nothing at that granularity to grant on | **High** |
| **2.3c** | One central permission service | ✅ **Compatible** | The relay *is* that service | — |
| **3.1** | **App manifest** + public register — how an app's link renders elsewhere, what actions it exposes | ❌ **Absent** | No manifest kind, no registry. Buzz has not adopted **NIP-89** either (31989/31990 absent from `ALL_KINDS`). "manifest" in the Rust tree means the git ref-state manifest — unrelated. Buzz *has the exact problem this solves*, and says so: kinds 40002/40003 *"work on the wire but no standard NIP-29 client renders these"* | **High** |
| **3.2** | **Agent manifest** — purpose, available actions/skills others can invoke | 🟡 **Partial — closest thing Buzz has** | `KIND_MANAGED_AGENT` (30177) is a world-readable, owner-authored, opt-in projection of an agent; `KIND_PERSONA` (30175) carries system_prompt, display_name, runtime, model, provider and is *"designed for discoverability and sharing — d-tag is not blinded."* Two thirds of a manifest. **What's missing is the actions/skills half:** skills are discovered by scanning the **local filesystem** for `SKILL.md` files (`buzz-agent/src/hints.rs:110`), and tools come over MCP. None of it is published as a Nostr event. Invocation exists (job protocol 43001–43006) but capability *declaration* does not | **High** |

### 3.2 The conflicts, stated bluntly

**1. Cross-org collaboration is the RFC's centrepiece and Buzz has none of it.**
RFC §1.3 is unambiguous — first-class, replicated between relays, a copy on each
side, no owning org. Buzz implements the opposite architecture: one operator, one
Postgres, many communities isolated by row-level security. That is a good answer to
"how do I host 50 orgs cheaply" and no answer at all to "how do Acme and Beta share
a File." The gap is not a missing feature on a roadmap; it is a different shape.

Two smaller facts make it worse rather than better. `NOSTR.md` states that a pubkey
joining multiple communities must **repost its profile in each**, and that *"DMs and
profiles do not inherit across community domains"* — so Buzz has already decided
that identity does **not** carry across the boundary, which is precisely the
continuity NfB needs. And the relay's ingest allowlist means the replication events
you'd need can't even be introduced without patching Rust.

**Cost:** Large, upstream, in Buzz. Not something Peek can do on its side.

**2. The Folder/File/Component data model has no substrate in Buzz — and the ingest
allowlist blocks the obvious workaround.** NfB wants a *generic* content model that
apps extend. Buzz is a *fixed vocabulary* of ~140 registered kinds, each with a
hand-written scope mapping, and unknown kinds are rejected at ingest. So "define
kind:X for File, kind:Y for Component and publish them" does not work against a
stock relay. Every new NfB object type is a Rust change in `buzz-relay`.

This also cascades into permissions: RFC §2.3 wants access scoped to protocol
resources, and Buzz's finest granularity is the channel.

**3. App capability discovery — the RFC's Layer 3 — is essentially greenfield.**
Buzz has no app manifest and hasn't adopted NIP-89. Agent manifests are ~60% there
(persona + managed-agent events are genuinely close in spirit), but the actionable
half — declared skills — is local-filesystem and MCP, entirely off-protocol. Layer 3
would be built, not adopted.

### 3.3 Where Buzz is ahead of RFC 0.2

Worth saying, because the comparison is not one-directional:

- **Agents.** The RFC says "and later agents". Buzz has shipped independent agent
  keypairs, a written owner-attestation spec (NIP-OA) with a clean security
  argument, owner-scoped encrypted telemetry, per-turn cost accounting, and a ban
  cascade from owner to agents. If NfB wants agents as identities, this is a
  reference design to adopt rather than re-derive.
- **Permissions.** RFC §2.3 is one sentence. Buzz has a fail-closed, relay-enforced
  implementation with a formal isolation spec behind it.
- **Authentication.** RFC §2.2 is the "one auth for 50 apps" claim; Buzz already
  demonstrates it with pure NIP-42.
- **Append-only revision.** RFC §1.2 is a goal; in Buzz it is a property of the
  substrate.

### 3.4 Net read

Buzz is **strongly aligned with NfB's Layer 2** (identity, auth, permissions —
where it is ahead), **partially aligned with Layer 1.2 and 1.4** (append-only
revision is free; highlights and raw memory need new kinds), and **fundamentally
misaligned with Layer 1.1, Layer 1.3 and Layer 3** — the File/Component model,
cross-org replication, and capability discovery.

Put another way: **Buzz is an excellent implementation of the Nostr-native
workspace, and NfB's two most differentiating claims — cross-org collaboration and
app/agent discoverability — are exactly the two things it does not do.** Adopting
Buzz's event model buys real infrastructure for messaging, identity and permissions;
it does not shorten the path to the parts of the RFC that make NfB distinctive.

**Practical consequence for the Peek question.** Aligning Peek's backend to Buzz's
event model for **channels + messages** (§4) is compatible with the RFC and
cheap — no RFC decision is violated by emitting kind:9 into an org's relay. Anything
that depends on RFC §1.3 replication or §1.1 Files should not be designed against
Buzz's current model, because that model does not contain the concepts.

---

## 4. Smallest useful interop surface: channels + messages

Concretely, to make Peek's backend emit Buzz-readable channels and messages.
Phase 4 already proved steps 4–5 produce byte-identical output to Buzz's own SDK,
so the wire format is not where the work is.

**Prerequisite (unavoidable) — key custody. Large.**
Decide who holds the secp256k1 key. Server-held keys make everything else easy and
mean Peek can sign as any user; user-held keys are honest and drag in recovery,
device sync and onboarding. *Nothing below is meaningful until this is settled.*

1. **Add key material to `users`.** New optional fields (pubkey, plus encrypted
   privkey if server-held). Backfill existing rows. — **Small** (schema) once the
   decision above is made.
2. **Give topics a UUID.** Add a `channelUuid` column; mint `crypto.randomUUID()`
   at create. Do **not** ship the Phase 4 hash-derivation trick — it was a probe
   crutch, and it fabricates ids nothing else recognizes. — **Small**
3. **Add an outbound emitter.** Peek has no outbound hook at all today: `convex/http.ts`
   mounts only auth routes, and Convex's reactive sync is proprietary. Use a Convex
   **action** (Node runtime — Schnorr signing needs `@noble/curves`, which the query
   runtime cannot run) invoked from `topics.create` and `messages.send`. — **Medium**
4. **Build + sign the events.** kind:9007 for a topic, kind:9 with `["h", uuid]` for
   a message. NIP-01 canonical serialization, BIP-340 signature. — **Small**
   *(working reference: [`emit-buzz-event.mjs`](emit-buzz-event.mjs))*
5. **Connect and publish.** WebSocket to the relay, complete **NIP-42 AUTH** (signed
   kind:22242 against the relay's challenge), then `["EVENT", …]`. Handle the `OK`
   response — Buzz rejects unknown kinds and unauthorized scopes. — **Medium**
6. **Persist the returned event id** on the Peek row, so the two systems can be
   reconciled. Peek's `seedKey` cannot serve — a Nostr id is the hash of the event's
   own content. — **Small**
7. **Membership.** Emit kind:9000 when `ensureTopicMember` fires, or Peek's members
   never exist on the relay and private channels will refuse them. — **Medium**
8. **Decide the drop list, explicitly.** `urgent`, `highlightType`, resolution
   fields, mentions and file attachments have nowhere to go on this surface. Log
   what is dropped rather than dropping it silently. — **Small**
9. **Verify end-to-end** on a machine with Docker (this one had none): `just relay`,
   publish, open the channel in `web/`. — **Small**, but currently **untested** —
   see [`INTEROP_PROOF.md`](INTEROP_PROOF.md) §6.

**Realistic total for one-way channels + messages: Medium** — *conditional on the
identity decision, which is Large on its own and is a product decision, not an
engineering one.*

Explicitly **not** in this surface: replies, reactions, DMs, huddles, edits,
deletes, files, and reading *back* from Buzz (which needs a subscription, a
projection into Convex, and a conflict story for a mutable store fed by an
append-only log — **Large**).

---

## 5. Cross-org replication: a gap in **Buzz**, not in Peek

Stating this plainly because it inverts the usual framing.

**Buzz has no cross-organization replication.** Searching the entire repo for
`federat*` yields exactly one hit, and it is a parenthetical in a Helm chart README
(`deploy/charts/buzz/README.md:115`) describing a capability with no implementation
in the tree. There is no outbound relay client, no outbox, no upstream/mirror
config, and no event-forwarding path between deployments.

The two things that sound like it are not it:

- **`buzz-relay-mesh`** is an inter-**pod** QUIC mesh for horizontal scaling within
  one cluster — its own docs say single-instance deployments never construct one.
- **`VISION_MESH.md`** is about pooling members' idle **GPUs** for inference.

Multi-tenancy is real (`communities` table, host-bound at row zero, RLS, a formal
isolation spec) but it is **many orgs inside one deployment**, not orgs talking to
each other. `NOSTR.md` is explicit that "DMs and profiles do not inherit across
community domains."

**Consequences:**

1. If the goal is *"Peek interoperates with Buzz workspaces"* — achievable. Peek
   emits into a specific community by connecting to its host.
2. If the goal is *"a Peek org and a Buzz org sync"* — **the capability does not
   exist on either side.** Not a Peek gap to close; there is nothing to connect to.
3. Buzz accepts and stores **kind:10002** (NIP-65 relay lists), so users can
   *declare* other relays — but nothing in Buzz acts on that declaration.
4. The only path today is **client-side aggregation**: a client connects to several
   relays and merges locally. That is real, and it works because it is all standard
   Nostr — but it is not replication, and DMs and profiles explicitly do not carry
   across.

**It is a locked requirement.** RFC 0.2 §1.3 makes cross-org collaboration a
first-class protocol feature with per-relay copies and inter-relay replication of
signed events (§3.1 rows 1.3a–1.3g). So the honest options are:

1. **Build it upstream in Buzz** — an outbound replication path, a peering/trust
   model, and DNS-based mutual domain proof. Large, in Rust, and it cuts across
   ingest, storage and the tenant model. Buzz's existing host-binding and NIP-05
   domain canonicalization are useful building blocks but solve inward-facing
   problems (§3.1 row 1.3f).
2. **Client-side aggregation** — a client connects to both orgs' relays and merges.
   Real and works today, but it is not the RFC's model: there is no second copy, so
   §1.3's "either side keeps its copy if the relationship ends" does not hold.
3. **Don't adopt Buzz for this layer.** Use Buzz's event model where it is strong
   (messaging, identity, permissions) and treat cross-org as a separate protocol
   surface NfB defines itself.

What is *not* an option is assuming this arrives with Buzz.

---

## 6. Effort summary

| Gap | Tier |
| --- | --- |
| Key custody / identity model | **Large** |
| Replacing password auth with NIP-42 | **Large** |
| DMs → NIP-17 gift wrap | **Large** |
| Reading *back* from Buzz into Convex | **Large** |
| Cross-org replication (RFC §1.3) | **Large** — upstream in Buzz, not Peek |
| Folder / File / Component substrate (RFC §1.1) | **Large** — needs relay-side Rust changes, not just new kinds |
| App manifest + registry (RFC §3.1) | **Large** — greenfield; Buzz hasn't adopted NIP-89 either |
| Agent manifest skills half (RFC §3.2) | **Medium** — persona/managed-agent events exist; skill declaration is off-protocol |
| Highlights as append-only, team/org-scoped (RFC §1.4a) | **Medium** — NIP-51 lists are replaceable and pubkey-only |
| Org-owned raw memory log (RFC §1.4b) | **Medium** — append-only precedent exists (44200), scoping does not |
| Human teams as a permission principal (RFC §2.1c) | **Medium** — `KIND_TEAM` is agent personas, not humans |
| Huddles → some Buzz container | **Medium–Large** |
| Outbound emitter + NIP-42 publish path | **Medium** |
| Append-only edits/deletes | **Medium** |
| Membership events | **Medium** |
| Adding an authorization model to Peek | **Medium** |
| Workspace → host/community boundary | **Medium** |
| Structured mentions (needs identity first) | **Medium** |
| Replies → NIP-10 threads | **Medium** |
| Files → Blossom (re-upload for hashes) | **Medium** |
| `readState` → NIP-RS | **Medium** |
| New kinds: resolution, highlight, urgency | **Small–Medium** each |
| Stars / open-work → NIP-51 lists | **Small–Medium** |
| Topic UUIDs | **Small** |
| Profile fields → kind:0 | **Small** |
| Reactions → kind:7 | **Small** |
| Building and signing the events themselves | **Small** — *proven* |

The pattern: **the protocol mapping is the cheap part.** What is expensive is
identity, authorization, and giving up mutable rows — none of which is about Buzz
specifically. They are the cost of moving from a private database to a signed,
append-only, relay-enforced log.
