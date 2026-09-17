import { TOKEN_LINT_IGNORES, tokenLint, tokenValues } from '@estiva-app/ui/gates'
import reactHooks from 'eslint-plugin-react-hooks'
import { defineConfig, globalIgnores } from 'eslint/config'

/**
 * The token rules on their own — `npm run lint:tokens`, and the CI gate (D55).
 *
 * The settings are the package's own piece, `tokenLint` and `tokenValues` in
 * `@estiva-app/ui/gates`, imported (UIG-32, estiva-ui docs/GATES.md §23). They
 * were the same block, character for character, in Peek and in Ship; now there
 * is one. UIG-28's hand-written sizes, corners, shadows and inline colours are
 * `tokenValues`.
 *
 * `npm run lint` runs everything, token rules included, and reports the 79
 * pre-existing errors Peek already carries. This config runs the token contract
 * by itself so CI can fail on a class that emits nothing without also failing
 * on a backlog nobody is clearing this week.
 *
 * `react-hooks` is registered for one reason: source files carry
 * `eslint-disable-next-line react-hooks/exhaustive-deps` comments, and ESLint
 * refuses a directive for a rule it does not know. The rule is off here — the
 * full lint is where it runs.
 */
export default defineConfig([
  globalIgnores([...TOKEN_LINT_IGNORES, 'demo-scenarios', 'convex/_generated']),
  {
    plugins: { 'react-hooks': reactHooks },
    rules: { 'react-hooks/exhaustive-deps': 'off' },
    // Every `react-hooks/exhaustive-deps` directive in the source is unused
    // *here*, because the rule is off here. Reporting them would be this config
    // complaining about the other one's business.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
  },
  tokenLint(),
  tokenValues(),
])
