/**
 * The editor gate (UIG-3): before Claude writes a `.tsx` under `src/`, lint
 * the text it is about to write with the UI Guardrails' rules, and refuse the
 * write on an error. Exit 2 blocks the write and hands the messages back to
 * Claude, which can then use the component the message names.
 *
 * It runs `eslint.gates.config.js`, the very config CI's "Gate lint" runs, and
 * reimplements nothing: a hook and a lint that could disagree would be worse
 * than neither.
 *
 * It reaches a Claude session whose project directory is this repository (Claude
 * Code reads `.claude/settings.json` from there). Tests are not checked
 * (Katerina, 13 September); stories are.
 *
 * Input, from Claude Code on stdin: `tool_name` and `tool_input` — `file_path`
 * and `content` for Write; `file_path`, `old_string`, `new_string` and
 * `replace_all` for Edit. An Edit carries no whole file, so the edit is applied
 * to the file on disk here. Anything it cannot read passes, and the tool itself
 * reports its own failure.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

let input
try {
  input = JSON.parse(readFileSync(0, 'utf8'))
} catch {
  process.exit(0)
}
const { tool_name: tool, tool_input: args = {}, cwd } = input
if (typeof args.file_path !== 'string') process.exit(0)

const file = isAbsolute(args.file_path) ? args.file_path : resolve(cwd ?? root, args.file_path)
const rel = relative(root, file).split(sep).join('/')
if (rel.startsWith('../') || !/^src\/.+\.tsx$/.test(rel) || /\.test\.tsx$/.test(rel)) process.exit(0)

/** The file as it will be after this tool call, or null when that cannot be known. */
function proposed() {
  if (tool === 'Write') return typeof args.content === 'string' ? args.content : null
  if (tool !== 'Edit' || typeof args.old_string !== 'string' || typeof args.new_string !== 'string') return null
  const current = existsSync(file) ? readFileSync(file, 'utf8') : ''
  // A checkout on Windows has CRLF on disk; an edit is written with LF.
  for (const text of [current, current.replace(/\r\n/g, '\n')]) {
    if (!text.includes(args.old_string)) continue
    return args.replace_all ? text.split(args.old_string).join(args.new_string) : text.replace(args.old_string, () => args.new_string)
  }
  return null
}

const text = proposed()
if (text === null) process.exit(0)

const { ESLint } = await import('eslint')
const { countGates } = await import('@estiva-app/ui/eslint')
const eslint = new ESLint({ cwd: root, overrideConfigFile: join(root, 'eslint.gates.config.js') })
const results = await eslint.lintText(text, { filePath: file })
// A rule's errors only. Code that does not parse yet (one edit of several) is
// the typecheck's to judge; the gate looks again at the edit that completes it.
const errors = results.flatMap((r) => r.messages.filter((m) => m.severity === 2 && m.ruleId))
const { disabled } = countGates(results)
if (errors.length === 0 && disabled.length === 0) process.exit(0)

const lines = [`${rel} was not written: the UI Guardrails refuse it (eslint.gates.config.js).`]
for (const m of errors) lines.push(`  ${m.line}:${m.column}  ${m.message}${m.ruleId ? `  (${m.ruleId})` : ''}`)
for (const d of disabled) lines.push(`  ${d.line}  an eslint-disable switches ${d.ruleId} off. Keep the element only with its reason on the line above: // @estiva-escape: <reason>`)
process.stderr.write(`${lines.join('\n')}\n`)
process.exit(2)
