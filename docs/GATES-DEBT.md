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

What is kept is kept in the open, on the line above it, and counted in
`.gates-count.json` — 16 escapes, each with its reason:

- `estiva/no-raw-element` — 1. UIG-3 found 16 raw `<button>`: 8 became the
  package's `Button`, 7 went with the Signal Theme page, 1 is escaped. UIG-7
  then found 3 more raw elements and replaced all 3.
- `estiva/no-rebuilt-behaviour` — 13. UIG-8 found 15: 2 fixed, 13 kept with
  their reasons, seven of them the `/ @ [` editor menus, which UIG-31 will make
  one shared part.
- `estiva/no-restyled-part` — 2. UIG-9 found 23: 16 fixed, 5 drawn by new props
  on the package's parts, 2 kept — a row that is one link, and a search field
  that is a button, neither of which the package has a part for yet.

An escape is not a debt: the code is in the open, counted, and named in a
ticket. A debt is a file a gate cannot read at all, and there is none.
