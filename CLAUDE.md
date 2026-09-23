# Peek — the real app

Peek is a team-communication app (DMs, Topics, Huddles, Screener, Desk).
It runs at peek.estiva.app. How to run and check it: `README.md`.

**The UI Guardrails project:** where it stands is `docs/GATES.md` §0 in the `estiva-ui` checkout beside this repository.
`npm run gates:status` here shows Peek's part of it, read from the code.

## Stack, build and test

- React 19 + Vite + TypeScript + Tailwind (the tokens come from the
  `@estiva-app/ui` preset) + Tiptap composer.
- Data: the relay is canonical (ADR 0001, `estiva-docs/decisions/`); Convex
  is the projection and cache beside it. Config in `.env.local`; schema in
  `convex/schema.ts`.
- Tests: Vitest (`npm run test:run`). Storybook: `npm run storybook`.
- **Type-check with `npx tsc -b`** — never `tsc --noEmit` (matches the build,
  which runs `tsc -b && vite build`).
- `npm run lint:rules` is the gate lint, `npm run lint:tokens` the token lint.
  Both run in CI's `gate` job, the one required check.

## Convex: never `--prod`

`--prod` is wrong here: the live backend is `honorable-guineapig-592`, and
Convex labels it Development. Name it with `--url
https://honorable-guineapig-592.eu-west-1.convex.cloud`, or use the dashboard.

## The gate lint, and a session opened above this folder

A raw element, a rebuilt behaviour or a restyled package part is refused
before the write by the package's editor hook, which `.claude/settings.json`
runs — but that hook runs only in a Claude session started in this folder. A session started in a folder above it
(a workspace holding several repositories) does not get the hook, so: after
changing any `.ts` or `.tsx` under `src/`, run `npm run lint:rules` in this
repository and fix everything it reports before you finish.

## UI

Every piece of UI in this app comes from `@estiva-app/ui`, or wraps it with
what only Peek knows, or draws a product object nothing else has. There is no
fourth kind.

If the component you need is missing or nearly fits: extend the package (a
ticket in `estiva-ui`, a prop added there), never a fork here.

**Pixel-perfect, no exceptions.**

## Where the rest lives

Each rule file loads only once Claude reads a file its paths match,
also in a session started in the folder above.

- `.claude/rules/peek-ui.md` — a `.tsx` under `src/`, `src/index.css`,
  `tailwind.config.js`: the three kinds of UI file, what stays when a part
  moves into the package, Peek's own tokens, `cn()`, the theme, how to keep
  a refused line, only offer actions that can succeed.
- `.claude/rules/data-seam.md` — `src/components`, `pages`, `layouts`,
  `extensions`, `api`: read app data through `@/api`, write through
  `usePeekActions()`.
- `.claude/rules/on-device-ai.md` — the launcher and the Prompt API files:
  a model runs on the device, never in a cloud.
- `.claude/rules/convex.md` — `convex/` and `scripts/`: ADR 0001's three
  questions, the nine-field measurement, the deployment, schema changes.
- Skill `estiva-ui` (the package's) — before any screen work: `npm run
  ui:find` first, read the part's page, never hand-roll what it owns.
- Skill `verify` — to prove a change in the running app, or to measure a
  story in Storybook.
- The lints are the rest of the rules: `lint:rules` and `lint:tokens` name
  the fix in their message.
