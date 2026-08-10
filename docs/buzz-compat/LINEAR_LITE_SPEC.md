# Linear-lite — MVP spec

The second real app on the shared data layer. Deliberately minimal: **Projects and
Issues, a few properties, comments.** No cycles, no roadmaps, no custom fields, no
views, no automations.

**Why Linear-lite first, before Notion-lite:** it delivers all three of the claims
worth demonstrating, and Peek — which already speaks Nostr both ways — is the host
app that renders its widgets. Notion adds the *document* dimension but no new
protocol claim, and it carries the block-editor risk. This one also sidesteps the
files/git question entirely, because issues are records, not documents.

| Claim | Delivered by Linear-lite alone |
| --- | --- |
| Shared data layer, no integration | ✅ two apps, one relay |
| Cross-app commenting | ✅ Peek ↔ Linear via NIP-22 |
| Live widgets from another app | ✅ a Linear issue rendered inside Peek |
| App manifest actually used | ✅ Linear declares, Peek consumes |

---

## 1. Objects

Kind numbers are **provisional** — 30820–30899 and 185x are unused in the NIP
repository and in Buzz.

**Every object carries `h` — the Folder.** That is both how things are grouped and
how access is enforced, so it is required, not optional
([RFC_UPDATES.md](RFC_UPDATES.md) §1.1).

### 1.1 Project — `kind:30850`

```jsonc
{
  "kind": 30850,
  "tags": [
    ["d", "<uuid>"],
    ["title", "Payment integration"],
    ["h", "<folder-id>"],                  // REQUIRED — the Folder
    ["lead", "<pubkey>"]                   // optional
  ],
  "content": "Stripe Checkout for workspace billing — redirect flow, no custom card form."
}
```

Authored by whoever created it. Editable in place **by its author only** — for
anything others change, see §1.3.

### 1.2 Issue — `kind:30851`

The **root** event. Immutable facts about the issue: what it is and where it
lives. Mutable state (status, assignee) is *not* here.

```jsonc
{
  "kind": 30851,
  "tags": [
    ["d", "<uuid>"],
    ["title", "Billing entry + add payment method"],
    ["h", "<folder-id>"],                  // REQUIRED
    ["a", "30850:<pubkey>:<project-d>"],   // parent project, optional
    ["ref", "PEE-127"]                     // display-only key
  ],
  "content": "Entry point in settings, plus the empty-state when no card is on file."
}
```

### 1.3 Change — `kind:1851`

**The important one.** A regular (append-only) event that sets one field on one
object. This is how status and assignee change, and it is what makes the model
work with more than one person.

```jsonc
{
  "kind": 1851,
  "tags": [
    ["a", "30851:<pubkey>:<issue-d>"],     // the object being changed
    ["field", "status"],
    ["value", "in_progress"],
    ["h", "<folder-id>"]
  ],
  "content": ""                            // optional human note
}
```

**Why not just edit the issue?** NIP-33 addresses are `(pubkey, kind, d)`, so only
the author can replace their own event. Ana creates an issue and Ravi closes it —
Ravi *cannot* rewrite Ana's event. In a tracker that is the normal case.

**Reading current state** is a fold: take the root, then apply changes in
`created_at` order, last write per field wins. Two consequences worth having:

- **The activity feed is free.** It *is* the change stream.
- **Nobody rewrites anyone's event**, so no permission gymnastics.

Precedent: NIP-34's git statuses (`1630`–`1633`) work exactly this way, and Buzz's
own `kind:9000` add-member is an event rather than an edit to a channel object.

> **Design alternative worth testing:** for purely categorical fields, a **NIP-32**
> label (`kind:1985`, `L`/`l`) says almost the same thing using an existing NIP —
> `["l","done","linear.status"]` on the issue. It fits status and priority well
> and assignee badly (a pubkey is not a label). One generic change kind is chosen
> here for consistency across fields; if it survives contact with the MVP, the
> categorical cases could migrate to NIP-32 and shed a kind.

### 1.4 Comments — no new kind

**NIP-22** `kind:1111`, which scopes to any addressable event. Both apps read the
same comments. Cross-app commenting, for free.

## 2. The manifest

**NIP-89** `kind:31990` plus the projection/actions extension described in
[RFC_UPDATES.md](RFC_UPDATES.md) §3. This is the part that is genuinely new
protocol, and the reason to build this app.

```jsonc
{
  "kind": 31990,
  "tags": [
    ["d", "linear-lite"],
    ["k", "30850"],                        // NIP-89: kinds this app handles
    ["k", "30851"]
  ],
  "content": {
    "name": "Linear-lite",
    "about": "Projects and issues",

    // ── The projection: how MY objects look in YOUR app ──
    "projections": {
      "30850": {
        "widget": "card",
        "slots": {
          "title":    { "tag": "title" },
          "subtitle": { "field": "content", "truncate": 120 },
          "status":   { "tag": "status", "map": "statuses" },
          "meta":     [{ "label": "Lead", "tag": "lead", "as": "pubkey" }]
        }
      },
      "30851": {
        "widget": "row",
        "slots": {
          "title":  { "tag": "title" },
          "status": { "tag": "status", "map": "issueStatuses" },
          "meta":   [
            { "tag": "ref" },
            { "label": "Assignee", "tag": "assignee", "as": "pubkey" }
          ]
        }
      }
    },

    // ── Vocabularies, so a consumer can render and validate ──
    "vocabularies": {
      "statuses": [
        { "value": "planned",     "label": "Planned",     "colour": "neutral" },
        { "value": "in_progress", "label": "In Progress", "colour": "blue" },
        { "value": "completed",   "label": "Completed",   "colour": "green" },
        { "value": "cancelled",   "label": "Cancelled",   "colour": "muted" }
      ],
      "issueStatuses": [
        { "value": "todo",        "label": "Todo",        "colour": "neutral" },
        { "value": "in_progress", "label": "In Progress", "colour": "blue" },
        { "value": "done",        "label": "Done",        "colour": "green" },
        { "value": "cancelled",   "label": "Cancelled",   "colour": "muted" }
      ]
    },

    // ── Actions: what another app may DO, and how ──
    // The consumer publishes the event itself; this says what to publish.
    "actions": [
      {
        "id": "set-issue-status",
        "label": "Change status",
        "appliesTo": "30851",
        // A change event authored by whoever acts — NOT a rewrite of the issue.
        "emits": { "kind": 1851, "field": "status" },
        "input": { "type": "string", "enum": "issueStatuses" }
      },
      {
        "id": "assign-issue",
        "label": "Assign",
        "appliesTo": "30851",
        "emits": { "kind": 1851, "field": "assignee" },
        "input": { "type": "pubkey" }
      },
      {
        "id": "add-issue",
        "label": "Add issue",
        "appliesTo": "30850",
        "emits": { "kind": 30851, "setTag": "a", "toAddressOf": "self" },
        "input": {
          "type": "object",
          "properties": { "title": { "type": "string" } },
          "required": ["title"]
        }
      }
    ]
  }
}
```

### Notes on the design

- **Actions emit change events, not rewrites.** `kind:1851` authored by whoever
  acts. This is what lets Ravi close Ana's issue — see §1.3. Only `add-issue`
  creates a new object.
- **`enum` points at a vocabulary** rather than inlining values, so the status list
  is declared once and used for both rendering and validation.
- **Widget + slots, not layout.** Peek renders a `card` in Peek's design system.
  Linear-lite decides *which fields*; Peek decides *how it looks*.
- **`as: "pubkey"`** tells the consumer to resolve a profile rather than print hex.

### The honest gap

Peek writes into the shared object space directly, with nothing validating it. That is the intended model
([RFC_UPDATES.md](RFC_UPDATES.md) §3), and the `input` schema is the only thing
preventing corruption. Worth watching in practice — it is the first real test of
the honour-system assumption.

---

## 3. What Peek has to do

Peek is already the host app, so this is additive:

1. **Recognise a reference.** A `nostr:naddr…` in a message body pointing at
   `30850`/`30851` (NIP-21/NIP-19 encoding, NIP-27 pattern).
2. **Resolve the manifest.** Query `kind:31990` for one declaring `k` = that kind.
   Cache it.
3. **Fetch the object** and render the declared widget with Peek's own components.
4. **Offer the declared actions** — a status dropdown built from the vocabulary,
   publishing the replacement event.
5. **Show comments** — `kind:1111` referencing the object, which Peek can already
   almost do.

Step 4 is the moment the claim becomes visible: **changing a Linear issue's status
from inside Peek, with no integration between the two apps.**

---

## 4. Relay work

Three kinds to add to Buzz's registry, in the same two files as the previous
patches (`crates/buzz-core/src/kind.rs`, `handlers/ingest.rs`):

| Kind | For |
| --- | --- |
| 30850, 30851, **1851** | Project, Issue, Change |
| **31989, 31990** | **NIP-89** — needed regardless, since Buzz doesn't have it |
| 1111 | **NIP-22** comments — check whether Buzz has it; not in the registry as far as I saw |

`31989`/`31990` and `1111` are **ratified NIPs Buzz simply hasn't adopted**, so
those patches are uncontroversial and worth upstreaming separately from the
provisional 30850/30851.

---

## 5. Scope discipline

Explicitly **not** in the MVP, because "simplified Linear" is where this project
would otherwise die:

sub-issues · cycles/sprints · roadmaps · custom fields · saved views and filters ·
labels · attachments · notifications · search · keyboard shortcuts beyond the
basics · drag-to-reorder · burndown anything

Two properties per object beyond title and status. If a demo beat does not need
it, it does not exist.

---

## 6. Build order

1. **Relay patch** for 31989/31990 and 1111 first — ratified kinds, proves the
   path, and Peek needs them anyway.
2. **Linear-lite's own CRUD** — publish and read projects and issues, its own UI.
   No manifest yet. Verifiable on its own.
3. **Publish the manifest.** Still no consumer; just an event.
4. **Peek consumes it** — resolve, render a widget, show comments. **This is the
   demo.**
5. **Actions** — status change from inside Peek. The strongest single moment.
6. Comments from Linear-lite on a Peek message, for symmetry.

Steps 1–3 are self-contained and independently checkable. Step 4 is where the
protocol claim becomes visible, and step 5 is what people will remember.

## 7. Open questions before building

1. ~~Do issues need an `h` tag?~~ **Resolved:** yes, and it is the Folder.
2. ~~Who owns the `d` for an issue Peek created?~~ **Resolved:** the person who
   created it. Apps are not identities. Changes by *other* people are `kind:1851`
   events rather than rewrites — §1.3.
3. **How does a consumer discover *which* manifest wins** if two apps claim the
   same kind? NIP-89's `kind:31989` recommendation mechanism partly answers this.
4. **Does the fold need conflict rules beyond last-write-wins per field?** Two
   people setting status in the same second is rare but not impossible; event id
   is a stable tie-break.
