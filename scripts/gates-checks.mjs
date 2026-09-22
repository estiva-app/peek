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
  /*
    The page contract, as it is actually written (Ship's UIG-18 set it): an
    opening line that says what the part is, then four headings. "What it is"
    is that opening line, not a heading of its own — a check that demanded five
    headings would fail every page in the repo.
  */
  const fourSections = (mdx) => {
    if (!h.exists(mdx)) return false;
    const text = h.read(mdx);
    const headed = ["When", "When not", "How", "What it owns"].every((s) => new RegExp(`^##\\s*${s}\\s*$`, "m").test(text));
    const body = text.replace(/^import .*$/gm, "").replace(/^<Meta[^>]*\/>$/gm, "");
    const opening = body.slice(body.indexOf("\n", body.indexOf("# ")), body.search(/^##\s/m));
    return headed && opening.trim().length > 0;
  };
  const registry = () => { try { return JSON.parse(h.read("registry.json")).entries ?? null; } catch { return null; } };
  /** The set UIG-17 is about: reusable and promote-candidate, nothing else. */
  const targets = (test) => {
    const entries = registry();
    if (!entries) return h.FAIL("registry.json has no entries — run `npm run registry`");
    const parts = entries.filter((e) => ["reusable", "promote-candidate"].includes(e.app?.class));
    return parts.length ? test(parts) : h.FAIL("no reusable parts in the registry — rebuild it");
  };
  const storyFiles = () => h.listFiles("src", (name) => name.endsWith(".stories.tsx") || name.endsWith(".mdx"));
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
      { what: "every reusable part has a usage page with the four sections", run: () => targets((parts) => {
        const missing = parts.filter((e) => !e.docPage || !fourSections(e.docPage)).map((e) => e.name);
        return missing.length === 0
          ? h.PASS(`all ${parts.length} reusable parts have a page with When / When not / How / What it owns`)
          : h.FAIL(`${parts.length - missing.length} of ${parts.length}; no page or an incomplete one: ${missing.slice(0, 6).join(", ")}${missing.length > 6 ? `, +${missing.length - 6}` : ""}`);
      }) },
      { what: "a usage page sits beside the component it describes", run: () => targets((parts) => {
        const dir = (f) => f.replace(/\\/g, "/").replace(/\/[^/]*$/, "");
        const stray = parts.filter((e) => e.docPage && dir(e.docPage) !== dir(e.sourceFile)).map((e) => e.name);
        return stray.length === 0
          ? h.PASS("every page is in its component's own folder, so the rule travels with the code")
          : h.FAIL(`filed away from their component: ${stray.join(", ")}`);
      }) },
      { what: "the classification reconciles — every part has one, and they sum", run: () => {
        const entries = registry();
        if (!entries) return h.FAIL("registry.json has no entries — run `npm run registry`");
        const unclassified = entries.filter((e) => !e.app?.class).map((e) => e.name);
        if (unclassified.length) return h.FAIL(`no class: ${unclassified.slice(0, 6).join(", ")}`);
        const by = {};
        for (const e of entries) by[e.app.class] = (by[e.app.class] ?? 0) + 1;
        const sum = Object.values(by).reduce((a, b) => a + b, 0);
        const shape = Object.entries(by).map(([k, n]) => `${n} ${k}`).join(", ");
        return sum === entries.length ? h.PASS(`${entries.length} parts — ${shape}`) : h.FAIL(`${shape} sums to ${sum}, not ${entries.length}`);
      } },
      /*
        The Introduction is a hand-written map of something that moves, and it
        has been wrong twice in three days — once naming three headings that no
        longer existed, once missing four that did. Nothing noticed either time
        (Katerina, 23 September). This is what notices.
      */
      { what: "the Introduction names exactly the headings the sidebar has", run: () => {
        const intro = "src/stories/Introduction.mdx";
        if (!h.exists(intro)) return h.FAIL(`${intro} is missing`);
        const listed = new Set([...h.read(intro).matchAll(/^\|\s*\*\*([^*]+)\*\*\s*\|/gm)].map((m) => m[1].trim()));
        // `Estiva ID` is prepended by .storybook/main.ts, not by any title here.
        const real = new Set(["Estiva ID"]);
        for (const file of storyFiles()) {
          const text = h.read(file);
          /*
            Only the title the meta declares. A story file is full of invented
            data, and fixtures have titles too — reading the first `title:` in
            the file reported a heading called "Feedback on Peek", which is a
            topic's name in TopicDetailsDialog's fixtures.
          */
          const start = text.indexOf("const meta");
          const meta = start === -1 ? "" : text.slice(start, text.indexOf("satisfies Meta", start) + 1 || undefined);
          const title = meta.match(/\btitle: *['"]([^'"]+)['"]/) ?? text.match(/<Meta\s+title="([^"]+)"/);
          if (title) real.add(title[1].split("/")[0].trim());
        }
        const missing = [...real].filter((r) => !listed.has(r));
        const stale = [...listed].filter((l) => !real.has(l));
        if (!missing.length && !stale.length) return h.PASS(`${real.size} headings, all named on the Introduction`);
        return h.FAIL([missing.length ? `the sidebar has, the page does not name: ${missing.join(", ")}` : "", stale.length ? `the page names, the sidebar does not have: ${stale.join(", ")}` : ""].filter(Boolean).join("; "));
      } },
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
