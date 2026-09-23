---
paths:
  - "convex/**"
  - "scripts/**"
---

# Convex in Peek

## Convex takes no new state the relay already holds

**Before adding a table or a field to `convex/schema.ts`, answer ADR 0001 §3's
three questions in order** (`estiva-docs/decisions/0001-relay-canonical-by-default.md`):

1. Does another app need to see it? → **layer 1**: the relay, a standard kind.
2. Otherwise, would the person reasonably expect to own, export or take it with
   them? → **layer 2**: the relay, `kind:30078`, app-namespaced `d` tag,
   NIP-44 encrypted.
3. Otherwise, **and only if it needs a query, an index, aggregation,
   server-side compute or size** → **layer 3**: Convex.

Layer 3 is legitimate and permanent. The rule is only that state does not
*start* there. ADR 0001 §5 states the form that binds this repository:

> Convex may never be the source of truth for something the relay owns, and
> never the only home for something a person would reasonably expect to own.

A change that takes layer 3 says in its PR **which** of the five — query,
index, aggregation, compute, size — the state needs, and names the shipped
feature that shows it. **"Only Peek reads it" is not one of the five** (§2);
that conflation is what the ADR was written to stop. The check is on the PR
template.

### The measurement this rule comes from

Nine fields were added to `convex/schema.ts` in the fortnight to 2026-09-14
(`git diff 2d6e2ed~1 3e3d130 -- convex/schema.ts`). **Eight mirror a field the
relay already holds; the ninth exists only to report a gap in that mirror.**

| Field | What the relay already holds |
|---|---|
| `sha256` `:58` | `imeta` `x` |
| `mediaUrl` `:60` | `imeta` `url` |
| `thumbUrl` `:62` | `imeta` `thumb` — read at `nostr/sync.ts:142`, written back at `nostr/outbox.ts:78` |
| `dim` `:64` | `imeta` `dim` |
| `editedAt` `:225` and `:269` | the `kind:40003`'s own `created_at` — mirrored twice, once per table |
| `nostrBlockId` `:235` | the imported event's block anchor, SPEC §13.6 |
| `replyId` `:280` | the `kind:7`'s `e` tag, re-expressed as a Convex id |
| `reactionTargetsOmitted` `:134` | **nothing** — it counts what Peek's own sync did not ask for (`nostr/data.ts:672`) |

Not one is state Peek owns independently of the mirror. `schema.ts:49` states
the tax in its own words: `storageId` and `sha256` are "two different
identities and a row has at least one."

Two corrections to how this was filed, so it is not re-argued from memory.
SHR-1 counted **seven**, omitting `thumbUrl` and `dim`; both are relay-computed
and both are mirrors, so the count is nine. And its "not one represents data
Peek owns" is true of the eight but not of `reactionTargetsOmitted`, which is
Peek's own sync bookkeeping — it is on the list because it would not exist
without the mirror, not because the relay holds it.

## Convex deployment — read before running anything against it

**The deployed backend is `honorable-guineapig-592`, and Convex labels it a
*Development* deployment** (`[Development] jan-miky:estiva-peek:dev/jan-miky`
in the deploy log). That is what `.github/workflows/deploy.yml` pushes to and
what peek.estiva.app talks to.

So **`--prod` is wrong here.** It resolves somewhere else and will happily
report a reassuring nothing about a database nobody is using. Name the target
explicitly instead:

```
npx convex run <fn> --url https://honorable-guineapig-592.eu-west-1.convex.cloud --admin-key '<deploy key>'
```

or just use the dashboard, which is already pointed at the right deployment.
`.env.local` has pointed at a different deployment than the live one more than
once; treat it as a hint, never as the answer. This has misled work here
repeatedly, including a custody audit that confidently reported users who do
not exist.

### Schema changes fail asymmetrically

**Removing a field from a table's validator fails the entire push** — not just
that table — for every row that still carries it:

```
Object contains extra field `nostrSecretKey` that is not in the validator.
```

So a column can only leave the schema after a sweep has cleared it from every
row. Ship the sweep first, run it, confirm zero, then remove the field.

**Removing a whole table does not.** Schemas only validate documents in the
tables they list, so dropped tables leave inert, unreachable rows behind —
they neither block a push nor appear in `TableNames`. Convex Auth's tables are
still there for exactly this reason.

Neither of these is visible to `tsc`, `vite build` or the test suite. Nothing
local runs Convex's module loader, so **push failures are discovered at deploy
time** — see `convex/runtime.test.ts` for the one such rule that can be checked
without a deployment (`"use node"` files may export only actions).

## New records

Put a `userId` on every new record from day one.
