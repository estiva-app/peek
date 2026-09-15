import betterTailwindcss from 'eslint-plugin-better-tailwindcss'
import reactHooks from 'eslint-plugin-react-hooks'
import { defineConfig, globalIgnores } from 'eslint/config'
import { gateLint, GATE_LINT_IGNORES } from './eslint.gates.js'

/**
 * The UI Guardrails' rules on their own — `npm run lint:rules`, the CI gate
 * ("Gate lint"), and the config the editor hook lints a proposed write with.
 *
 * `npm run lint` runs everything, these included, and still carries errors of
 * its own. This config runs the gate by itself, so it can fail on a raw element
 * without also failing on that backlog. Zero errors the day it landed.
 *
 * The other plugins are registered, every rule off, for one reason: the source
 * carries `eslint-disable-next-line` comments for `react-hooks`, the token lint
 * (`better-tailwindcss`, and the same plugin as `token-values`) and its
 * warnings (`token-spacing`), and ESLint refuses a directive for a rule it does
 * not know. Those rules run in their own configs.
 */
export default defineConfig([
  globalIgnores(GATE_LINT_IGNORES),
  {
    plugins: {
      'react-hooks': reactHooks,
      'better-tailwindcss': betterTailwindcss,
      'token-values': betterTailwindcss,
      'token-spacing': betterTailwindcss,
    },
    // Every other config's directives are unused *here*, because their rules
    // are off here. Reporting them would be this config complaining about the
    // others' business.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
  },
  gateLint,
])
