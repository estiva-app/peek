NIP-FC
======

Files and Components
--------------------

`draft` `optional` `superseded`

> **Superseded — do not propose.** [FILES_ARCHITECTURE.md](../FILES_ARCHITECTURE.md)
> argues that git provides folders, files, history and multi-writer merge, and
> that static components are markup rather than protocol. That resolves this
> draft's central open question (multi-writer) far better than any option
> sketched below. Kept as a record of the reasoning that led there; its one
> surviving idea is addressable sub-file units for anchoring comments.

This NIP defines `kind:30840` (a **File**) and `kind:30841` (a **Component**):
a shared business object composed of separately addressable parts.

## Motivation

Nostr has several document-shaped kinds — NIP-23 long-form, NIP-54 wiki articles,
NIP-B0 bookmarks — and all of them carry their whole body in `.content`. That is
correct for an article, and insufficient for a business object.

Business tools do not treat a document as one blob. They comment on a paragraph,
assign a checklist item, highlight a passage, and grant access to a section. Each
of those needs the *part* to be addressable, not just the whole.

This NIP splits the two: a File is an ordered list of Components, and a Component
is an addressable, typed unit of content. Existing NIPs then work on Components
for free — NIP-22 comments scope to any addressable event, NIP-84 highlights tag
one, NIP-32 labels one.

It deliberately does **not** define what Components contain. The protocol defines
the container and the addressing; applications define payloads. An ecosystem in
which every app must agree on a closed set of block types is not an ecosystem.

## Non-Goals

This NIP does not define folders — those are local organisation and NIP-51 lists
already cover them. It does not define access control, real-time collaborative
editing, or conflict resolution between concurrent writers (see *Open Questions*).

## File

`kind:30840`, addressable (NIP-33). Keyed by `(pubkey, kind, d)`.

```jsonc
{
  "kind": 30840,
  "tags": [
    ["d", "9f1c4e8a-2b7d-4c31-9e05-6a8f2d3b1c47"],   // stable File id (UUID)
    ["title", "Payment integration — kickoff"],
    ["h", "080054dc-c1e3-40da-b904-6863431a14de"],   // optional: channel scope
    // Components in document order. NIP-01 addressable references.
    ["a", "30841:<pubkey>:<component-d>"],
    ["a", "30841:<pubkey>:<component-d>"]
  ],
  "content": "{\"source\":\"https://meet.example.com/kickoff\"}"
}
```

- `d` MUST be present and stable for the life of the File. It SHOULD be a UUID.
  It MUST NOT encode the relay, organisation, or author — a File is portable, and
  an id that names its origin is not.
- `title` SHOULD be present.
- `h` MAY be present to scope the File to a NIP-29 group. Where a relay enforces
  group access, that enforcement then applies to the File.
- `a` tags list Components **in document order**. Order lives on the File, not on
  Components, so reordering is one edit in one place.
- `content` MAY be a JSON object of File-level metadata. Clients MUST tolerate an
  empty string and MUST ignore unknown members.

A File referencing a Component that cannot be resolved SHOULD render the rest of
the document rather than failing.

## Component

`kind:30841`, addressable (NIP-33). Keyed by `(pubkey, kind, d)`.

```jsonc
{
  "kind": 30841,
  "tags": [
    ["d", "c1a2b3d4-..."],                            // stable Component id
    ["a", "30840:<pubkey>:<file-d>"],                 // parent File
    ["type", "nfb/todo"],                             // namespaced type
    ["h", "080054dc-..."]                             // optional, mirrors the File
  ],
  "content": "{\"text\":\"Designer starts the Figma flow\",\"assignee\":\"<pubkey>\",\"done\":false}"
}
```

- `d` MUST be present and stable.
- `a` MUST reference the parent File. A Component belongs to exactly one File.
- `type` MUST be present and MUST be namespaced as `<namespace>/<name>`. The
  namespace SHOULD be a domain-like or vendor prefix. Clients MUST NOT assume a
  closed set, and SHOULD render an unknown type as its plain text content, or
  skip it, rather than failing.
- `content` is a JSON object whose shape is defined by `type`.

### Registered types

This NIP registers only a minimum for interoperable plain reading. Everything
else is application-defined.

| `type` | `content` |
| --- | --- |
| `nfb/text` | `{"text": string}` |
| `nfb/heading` | `{"text": string, "level"?: number}` |
| `nfb/list` | `{"items": string[], "ordered"?: boolean}` |

A client that understands only these three can render any File legibly, because
unknown Components degrade to their `content.text` when present.

## Composition with existing NIPs

Nothing below is new — it falls out of Components being addressable:

| Need | Mechanism |
| --- | --- |
| Comment on a part | **NIP-22** `kind:1111` scoped to the Component's `a` |
| Highlight a part | **NIP-84** `kind:9802` with an `a` tag |
| Categorise a part | **NIP-32** `L`/`l`, inline or via `kind:1985` |
| Attach a file | **NIP-94** / **NIP-92** `imeta` in the Component |
| Delete | **NIP-09** on the File or a Component |
| Open in the authoring app | **NIP-89** handler for `30840` |
| Reference external content | **NIP-73** `i` tags |

## Revision

Both kinds are addressable, so an edit is a republish with the same `d` and a
newer `created_at`. The relay keeps the latest; the event log keeps the history.
No revision kind is needed, and none is defined.

Editing one Component does not touch the File. Adding, removing or reordering
Components replaces the File.

## Relay Behaviour

Relays require no changes beyond storing NIP-33 addressable events. Relays that
allowlist kinds MUST add `30840` and `30841`.

Relays that enforce NIP-29 group membership SHOULD apply the same enforcement to
Files and Components carrying an `h` tag, so a File in a private channel is not
readable by non-members.

## Open Questions

Stated rather than hidden, because they are unresolved:

1. **Multi-writer.** NIP-33 addresses are `(pubkey, kind, d)`, so a File edited by
   two people is two addresses. This is fine for a single-author document and
   wrong for the collaborative case this NIP exists to serve. Three candidate
   answers, none adopted here:
   - *Owner-authored:* one key owns the File; others propose changes (git-shaped).
   - *Per-author versions:* NIP-54's answer — every author has their version,
     clients merge or choose.
   - *Component-level authorship:* each Component is owned by whoever wrote it,
     and only the ordering is contested. Attractive, but "Ana edits Ravi's
     paragraph" still has no address.

   **This is the central unresolved question and it should be settled before
   this draft is proposed anywhere.**

2. **Cross-organisation identity of a File.** §1.3 of the NfB RFC wants one File
   to exist on several relays. A stable `d` makes that expressible, but two
   copies with different authors are still two addresses — the same problem as
   (1), across a trust boundary.

3. **Ordering conflicts.** Order lives on the File, so two concurrent reorders
   are last-write-wins with no merge. Acceptable for documents edited by one
   person at a time; not for a live canvas.

4. **Kind numbers are provisional.** `30840`/`30841` were chosen because
   30820–30899 is unused in the NIP repository and in Buzz. Real allocation needs
   coordination.

## Implementation Status

Unimplemented at time of writing. Motivated by a concrete case: a call-summary
document with a title, headings, typed highlights and assignable todos, which
NIP-84 and NIP-32 together could carry the *content* of but not the *structure*.
