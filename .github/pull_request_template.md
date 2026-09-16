<!--
  Peek has no required PR shape, and this template does not impose one — delete
  anything that does not apply. It exists for one check, because one class of
  change went in nine times in a fortnight without anybody being asked.
-->

## What this changes

## Convex schema

Tick one:

- [ ] This PR adds **no** table or field to `convex/schema.ts`.
- [ ] It does, and here is which of ADR 0001 §3's five the state needs — a
      **query**, an **index**, **aggregation**, **server-side compute**, or
      **size** — and the shipped feature that shows it:

      <!-- … -->

**"Only Peek reads it" is not one of the five** (ADR 0001 §2), and neither is
"it is easier here". If the answer is none of the five, the state goes to the
relay: layer 1 for anything another app reads, layer 2 (`kind:30078`,
app-namespaced `d` tag, NIP-44) for anything the person would expect to own.

The rule, the reasoning and the nine-field measurement behind it are in
`CLAUDE.md` → *Convex takes no new state the relay already holds*.
