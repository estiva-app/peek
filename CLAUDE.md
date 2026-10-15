# Peek — the real app

Peek is a team-communication app (DMs, Topics, Huddles, Screener, Desk).
It runs at peek.estiva.app. How to run and check it: `README.md`.

**The UI Guardrails project:** where it stands is `docs/GATES.md` §0 in the `estiva-ui` checkout beside this repository.
`npm run gates:status` here shows Peek's part of it, read from the code.

## Stack, build and test

- React 19 + Vite + TypeScript + Tailwind (the tokens come from the
  `@estiva-app/ui` preset) + Tiptap composer.
- Data: the relay, and nothing else (ADR 0001, `estiva-docs/decisions/`).
  Convex was deleted in REM-7. Config (`VITE_RELAY_URL`) in `.env.local`.
- Tests: Vitest (`npm run test:run`). Storybook: `npm run storybook`.
- **Type-check with `npx tsc -b`** — never `tsc --noEmit` (matches the build,
  which runs `tsc -b && vite build`).
- `npm run lint:rules` is the gate lint, `npm run lint:tokens` the token lint.
  Both run in CI's `gate` job, the one required check.

## The gate lint, and a session opened above this folder

Code that reaches past the package is refused (the `estiva-ui` skill lists
what, and the list grows with the package) before the write by its editor hook, which `.claude/settings.json`
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

**Pixel-perfect to the package, no exceptions: measure, never eyeball.**

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
- Skill `estiva-ui` (the package's) — before any screen work: `npm run
  ui:find` first, read the part's page, never hand-roll what it owns.
- Skill `verify` — to prove a change in the running app, or to measure a
  story in Storybook.
- The lints are the rest of the rules: `lint:rules` and `lint:tokens` name
  the fix in their message.

## Tests: house rules

Read these before writing or changing a test (agent or person). `/land`'s code
reviewer checks every new test in a PR against them (PEE-50, UNI-4).

- **Test what a person or the relay sees**: the rendered text, the enabled
  control, the event that goes on the wire, the row a reader gets back. Not how
  the code arrives there.
- **No tests of** constants, CSS class names, re-exports, type shapes, or
  debugging instruments (a `console.log` or a probe hook). They pass on a broken
  feature and fail on a harmless rename.
- **Fake timers, never real sleeps.** `vi.useFakeTimers()` and advance the clock;
  no `setTimeout` waits, no `sleep(…)`. Real waits fail under load and hide
  races.
- **Test writes at the wire.** A send, edit, delete or membership change is
  asserted on the signed event that would reach the relay (kind, tags, content,
  signer), not on a mocked helper being called.
- **A new test must fail on the bug it is for.** Run it on the code before your
  change: it must fail on an assertion, not on a missing import or a timeout.
  `/land` runs the same check (`old-code-check.mjs`) and, on a PR touching read
  state, access, membership or the wire, plants bugs in the changed lines
  (`plant-check.mjs`); a planted bug no test catches means a test is missing.
- **Mocking a module the code relies on is a decision.** If a test mocks a module
  (for example Ship mocks `./nip44`), something else must cover that module's own
  contract.
- **A test says what it guards**: its name states the behaviour and the case, so
  a red run reads as a real bug.
