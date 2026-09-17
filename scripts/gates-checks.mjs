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
  const fiveSections = (mdx) => h.exists(mdx) && ["What it is", "When", "When not", "How", "What it owns"].every((s) => new RegExp(`^#+\\s*${s}\\s*$`, "m").test(h.read(mdx)));
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
      { what: "PendingAttachmentChip has a usage page with the five sections", run: () => fiveSections("src/components/ui/PendingAttachmentChip.mdx") ? h.PASS("PendingAttachmentChip.mdx has all five") : h.FAIL("src/components/ui/PendingAttachmentChip.mdx does not have all five yet") },
      { what: "every Peek component in the registry has a class", run: () => h.json("registry.json", (d) => (d.entries ?? d.components ?? []).every((e) => e.repo !== "peek" || e.class || e.classification), "every peek entry has a class") },
    ] },
    { ref: "UIG-27", checks: [
      { what: "Peek's hand-made progress bar is gone", run: () => h.exists("src/components/ui/ProjectTickets.tsx") ? h.lacks("src/components/ui/ProjectTickets.tsx", 'role="progressbar"') : h.PASS("ProjectTickets.tsx is gone") },
      // The adoption deleted these; the checks keep them deleted.
      { what: "Peek's own inline chip is gone", run: () => h.exists("src/components/ui/inlineChip.ts") ? h.FAIL("src/components/ui/inlineChip.ts is back: use the package's InlineChip") : h.PASS("src/components/ui/inlineChip.ts is gone") },
      { what: "Peek's own pending attachment chip is gone", run: () => h.exists("src/components/ui/PendingAttachmentChip.tsx") ? h.FAIL("src/components/ui/PendingAttachmentChip.tsx is back: use the package's AttachmentCard") : h.PASS("src/components/ui/PendingAttachmentChip.tsx is gone") },
      { what: "a posted file is the package's AttachmentCard", run: () => h.contains("src/components/ui/FileAttachmentCard.tsx", /\bAttachmentCard\b/, "FileAttachmentCard.tsx draws AttachmentCard") },
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
  const tickets = appChecks(h, { page: "src/pages/TopicsPage.tsx", chain: { ref: "UIG-3", owner: true }, headers: ["ContainerHeader"] });
  for (const { ref, title, owner = false, checks } of own) {
    const row = tickets.find((t) => t.ref === ref);
    if (row) row.checks.push(...checks);
    else tickets.push({ ref, title, owner, checks });
  }

  return { repo: "peek", tickets };
}
