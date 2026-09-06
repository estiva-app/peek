# Peek — the real app

Peek is a team-communication app (DMs, Topics, Huddles, Screener, Desk). This
repo is the production app grown out of the pixel-perfect prototype preserved
at `k:\PeekApp` (GitHub `cath23/Peek`, tag `prototype-v1`). See `PROTOTYPE.md`
and `MIGRATION.md` for lineage, and `PRDs/Peek-Product-Overview.md` for the
feature spec.

## UI: the shared package, and the rules every session follows

@UI-RULES.md

Every piece of UI in this app comes from `@estiva-app/ui`, or wraps it with
what only Peek knows, or draws a product object nothing else has. There is no
fourth kind. Before you write a component, a class list or a colour:

1. `UI-RULES.md`, imported above, is already in your context. Act on it, all
   of it.
2. Read `node_modules/@estiva-app/ui/src/<Component>.mdx` for how to use a
   component, and `Choosing.mdx` to pick one (in the `estiva-ui` checkout
   beside this repository under `stories/`, or the package Storybook on
   `:6008`). Do not use a component you have not read the page of.
3. Look in `src/components/ui/` for the shim or wrapper this app already has.

Never hand-write a popup, a menu, a dialog, a tooltip, keyboard navigation,
outside-click or focus handling, or a form control; the files that still do
are being replaced and are not to be copied. Never use a Tailwind default size
or colour (`text-sm`, `bg-gray-100`), a hex value, an opacity modifier on a
token (`border-warning-default/40`), or a class the preset does not define:
the token classes are doubled, `bg-bg-surface` and `text-text-primary`, and
`bg-surface` compiles to nothing. Until the lint that fails the build on these
lands, prove a class exists by building the CSS (`UI-RULES.md` §4).

If the component you need is missing or nearly fits: extend the package (a
ticket in `estiva-ui`, a prop added there), never a fork here. A fork without a
ticket is a defect. Every UI file has a story; a file without one is unreviewed
and is treated as broken until it has one.

## Stack

React 19 + Vite + TypeScript + Tailwind (custom design tokens in
`tailwind.config.js`) + Tiptap composer. Tests: Vitest (`npm run test:run`).
Storybook: `npm run storybook`. Backend: Convex (config in `.env.local`;
schema in `convex/schema.ts`, spec in `PRDs/Peek-Domain-Model.md`). Demo data:
`npx convex run dev/seedDemo:seed '{"wipe": true}'` — dev-only fixture;
**production launches with an empty database, no mock data**
(decision 2026-07-08). To sign in as the seed user, use
`dev/seedDemo:seedAs '{"pubkey": "<64 hex>"}'` — it stamps your Estiva ID
pubkey on Cath instead of minting a login, which is no longer possible.

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

## Working rules

- **Type-check with `npx tsc -b`** — never `tsc --noEmit` (matches the Vercel
  build, which runs `tsc -b && vite build`).
- **Pixel-perfect, no exceptions.** The prototype is the visual reference.
  Tokens only, never raw hex; every primitive comes from `@estiva-app/ui`
  through `src/components/ui/` (the UI section above, and `UI-RULES.md`),
  never re-hand-rolled.
- **tw-merge:** the package's `cn()`, re-exported from `src/lib/utils.ts`,
  knows the type ramp, so token size classes (`text-body-2`, `text-btn-small`)
  survive beside a text colour. Write the token; never bring a plain `twMerge`,
  which drops them. The old rule "use arbitrary values in shared components" is
  retired; migrate an arbitrary value to its token when you touch it.
- **Menus/popovers:** stay open on hover, close on mouse leave, guard the
  parent hover state, close on outside click and Escape.
- **Only offer actions that can succeed** — an action appears only in contexts
  where it works; the enabling surface advertises the capability.
- **On-device AI only.** The 2026-07-08 "no AI features" decision was narrowed
  on 2026-08-31 by PEE-5, which asked for Prompt API prefill in the launcher.
  What that settles: a model may run **locally** (Chrome's Prompt API / Gemini
  Nano) over a thread the viewer can already read, and a work thread must never
  be sent to a cloud model — that would be a disclosure, and the suite's whole
  position is that a Folder is readable only by its members. Anything
  cloud-hosted still needs a decision, not an implementation. It must also
  degrade to nothing: the API is desktop-Chrome-only and needs a downloaded
  model, so most people never see it and nothing may look broken for them
  (PEE-6). The prototype's cloud-shaped AI features stay for reference only.
- **Data access only through the seam.** Components/pages/extensions import
  app data exclusively from `@/api` (stories: `@/api/fixtures`) — never from
  `@/data/*` or `@/api/internal/*`. All writes go through `usePeekActions()`
  and stamp `CURRENT_USER_NAME` (the Phase 3 identity switch point). Extend
  the seam rather than bypassing it.

## Direction — PRODUCTION-PLAN.md is the single source of truth for progress

Phase 0 (domain spec) ✅ and Phase 1 (data-access seam) ✅ are done
(2026-07-08). Phase 2 (Convex persistence, hardcoded "You") is in progress:
schema deployed + demo data seeded + `ConvexProvider` wired; next is the
entity-by-entity hook swap (people → topics → messages → …), deleting one
`src/api/internal/` override layer per swap, with a skeleton/empty-state
Figma pass before the first visible swap. Then Phase 3 auth. Put a `userId`
on every new record from day one. Check off worklog items in the same commit
as the work; log decisions in the Decision log.
