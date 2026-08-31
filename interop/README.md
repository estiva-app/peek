# `interop/` — the manifest consumer runtime

**This directory is not Peek.** It is a peer of `src/` and `convex/`, and the
only thing in this repository that is written to leave it.

It holds the runtime that renders and acts on *another app's* objects from that
app's published NIP-89 `kind:31990` manifest — `resolveManifest →
resolveForeignObject → resolveActions → buildActionEvent`. Peek is currently its
only consumer. It is intended to become `@estiva-app/interop` (PRO-9), and it
will not be published until a second consumer has pushed back on its API
(PRO-7). That order is [SHA-7][adr]'s lesson, and it is deliberate.

## The rule this directory is under

[ADR 0002 §10][adr] — what makes an in-app implementation extractable. The four
constraints, and how they land here:

| | constraint | here |
| --- | --- | --- |
| 1 | No imports from the app's data layer, store or config | the entire import list is `@estiva-app/protocol` |
| 2 | Every environment touch is an injected parameter | the relay arrives as a `QueryFn`; there is no module-level state |
| 3 | Its tests run with no app | `projection.test.ts` pins `// @vitest-environment node` against a jsdom default |
| 4 | Put it where it is going | this directory, which is why it exists |

**Constraint 4 is why the move happened.** The runtime satisfied 1–3 from its
first commit and still lived at `convex/nostr/projection.ts` — a path that says
Convex about a file whose own header says it knows nothing about the app it
renders, and which no Convex function has ever imported. Convex's codegen listed
it as part of the deployed function surface for nothing.

## What may go in here

Anything that satisfies all four constraints and is about *consuming another
app's manifest*. Nothing else.

Two things that specifically do **not** belong, both because they are Peek's
half of the seam rather than the shared half:

- `src/nostr/foreign.ts` and `src/api/foreign.ts` — they supply the
  authenticated bridge and the app's data-seam wiring. They import *from* here.
  The dependency runs one way and must keep running one way.
- `src/nostr/liveProjection.ts` — batching and socket routing, which is a Peek
  concern about when to re-resolve, not how to resolve.

## The check anyone can run

```bash
grep -rhn "^import" interop/*.ts \
  | grep -vE "@estiva-app/protocol|from '\\./|'vitest'"
```

Empty output means constraint 1 still holds: the module imports only the
protocol package and itself, and the test adds only its runner. Anything else
is the extraction getting more expensive, and it is much cheaper to notice here
than in the PR that tries to move the directory.

`vitest` is exempt because a test runner travels with the package. `@/…`,
`../src/…` and `../convex/…` are the imports that must never appear.

[adr]: https://github.com/estiva-app/estiva-docs/blob/main/decisions/0002-foundation-packages.md
