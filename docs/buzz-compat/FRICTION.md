# Friction log

Every place a Peek or NfB concept had to be dropped, forced, or worked around to
fit Buzz's model. This is the input to iteration 2's spec work and the evidence
behind any upstream proposal — a list of "we built it and here's where it broke"
rather than speculation.

**Append, don't curate.** A small friction that keeps recurring is more useful
signal than one dramatic blocker.

Legend — **Impact:** `blocker` (cannot proceed) · `lossy` (works, data is lost) ·
`workaround` (works, cost incurred) · `papercut`.

---

## A. Found by running against a live relay

These cost real debugging time. None were visible from reading the source.

### A1. Historical data cannot be backfilled — **blocker (for backfill only)**

`MAX_TIMESTAMP_DRIFT_SECS = 900` (`handlers/ingest.rs:1480`) rejects any event
whose `created_at` is more than **±15 minutes** from server time. Hard-coded, no
env override, applied to every ingested event.

So Peek's existing message history can never be published with its true
timestamps. Observed as `invalid: event timestamp too far from server time` when
publishing a topic seeded with a 2024 date.

**What we did:** messages keep their true `createdAt` and are skipped when
outside the window — rewriting the timestamp would falsify the shared record for
every other app reading it. Container events (channel create, membership,
profile) legitimately use `Date.now()`, since they describe state being
established now, which keeps old topics publishable.

**Open question for the spec:** NfB RFC §1.2 makes Files "shared evolving
histories". A protocol that cannot express "this happened last year" cannot
represent an imported history at all. Either NfB needs a signed
`original_timestamp` concept distinct from `created_at`, or migration from any
existing tool is impossible by construction. **This deserves to be an explicit
RFC decision.**

### A2. `HTTP 200` does not mean accepted — **papercut, high blast radius**

A duplicate channel create returns `200 {"accepted":false,"message":"duplicate:
channel already exists"}`. Any client checking only the status code silently
treats rejections as successes. A duplicate *event* differs again:
`accepted:true` with `message:"duplicate:"`.

**What we did:** `bridge.ts` treats the `accepted` field as authoritative and
maps both duplicate shapes to success.

### A3. NIP-98 auth events need a nonce — **workaround**

`created_at` has one-second resolution, so two requests with identical URL,
method and body inside the same second produce a byte-identical auth event. The
relay's replay guard rejects the second with `401 NIP-98: replay detected`.
Rebuilding the header per request is *not* sufficient.

**What we did:** added a random `nonce` tag. The verifier looks tags up by name,
so unknown tags are ignored. Pinned by `convex/nostr/nip98.test.ts`.

**Worth upstreaming:** NIP-98 as specified has no uniqueness requirement, so any
client that retries will hit this. Either the spec should mandate a nonce or the
relay should key its replay set on something else.

### A4. Ordering is enforced — **workaround**

A `kind:9` into a channel the relay does not know returns `restricted: not a
channel member` (not "unknown channel"), so the channel must exist first.

**What we did:** `publishMessage` assumes the channel exists — no round trip on
the happy path — and recreates plus retries once on exactly that message, which
also covers a wiped dev relay.

### A5. `POST /query` takes a bare array — **papercut**

`Vec<Value>` (`bridge.rs:970`), not a filter object and not `{filters: […]}`.
A single object gets `invalid type: map, expected a sequence`.

---

## B. Peek concepts with nowhere to go

Structural gaps. Each needs a new kind, a tag convention, or an explicit decision
to drop it.

| Peek concept | Status | Notes |
| --- | --- | --- |
| `highlightType` (insight / concern / conclusion / question / summary) | **lossy — dropped** | No Buzz kind. Directly relevant to **RFC §1.4a Highlights** — Peek's primitive is closer to the RFC's intent than anything Buzz has. Strongest candidate for the first NfB NIP |
| `urgent` | **lossy — dropped** | No urgency concept in Buzz. Currently derived from `!@` in body text |
| `resolved` + `resolvedById` + `resolutionMessage` + `resolvedAt` | **lossy — dropped** | A completed action *by someone other than the author*, stored as a mutation of the author's row. Append-only demands a separate event referencing the message |
| `@mentions` | **lossy — dropped** | Peek resolves them by display-name string match, so there is no pubkey for the `["p", …]` tag Buzz expects. Blocked on identity, not on protocol |
| `fileAttachments` | **not attempted** | Buzz is content-addressed by sha256; Convex `storageId`s carry no hash, so every blob needs re-uploading to Blossom |
| `attachments` (Figma frame ids) | **n/a** | Static integration mocks, not real data |
| Replies as a separate table | **not attempted** | Buzz has no reply table — a reply is a kind:9 with NIP-10 `e` tags. Peek-side refactor, not a protocol gap |
| Huddles | **not attempted** | Buzz has no nested container. A Buzz "huddle" is a live A/V session — a false friend |
| DMs | **not attempted** | Needs NIP-17 gift wrap + NIP-44. Peek stores DM bodies as plaintext rows today |

---

## C. NfB concepts with no substrate in Buzz

From `COMPATIBILITY_GAP_ANALYSIS.md` §3, restated here as work items.

| RFC | Concept | Status |
| --- | --- | --- |
| §1.1 | Folder / File / Component | **No substrate.** And `required_scope_for_kind` (`ingest.rs:198`) rejects unknown kinds, so new kinds cannot be added to a stock relay without patching Rust |
| §1.3 | Cross-org replication | **Does not exist.** `federat*` appears once repo-wide, in a Helm README, unimplemented |
| §1.4a | Highlights scoped to person/team/org, append-only | NIP-51 lists are replaceable and pubkey-only — wrong shape twice over |
| §2.1c | Human teams as a permission principal | `KIND_TEAM` (30176) is a grouping of *agent personas*, not humans |
| §3.1 | App manifest + public registry | Absent. Buzz has not adopted NIP-89 either |
| §3.2 | Agent skills declaration | Personas/managed-agents cover ~60%. Skills are discovered by scanning the local filesystem for `SKILL.md` (`buzz-agent/src/hints.rs:110`) — entirely off-protocol |

---

## D. Things that worked better than expected

Worth recording so the report is not one-sided.

- **The event shape needed zero iteration.** Peek's builders produced
  byte-identical output to Buzz's own SDK on the first try, verified by running
  Buzz's Rust over Peek's JSON.
- **NIP-98 over plain HTTP** — no NIP-42 challenge, no WebSocket — is what makes
  any of this possible from Convex's request-scoped runtime.
- **The relay treats Peek as a first-class client.** Publishing three kinds
  caused it to generate five more (39000/39001/39002 discovery, 40099, 44100),
  so a Peek-created channel is immediately visible to any NIP-29 client.
- **Convex runs fully locally** via `CONVEX_AGENT_MODE=anonymous`, so none of
  this needed a cloud deployment or an account.
