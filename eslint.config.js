import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'
import { tokenLint, tokenValues, TOKEN_LINT_IGNORES } from './eslint.tokens.js'

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
  globalIgnores(TOKEN_LINT_IGNORES),
  tokenLint,
  // UIG-28: hand-written sizes, corners, shadows and inline colours.
  tokenValues,
])
