/**
 * What gates:status checks in peek.
 *
 * `owner: true` is a ticket peek owns. `owner: false` is peek's part of a
 * ticket another repo owns. The list of all 30 tickets, and who owns each, is
 * in estiva-ui's scripts/gates-checks.mjs. Run gates:status there to see them
 * all together.
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
  const installed = "node_modules/@estiva-app/ui/dist/index.d.ts";

  return {
    repo: "peek",
    tickets: [
      { ref: "UIG-2", title: "The tracking rails — GATES.md, the status script, the guide committed", owner: false, checks: [
        { what: "npm run gates:status is wired", run: () => h.script("package.json", "gates:status") },
      ] },
      { ref: "UIG-3", title: "Tracer bullet — one rule, end to end, blocking in Peek", owner: true, checks: [
        { what: "the gate lint config loads", run: () => h.loads(GATES) },
        { what: "package.json has lint:rules", run: () => h.script("package.json", "lint:rules") },
        { what: "CI runs lint:rules", run: () => h.ci("lint:rules") },
        { what: "the committed hook runs the gate lint", run: () => h.hook(".claude/settings.json", "gates") },
        { what: ".gates-count.json is committed and parses", run: () => h.json(".gates-count.json") },
        { what: "a raw <button> is an error naming Button", run: probe(component('<button type="button">x</button>'), "error", "Button") },
        { what: "the same in a story", run: probe(component('<button type="button">x</button>'), "error", "Button", "src/stories/__gates_probe__.stories.tsx") },
        { what: "a test file is not checked, while source is", run: async () => {
          const source = await probe(component('<button type="button">x</button>'), "error", "Button")();
          if (source.result !== "pass") return h.FAIL(`source is not checked yet, so this proves nothing: ${source.detail}`);
          return probe(component('<button type="button">x</button>'), "none", undefined, "src/components/__gates_probe__.test.tsx")();
        } },
      ] },
      { ref: "UIG-6", title: "Branch protection — the backstop, all three repos", owner: false, checks: [
        { what: "GitHub requires the check gate to merge into main", run: () => h.protectedBranch(/^gate$/) },
        { what: "CI's job gate runs lint:rules", run: () => h.ciJob("gate", "lint:rules") },
      ] },
      { ref: "UIG-7", title: "Lint rule — every remaining raw element", owner: false, checks: [
        { what: "a raw <input> is an error naming TextInput", run: probe(component("<input />"), "error", "TextInput") },
        { what: "a raw <a> is an error naming Link", run: probe(component('<a href="/topics">Topics</a>'), "error", "Link") },
        { what: "a raw <form> is an error naming Form, and a file input one naming FilePicker", run: async () => {
          const form = await probe(component("<form />"), "error", "`Form`")();
          if (form.result !== "pass") return form;
          return probe(component('<input type="file" />'), "error", "FilePicker")();
        } },
        { what: "<textarea>, <select>, <dialog> and <label> name Textarea, Select, DialogShell and Field", run: async () => {
          for (const [element, part] of [["textarea", "Textarea"], ["select", "Select"], ["dialog", "DialogShell"], ["label", "Field"]]) {
            const one = await probe(component(`<${element} />`), "error", `\`${part}\``)();
            if (one.result !== "pass") return one;
          }
          return h.PASS("all four are errors, each naming its part");
        } },
        { what: "an element the package has no part for is an error that says to ask for one", run: probe(component('<iframe title="Map" />'), "error", "ask Katerina") },
        { what: "an escaped element is not an error, while the same element is", run: async () => {
          const raw = await probe(component("<form />"), "error")();
          if (raw.result !== "pass") return h.FAIL(`a raw <form> is not caught yet, so this proves nothing: ${raw.detail}`);
          return probe("export function Probe() {\n  return (\n    // @estiva-escape: a probe that keeps its element on purpose\n    <form />\n  )\n}\n", "none")();
        } },
        { what: "a real page, full of elements that are not controls, gets no error", run: () => { const expect = "none"; return h.lint({ config: GATES, file: "src/pages/TopicsPage.tsx", code: h.read("src/pages/TopicsPage.tsx"), expect }); } },
      ] },
      { ref: "UIG-8", title: "Lint rule — forbid the reach", owner: false, checks: [
        { what: "createPortal is an error", run: probe("import { createPortal } from 'react-dom'\nexport const Probe = (to: HTMLElement) => createPortal(<span />, to)\n", "error") },
        { what: "tabIndex={0} on a div is an error", run: probe(component("<div tabIndex={0} />"), "error") },
        { what: "tabIndex={-1} on a div is not, while tabIndex={0} is", run: async () => {
          const zero = await probe(component("<div tabIndex={0} />"), "error")();
          if (zero.result !== "pass") return h.FAIL(`tabIndex={0} is not caught yet, so this proves nothing: ${zero.detail}`);
          return probe(component("<div tabIndex={-1} />"), "none")();
        } },
      ] },
      { ref: "UIG-9", title: "Lint rule — the className allow-list", owner: false, checks: [
        { what: "a border passed into Button is an error naming Button", run: probe(`import { Button } from '@estiva-app/ui'\n${component('<Button className="border">x</Button>')}`, "error", "Button") },
      ] },
      { ref: "UIG-13", title: "The registry widens to Peek's 115 and Ship's 74, with classification", owner: false, checks: [
        { what: "registry.json is committed and has entries", run: () => h.json("registry.json", (d) => (d.entries ?? d.components ?? []).length > 0, "registry.json has entries") },
      ] },
      { ref: "UIG-17", title: "Usage rules — Peek's own components", owner: true, checks: [
        { what: "PendingAttachmentChip has a usage page with the five sections", run: () => fiveSections("src/components/ui/PendingAttachmentChip.mdx") ? h.PASS("PendingAttachmentChip.mdx has all five") : h.FAIL("src/components/ui/PendingAttachmentChip.mdx does not have all five yet") },
        { what: "every Peek component in the registry has a class", run: () => h.json("registry.json", (d) => (d.entries ?? d.components ?? []).every((e) => e.repo !== "peek" || e.class || e.classification), "every peek entry has a class") },
      ] },
      { ref: "UIG-19", title: "Lock the contract in CI, and make the three Storybooks one search", owner: false, checks: [
        { what: "the usage-page contract runs in CI", run: () => h.ci(/[\w:-]*contract[\w:-]*/) },
      ] },
      { ref: "UIG-20", title: "The Claude skill, reading the registry", owner: false, checks: [
        { what: "a committed skill runs ui:find", run: () => h.listFiles(".claude/skills", (n) => n === "SKILL.md").some((f) => h.read(f).includes("ui:find")) ? h.PASS("a skill runs ui:find") : h.FAIL("no skill in .claude/skills runs ui:find") },
      ] },
      { ref: "UIG-21", title: "CLAUDE.md becomes an index, not a lecture", owner: false, checks: [
        { what: "path-scoped instructions exist", run: () => h.listFiles(".claude/rules", (n) => n.endsWith(".md")).some((f) => /^paths:/m.test(h.read(f))) ? h.PASS(".claude/rules has paths: instructions") : h.FAIL("no .claude/rules file with paths:") },
      ] },
      { ref: "UIG-22", title: "Fingerprint — a hand-made header row", owner: false, checks: [
        { what: "a hand-made header row is an error naming ContainerHeader", run: probe(component('<section className="flex flex-col"><div className="flex items-center px-3 py-2"><span>Folders</span></div><div /></section>'), "error", "ContainerHeader") },
      ] },
      { ref: "UIG-23", title: "Fingerprint — a hand-made empty state", owner: false, checks: [
        { what: "a hand-made empty line is an error naming EmptyState", run: probe("export function Probe({ items }: { items: string[] }) {\n  return <div>{items.length === 0 ? <p className=\"text-text-secondary\">Nothing here</p> : items.map((i) => <span key={i}>{i}</span>)}</div>\n}\n", "error", "EmptyState") },
      ] },
      { ref: "UIG-24", title: "Fingerprint — a browser tooltip where ours belongs", owner: false, checks: [
        { what: "a title= is an error naming WithTooltip", run: probe(`import { Button } from '@estiva-app/ui'\n${component('<Button title="Delete">x</Button>')}`, "error", "WithTooltip") },
      ] },
      { ref: "UIG-25", title: "Fingerprint — a component copied out by hand", owner: false, checks: [
        { what: "SectionLabel's class list, typed by hand, is a warning", run: probe(component('<span className="text-[10px] uppercase tracking-wide text-text-muted">Label</span>'), "warning", "SectionLabel") },
      ] },
      { ref: "UIG-27", title: "The components the apps had to build themselves — Link, ProgressBar, EmptyState padding", owner: false, checks: [
        { what: "the installed package has Link", run: () => h.contains(installed, /\bLink\b/, "the installed @estiva-app/ui exports Link") },
        { what: "the installed package has ProgressBar", run: () => h.contains(installed, /\bProgressBar\b/, "the installed @estiva-app/ui exports ProgressBar") },
        { what: "Peek's hand-made progress bar is gone", run: () => h.exists("src/components/ui/ProjectTickets.tsx") ? h.lacks("src/components/ui/ProjectTickets.tsx", 'role="progressbar"') : h.PASS("ProjectTickets.tsx is gone") },
        // The adoption deleted these; the checks keep them deleted.
        { what: "Peek's own inline chip is gone", run: () => h.exists("src/components/ui/inlineChip.ts") ? h.FAIL("src/components/ui/inlineChip.ts is back: use the package's InlineChip") : h.PASS("src/components/ui/inlineChip.ts is gone") },
        { what: "Peek's own pending attachment chip is gone", run: () => h.exists("src/components/ui/PendingAttachmentChip.tsx") ? h.FAIL("src/components/ui/PendingAttachmentChip.tsx is back: use the package's AttachmentCard") : h.PASS("src/components/ui/PendingAttachmentChip.tsx is gone") },
        { what: "a posted file is the package's AttachmentCard", run: () => h.contains("src/components/ui/FileAttachmentCard.tsx", /\bAttachmentCard\b/, "FileAttachmentCard.tsx draws AttachmentCard") },
      ] },
      { ref: "UIG-28", title: "Close the two holes in the token contract — arbitrary values, and inline style", owner: false, checks: [
        { what: "text-[14px] is an error", run: probe(component('<div className="text-[14px]">x</div>'), "error", undefined, PROBE, "eslint.tokens.config.js") },
        { what: "a colour in an inline style is an error", run: probe(component("<div style={{ backgroundColor: '#ff0000' }}>x</div>"), "error", undefined, PROBE, "eslint.tokens.config.js") },
        { what: "h-[240px] is a warning", run: probe(component('<div className="h-[240px]">x</div>'), "warning", undefined, PROBE, "eslint.tokens.config.js") },
        { what: "h-[240px] is not an error", run: probe(component('<div className="h-[240px]">x</div>'), "none", undefined, PROBE, "eslint.tokens.config.js") },
        { what: "a hand-written line height behind an arbitrary variant is an error", run: probe(component('<div className="[&_p]:leading-[1.4]">x</div>'), "error", undefined, PROBE, "eslint.tokens.config.js") },
        { what: "a raw colour in a class is an error (the pattern that matched nothing, R1)", run: probe(component('<div className="bg-[#5c69dc]">x</div>'), "error", "raw colour", PROBE, "eslint.tokens.config.js") },
        { what: "a width and height from a prop pass", run: probe("export function Probe({ size }: { size: number }) {\n  return <div style={{ width: size, height: size }}>x</div>\n}\n", "none", undefined, PROBE, "eslint.tokens.config.js") },
        { what: "a test file is not checked for hand-written values, while source is", run: async () => {
          const code = component("<div className=\"text-[14px]\" style={{ color: 'red' }}>x</div>");
          const source = await probe(code, "error", undefined, PROBE, "eslint.tokens.config.js")();
          if (source.result !== "pass") return h.FAIL(`source is not checked yet, so this proves nothing: ${source.detail}`);
          return probe(code, "none", undefined, "src/components/__gates_probe__.test.tsx", "eslint.tokens.config.js")();
        } },
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
      { ref: "UIG-30", title: "RichText — one component that draws a message's text, for both apps", owner: false, checks: [
        { what: "the installed package has RichText", run: () => h.contains(installed, /\bRichText\b/, "the installed @estiva-app/ui exports RichText") },
      ] },
    ],
  };
}
