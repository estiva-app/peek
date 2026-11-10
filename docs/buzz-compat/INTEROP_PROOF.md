# Phase 4 — Interop Proof (actual output, not predictions)

**Result: PASS, end to end against a live relay.** Peek's own modules build, sign,
publish, and read back events that a running Buzz relay accepts, materializes into
its database, and fans out into NIP-29 discovery events — see **§0**.

Everything below is copied from real runs. Nothing here is predicted.

---

## 0. Live relay result (the test §2 originally could not run)

Once Docker was available, the relay came up in ~4 minutes via `just relay` and the
full path was exercised with Peek's real `convex/nostr/*` modules — not the
throwaway probe script. Verbatim from [`live-relay-run.txt`](live-relay-run.txt):

```
[PASS] kind:0 profile  (HTTP 200)
       {"accepted":true,"event_id":"…","message":""}
[PASS] kind:9007 create channel  (HTTP 200)
       {"accepted":true,"event_id":"…","message":""}
[PASS] kind:9 message  (HTTP 200)
       {"accepted":true,"event_id":"530212f0…","message":""}
[PASS] POST /query reads it back  (HTTP 200)
[PASS] the exact event id came back from the relay

=== RESULT: PASS ===
```

**The relay ran its full side-effect pipeline on Peek's events**, which is the
result that matters — it treated them as first-class, not as opaque blobs:

```sql
-- channels
Onboarding redesign | stream | open | 163440f4dcf271a30ff83e9652adce713ad94abd76840265d5ed51f36fe47101
-- users  (proves kind:0 content parsed correctly, incl. key ordering)
163440f4… | Alice Chen | Design Lead
-- events by kind
    0 | 9 | 9007          ← what Peek published
39000 | 39001 | 39002     ← relay-signed NIP-29 group metadata / admins / members
40099 | 44100             ← system message + member-added notification
```

Peek published three kinds; the relay generated five more on its own, including the
NIP-29 discovery events that make the channel visible to **any** NIP-29 client.

**Two things this run corrected:**

1. **`POST /query` takes a bare JSON array of filters** — `Vec<Value>`
   (`bridge.rs:970`), not a single filter object and not `{filters: […]}`. My first
   attempt sent an object and got `invalid type: map, expected a sequence`. This is
   exactly the class of detail that cannot be got right by reading alone.
2. NIP-98 auth worked first time, with no NIP-42 challenge anywhere — confirming
   the HTTP bridge is usable from a request-scoped runtime like Convex.

**Still not exercised:** rendering in Buzz's own `web/` client, membership
enforcement on private channels, and the read-back projection into Convex. The
first is cosmetic; the other two are Stage 2 work.

---

## Original Phase 4 (analysis-environment) result

The sections below were written before Docker was available and are kept as the
record of what could be established without a relay. Their conclusion — that the
event *shape* was already correct — was confirmed by §0.

---

## 1. What was asked vs. what ran

| Step | Status |
| --- | --- |
| Spin up a local Buzz relay from the cloned repo | ❌ **Blocked** — see §2 |
| Write a script in Peek that emits one Buzz-shaped signed event | ✅ Done — [`emit-buzz-event.mjs`](emit-buzz-event.mjs) |
| Confirm Buzz can read it | ⚠️ **Partially** — Buzz's own crates parse, verify, and match it (§4). Buzz's *client* never saw it, because no relay ran |
| Report the actual diff | ✅ §5 |

I did not simulate the missing parts. Where the relay was needed, the result is
"not tested", not an inferred pass.

---

## 2. Why the relay could not be started — and what that does *not* mean

This is an **environment limitation, not a Buzz defect**. The relay is runnable;
this machine cannot run it.

```
$ which docker docker-compose cargo rustc psql just
(no output — none installed)

$ sudo -n true
sudo: interactive authentication is required
```

`buzz-relay` hard-requires Postgres and Redis:

- `crates/buzz-relay/src/config.rs:410` defaults `DATABASE_URL` to
  `postgres://buzz:buzz_dev@localhost:5432/buzz`, and `:419` defaults `REDIS_URL`
  to `redis://localhost:6379`. Neither is optional; there is no in-memory mode.
- `docker-compose.yml` provisions `postgres:17-alpine` and `redis:7-alpine`.
- `just relay` (Justfile:367) depends on `bootstrap` and `_ensure-migrations` —
  migrations run against Postgres before the relay starts.

With no Docker, no Postgres, no Redis, and no root to install them, the relay
cannot come up. **The full end-to-end test remains genuinely unverified and should
be re-run on a machine with Docker before anyone relies on Phase 3's table for
planning.**

What I *could* do was install a Rust toolchain into `$HOME` (rustup 1.95.0, no root
needed) and build Buzz's two **zero-I/O** crates — `buzz-core` ("NO tokio, NO sqlx,
NO redis, NO axum — zero I/O dependencies", per its own `Cargo.toml`) and
`buzz-sdk`. Those hold the event verification, the kind registry, the filter
matcher, and the canonical event builders. That is the largest slice of Buzz's real
logic that runs without a database.

---

## 3. The two halves of the test

**Emitter (Peek side)** — [`emit-buzz-event.mjs`](emit-buzz-event.mjs). Takes Peek
rows in their exact `convex/schema.ts` shape and maps them to Buzz events, signing
with BIP-340 Schnorr (`@noble/curves`). It records every place Peek has no value to
supply in a `gaps` array rather than silently defaulting.

> Peek rows are hand-written in the real schema shape rather than pulled live:
> this checkout has no `.env.local`, so the Convex deployment
> (`hallowed-stork-966`) is not reachable from here.

**Verifier (Buzz side)** — [`verify-with-buzz/`](verify-with-buzz/). A small Rust
binary that path-depends on `/home/miky/buzz/crates/buzz-core` and
`crates/buzz-sdk` and calls **Buzz's own functions**. It reimplements no Buzz rule:

| Check | Buzz function called |
| --- | --- |
| Parses as a Nostr event | `nostr::Event::from_json` (Buzz's pinned `nostr` 0.44) |
| Id hash + signature | `buzz_core::verify_event` |
| Kind is real | `buzz_core::kind::ALL_KINDS` |
| Channel resolution | `buzz_sdk::builders::extract_channel_id` |
| A client REQ would match | `buzz_core::filter::filters_match` |
| Structural equality | `buzz_sdk::builders::build_message` / `build_create_channel` |

Reproduce:

```bash
cd docs/buzz-compat && npm install && node emit-buzz-event.mjs | \
  cargo run --manifest-path verify-with-buzz/Cargo.toml
```

---

## 4. Actual output

Verbatim from [`phase4-run-output.txt`](phase4-run-output.txt):

```
=== channel_event ===
  [PASS] parses as a nostr Event
  [PASS] buzz_core::verify_event (NIP-01 id hash + BIP-340 sig)
         id=e6fb22b28309ae82d34f5f28c38a572bf84dab47fb6bad8f4fe001e9638e87b8
  [PASS] kind is registered in buzz_core::kind::ALL_KINDS
         kind=9007
  [PASS] buzz_sdk::builders::extract_channel_id finds a valid channel UUID
         channel_id=7b32200c-e4c0-4216-b79a-8490fc05e0bd
  [PASS] buzz_core::filter::filters_match against {kinds,#h} REQ
         REQ {"kinds":[9007],"#h":["7b32200c-e4c0-4216-b79a-8490fc05e0bd"]}
  [PASS] tags match buzz_sdk::builders::build_create_channel output
         want=[["h", "7b32200c-..."], ["name", "Onboarding redesign"], ["visibility", "open"], ["channel_type", "stream"]]
         got =[["h", "7b32200c-..."], ["name", "Onboarding redesign"], ["visibility", "open"], ["channel_type", "stream"]]

=== message_event ===
  [PASS] parses as a nostr Event
  [PASS] buzz_core::verify_event (NIP-01 id hash + BIP-340 sig)
         id=4f0edeb3b732fa1c44c4dbd26563b4acad022ffeb469ccfdb2aeb02088a92546
  [PASS] kind is registered in buzz_core::kind::ALL_KINDS
         kind=9
  [PASS] buzz_sdk::builders::extract_channel_id finds a valid channel UUID
         channel_id=7b32200c-e4c0-4216-b79a-8490fc05e0bd
  [PASS] buzz_core::filter::filters_match against {kinds,#h} REQ
         REQ {"kinds":[9],"#h":["7b32200c-e4c0-4216-b79a-8490fc05e0bd"]}
  [PASS] tags match buzz_sdk::builders::build_message output
         want=[["h", "7b32200c-e4c0-4216-b79a-8490fc05e0bd"]]
         got =[["h", "7b32200c-e4c0-4216-b79a-8490fc05e0bd"]]
         canonical id for same fields: 4f0edeb3b732fa1c44c4dbd26563b4acad022ffeb469ccfdb2aeb02088a92546
         peek-emitted id             : 4f0edeb3b732fa1c44c4dbd26563b4acad022ffeb469ccfdb2aeb02088a92546
         ids identical: true

=== RESULT: PASS ===
```

The event Peek emitted, in full ([`peek-emitted-event.json`](peek-emitted-event.json)):

```json
{
  "pubkey": "714902a6e7b9a991fe77ebd9cc4dad01b6474afdf58048277e1ec6b9cde567e8",
  "created_at": 1753300200,
  "kind": 9,
  "tags": [["h", "7b32200c-e4c0-4216-b79a-8490fc05e0bd"]],
  "content": "The new sign-up flow drops a step. Worth a look before Friday.",
  "id": "4f0edeb3b732fa1c44c4dbd26563b4acad022ffeb469ccfdb2aeb02088a92546",
  "sig": "146bf4f4945437a3059e752fec12bcd5ef8c514e23a330c78d7e34c236c10f7c9c22fd7264e222fc36eefa509ca615b6efdd3839531bed6f6d8a0e7db4eef85b"
}
```

**One honest note on `ids identical: true`.** The first run reported `false`. That
was not a mapping bug: `EventBuilder::build()` stamps `created_at` with the current
clock unless told otherwise, so the canonical rebuild was hashing a different
timestamp. Pinning it with `.custom_created_at(event.created_at)` made the ids
match exactly. Worth recording because a naive comparison would have produced a
false negative.

---

## 5. The actual diff: what Peek emitted vs. what Buzz expected

**Structural diff on the wire: none.** For the fields Buzz's message model has,
Peek's output is byte-identical to `build_message`'s.

The real diff is everything Peek holds that has nowhere to go. From the emitter's
own `gaps` output on this single message:

| Peek field | What happened | Consequence |
| --- | --- | --- |
| `users.<key material>` | **Invented.** Peek has no keypairs, so the probe derived `sk = sha256("peek:probe:user:" + _id)` | Peek could mint a key for any user with no consent, custody or recovery. This is the single largest gap and it is not a mapping problem |
| `topics._id` → `h` | **Invented.** Peek ids are opaque Convex ids; Buzz needs UUIDs. Hashed into `7b32200c-…` | The UUID is stable but arbitrary — nothing binds it to a channel Buzz already knows |
| `topics.<visibility>` | **Invented** — `"open"` | Peek has no visibility flag and no workspace scope; the value is a guess |
| `messages.highlightType` | **Dropped** — `"insight"` | No Buzz kind or tag carries it. Silent data loss |
| `messages.createdAt` | **Downgraded** — ms → seconds | Peek sorts by `createdAt`; two messages in the same second become order-ambiguous on the relay |
| `messages.seedKey` / `_id` | **Discarded** — `m_1753300200000_1` | A Nostr event id is the hash of its own content. Peek must store the returned id to keep the two systems in sync |
| `urgent`, `resolved`/`resolvedById`/`resolutionMessage`, `attachments`, `fileAttachments` | **Would be dropped** (absent on this sample) | Each needs either a new kind or a tag convention — see the gap analysis |
| `@mentions` | **Would be dropped** (absent on this sample) | Peek parses them out of body text and resolves by display-name match, so there is no pubkey for the `["p", …]` tag Buzz expects |

---

## 6. What is still untested

Do not read the PASS above as "Peek can talk to Buzz." These were **not** exercised
and all of them are relay-side:

1. **Ingest scope gate** — `required_scope_for_kind`
   (`crates/buzz-relay/src/handlers/ingest.rs:198`) requires an authenticated
   principal holding `MessagesWrite`/`ChannelsWrite`. Never invoked here.
2. **NIP-42 AUTH** — the relay challenges and requires a signed kind:22242 response.
   Never performed.
3. **Channel existence and membership** — kind:9 into a channel that does not exist,
   or that the pubkey is not a member of, is a relay-side decision. Untested.
4. **Storage, dedup, replaceable-kind handling** — needs Postgres.
5. **Fan-out and read gating** — `filter_fanout_by_access`
   (`handlers/event.rs:115`). My `filters_match` check is the *filter* layer only,
   not the access layer.
6. **Rendering in Buzz's client** — `web/` or `desktop/` never ran. Whether the
   message *displays* correctly is unproven.

**To close this properly**, on a machine with Docker: `just relay`, then publish
`peek-emitted-event.json` with `nak event` (or `buzz-cli`) over a NIP-42
authenticated connection, and open the channel in `web/`. Expect the first failure
to be authentication or channel-not-found, not event shape — the shape is now
proven correct.

---

## 7. What this run does establish

1. Peek can produce **cryptographically valid** Nostr events that Buzz's own
   verification accepts.
2. Peek's mapping for channels + messages is **structurally exact** — byte-identical
   ids against Buzz's own builder, so there is no wire-format work left for this
   surface.
3. The blocking problems are **not** shape problems. They are **identity** (Peek has
   no keys), **addressing** (opaque ids vs. UUIDs), and **semantic loss** (urgency,
   highlights, resolution, structured mentions).
4. Phase 3's claim that "channels + messages is a clean 1:1 map" **survives contact
   with Buzz's real code** — which is exactly what this phase existed to test.
