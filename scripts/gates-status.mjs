#!/usr/bin/env node
/**
 * gates:status — where the UI Guardrails project stands, read from the code.
 *
 *   npm run gates:status              one row per ticket
 *   npm run gates:status -- --detail  every check under every row
 *   npm run gates:status -- --json    machine output, read by estiva-ui's run
 *
 * Every row is decided by checks on real files, a real lint run or a real
 * GitHub setting. Nothing here reads a list that someone ticks by hand.
 *
 * This file is the same in estiva-ui, peek and ship. Keep it that way: copy it
 * across when it changes, and estiva-ui's run warns when the copies differ.
 * What differs per repo is `gates-checks.mjs`, beside it.
 *
 * The rows and the reasons for each check are in estiva-ui docs/GATES.md §15
 * and §17. A ticket that builds something updates its own checks there and in
 * `gates-checks.mjs`, in the same session.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const ENGINE = readFileSync(fileURLToPath(import.meta.url));
const ENGINE_HASH = createHash("sha256").update(ENGINE.toString("utf8").replace(/\r\n/g, "\n")).digest("hex").slice(0, 12);

const args = new Set(process.argv.slice(2));
const JSON_OUT = args.has("--json");
const DETAIL = args.has("--detail");

// ── helpers the checks are written with ────────────────────────────────────

const PASS = (detail) => ({ result: "pass", detail });
const FAIL = (detail) => ({ result: "fail", detail });
const PART = (detail) => ({ result: "part", detail });
const UNKNOWN = (detail) => ({ result: "unknown", detail });

const abs = (rel) => resolve(ROOT, rel);
const shown = (dir) => (relative(ROOT, dir) || dir).replace(/\\/g, "/");
const exists = (rel) => existsSync(abs(rel));
const read = (rel) => readFileSync(abs(rel), "utf8");

function git(...a) {
  try { return execFileSync("git", a, { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { return null; }
}

function listFiles(rel, test) {
  const out = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      if (["node_modules", ".git", "dist", "storybook-static", ".verify-shots"].includes(name)) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (test(name, p)) out.push(relative(ROOT, p).replace(/\\/g, "/"));
    }
  };
  walk(abs(rel));
  return out;
}

const h = {
  PASS, FAIL, PART, UNKNOWN, exists, read, listFiles,

  file(rel) {
    return exists(rel) ? PASS(`${rel} exists`) : FAIL(`${rel} does not exist`);
  },

  committed(rel) {
    if (!exists(rel)) return FAIL(`${rel} does not exist`);
    return git("ls-files", "--error-unmatch", rel) ? PASS(`${rel} is committed`) : FAIL(`${rel} exists but is not committed`);
  },

  contains(rel, needle, label) {
    if (!exists(rel)) return FAIL(`${rel} does not exist`);
    const hit = typeof needle === "string" ? read(rel).includes(needle) : needle.test(read(rel));
    return hit ? PASS(label ?? `${rel} has ${needle}`) : FAIL(label ? `not yet: ${label}` : `${rel} has no ${needle}`);
  },

  lacks(rel, needle, label) {
    if (!exists(rel)) return FAIL(`${rel} does not exist`);
    const hit = typeof needle === "string" ? read(rel).includes(needle) : needle.test(read(rel));
    return hit ? FAIL(`${rel} still has ${needle}`) : PASS(label ?? `${rel} has no ${needle}`);
  },

  script(pkgRel, name) {
    if (!exists(pkgRel)) return FAIL(`${pkgRel} does not exist`);
    const cmd = JSON.parse(read(pkgRel)).scripts?.[name];
    return cmd ? PASS(`${pkgRel} runs "${name}": ${cmd}`) : FAIL(`${pkgRel} has no "${name}" script`);
  },

  async loads(rel) {
    if (!exists(rel)) return FAIL(`${rel} does not exist`);
    try {
      const mod = await import(pathToFileURL(abs(rel)).href);
      return mod.default ? PASS(`${rel} loads`) : FAIL(`${rel} has no default export`);
    } catch (e) {
      return FAIL(`${rel} does not load: ${String(e.message).split("\n")[0]}`);
    }
  },

  /** A workflow step that runs `npm run <script>`; a regex matches the script name. */
  ci(script) {
    const files = listFiles(".github/workflows", (n) => /\.ya?ml$/.test(n));
    const name = typeof script === "string" ? script.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : script.source;
    const step = new RegExp(`npm run (${name})(?![\\w:-])`);
    for (const f of files) {
      const m = read(f).match(step);
      if (m) return PASS(`${f} runs npm run ${m[1]}`);
    }
    return FAIL(`no workflow runs npm run ${script}`);
  },

  hook(settingsRel, needle) {
    if (!exists(settingsRel)) return FAIL(`${settingsRel} does not exist`);
    let s;
    try { s = JSON.parse(read(settingsRel)); } catch { return FAIL(`${settingsRel} is not valid JSON`); }
    const commands = (s.hooks?.PreToolUse ?? []).flatMap((m) => (m.hooks ?? []).map((x) => x.command ?? ""));
    const hit = commands.find((c) => c.includes(needle));
    if (hit) return PASS(`${settingsRel} has a PreToolUse hook running ${needle}`);
    return FAIL(commands.length ? `${settingsRel} has PreToolUse hooks, none running ${needle}` : `${settingsRel} has no PreToolUse hook`);
  },

  json(rel, test = () => true, label) {
    if (!exists(rel)) return FAIL(`${rel} does not exist`);
    let data;
    try { data = JSON.parse(read(rel)); } catch { return FAIL(`${rel} is not valid JSON`); }
    if (!git("ls-files", "--error-unmatch", rel)) return FAIL(`${rel} is not committed`);
    return test(data) ? PASS(label ?? `${rel} is committed and parses`) : FAIL(`${rel} parses, but ${label ?? "fails its test"}`);
  },

  /** Lints a line of code that is never written to disk, the way the hook will. */
  async lint({ cwd = ".", config, file, code, expect, mentions }) {
    const cfg = join(cwd, config);
    if (!exists(cfg)) return FAIL(`${cfg} does not exist`);
    let ESLint;
    try {
      const req = createRequire(join(abs(cwd), "package.json"));
      ({ ESLint } = await import(pathToFileURL(req.resolve("eslint")).href));
    } catch (e) {
      return UNKNOWN(`could not load eslint from ${cwd}: ${String(e.message).split("\n")[0]}`);
    }
    let results;
    try {
      const eslint = new ESLint({ cwd: abs(cwd), overrideConfigFile: config });
      results = await eslint.lintText(code, { filePath: join(abs(cwd), file), warnIgnored: true });
    } catch (e) {
      return UNKNOWN(`${cfg} could not lint ${file}: ${String(e.message).split("\n")[0]}`);
    }
    const messages = results.flatMap((r) => r.messages);
    const ignored = messages.some((m) => /ignored/i.test(m.message) && !m.ruleId);
    const fatal = messages.find((m) => m.fatal && !/ignored/i.test(m.message));
    if (fatal) return UNKNOWN(`${file} did not parse: ${fatal.message}`);
    const want = expect === "error" ? 2 : expect === "warning" ? 1 : 0;
    if (want === 0) {
      const any = messages.filter((m) => m.ruleId && m.severity === 2);
      return any.length ? FAIL(`${file} gets an error it should not: ${any[0].message}`) : PASS(`${file}: no error${ignored ? " (not linted)" : ""}`);
    }
    if (ignored) return FAIL(`${cfg} does not lint ${file}`);
    const hit = messages.find((m) => m.ruleId && m.severity === want && (!mentions || m.message.includes(mentions)));
    const kind = want === 2 ? "error" : "warning";
    return hit
      ? PASS(`${file} gets ${want === 2 ? "an" : "a"} ${kind}: ${hit.message}`)
      : FAIL(`${file} gets no ${kind}${mentions ? ` naming ${mentions}` : ""}`);
  },

  /** A GitHub setting, not a file, so it is asked of GitHub. */
  protectedBranch(pattern) {
    const url = git("remote", "get-url", "origin");
    const slug = url?.match(/github\.com[:/](.+?)(?:\.git)?$/)?.[1];
    if (!slug) return UNKNOWN("no GitHub remote");
    const branch = (git("symbolic-ref", "--short", "refs/remotes/origin/HEAD") ?? "origin/main").replace(/^origin\//, "");
    let out;
    try {
      out = execFileSync("gh", ["api", `repos/${slug}/branches/${branch}/protection`], { stdio: ["ignore", "pipe", "pipe"], timeout: 20000 }).toString();
    } catch (e) {
      const said = `${e.stdout ?? ""}${e.stderr ?? ""}`;
      if (/not protected|HTTP 404/i.test(said)) return FAIL(`${slug} ${branch} is not protected`);
      return UNKNOWN(`could not ask GitHub (${e.code === "ENOENT" ? "gh is not installed" : said.split("\n")[0] || e.message})`);
    }
    const p = JSON.parse(out);
    const names = [...(p.required_status_checks?.contexts ?? []), ...(p.required_status_checks?.checks ?? []).map((c) => c.context)];
    const hit = names.find((n) => pattern.test(n));
    return hit ? PASS(`${slug} ${branch} requires "${hit}"`) : FAIL(`${slug} ${branch} is protected, but no required check matches ${pattern}`);
  },

  gh(args, label) {
    try {
      execFileSync("gh", args, { stdio: ["ignore", "pipe", "pipe"], timeout: 20000 });
      return PASS(label);
    } catch (e) {
      const said = `${e.stdout ?? ""}${e.stderr ?? ""}`;
      if (/could not resolve|not found|HTTP 404/i.test(said)) return FAIL(`not yet: ${label}`);
      return UNKNOWN(`could not ask GitHub (${e.code === "ENOENT" ? "gh is not installed" : said.split("\n")[0] || e.message})`);
    }
  },

  /** How many of `files` pass `test`: all is a pass, some is a part. */
  share(files, test, label) {
    if (!files.length) return FAIL(`no files to check for: ${label}`);
    const ok = files.filter(test).length;
    const detail = `${ok} of ${files.length}: ${label}`;
    return ok === files.length ? PASS(detail) : ok ? PART(detail) : FAIL(detail);
  },
};

// ── running the checks ─────────────────────────────────────────────────────

const STATUS = { done: "✅", started: "🚧", none: "⬜", unknown: "❔" };

function statusOf(checks) {
  const n = (r) => checks.filter((c) => c.result === r).length;
  const pass = n("pass"), part = n("part"), fail = n("fail"), unknown = n("unknown");
  if (!checks.length) return "unknown";
  if (pass === checks.length) return "done";
  if (pass + part > 0) return fail === 0 && unknown > 0 ? "unknown" : "started";
  return fail > 0 ? "none" : "unknown";
}

async function runRepo() {
  const define = (await import(pathToFileURL(join(HERE, "gates-checks.mjs")).href)).default;
  const spec = define(h);
  const rows = [];
  for (const t of spec.tickets) {
    const checks = [];
    for (const c of t.checks ?? []) {
      if (c.aggregate) continue;
      let r;
      try { r = await c.run(); } catch (e) { r = UNKNOWN(`the check threw: ${e.message}`); }
      checks.push({ repo: spec.repo, what: c.what, ...r });
    }
    rows.push({ ref: t.ref, title: t.title, owner: t.owner, checks });
  }
  return { spec, report: { schema: 1, repo: spec.repo, branch: git("rev-parse", "--abbrev-ref", "HEAD"), commit: git("rev-parse", "--short", "HEAD"), engine: ENGINE_HASH, rows } };
}

function runSibling(dir) {
  const script = join(dir, "scripts", "gates-status.mjs");
  if (!existsSync(script)) return { error: `${shown(dir)} has no scripts/gates-status.mjs yet` };
  try {
    const out = execFileSync(process.execPath, [script, "--json"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"], timeout: 300000, maxBuffer: 16 * 1024 * 1024 });
    return { report: JSON.parse(out.toString()) };
  } catch (e) {
    return { error: `its gates:status failed: ${String(e.stderr ?? e.message).split("\n").filter(Boolean).slice(-1)[0]}` };
  }
}

function pad(s, n) {
  const len = [...s].length;
  return len >= n ? s : s + " ".repeat(n - len);
}

function printRows(rows, { showOwner }) {
  const lines = [];
  const width = Math.max(...rows.map((r) => [...r.title].length));
  for (const r of rows) {
    const pass = r.checks.filter((c) => c.result === "pass").length;
    const count = r.checks.length ? `${pass} of ${r.checks.length}` : "no checks here";
    lines.push(`${STATUS[r.status]}  ${pad(r.ref, 7)} ${pad(r.title, width)}  ${showOwner ? pad(r.ownerRepo, 10) : ""}${count}`);
    if (DETAIL || r.status === "started" || r.status === "unknown") {
      for (const c of r.checks) {
        const mark = { pass: "✓", part: "½", fail: "✗", unknown: "?" }[c.result];
        lines.push(`        ${mark} ${showOwner ? `${pad(c.repo, 10)} ` : ""}${c.what} — ${c.detail}`);
      }
    }
  }
  return lines.join("\n");
}

function summary(rows) {
  const n = (s) => rows.filter((r) => r.status === s).length;
  return `${STATUS.done} ${n("done")} done · ${STATUS.started} ${n("started")} started · ${STATUS.none} ${n("none")} not started · ${STATUS.unknown} ${n("unknown")} could not check`;
}

const { spec, report } = await runRepo();

if (JSON_OUT) {
  process.stdout.write(JSON.stringify(report));
  process.exit(0);
}

const out = [];
out.push("UI Guardrails · gates:status", "Read from the code. Nothing here is a hand-ticked list.", "");
out.push(`${pad(spec.repo, 10)} ${report.branch} @ ${report.commit}`);

if (!spec.all) {
  // A sibling repo on its own: its own rows, then its parts of rows owned elsewhere.
  const own = report.rows.filter((r) => r.owner).map((r) => ({ ...r, ownerRepo: spec.repo, status: statusOf(r.checks) }));
  const parts = report.rows.filter((r) => !r.owner).map((r) => ({ ...r, ownerRepo: "", status: statusOf(r.checks) }));
  out.push("", `Tickets ${spec.repo} owns (${own.length}):`, printRows(own, { showOwner: false }));
  out.push("", `Parts of tickets another repo owns, checked here (${parts.length}):`, printRows(parts, { showOwner: false }));
  out.push("", "For all 29 tickets across the repos, run npm run gates:status in estiva-ui.");
  console.log(out.join("\n"));
  process.exit(0);
}

// estiva-ui: gather the sibling checkouts and join everything into the 29 rows.
const reports = [report];
const found = [];
for (const s of spec.siblings) {
  const dir = resolve(ROOT, process.env[s.env] ?? s.path);
  if (!existsSync(join(dir, "package.json"))) {
    found.push({ name: s.name, note: `not found at ${shown(dir)} (set ${s.env} to point at it)`, missing: true });
    continue;
  }
  const r = runSibling(dir);
  if (r.error) { found.push({ name: s.name, note: r.error, missing: true }); continue; }
  const drift = r.report.engine !== ENGINE_HASH ? " · its gates-status.mjs differs from estiva-ui's, copy it across" : "";
  found.push({ name: s.name, note: `${r.report.branch} @ ${r.report.commit}, found at ${shown(dir)}${drift}` });
  reports.push(r.report);
}
for (const f of found) out.push(`${pad(f.name, 10)} ${f.note}`);

const problems = [];
const known = new Set(spec.all.map((t) => t.ref));
for (const rep of reports) {
  for (const r of rep.rows.filter((r) => !known.has(r.ref))) problems.push(`${rep.repo} reports ${r.ref}, which is not one of the tickets`);
}
const rows = spec.all.map((t) => {
  const pieces = reports.flatMap((rep) => rep.rows.filter((r) => r.ref === t.ref).map((r) => ({ rep, r })));
  const claims = pieces.filter((p) => p.r.owner).map((p) => p.rep.repo);
  const ownerMissing = found.some((f) => f.name === t.owner && f.missing);
  if (!ownerMissing && (claims.length !== 1 || claims[0] !== t.owner)) {
    problems.push(`${t.ref}: should be owned by ${t.owner}, is claimed by ${claims.join(" and ") || "no repo"}`);
  }
  for (const p of pieces.filter((p) => !p.r.owner && !(t.parts ?? []).includes(p.rep.repo))) {
    problems.push(`${t.ref}: ${p.rep.repo} checks a part of it, but the ticket list does not name ${p.rep.repo}`);
  }
  const checks = pieces.flatMap((p) => p.r.checks);
  for (const f of found.filter((f) => f.missing)) {
    if ((t.parts ?? []).includes(f.name) || t.owner === f.name) checks.push({ repo: f.name, what: `${f.name}'s part`, result: "unknown", detail: f.note });
  }
  return { ref: t.ref, title: t.title, ownerRepo: t.owner, checks, aggregate: t.aggregate };
});
for (const row of rows) row.status = statusOf(row.checks);
for (const row of rows.filter((r) => r.aggregate)) {
  const others = rows.filter((r) => r !== row);
  const done = others.filter((r) => r.status === "done").length;
  row.checks.push({ repo: "all", what: "every other ticket is done", ...(done === others.length ? PASS(`${done} of ${others.length} done`) : FAIL(`${done} of ${others.length} done`)) });
  row.status = statusOf(row.checks);
}

out.push("", printRows(rows, { showOwner: true }), "", summary(rows));
const owners = Object.entries(rows.reduce((a, r) => ({ ...a, [r.ownerRepo]: (a[r.ownerRepo] ?? 0) + 1 }), {})).map(([k, v]) => `${k} ${v}`).join(", ");
out.push(`${rows.length} tickets. Owned by ${owners}.`);
const unchecked = found.filter((f) => f.missing && spec.all.some((t) => t.owner === f.name)).map((f) => f.name);
if (problems.length) out.push(`⚠️ Ownership does not add up:\n  ${problems.join("\n  ")}`);
else if (unchecked.length) out.push(`❔ Ownership not fully checked: ${unchecked.join(" and ")} could not be read.`);
else out.push("✅ Each ticket is owned by exactly one repo, and every repo agrees.");
if (!DETAIL) out.push("Add -- --detail to see every check.");
console.log(out.join("\n"));
