# NIP survey — what to reuse, what's actually missing

**Purpose:** input for refining NfB RFC 0.2. For each thing the RFC needs, this
answers one question: **does a NIP for it already exist?**

**Why it comes first.** [COMPATIBILITY_GAP_ANALYSIS.md](COMPATIBILITY_GAP_ANALYSIS.md)
asked "what does *Buzz* have?" — but Buzz implements roughly 20 of the 99 NIPs.
Something absent from Buzz may still be a solved, standardised problem. Writing
"what's missing" from the Buzz view alone would have produced proposals for
things that already exist, which is the most expensive mistake available in
standards work because it looks like progress while you make it.

**Source:** `github.com/nostr-protocol/nips`, 99 NIP files, cloned to `~/nips`.
Read for coverage, not implemented. Where a NIP is *close but the wrong shape*
that is stated rather than smoothed over.

---

## Headline findings

**Four things you were about to invent already exist:**

1. **Highlights is NIP-84** (`kind:9802`). I recommended writing this as your
   first NIP. Don't — read it first. It is a *different shape* to RFC §1.4a
   (see §1.4 below), but it is the incumbent and any proposal has to reckon
   with it.
2. **App manifests are NIP-89** (`kind:31989`/`31990`) — RFC §3.1 is largely a
   solved problem that Buzz simply hasn't adopted.
3. **Relay-to-relay sync is NIP-77** (Negentropy). RFC §1.3's *transport* exists
   and is specified. Its *trust model* does not.
4. **Key custody is NIP-46** (Remote Signing). The "server-held keys are
   PoC-grade" problem rated **Large** in the gap analysis has a standard answer.

**Two things are genuinely unclaimed, and they are the RFC's centre:**

- **The Folder / File / Component model (§1.1).** Nothing in 99 NIPs is
  document-with-parts shaped. `grep -il folder *.md` returns nothing.
- **Cross-org trust and replication policy (§1.3).** No federation NIP exists.
  NIP-77 moves events between relays; nothing says *which* events, *to whom*, or
  *on whose authority*.

---

## Mapping, by RFC section

Legend: ✅ **reuse as-is** · 🟡 **exists but wrong shape** · 🔧 **primitive
exists, needs a layer** · ❌ **nothing**

### §1.1 Structure — Folder / File / Component

| Need | Verdict | Nearest |
| --- | --- | --- |
| **File** — a shared business object | ❌ | **NIP-54 Wiki** (`kind:30818`) is the closest: an addressable, collaboratively-edited article identified by a normalized `d` tag, explicitly expecting multiple authors on the same subject. Also NIP-23 long-form (`30023`), NIP-B0 web bookmarks (`39701`), NIP-C0 code snippets |
| **Component** — smallest structured unit inside a File | ❌ | Nothing. No NIP models intra-document parts as separately addressable things |
| **Folder** — local container | 🟡 | **NIP-51 Lists** — arbitrary references, public *or* NIP-44-encrypted private items in one event. RFC says folders are local, and NIP-51 sets are exactly "a user's private collection of references" |
| Attaching binaries to a File | ✅ | **NIP-94** file metadata, **NIP-92** `imeta` tags, **NIP-B7** Blossom |
| Referencing non-Nostr content | ✅ | **NIP-73** External Content IDs (`i`/`k` tags) |

**This is the real work.** Everything else in the RFC hangs off it, and nothing
in the corpus defines it. NIP-54 is worth reading closely as prior art for
"multiple parties, one addressable subject".

### §1.2 Collaboration and revision

| Need | Verdict | Nearest |
| --- | --- | --- |
| Files as evolving histories | ✅ | Free — Nostr is append-only, addressable events supersede by `created_at` |
| Edits | ✅ | Addressable-event replacement (NIP-01 §33 semantics) |
| Deletion | ✅ | **NIP-09** requests; **NIP-62** Request to Vanish for a hard, legally-oriented erase |
| Drafts | ✅ | **NIP-37** (`kind:31234`) — NIP-44-encrypted unsigned drafts of any kind |
| Comments on a File | ✅ | **NIP-22** (`kind:1111`) — generic threaded comment scoped to *any* root event or external id. Unlike NIP-10 it is not note-specific, so it works on Files/Components as soon as those exist |
| Importing history with real timestamps | ❌ | Nothing. See [FRICTION.md](FRICTION.md) A1 — and note this is a *Buzz* restriction (±15min), not a Nostr one |

### §1.3 Cross-org collaboration

| Need | Verdict | Nearest |
| --- | --- | --- |
| Moving events between relays | 🔧 | **NIP-77 Negentropy** — range-based set reconciliation, `NEG-OPEN`/`NEG-MSG`/`NEG-CLOSE`, and the spec explicitly says it "works for both client-relay and **relay-relay** scenarios". This is the transport §1.3 needs |
| Declaring where a thing lives | ✅ | **NIP-65** relay list metadata; **NIP-66** relay discovery/liveness |
| Domain-anchored identity | 🔧 | **NIP-05** maps a key to a DNS domain via `/.well-known/nostr.json`. It authenticates *a key against a domain* — not *an org to another org*. Half of what §1.3 asks for |
| Third-party attestations | 🟡 | **NIP-85 Trusted Assertions** — signed, addressable assertions about pubkeys/events from declared providers. Shaped for web-of-trust scoring, but the pattern generalises |
| **Which events replicate, to whom, under whose authority** | ❌ | **Nothing.** No federation NIP. `grep -il federat` finds only NIP-EE (E2EE messaging, unrecommended) and NIP-87 |

**Read this way, §1.3 is smaller than it looked.** You are not inventing sync —
you are inventing the *policy layer* on top of an existing sync protocol. That is
a much more tractable proposal, and "reuses NIP-77" is a far stronger pitch than
"new replication protocol".

### §1.4 AI memory and highlights

| Need | Verdict | Nearest |
| --- | --- | --- |
| **Highlights** | 🟡 | **NIP-84** (`kind:9802`) exists — but it highlights *a passage of text*: `.content` is the highlighted excerpt, with `e`/`a`/`r` tags for the source. RFC §1.4a is different: mark *a whole File or Component as significant*, scoped to person/team/org. Related, not the same |
| **Categorising** (Peek's insight/concern/conclusion/question/summary) | 🟡 | **NIP-32 Labeling** (`kind:1985`, `L` namespace + `l` label) — designed for "content classification" and "collection management", attached to existing events. **Arguably a better fit than NIP-84** for Peek's `highlightType`, and it is namespaced so NfB could define its own vocabulary without a new kind at all |
| Append-only observation log | ✅ | Free — regular events are append-only by construction |
| Org-owned, portable memory | 🔧 | No NIP; but it is regular events on your relay, which is most of the requirement |
| Derived data staying app-local | ✅ | **NIP-78** (`kind:30078`) is explicitly "app data that does not care about interoperability" — the standard home for exactly what the RFC says should *not* be shared |

**The most useful realisation here:** NIP-32 might mean you need *no new kind*
for highlights at all — just a registered label namespace. That is a far easier
proposal to land than a new event kind.

### §2 Identity, authentication, permissions

| Need | Verdict | Nearest |
| --- | --- | --- |
| Users | ✅ | NIP-01 keypairs, NIP-05 DNS names, NIP-39 external identity links |
| **Key custody without the app holding secrets** | ✅ | **NIP-46 Remote Signing** — bunker URLs, remote signer separate from client. Also **NIP-07** (browser extension), **NIP-55** (Android signer), **NIP-49** (`ncryptsec` encrypted keys at rest). Directly addresses the identity gap rated *Large* |
| One auth mechanism across apps | ✅ | **NIP-42** relay auth, **NIP-98** HTTP auth |
| Teams as a principal | ❌ | Nothing. NIP-29 has per-group roles; there is no reusable "team" identity |
| Orgs | 🟡 | NIP-29 groups, or the relay itself. No org entity |
| Apps as identities | ✅ | **NIP-89** `kind:31990` is an app declaring itself |
| Author-only writes | ✅ | **NIP-70** Protected Events (`["-"]` tag) |
| Per-resource permissions | ❌ | Only NIP-29 group membership. Nothing scopes access to a document or a part of one |

### §3 Discoverability

| Need | Verdict | Nearest |
| --- | --- | --- |
| **App manifest + registry** | ✅ | **NIP-89**. `kind:31990` = "I handle kind X, here is how to open it"; `kind:31989` = "I recommend this app for kind X". This is §3.1 |
| Rendering another app's link | ✅ | NIP-89 handler `d` tags + NIP-21 `nostr:` URIs + NIP-19 entity encoding |
| **Agent manifest — skills/actions** | ❌ | Nothing. Buzz's persona/managed-agent events (30175/30177) are the closest anywhere, and they stop short of declaring invocable skills |

---

## What is genuinely new

Only four things, which is fewer than RFC 0.2 implies:

1. **File / Component data model** (§1.1) — the load-bearing one.
2. **Cross-org trust and replication policy** (§1.3) — the *policy*, on top of
   NIP-77's transport.
3. **Teams and per-resource permissions** (§2.1c, §2.3b) — both depend on 1.
4. **Agent skill declaration** (§3.2).

Everything else in the RFC is reuse, adoption, or a label namespace.

---

## Suggested reading order for refining RFC 0.2

Short list, highest value first:

1. **NIP-54** (Wiki) — prior art for collaboratively-edited addressable objects
2. **NIP-32** (Labeling) — may remove the need for a Highlights kind entirely
3. **NIP-84** (Highlights) — the incumbent your §1.4a must reckon with
4. **NIP-89** (App Handlers) — §3.1, largely solved
5. **NIP-77** (Negentropy) — §1.3's transport
6. **NIP-22** (Comment) — generic threading for whatever a File turns out to be
7. **NIP-46** (Remote Signing) — the identity/custody answer
8. **NIP-51** (Lists) — folders, and the public/private-in-one-event pattern

---

## Caveats

- **Read for coverage, not implemented.** "Exists" means a NIP specifies it, not
  that it is widely deployed or that Buzz supports it. Several of these Buzz does
  not implement at all.
- **Most NIPs are `draft` `optional`.** Even NIP-84 and NIP-89 are drafts.
  "Already exists" means "already claimed and specified", not "settled".
- **Kind-number collisions are a real risk.** Any new NfB kind must be checked
  against the full corpus, not just Buzz's registry — Buzz's own history shows it
  twice picked numbers it later had to correct as "wrong".
- This survey answers *what exists*. It does not judge whether the existing shape
  is good enough for NfB — that is the RFC refinement itself.
