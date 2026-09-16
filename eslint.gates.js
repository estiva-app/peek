import estiva from '@estiva-app/ui/eslint'
import { parser as typescriptParser } from 'typescript-eslint'
import { TOKEN_LINT_IGNORES } from './eslint.tokens.js'

/**
 * The UI Guardrails' rules (docs/GATES.md in estiva-ui; UIG-3 is the first):
 * a rule refuses what the package already has, and its message names the
 * component to use instead.
 *
 * The rules are code in `@estiva-app/ui/eslint`, not here, so Peek, Ship and
 * the editor hook all run the same rule, and a new rule arrives with a version
 * bump. This file only says where they apply.
 *
 * The same shape as the token lint: this file is the rules alone, with no
 * opinion about the rest of the set; `eslint.gates.config.js` runs them by
 * themselves, which is the CI gate and what the hook in `.claude/hooks/gates.mjs`
 * runs; `eslint.config.js` adds them beside everything else, so an editor shows
 * them where the element is typed.
 *
 * Where: every `.ts` and `.tsx` under `src`, stories included (a story is what
 * people read and copy), tests not (a test mounts markup to test it) — Katerina's
 * rulings of 13 September. `.ts` since UIG-8: a listener on the whole page in a
 * hook file is behaviour rebuilt by hand too.
 *
 * A place that keeps a raw element says why, on the line above:
 * `// @estiva-escape: <reason>`, or `{/* @estiva-escape: <reason> *\/}` as a JSX
 * child. Never `eslint-disable`: the count refuses it. The token lint's notes
 * (`eslint-disable-next-line <rule> -- @estiva-escape: <reason>`) are the token
 * lint's, and stay as they are.
 */
export const GATE_LINT_IGNORES = TOKEN_LINT_IGNORES

export const gateLint = {
  ...estiva.configs.recommended,
  files: ['src/**/*.{ts,tsx}'],
  ignores: ['**/*.test.ts', '**/*.test.tsx'],
  languageOptions: {
    parser: typescriptParser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
}
