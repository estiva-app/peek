# RFC 0.2 → 0.3 — what to change and why

Everything from the analysis and the design sessions that should feed a revision
of the NfB RFC. Organised by RFC section so it can be worked through directly.

Each item states **what to change**, **why**, and where the evidence is. Where
something is still open, it says so rather than proposing a resolution.

---

## The headline

**RFC 0.2 substantially overstates how much needs inventing.** After surveying all
99 NIPs and reading Buzz's implementation, the genuinely unclaimed list is:

1. **The app/agent manifest** — display projections and actions (§3.1 + §3.2,
   which turn out to be one thing)
2. **Cross-org trust and replication policy** (§1.3) — the *policy*, not the
   transport
3. **Teams as a permission principal** (§2.1c)

That is three, and one of them is small. **The File/Component model — previously
the largest and most load-bearing gap — evaporates**, because git already
provides it. See §1.1 below.

---

## New: a Layer 0 principle to state up front

Currently implicit and buried in §1.4c. It deserves to be the first thing the RFC
says, because it is the rule that makes every other decision decidable:

> **Publish completed business actions that other apps need in order to behave
> correctly. Keep per-viewer state, derived state, and routing decisions local.**
>
> Tie-breaker: *would another app's user-visible behaviour be wrong if it could
> not see this?*

Consequences worth spelling out, because they are counter-intuitive until stated:

- Apps may use any backend they like for non-shared data. NfB does not ask anyone
  to move their database.
- A per-user read position, a notification decision, a UI preference: local.
- **Interop lives at the commit boundary**, not at the keystroke.

Add a conformance note: for each object type, the spec should say whether
publishing is **required** or **optional**. Otherwise App A publishes reactions,
App B does not, and B's users silently look like they never react.

---

## §1.1 Structure — rewrite around git

**Change:** Folders and Files are **git**, not new event kinds.

Buzz already implements real git hosting — `api/git/transport.rs` provides the
Smart HTTP protocol (`info/refs`, `upload-pack`, `receive-pack`), NIP-98
authenticated on every route including clone. Not patch-exchange-over-Nostr;
actual `git clone` and `git push`.

**Why this is better, not merely available:**

| Need | git | An event-based File kind |
| --- | --- | --- |
| Folders | Native, hierarchical | Not modelled |
| History | Diffs, blame, branches | "Latest wins" plus log-scraping |
| **Multi-writer** | **Merge** | **Unsolved** — see below |
| Permissions | Already built | Undesigned |

The multi-writer point is close to decisive. NIP-33 addresses are
`(pubkey, kind, d)`, so a document edited by two people is *two documents*. That
was the central unresolved question in the [NIP-FC draft](nips/NIP-FC.md), and git
has solved it for twenty years.

### Components split in two, and only one is protocol

- **Static components** — headings, paragraphs, tables, lists. These are
  **markup inside the file**. Not events, not addressable, not protocol. An
  earlier draft made every heading an addressable event; that is a great deal of
  machinery to make a `##` addressable, and nobody needs to permission a heading.
- **Dynamic components** — a Linear ticket, a filtered issue table. These are the
  real work, and they decompose into: **a reference** to another app's object, and
  **a rendering**. See §3.1.

### New principle: the owner defines the projection

Worth stating explicitly in the RFC:

> The app that owns an object type declares how that object appears in other
> apps. Linear decides what a Linear project looks like inside Peek.

This inverts normal integration, where each consumer decides what to show and
each gets it wrong differently. Here the domain expert declares the canonical
external view once, and apps that do not exist yet inherit it.

---

## §1.2 Collaboration and revision

**Change:** revision is git history. Delete any implied bespoke revision
mechanism.

**Add, explicitly:** real-time collaborative editing is **out of scope, by
design** — not deferred, not missing.

Verified: no CRDT, Automerge, Yjs or operational-transform mechanism exists in
any of the 99 NIPs, and Buzz's canvas is a plain `UPDATE channels SET canvas = $1`
— last writer silently erases the other. Git is the strongest option available.

The principled framing: an app building Figma-on-NfB uses its own real-time
mechanism and publishes when there is something worth committing. Keystrokes are
the purest case of ephemeral local state; a saved document is the business action.
This is the Layer 0 principle applied, not a concession.

**Carve-out worth keeping:** *presence* — knowing that someone is editing, as
opposed to receiving their keystrokes — is genuinely useful cross-app and already
has ephemeral kinds (`20001` presence, `20002` typing).

**Also settled:** importing history from existing tools is out of scope
(decision 2026-07-24). Worth stating as a choice, since Buzz's ±15 minute
`created_at` window makes it impossible anyway
([FRICTION.md](FRICTION.md) A1).

---

## §1.3 Cross-org collaboration — smaller than it looked

**Change:** you are not inventing sync. Two mechanisms already exist:

- **Files:** git remotes. "Each side holds its own copy, no owning org" is a
  description of `git clone`. Cross-org file sharing becomes "a remote you may
  fetch from" — a well-understood problem.
- **Messages/events:** **NIP-77 Negentropy**, whose spec explicitly covers
  relay-to-relay set reconciliation.

**What remains genuinely unclaimed is the policy layer:** *which* objects
replicate, *to whom*, and *on whose authority*. No federation NIP exists.

**Partial building block:** NIP-05 anchors a key to a DNS domain. That is half of
§1.3's domain-verified trust — it authenticates a key against a domain, not an org
to another org.

**Correction to note:** Buzz's multi-tenancy is *many orgs inside one deployment*
(row-level, host-bound), which is co-tenancy, not federation. The RFC should not
assume Buzz provides any of §1.3 today.

---

## §1.4 Memory and highlights

**Change:** **NIP-84 already exists** (`kind:9802`, Highlights) — but it is a
different shape: `.content` is a highlighted *excerpt*. §1.4a currently describes
marking a whole object as significant, which is closer to **NIP-32** labelling.

These are two features sharing a word, and the RFC should distinguish them:

| Feature | Shape | Mechanism |
| --- | --- | --- |
| A highlighted passage | an excerpt with a source | **NIP-84** |
| A category on an object | a namespaced label | **NIP-32** `L`/`l` |

NIP-32 labels may be applied inline on any event kind (NIP-32 §52), so
categorisation needs **no new kind at all** — just a registered namespace. That is
a far easier proposal to land.

**Also:** derived data staying app-local has a standard home — **NIP-78**
(`kind:30078`) is explicitly for app data that does not need interoperability.

---

## §2 Identity, authentication, permissions

**Change:** §2 currently says "one central service that handles identification,
authentication and permission." In Nostr there *is* no central auth service — the
key is the identity. State the resolution explicitly:

> Identity is a keypair the user controls. Authentication is NIP-42 (relay) and
> NIP-98 (HTTP). Permission is enforced by the relay. There is no account server.

**Key custody has a standard answer:** **NIP-46** remote signing, plus NIP-07
(browser), NIP-55 (Android), NIP-49 (encrypted keys at rest). The RFC should point
at these rather than leave custody undefined.

**Permissions on files already exist and are already unified.** From Buzz's
`git_perms.rs`: *"channel role = repo role"*, plus `buzz-protect` branch rules on
the repo announcement. One permission model across chat and files — which is what
§2.3 asks for, already built.

**Still unclaimed:** teams as a grantable principal. Buzz's `KIND_TEAM` (30176) is
a grouping of *agent personas*, not humans. And per-resource permissions below the
channel level do not exist anywhere.

---

## §3 Discoverability — §3.1 and §3.2 are one thing

**The most significant change in this document.**

RFC 0.2 treats app manifests (§3.1) and agent manifests (§3.2) as separate
concerns. They are the same object, and the framing that makes this obvious is
**MCP**: an app declaring what can be done with its objects. "What can I do with a
Linear issue" is the same question whether a human's app or an agent is asking.

This matters practically: Buzz's agents **already speak MCP** (`McpRegistry` in
`buzz-agent`, a `buzz-dev-mcp` crate). An agent that can read the app registry
gets a tool catalogue for free — no separate skill mechanism needed.

### What the manifest declares

Building on NIP-89 (`kind:31990`), which already handles discovery but only says
how to **open** an object in its owning app — not how to **render** it inline:

1. **Which object types the app owns** — resources
2. **How each appears in other apps** — the projection: which fields, and which
   predefined widget shape
3. **What can be done to it** — actions, with schemas

### Predefined widgets, not free-form layout

The reason is the same one that rules out iframes: if the owner specifies
arbitrary layout, the owner controls the consumer's UI. With a fixed set of widget
types, **the consumer renders in its own design language** — a Linear ticket looks
like Peek inside Peek.

Recommended shape: predefined widget **types**, each with declared **slots**, and
the manifest maps its fields into slots. Fixed layout, flexible data mapping —
roughly how Open Graph works.

```
card  → { title, subtitle, status, meta[], avatar }
row   → { title, status, meta[] }
table → { columns[], rows[] }
stat  → { label, value, trend }
```

Governance question to answer: who may add a fifth widget type.

### Actions need schemas, not names

"Change status" is not actionable. A consumer needs to know what event to emit,
and which values are legal — otherwise every app guesses differently. Borrow
MCP's discipline: JSON Schema for inputs.

### The difference from MCP, and why it matters

MCP is RPC: call, execute, return. The NfB manifest is a schema for **direct
writes** — the consumer publishes the event itself, and the owning app is not in
the loop. Consequences:

- No return value; no synchronous failure.
- No owner-side execution, so none of the owner's side effects fire.
- **The owner becomes a reactor, not a gatekeeper** — to do derived work, the
  owning app must be running and subscribed to its own data.

### Trust and validation — decided, with one asymmetry to note

**Decided:** any installed app may write any object type. Orgs vet what they
install; "Slack can change a Linear property" is a feature, not a risk.

**The asymmetry worth naming:** with Slack↔Linear, Slack calls Linear's API and
Linear's server validates — garbage is rejected at the door. Under NfB the write
goes straight to the relay and **nobody validates**. A *buggy* app, not a hostile
one, can write malformed data into another app's object space, and on Nostr you
cannot unpublish someone else's event.

This makes the action schema load-bearing: it is the only thing doing the job the
owner's server used to do. The RFC should state which model applies —
honour-system (clients validate against the manifest), relay-enforced (the relay
would need schemas), or self-healing (the owner publishes corrections).
Honour-system is probably right for vetted apps, but it should be chosen.

---

## Open questions to carry into 0.3

1. **Multi-writer for non-git objects.** Solved for files by git. An issue edited
   by two apps at once is still last-write-wins per author.
2. **Cross-org policy** (§1.3) — the only large unclaimed piece.
3. **Teams as a principal** (§2.1c).
4. **Comment anchoring inside a file.** Git has no addressable sub-file unit;
   GitHub uses `(commit, path, line-range)` and it is fragile across edits. This
   is the one place addressable Components were genuinely better.
5. **Widget governance** — who adds a widget type.
6. **Validation model** — see above.

---

## Where the evidence lives

| Claim | Source |
| --- | --- |
| What exists across all 99 NIPs | [NIP_SURVEY.md](NIP_SURVEY.md) |
| What Buzz implements, cited to code | [BUZZ_PROTOCOL_MODEL.md](BUZZ_PROTOCOL_MODEL.md) |
| Where Buzz conflicts with RFC 0.2 | [COMPATIBILITY_GAP_ANALYSIS.md](COMPATIBILITY_GAP_ANALYSIS.md) §3 |
| The git/Files reasoning | [FILES_ARCHITECTURE.md](FILES_ARCHITECTURE.md) |
| Things that broke in practice | [FRICTION.md](FRICTION.md) |
| Superseded File-kind draft | [nips/NIP-FC.md](nips/NIP-FC.md) |
