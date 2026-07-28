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

### A1. Historical data cannot be backfilled — **decided: not a problem for Peek**

> **Ruling (2026-07-24): no migration. Peek starts fresh on Nostr.** This
> downgrades A1 from a blocker to a documented constraint. The handling below
> stays as-is — it is the correct behavior for any out-of-window message
> regardless — but nothing is now blocked by it.
>
> Two consequences that follow from the ruling and are easy to trip over:
>
> 1. **Seeded demo data will not publish.** `dev/seedDemo` writes historical
>    dates, so every seeded message is outside the window and gets skipped. A
>    demo that needs Peek content visible in Buzz has to use freshly sent
>    messages (or shift the seed dates to now).
> 2. **It remains an open ecosystem question, just not ours.** Any business
>    adopting NfB later will want to import history from whatever they use
>    today. See the spec note below.

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

**Open question for the spec — still open, despite the ruling above.** Peek not
needing migration settles Peek, not the ecosystem. NfB RFC §1.2 makes Files
"shared evolving histories", and a protocol that cannot express "this happened
last year" cannot represent an imported history at all. Any org adopting NfB
with existing data in Slack, Notion or Linear hits this on day one.

Either NfB defines a signed `original_timestamp` distinct from `created_at`, or
"no migration from existing tools, ever" becomes a property of the protocol by
accident rather than by choice. **Worth an explicit RFC decision either way** —
deciding "we don't support import" is a perfectly good answer, but it should be
a decision.

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

### A5b. A multi-value `#h` filter is **not** OR-ed — **trap, silent**

NIP-01 says the values of a tag filter are alternatives, so `{"#h": [A, B]}`
should return events in either Folder. Buzz returns **only A's**, with no error
and no warning.

Measured, with one event in each of two Folders:

```
#h:[A]      -> 1
#h:[B]      -> 1
#h:[A,B]    -> 1     ← not 2
two filters -> 2     ← [{#h:[A]}, {#h:[B]}] works
```

This is worse than a papercut because the failure is a **short read**, not an
error. Linear-lite hit it the moment projects got their own Folders: the
workspace query returned the project records and silently none of their issues,
which folds into a project that looks empty rather than a query that looks
broken.

**Workaround:** one filter object per Folder. `POST /query` takes an array
anyway (A5), so it is still a single round trip — `store.ts:rawFolders` does
this, and `scripts/smoke.ts`'s stub relay reproduces the Buzz behaviour so a
client that regresses to an array fails in the test rather than in front of
someone.

Almost certainly because `h` is special-cased as channel scoping rather than
handled as a generic tag filter. Not verified against other tag names.

### A6. `created_at` is too coarse to order an event-sourced record — **workaround**

Found building Linear-lite's change fold (LINEAR_LITE_SPEC.md §1.3). The fold is
last-write-wins per field over `kind:1851` events ordered by `created_at`, and
`created_at` is **seconds**.

Measured against the live relay: **five sequential changes from a single client
all landed in one `created_at` second.** So the ordering key ties, and the
tie-break decides — which means the fold returned a status the user had already
moved past. Deterministic and wrong.

This is not the case §7.4 of the spec anticipated. That question assumed the
tie was "two people setting status in the same second — rare but not
impossible". The real case is *one* person, *one* app, a few clicks: ties are
the common case for any burst of activity, not a race between users.

Nothing on the relay side recovers the order, and this was checked rather than
assumed:

- A stored event is exactly the seven signed NIP-01 fields — `/query` returns
  `content, created_at, id, kind, pubkey, sig, tags` and no ingest sequence or
  row id.
- Query result order is stable across reads but is **id-sorted**, so it carries
  no insertion information either.

So the ordering information has to be inside the signed event or it does not
exist.

**It is not a change-event problem.** The same failure reappeared verbatim on
`kind:1111` comments the day they were added: two comments posted in one second
sorted by event id, so the thread read back in the wrong order. `created_at`'s
one-second resolution is a property of *every* append-only stream on this relay,
so the ordering rule belongs to the app's whole event vocabulary rather than to
one kind. Anything folded or threaded needs it.

**What we did:** `kind:1851` and `kind:1111` carry a provisional
`["ts", "<epoch-ms>"]` tag,
and the fold orders by `ts` where present, falling back to `created_at * 1000`.
A change without `ts` still folds, just at one-second resolution, so this is
additive rather than a format break.

The part worth keeping in the spec is the **trust bound**: `ts` is honoured only
when it agrees with `created_at` to the second. The relay already validates
`created_at` against its own clock (±15 min, A1), so a `ts` pinned inside that
second inherits that validation and can only reorder events *within* an
already-checked second. It adds resolution without adding anything new to trust
— which matters under the honour-system model (RFC_UPDATES.md §3), where a
buggy app claiming `ts = 2^52` would otherwise win every fold forever. Pinned by
a check in `scripts/verify.ts`.

**Open question for the spec.** `ts` fixes same-second ordering by *one* writer.
It does not fix genuine concurrency between two writers with skewed clocks — for
that, last-write-wins by wall clock is the wrong primitive regardless of
resolution, and the honest options are a causal `prev` pointer per field (which
costs the "consumer publishes directly, owner not in the loop" property from
RFC §3) or accepting that categorical fields converge eventually. Worth deciding
before a second app starts writing `1851` events, because the fold rule is the
one thing every consumer must implement identically.

---

### A7. A non-member's query returns zero rows, not an error — **workaround**

Found building Peek's consumer side. Peek is handed a `nostr:naddr…` for a
Linear-lite issue, resolves the manifest, fetches the object — and gets nothing.
No error, no `restricted:`, just an empty array, which is indistinguishable from
"that object does not exist".

The cause is the permission model working correctly: objects and change events
are channel-scoped, so a reader who is not a member of the Folder sees none of
them. Grouping and access are the same mechanism (RFC_UPDATES.md §1.1), and this
is that.

What makes it a trap rather than an obvious permission failure is **which kinds
are global**. NIP-89 manifests (31990) and recommendations (31989) are
deliberately not channel-scoped — discovery has to work before you are a member
of anything. So the first two steps of resolution *succeed*: Peek finds the app,
learns the widget shape, learns the vocabulary. Only the last step comes back
empty. The failure surfaces as far as possible from its cause and reads like a
malformed reference.

**What we did, first:** Peek distinguishes the two cases. When the manifest
resolves but the object does not, the widget is returned with
`unreachable: true` so the UI can say "you may not have access to this Folder"
rather than rendering nothing. That part stays — it is the right behaviour for a
genuinely private Folder.

**What we did next, once it showed up in the actual UI.** The membership grant
turned out to be self-inflicted. Two choices, neither required by the protocol:

1. Linear-lite created Folders with `visibility: 'private'`.
2. Linear-lite created a *new* Folder rather than reusing an existing one.

Buzz treats `open` channels as accessible to everyone —
`get_accessible_channel_ids` (`channel.rs:638`) unions a pubkey's memberships
with *all* open channels, and `check_channel_membership` returns early for them
on the write path too. **Peek already creates its own topics open**
(`convex/nostr/publish.ts:124`). So the fix was one word, and pairing removes
the question entirely.

Verified against the live relay: a brand-new identity, never added to anything,
published a project, an issue, a change and a comment into an existing Peek
topic's channel, and Peek rendered the folded result. Same outcome for a fresh
open standalone Folder.

**The real lesson is about pairing, not permissions.** Creating a new Folder for
a project that already has a Peek topic makes two containers for one thing, and
then nobody in the topic can see the issues. RFC_UPDATES.md §1.1 already says
this — "the Peek topic, the Linear project, the messages all carry the same
`h`" — and building the consumer is what made it concrete. Linear-lite now
accepts a pasted Folder link and *adopts* the container instead of forking it,
and Peek's topic header can copy one.

**Still open for the spec.** `open` on this relay means world-**writable**
within the community, not just world-readable — the same check gates ingest. So
"open so other apps can see it" and "anyone may write here" are currently the
same setting. A read-only-to-non-members visibility is the missing third option,
and without it the honest choice for a private project is explicit membership
per consuming app.

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
