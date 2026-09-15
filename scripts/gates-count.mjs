/**
 * Write `.gates-count.json`: what the UI Guardrails' rules find in Peek, per
 * rule — errors, warnings and escapes (UIG-3, seam S3 in estiva-ui
 * docs/GATES.md §16).
 *
 * Runs after `npm run lint:rules` (npm's `postlint:rules`), so CI runs it too.
 * The file is committed: nothing compares it yet, and the later ratchet needs
 * the history to start at the first commit.
 *
 * It lints with the same config as the gate, with escapes reported, so an
 * escape is counted rather than silent. The file is rewritten only when a
 * count changes, so running the lint does not leave a changed file behind
 * every time.
 *
 * It fails when an `eslint-disable` switched one of these rules off: that is
 * not an escape, and the escape count cannot see it.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { countGates } from '@estiva-app/ui/eslint'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, '.gates-count.json')

const eslint = new ESLint({
  cwd: root,
  overrideConfigFile: join(root, 'eslint.gates.config.js'),
  overrideConfig: { settings: { estiva: { reportEscapes: true } } },
})
const { rules, disabled } = countGates(await eslint.lintFiles(['.']))

const previous = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : null
if (JSON.stringify(previous?.rules) === JSON.stringify(rules)) {
  console.log('.gates-count.json: unchanged')
} else {
  const count = { schemaVersion: 1, repo: 'peek', generatedAt: new Date().toISOString(), rules }
  writeFileSync(out, `${JSON.stringify(count, null, 2)}\n`)
  console.log('.gates-count.json: written')
}
for (const [id, c] of Object.entries(rules)) console.log(`  ${id}: ${c.errors} errors, ${c.warnings} warnings, ${c.escapes} escapes`)

if (disabled.length > 0) {
  console.error('\nAn eslint-disable switched a gate rule off. Write the reason above the element instead: // @estiva-escape: <reason>')
  for (const d of disabled) console.error(`  ${relative(root, d.filePath)}:${d.line}  ${d.ruleId}`)
  process.exitCode = 1
}
