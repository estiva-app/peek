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

### Folder is the universal container, and it already exists

**Decision (2026-07-25): the container is called a Folder**, at protocol and RFC
level. Buzz and Slack call their version a channel; that word is right for chat
and wrong for everything else, so the spec should not inherit it. Apps may label
it however suits them — Peek calls it a Topic, Linear calls it a Project — which
is the projection principle applied to containers rather than objects.

**Mechanically it is Buzz's `h` tag.** Everything Buzz scopes is scoped by it,
and via `channel role = repo role` that already includes git repos. So a Folder
is not a new concept to build: it is the existing grouping, renamed and made
explicit.

> Create a Folder for a project. The Peek topic, the Linear project, the
> repository, the messages, the highlights all carry the same `h`. One container,
> many projections.

Consequences:

- **Every shared object carries `h`.** It is how things are grouped *and* how
  access is enforced — the two are the same mechanism, which is why permissions
  do not need separate design.
- **One level of nesting for now** (decision 2026-07-25). Hierarchy is expected
  later and needs only a parent link on the Folder, not a new concept.
- The RFC should stop describing Folders as merely "local organisation". They are
  the primary scoping unit for everything.

### New principle: shared records are event-sourced, not edited in place

The problem this solves: NIP-33 addresses are `(pubkey, kind, d)`, so **only the
author can replace their own event.** Ana creates an issue, Ravi changes its
status — Ravi cannot rewrite Ana's event, and in a tracker that is the normal
case, not an edge case.

> A shared record is a **root event plus a stream of change events**, folded at
> read time. Nobody rewrites anyone else's event.

Three things recommend it beyond solving the problem:

1. **The activity feed is free** — it *is* the event stream, rather than being
   reconstructed from one.
2. **Precedent in this exact domain**: NIP-34's git statuses (`1630`–`1633`) are
   separate events referencing an issue, authored by whoever set them.
3. **Buzz already works this way** for channel membership — `kind:9000` add-member
   is an event, not an edit to a channel object.

This applies to *shared* records. An object only its author edits (a personal
document, a draft) can stay a plain addressable event.

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

### What it does not declare: how to find anything

Added after PEEK-150 built the most demanding consumer available — an agent that
had never heard of Ship — and pointed it at Ship's manifest with nothing else.
The reader is `scripts/manifest-reader.ts` in estiva-ship; it imports a relay
client and a signer, and every kind number, tag name, ordering rule and status
label it uses comes out of the manifest at runtime. Measured against production.

**Rendering worked completely.** Both projections came out with titles,
truncated subtitles, status labels resolved through the declared vocabularies,
display refs, and assignees resolved from a public key to a person's name —
indistinguishable from what Ship's own tooling prints.

The part that made it work is the part this document added to NIP-89 last:
`records`. Because the fold rule is declared — which kind carries changes, which
tags name the target, the field and the value, and how to break a tie when two
land in the same second — a stranger can apply it. The prediction was that
folding would be the gap, on the grounds that a manifest describes objects and
the fold is a behaviour. It is the part that already works, and it works
precisely because it stopped being left to convention.

**Everything relational was missing.** Six gaps, and they are one gap wearing
six hats:

| Asked | Missing |
| --- | --- |
| "list the open issues" | Nothing says which handled kind is the unit of work. `k` tags list 30850 and 30851 flat; the reader guessed from `widget: "row"`, which is a layout hint, not a type. |
| | The vocabulary gives every value and its label, but never which values mean *not finished*. Each consumer re-derives it and they will disagree. |
| "what is in project X?" | An issue carries `["d","title","h","a","ref"]`. Its projection reads four slots and none is the `a` tag. |
| | Nothing names the `h` tag or any container, so a query cannot be scoped to one Folder — only to everything. |
| "show me the discussion" | `kind:9` appears **only as an emitted kind** inside the `comment` action. No projection describes reading messages back. |
| "is that everything?" | With no declared discovery model, a reader cannot distinguish a whole workspace from a slice, and so cannot report its own coverage. |

**The sharpest of these is an asymmetry, not an omission.** The issue→project
link is fully described — in `add-issue`, as `setTag: 'a', toAddressOf: 'self'`.
So a consumer can *create* a correctly linked issue and then cannot *read the
link back*. The manifest currently says how to write a relationship and not how
to follow one, which is the exact inverse of what a reader needs.

That generalises past this one tag. §1.1 established the Folder as the universal
container and made records event-sourced; §3 then described objects one at a
time, as though a consumer would always arrive already holding one. That is true
of the case this document was written from — Peek renders an issue it received in
a message — and false of every consumer that has to go and look for something.

### What would close it

Three additions, in the same spirit as `records`: each states a rule the owner
already relies on, rather than adding a capability.

1. **A root.** Which kind a reader should start from, and which kinds are found
   through it rather than queried directly.
2. **A parent link.** The tag that carries an object's containing object, on the
   read side, as a projection slot rather than only inside an action.
3. **Containment.** The tag that scopes a query to one container, so a consumer
   can ask for part of a workspace instead of all of it.

With those, a reader could also state what it could not see — which matters more
for an agent than for a person. Somebody browsing sees projects and never forms
the belief they are looking at everything; an agent asked "what is still open?"
answers from whatever came back, and an array carries no hint that a third of the
data was never in scope.

**A finding to sit with rather than act on immediately:** because this reader has
no containment model, it never narrows, and it therefore saw *every* issue —
including the 13 that Ship's own discovery cannot reach, whose project records
were deleted out from under them. 31 against 18. That is luck rather than
correctness, and it should not be mistaken for an argument that unscoped reads
are better. What it does establish is that those issues are intact and readable,
and that the fault is in navigating from a parent that can be deleted, not in the
data.

---

## Open questions to carry into 0.3

1. ~~Multi-writer for non-git objects.~~ **Resolved** — event-sourced records,
   above. Files use git; records use root-plus-changes.
2. **Cross-org policy** (§1.3) — the only large unclaimed piece.
3. **Teams as a principal** (§2.1c).
7. **Folder nesting** — deferred by decision, needs a parent link when wanted.
4. **Comment anchoring inside a file.** Git has no addressable sub-file unit;
   GitHub uses `(commit, path, line-range)` and it is fragile across edits. This
   is the one place addressable Components were genuinely better.
5. **Widget governance** — who adds a widget type.
8. **Declared discovery** (§3) — a root kind, a read-side parent link and a
   containment tag. Raised by PEEK-150; without them a manifest describes
   objects a consumer must already be holding.
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
| Whether a manifest alone is enough to read an app | `scripts/manifest-reader.ts` in estiva-ship (PEEK-150) |
| Superseded File-kind draft | [nips/NIP-FC.md](nips/NIP-FC.md) |
