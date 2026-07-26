# Folders, Files and Components — working through the git model

Response to the proposal that **git provides folders and files**, leaving only
Components to design, split into **static** (markup) and **dynamic** (widgets).

**Verdict: the proposal is right, it is better than [NIP-FC](nips/NIP-FC.md),
and it makes NIP-FC largely unnecessary.** Details below, including what it
costs and the one place it genuinely leaves a gap.

---

## 1. "Buzz is using git on Nostr" — confirmed, and further along than assumed

Not patch-exchange-over-Nostr. **Real git hosting.**

`crates/buzz-relay/src/api/git/transport.rs` implements the git **Smart HTTP**
protocol:

```
GET  /git/{owner}/{repo}/info/refs        ref advertisement
POST /git/{owner}/{repo}/git-upload-pack  clone / fetch
POST /git/{owner}/{repo}/git-receive-pack push
```

Authenticated with **NIP-98 on every route**, including clone. You can
`git clone` and `git push` against a Buzz relay with a Nostr key.

**Permissions already exist, and are already unified.** From
`crates/buzz-core/src/git_perms.rs`:

> "The permission model: **channel role = repo role**; `buzz-protect` tags on
> kind:30617 add constraints that apply to everyone (including the owner)."

So repo access *is* channel membership — one permission system, not two. Plus
branch-protection rules declared as tags on the NIP-34 repo announcement. That is
further than "permissions are also doable": it is done, and done the way the RFC
wants (one identity, one permission model, many surfaces).

---

## 2. Why git is the better substrate — including for the thing I could not solve

I flagged one central unresolved problem in NIP-FC:

> NIP-33 addresses are `(pubkey, kind, d)`, so a File edited by two people is two
> addresses. Fine for a single-author document, **wrong for the collaborative
> case this NIP exists to serve.**

**Git solves exactly this, and has for twenty years.** Concurrent edits merge
rather than clobber. Nostr addressable events give you last-write-wins per
author; git gives you a merge model, conflict markers, and a history that
survives disagreement.

That one fact is close to decisive on its own.

What else comes free:

| Need | Under git | Under NIP-FC |
| --- | --- | --- |
| **Folders** | Native, hierarchical | Not modelled at all |
| **History** | Real: diffs, blame, branches | "Latest event wins" + scraping the log |
| **Multi-writer** | Merge | **Unsolved** |
| **Permissions** | Already built, = channel role | Not designed |
| **Large/binary files** | Known problem with known answers | Blossom, separately |

### And it answers §1.3 almost by accident

RFC §1.3 says: *"a File can belong to more than one org… exists on each
participating org's relay… no host database and no org that 'owns' the shared
project — each side holds its own copy."*

**That is a description of `git clone`.** Distributed copies, no central owner,
each side keeps its copy if the relationship ends — git's design brief.

One consequence to be explicit about: under this model files replicate by **git
push/pull, not by relay event sync**. NIP-77 Negentropy stops being the
interesting mechanism for files (it remains relevant for messages). Cross-org
file sharing becomes "a remote you are allowed to fetch from", which is a much
better-understood problem than inventing replication.

---

## 3. Static vs dynamic — the sharpest part of the proposal

This distinction is what collapses most of NIP-FC.

### Static components are not protocol

`h1`, `h2`, paragraph, table, list. These are **markup**. If a File is a git
blob, a heading is a line of Markdown. It does not need an event, an address, a
kind, or a registry.

NIP-FC made every heading a separately addressable Nostr event. Re-reading it
against this proposal, that is a lot of machinery to make a `##` addressable, and
it buys almost nothing: nobody needs to permission a heading or subscribe to it.

**Cut them.** Static structure is the file format's job.

### Dynamic components are the actual protocol work

A Linear ticket. A project with a filtered issue table. Your framing has two
parts and both are right:

1. **How it looks** — the rendering contract
2. **How to get current data** — the reference to resolve

The second is why this is not an embed or a screenshot. The document stores a
*pointer*; render time resolves it. That is what makes the widget live, and it is
the whole "components from other apps" claim in RFC §3.1.

---

## 4. What a dynamic component needs — mostly nothing new

Decomposing it against the NIP corpus:

| Part | Mechanism | Status |
| --- | --- | --- |
| Point at another app's object | `nostr:naddr…` / `nostr:nevent…` inline | ✅ **NIP-21** (URI scheme) + **NIP-19** (encoding) |
| Reference it from document text | ✅ **NIP-27** — text note references, exactly this pattern |
| Point at a *query*, not one object | a filter — needs a shape, but nothing new conceptually | 🔧 |
| Know which app owns that kind | ✅ **NIP-89** `kind:31990` handler declarations |
| Registry of available widgets | ✅ NIP-89 *is* the registry — your point 4 |
| **How to render it inline** | ❌ **the gap** — see below |

So a file could be Markdown containing `nostr:naddr1…`, and a client that
understands NIP-27 already knows that is a reference, and NIP-89 already tells it
which app handles that kind.

### The one genuine gap

**NIP-89 declares how to *open* an event in an app, not how to *render* it
inline.** Its `kind:31990` is about redirect targets — "open this in Linear at
this URL". A widget needs something else: an embeddable rendering.

That is the NIP to write, and it is small and well-scoped:

> Given a `nostr:` reference and a viewer that cannot interpret its kind, how
> does the owning app supply an inline rendering?

Candidate answers worth weighing: a declared iframe/embed URL; a data-shape
contract plus a viewer-supplied template; a signed HTML/JSON fragment. Each has
different trust and offline properties — an iframe hands the owning app your
render surface, a data contract keeps rendering local but constrains what the
widget can be.

**Naming it precisely: this is an embed extension to NIP-89, not a new document
model.** Far easier to propose than a File kind, and it is the thing your
scenarios actually need.

---

## 5. What this costs, honestly

The git model is better, not free.

- **A call summary becomes a git commit.** Heavier than publishing an event, and
  it needs a repo to exist first. Scenario 1's Meet app would need to commit and
  push rather than publish.
- **Reading a file is a git fetch, not a relay `REQ`.** Every client needs git
  access or the relay's HTTP git API. That is a real client-side cost, and it
  makes "just subscribe to everything" no longer true for files.
- **Frequent small edits are awkward.** Git commits are not keystrokes, so an
  app has to decide when to commit — see §6.
- **Discovery changes.** Finding files means listing a repo, not filtering
  events. Relay-side search (NIP-50) does not see inside git blobs.
- **Comments on part of a file lose their anchor.** Git has no addressable
  sub-file unit. GitHub solves this with `(commit, path, line-range)` and it is
  famously fragile across edits. This is the one place NIP-FC's addressable
  Components were genuinely better — worth revisiting if Scenario 2's pinned
  comments prove painful.

---

## 6. Real-time editing is deliberately app-local

Your point 2 — *"any kind of files is git versioned; separate things are messages
and discussion"* — raises the obvious objection: what about a Figma canvas or a
Google Doc, where several people type at once?

**The answer is that this does not belong on Nostr at all**, and that is a
principle rather than a workaround.

### Nothing available solves it anyway

Checked, not assumed:

| | Real-time co-editing |
| --- | --- |
| Git | No — but it merges, and keeps history |
| Buzz canvas (`kind:40100`) | No — `UPDATE channels SET canvas = $1`, a plain overwrite. Last writer silently erases the other |
| Any of the 99 NIPs | Does not exist. No CRDT, Automerge, Yjs or operational-transform mechanism anywhere |

So this is not a git shortcoming. Buzz's canvas is *worse* — git at least reports
a conflict instead of discarding someone's work.

### And it should not

An app building Figma-on-NfB would use its own real-time mechanism — a CRDT over
a websocket, whatever suits — and publish to Nostr **when there is something
worth committing.** Nothing is lost by that, and it follows directly from the
rule already adopted:

> Publish completed business actions that other apps need. Keep per-viewer
> state, derived state, and routing decisions local.

Keystrokes and cursor positions are the purest possible case of ephemeral local
state. A character typed is not a business action; a saved document is. Signing
and storing an event per keystroke would be absurd on any substrate.

This is also exactly how git already works: your editor does not commit every
keystroke. The commit is the unit that means something, and the same boundary
applies here.

**Interop lives at the commit boundary.** Another app does not need your
keystrokes — it needs the document. Publishing at the commit gives full
interoperability with none of the cost.

### Two small consequences

1. **Presence is a separate question, and is worth having.** Knowing *that* Ana
   is editing — as opposed to receiving her keystrokes — is genuinely useful
   across apps, and Nostr already carries it: `kind:20001` presence and
   `kind:20002` typing indicators, both ephemeral and never stored. So "who is
   in this document right now" can be shared without the editing traffic being
   shared.
2. **Each app must choose its commit boundary.** Commit on every pause and the
   history becomes noise; commit only on explicit save and collaborative context
   is lost. That is an application decision, but a demo should pick something
   deliberate rather than accidental.

## 7. Where this leaves the design

| Layer | Answer | New protocol? |
| --- | --- | --- |
| Folders | git tree | **No** |
| Files | git blob | **No** |
| History / revision | git | **No** |
| Permissions on files | Buzz: channel role = repo role | **No — already built** |
| Cross-org file sharing | git remotes | **No** (policy still open) |
| Static components | markup in the file | **No — not protocol** |
| Dynamic component: which object | `nostr:` URI, NIP-21/19/27 | **No** |
| Dynamic component: which app | NIP-89 | **No** |
| **Dynamic component: inline rendering** | — | **Yes — one small NIP** |
| Live collaborative editing | **App-local by design** (§6) | **No — deliberately out of scope** |
| Knowing who is editing now | `kind:20001` / `20002`, ephemeral | **No** |
| Comment on part of a file | git line-ranges, or revisit Components | Open |

**One new NIP instead of a document model.** That is a much better place to be
than where NIP-FC left things.

---

## 8. Consequences for what has been built

- **NIP-FC is superseded for Files and Folders.** Keep the draft as a record of
  the reasoning — its "Open Questions" section is what led here — but it should
  not be proposed. Its one surviving idea is addressable sub-file units for
  comment anchoring (§5).
- **The Meet app currently publishes a File + Components** (`kind:30840/30841`).
  Under this model it should commit Markdown to a repo instead. That is a rewrite
  of the publish path, not of the app.
- **The two relay patches stay useful.** `kind:9802` (NIP-84) is unaffected and
  ratified. `30840/30841` would become dead if this model is adopted — worth
  keeping on the branch until the decision is firm.

## 9. What to check next

Before committing to this, two things are worth verifying rather than assuming:

1. **Can a Buzz repo actually be created and pushed to from a script?** The
   transport is there; the provisioning path (`kind:30617` announcement → repo
   exists → push accepted) has not been exercised here.
2. **What does a Peek user's git identity look like?** Clone and push are NIP-98
   authenticated, so the same key custody question applies — and
   `git-credential-nostr` exists in the Buzz repo, which suggests the answer is
   already designed.
