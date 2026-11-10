# GATES-DEBT.md — what cannot pass a gate yet

Peek's debt list for the UI Guardrails (estiva-ui `docs/GATES.md` §21). Ship has
carried one since UIG-4; Peek's was missing until UIG-32, when the checks every
app runs came from the package and named it.

A file that cannot pass a gate yet is written here, with the gate, the reason
and the date it was written. A debt list is a promise; a file a gate skips
without a line here is a silent ignore, and that is a lie.

| file | gate | reason | since |
|---|---|---|---|

**Nothing is owed.** 17 September 2026: `npm run lint:rules` reads every `.ts`
and `.tsx` under `src`, stories included, tests out, and no file is excused. It
reports 0 errors for all three rules, and `npm run lint:tokens` reports 0 errors
(102 warnings, which are hand-written sizes and spaces, reported and never
blocked).

What is kept is kept in the open: on the line above it, naming the rule it
keeps off, `// @estiva-escape(<rule>): <reason>`. This page does not count them
by hand — the counts it once carried had drifted by 25 September.
`npm run gates:status -- --escapes` lists every one from the code, with its age
from git, and `npm run gates:status` shows the ones older than 30 days, to keep
with a new reason or fix (Katerina's rulings B1 and B3, 25 September).

An escape is not a debt: the code is in the open, counted, and named in a
ticket. A debt is a file a gate cannot read at all, and there is none.

## Folders the gate does not read

CI's job `gate` (`estiva-gates ci`) fails on a skipped folder that is not
named here (B11, B13).

| folder | why it is not checked |
|---|---|
| `demo-scenarios` | The Nostr-for-Business scenario player: a separate Vite app with its own `src`, Tailwind config and port (5200), built for a demo and not part of Peek's own build. Its own `STORYBOARD.md` says what it is. |
