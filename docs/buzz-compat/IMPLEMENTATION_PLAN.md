# Peek → Nostr: Iteration 1 Implementation Plan

**Goal:** Peek publishes and consumes Buzz-shaped Nostr events for the data that
other apps need, becoming a second implementation of Buzz's core kinds. Everything
app-local stays in Convex.

**Posture (decided):** adopt Buzz's existing kinds as-is. No new kinds in iteration 1
— the relay's ingest allowlist rejects unknown kinds anyway
(`handlers/ingest.rs:198`). Gaps get logged, not invented (§7).

**Key custody (decided):** per-user keypairs, secrets held by Peek's backend. Not a
long-term identity design — see §6.1.

---

## 0. Confidence — read this before planning around any of it

| Claim | Status |
| --- | --- |
| Event construction + signing produces byte-identical output to Buzz's SDK | ✅ **Proven** — [`INTEROP_PROOF.md`](INTEROP_PROOF.md), working code in [`emit-buzz-event.mjs`](emit-buzz-event.mjs) |
| `POST /events` uses NIP-98, not NIP-42 | ✅ **Verified in source** — `bridge.rs:62-96`, `router.rs:71` |
| Host→community binding applies to HTTP too | ✅ **Verified** — `bridge.rs:618-633` |
| Relay comes up cleanly from docker-compose | ❓ **Never tested.** No Docker in the analysis environment. **Biggest unknown in this plan** |
| Convex's Node runtime runs `@noble/curves` | ❓ Untested. Expected to work under `"use node"` |
| Convex can poll at a usable cadence | ❓ Untested — check scheduler/cron minimums |

**No week estimates in this document.** Effort is small / medium / large, matching
[`COMPATIBILITY_GAP_ANALYSIS.md`](COMPATIBILITY_GAP_ANALYSIS.md) §6. Stage 0 is the
one that could surprise you; everything after it is well-understood.

---

## 1. The rule that decides what goes on Nostr

> **Publish completed business actions that other apps need to behave correctly.
> Keep per-viewer state, derived state, and routing decisions local.**
>
> Tie-breaker: *would another app's user-visible behavior be wrong if it couldn't
> see this?*

| Peek entity | Iteration 1 | Why |
| --- | --- | --- |
| `topics` | **Nostr** — kind:9007 | Another app must see the channel |
| `messages` (topic) | **Nostr** — kind:9 | The shared record |
| `topicMembers` | **Nostr** — kind:9000 | Gates who may read/write |
| `users` profile | **Nostr** — kind:0 | Other apps render the author |
| `replies` | Nostr (stage 2+) | kind:9 + NIP-10 `e` tags |
| `reactions` | Nostr (stage 2+) | kind:7 |
| `readState` | **Convex** | Private per-viewer. NIP-RS (30078) later, for cross-device only |
| `screenerItems` | **Convex — never** | A notification *opinion*, fully recomputable |
| `deskOpenWork`, `stars` | **Convex** | Personal curation |
| `huddles`, DMs | **Neither yet** | Out of scope — see §6.3 |

---

## 2. Stage 0 — get a relay running

**Effort: small — one prerequisite, then a single command.**

Peek's frontend stays on Vercel; only the relay needs a home. For iteration 1 run it
locally (Windows 11 + WSL Ubuntu 26.04), then move to Fly.io / Railway / a VPS when
it needs to be shared.

**Prerequisite: Docker Desktop for Windows**, with WSL integration enabled for the
Ubuntu distro (Settings → Resources → WSL Integration). It must be *running*.
This is the only manual step and the only thing not automatable from inside WSL.

Everything else is one command:

```bash
cd ~/buzz && ./bin/just relay
```

`just relay` (`Justfile:367`) chains three recipes that do the whole job:

1. `bootstrap` — Hermit downloads the pinned toolchain. **`bin/` already contains
   `just`, `cargo`, `node`, `pnpm`** — nothing to install by hand.
2. `_ensure-services` (`Justfile:163`) — `docker compose up -d` for
   `postgres:17-alpine` + `redis:7-alpine`, then polls until both report healthy.
3. `_ensure-migrations` (`Justfile:189`) — runs migrations, then
   **`scripts/seed-local-community.sh`**, which inserts the loopback host rows into
   `communities`.

The relay then binds `0.0.0.0:3000` (`config.rs`, `BUZZ_BIND_ADDR`).

> **Correction to an earlier draft of this plan:** I flagged the host→community row
> as "the gotcha that will bite first". It is handled automatically by
> `seed-local-community.sh`. The fail-closed behavior is real
> (`bridge.rs:626-633`) and still matters for any *non*-loopback host — a deployed
> relay needs its domain in `communities`, via `POST /operator/communities` or SQL.

**First run compiles ~1,000 crates — budget 20–40 minutes.** Subsequent runs are
seconds. Machine checked: x86_64, 942 GB free, 11 GB RAM — comfortably sufficient.

If `BUZZ_PUBKEY_ALLOWLIST=true` is ever enabled, that one *is* SQL-only — no CLI:

```sql
INSERT INTO pubkey_allowlist (pubkey) VALUES (decode('<64-hex-pubkey>', 'hex'));
```

**Done when:** `curl -H 'Accept: application/nostr+json' localhost:3000/` returns
NIP-11 relay info, and Buzz's own web client (`pnpm -C web dev`) loads against it.

**Do this before writing any Peek code.** It's the only unknown big enough to
reshape the plan.

---

## 3. Stage 1 — emit (Convex still primary)

**Effort: small.** Peek behaves exactly as today; writes additionally publish signed
events. One-way: proves the standard claim, doesn't yet prove interop.

### 3.1 Schema (`convex/schema.ts`)

```ts
users: defineTable({
  // …existing…
  nostrPubkey: v.optional(v.string()),        // 64-hex x-only
  nostrSecretKey: v.optional(v.string()),     // encrypted at rest — see §6.1
}).index('by_nostrPubkey', ['nostrPubkey']),

topics: defineTable({
  // …existing…
  channelUuid: v.optional(v.string()),        // crypto.randomUUID() at create
}),

messages: defineTable({
  // …existing…
  nostrEventId: v.optional(v.string()),       // set once published
  nostrPublishedAt: v.optional(v.number()),
}).index('by_nostrEventId', ['nostrEventId']),
```

Mint `channelUuid` with `crypto.randomUUID()`. **Do not** reuse the hash-derivation
from the Phase 4 probe — that was a crutch to make the probe reproducible without a
real id, and it fabricates ids nothing else recognizes.

### 3.2 New modules

| File | Purpose |
| --- | --- |
| `convex/nostr/keys.ts` | Mint a keypair per user; encrypt/decrypt the secret |
| `convex/nostr/events.ts` | Build + sign kind:0 / 9007 / 9000 / 9. **Port of [`emit-buzz-event.mjs`](emit-buzz-event.mjs)** — already verified against Buzz's SDK |
| `convex/nostr/nip98.ts` | Build the `Authorization: Nostr <base64(kind-27235)>` header |
| `convex/nostr/bridge.ts` | `POST /events`, `POST /query` against the relay |
| `convex/nostr/publish.ts` | Internal **actions** that do the signing + HTTP |

### 3.3 The Convex constraint that shapes everything

**Mutations cannot call `fetch` and cannot run Node crypto.** Signing needs
`@noble/curves` under Convex's Node runtime (`"use node"`), and publishing needs
HTTP. Both are action-only. So every emit is two hops:

```ts
// convex/messages.ts — inside send()
const id = await ctx.db.insert('messages', { …, seedKey })
await ctx.scheduler.runAfter(0, internal.nostr.publish.message, { messageId: id })
```

The action signs, POSTs to `/events`, and patches `nostrEventId` back on success.
Publishing is therefore **async and can fail after the row exists** — which is fine
in stage 1 (Convex is truth) and becomes the thing stage 2 inverts.

### 3.4 Call sites

| Peek function | Emits |
| --- | --- |
| `topics.create` ([convex/topics.ts:81](../../convex/topics.ts:81)) | kind:9007 + kind:9000 for each member |
| `ensureTopicMember` ([convex/topics.ts:17](../../convex/topics.ts:17)) | kind:9000 |
| `messages.send` ([convex/messages.ts:292](../../convex/messages.ts:292)) | kind:9 |
| `users.updateProfile` ([convex/users.ts:60](../../convex/users.ts:60)) | kind:0 |

### 3.5 Auth, concretely

Every bridge call carries a NIP-98 event signed by the **acting user's** key:

```
Authorization: Nostr <base64 of a signed kind-27235 event>
```

with `u` = the full URL and `method` = POST (`bridge.rs:80-96`). No challenge, no
persistent connection, no session. If `BUZZ_REQUIRE_AUTH_TOKEN=true` a token is also
needed — leave it off for the PoC.

**Done when:** a topic and message created in Peek render in **Buzz's own web
client**. That also closes the Phase 4 loose end
([`INTEROP_PROOF.md`](INTEROP_PROOF.md) §6).

---

## 4. Stage 2 — relay-primary for topics + messages

**Effort: medium.** The vertical slice. Everything else stays Convex-primary.

### 4.1 Invert the write path

`messages.send` stops being the source of truth:

1. Action signs and `POST /events`.
2. Relay returns OK / rejection.
3. **On OK**, write the Convex row — now a *projection*, keyed by `nostrEventId`.

Peek's optimistic-update machinery (`src/api/internal/*`) already covers the window
between user action and confirmation, so the UI shouldn't need changes. This is the
one place Peek's existing architecture pays off unexpectedly well.

### 4.2 Add the read path

Convex can't hold a WebSocket, so poll `POST /query`:

```json
{ "kinds": [9], "#h": ["<channel-uuid>"], "since": <last_seen>, "limit": 200 }
```

An internal action fetches, then upserts into `messages` keyed by `nostrEventId`
(idempotent — the same event must never produce two rows). Drive it by:

- **read-your-writes** — poll immediately after Peek's own publish, so Peek feels instant;
- **background loop** — a cron or self-rescheduling action for *other* apps' writes.

Buzz's channel-window extension (`top_level`, `include_summaries`, kinds 39005/39006
— `docs/bridge-channel-window.md`, NIP-CW) gives paged top-level rows plus reply
counts, which maps closely onto what Peek's `messages.list` already computes. Worth
using rather than reassembling threads client-side.

**Watch for:** ms→s timestamp collapse means same-second messages are order-ambiguous
(observed in Phase 4). Tie-break on event id for stable ordering.

**Done when:** an event published by something that is *not* Peek appears in Peek's UI.

---

## 5. Stage 3 — the interop demo

**Effort: small, once stage 2 works.** This is the artifact that demonstrates NfB's
actual premise.

A throwaway single-page app (~100 lines) that:

1. holds its own keypair,
2. `POST /query`s the same `#h` channel and lists messages,
3. `POST /events` a kind:9 into it.

Then show that message appearing in Peek, and a Peek message appearing in it —
**two independently built apps sharing one dataset with no integration between
them.** No API keys, no webhooks, no per-app database.

That's the demo. A mini-Linear or mini-Notion is the same exercise with a different
UI; don't build one until the 100-line version works.

---

## 6. Decisions already made, and what they cost

### 6.1 Server-held keys

Peek's backend holds every user's secret. Consequences to accept explicitly:

- **Peek can sign as any user.** Signatures prove the event came from Peek's
  backend, not from the person. Fine for a PoC; not fine for a trust claim.
- **Iteration 1 relay data is throwaway.** When identity moves to org- or user-held
  keys, everything signed under PoC keys becomes unverifiable. Don't build anything
  that assumes migration.
- Encrypt secrets at rest with a key from Convex env vars, not in plaintext columns.
  Cheap now, awkward to retrofit.

### 6.2 What is deliberately *not* being solved

Cross-org replication (Buzz has none — gap analysis §5), the Folder/File/Component
model (RFC §1.1, needs relay-side Rust), app manifests (RFC §3.1). These are
iteration 2, and they are upstream conversations, not Peek work.

### 6.3 Out of scope for iteration 1

DMs (needs NIP-17 gift wrap + NIP-44 — large), huddles (no Buzz container — naming
trap: a Buzz "huddle" is a live A/V session), edits and deletes, file attachments
(needs re-upload to Blossom for content hashes).

---

## 7. The friction log

Create `docs/buzz-compat/FRICTION.md` and append an entry **every time** an NfB or
Peek concept has to be dropped or forced into a Buzz kind. Already known from
Phase 4:

| Peek concept | What happened | RFC relevance |
| --- | --- | --- |
| `highlightType` (5-value enum) | No Buzz kind. Dropped | **RFC §1.4a Highlights** — Peek's primitive is closer to RFC intent than anything in Buzz |
| `urgent` | No equivalent. Dropped | — |
| `resolved` + resolution metadata | No equivalent. Needs a new kind | — |
| `@mentions` | In-band `@Name`, no pubkey to `p`-tag | Blocked on identity |
| `fileAttachments` | Convex storageIds carry no sha256 | RFC §1.1 Files |

This log is the input to iteration 2's spec work and the evidence for the upstream
ask. It is the highest-value artifact of iteration 1 and it costs nothing.

---

## 8. Open questions to resolve while building

1. **Does the relay come up cleanly?** Stage 0. Everything else assumes yes.
2. **Will Convex's Node runtime run `@noble/curves`?** Expected yes under `"use node"`.
3. **What polling cadence can Convex sustain?** Determines whether stage 2 needs an
   external WS consumer.
4. **Does `POST /query` need membership for open channels?** `filter_fanout_by_access`
   governs WS fan-out; the bridge read path should be confirmed separately.
5. **One community per Peek workspace, or one shared?** Peek has no workspace
   concept (Phase 1 §4), so iteration 1 is one community. Revisit before multi-org.
