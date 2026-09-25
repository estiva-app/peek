import { appChecks } from '@estiva-app/ui/gates'

/**
 * What gates:status checks in peek.
 *
 * The checks every app runs are the package's own piece, `appChecks` in
 * `@estiva-app/ui/gates` (UIG-32, estiva-ui docs/GATES.md §23). Peek's list is
 * that, plus the checks about Peek's own code — its wrappers, what its adoption
 * deleted, its launcher — which no other app can run. `npm run gates:compare`
 * in estiva-ui is what decides which is which: every check here was either in
 * the package's list already, or reads a file only Peek has.
 *
 * `owner: true` is a ticket peek owns. `owner: false` is peek's part of a
 * ticket another repo owns. The list of all tickets, and who owns each, is in
 * estiva-ui's scripts/gates-checks.mjs. Run gates:status there to see them all
 * together.
 *
 * A check for a ticket that is not built yet is a first guess at the evidence,
 * taken from the ticket's own text. The ticket that builds it confirms or
 * changes its checks, here and in estiva-ui docs/GATES.md §15, in the same
 * session.
 */
export default function define(h) {
  const PROBE = "src/components/__gates_probe__.tsx";
  const GATES = "eslint.gates.config.js";
  const probe = (code, expect, mentions, file = PROBE, config = GATES) => () => h.lint({ config, file, code, expect, mentions });
  const component = (body) => `export function Probe() {\n  return ${body}\n}\n`;

  // Peek's own: a ticket of Peek's, or a check that reads a file only Peek has.
  const own = [
    { ref: "UIG-9", checks: [
      { what: "a part re-exported from Peek's own file is followed", run: probe(`import { Button } from '@/components/ui/Button'\n${component('<Button className="text-h2">x</Button>')}`, "error", "on `Button` changes how it looks") },
      { what: "a wrapper that hands its props on is followed: padding on Peek's EmptyState is an error", run: probe(`import { EmptyState } from '@/components/ui/EmptyState'\n${component('<EmptyState className="py-6" />')}`, "error", "EmptyState takes no padding") },
      { what: "a component that hands its className on is followed", run: probe(`import { ConversationCard } from '@/components/ConversationCard'\n${component('<ConversationCard className="bg-bg-hover" />')}`, "error", "hands its `className` to `Card`") },
    ] },
    { ref: "UIG-17", title: "Usage rules — Peek's own components", owner: true, checks: [
      /*
        Both checks here were first guesses from the ticket's own text, and both
        were wrong in a way worth recording. One named `PendingAttachmentChip`,
        which UIG-35 deleted — a check can name a file that no longer exists and
        simply fail for ever. The other read `e.class`, and the class lives at
        `e.app.class`, so it failed on a registry that was entirely correct.
        A check that reads the wrong field is worse than no check: it reports a
        problem in the thing it is checking rather than in itself.
      */
      // The contract itself is the package's, run by `estiva-ui check` in CI's
      // gate job (UIG-19); this repo kept its own copy until then.
      { what: "every reusable part keeps the usage-page contract", run: () => h.contract(".") },
      /*
        Three more checks stood here: the heading order in preview.tsx, the
        headings the Introduction names, and the count it states. They ran only
        in gates:status, never in CI, so the Introduction kept a deleted Huddles
        heading and said 49 when the catalogue built 41 (the audit before
        UIG-26, A3). They are the package's now, inside `estiva-ui check`, which
        CI's gate job runs, and they read the catalogue it builds in memory
        rather than a local registry.json (A5).
      */
      { what: "CI's gate job holds the Storybook map against the Storybook", run: () => h.ciJob("gate", "registry:check") },
    ] },
    { ref: "UIG-27", checks: [
      { what: "Peek's hand-made progress bar is gone", run: () => h.exists("src/components/ui/ProjectTickets.tsx") ? h.lacks("src/components/ui/ProjectTickets.tsx", 'role="progressbar"') : h.PASS("ProjectTickets.tsx is gone") },
      // The adoption deleted these; the checks keep them deleted.
      { what: "Peek's own inline chip is gone", run: () => h.exists("src/components/ui/inlineChip.ts") ? h.FAIL("src/components/ui/inlineChip.ts is back: use the package's InlineChip") : h.PASS("src/components/ui/inlineChip.ts is gone") },
      { what: "Peek's own pending attachment chip is gone", run: () => h.exists("src/components/ui/PendingAttachmentChip.tsx") ? h.FAIL("src/components/ui/PendingAttachmentChip.tsx is back: use the package's AttachmentCard") : h.PASS("src/components/ui/PendingAttachmentChip.tsx is gone") },
      // UIG-35 deleted FileAttachmentCard.tsx, and the card is drawn where it was
      // wrapped: a check naming the deleted file could only ever fail.
      { what: "a posted file is the package's AttachmentCard", run: () => h.contains("src/components/ConversationCard.tsx", /<AttachmentCard\b/, "ConversationCard draws the package's AttachmentCard") },
    ] },
    { ref: "UIG-29", title: "CommandLauncher — 1,655 lines that will fail almost every lint rule", owner: true, checks: [
      { what: "CommandLauncher passes the gate lint, with no escape still naming UIG-29", run: async () => {
        const file = "src/components/CommandLauncher.tsx";
        const lint = await h.lint({ config: GATES, file, code: h.read(file), expect: "none" });
        if (lint.result !== "pass") return lint;
        return h.lacks(file, /@estiva-escape:[^\n]*UIG-29/, "it passes, and no escape names UIG-29");
      } },
      // DialogShell did not fit the launcher; UIG-29 built the package's CommandPalette for it instead (Katerina, 15 September).
      { what: "its window is the package's CommandPalette", run: () => h.contains("src/components/CommandLauncher.tsx", /import\s*\{[^}]*\bCommandPalette\b[^}]*\}\s*from\s*['"]@estiva-app\/ui['"]/, "CommandLauncher imports CommandPalette from @estiva-app/ui") },
    ] },
    // A first guess, from the ticket's text (much later: Katerina, 16 September).
    { ref: "UIG-31", title: "Editor menus — one shared part for the / @ [ menus", checks: [
      { what: "the / menu keeps no escape naming UIG-31", run: () => h.lacks("src/components/ui/SlashMenu.tsx", /@estiva-escape:[^\n]*UIG-31/, "SlashMenu keeps no escape naming UIG-31") },
    ] },
  ];

  // Peek's own checks join the package's row for the same ticket, or make a row of their own.
  // The real page the gate must pass untouched. TopicsPage.tsx was it until FOL-23
  // deleted it, and three checks threw instead of reading (the audit before UIG-26).
  const tickets = appChecks(h, { page: "src/pages/FoldersPage.tsx", chain: { ref: "UIG-3", owner: true }, headers: ["ContainerHeader"] });
  for (const { ref, title, owner = false, checks } of own) {
    const row = tickets.find((t) => t.ref === ref);
    if (row) row.checks.push(...checks);
    else tickets.push({ ref, title, owner, checks });
  }

  return { repo: "peek", tickets };
}
