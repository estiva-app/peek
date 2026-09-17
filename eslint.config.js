import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'
// The token settings and the gate's rules are the package's own pieces, imported
// (UIG-32, estiva-ui docs/GATES.md §23). `eslint.tokens.config.js` and
// `eslint.gates.config.js` run each of them alone, and those are the CI gates.
import { gateLint, tokenLint, tokenValues, TOKEN_LINT_IGNORES } from '@estiva-app/ui/gates'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  // The token contract (D55), so an editor shows it where the class is typed.
  // `npm run lint:tokens` runs these alone, and that is the CI gate — this set
  // still carries 79 pre-existing errors of its own.
  globalIgnores([...TOKEN_LINT_IGNORES, 'demo-scenarios', 'convex/_generated']),
  tokenLint(),
  // UIG-28: hand-written sizes, corners, shadows and inline colours.
  tokenValues(),
  // The UI Guardrails' rules (UIG-3), so an editor shows them where the element
  // is typed. `npm run lint:rules` runs these alone, and that is the CI gate.
  gateLint(),
])
