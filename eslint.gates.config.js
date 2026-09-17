import { gateConfig } from '@estiva-app/ui/gates'
import reactHooks from 'eslint-plugin-react-hooks'

/**
 * The UI Guardrails' rules on their own — `npm run lint:rules`, CI's job `gate`
 * (GitHub requires it on main: never rename it), and the config the editor hook
 * lints a proposed write with.
 *
 * The gate is the package's own piece, `gateConfig` in `@estiva-app/ui/gates`,
 * imported (UIG-32, estiva-ui docs/GATES.md §23): the rules, where they apply
 * (every `.ts` and `.tsx` under `src`, stories included, tests not) and the
 * plugins whose directives must not break it. Peek says only what is Peek's:
 * React's hooks plugin, whose `exhaustive-deps` directives the source carries,
 * and the two folders that are not Peek's own source.
 *
 * `npm run lint` runs everything, these included, and still carries errors of
 * its own. This config runs the gate by itself, so it can fail on a raw element
 * without also failing on that backlog. Zero errors the day it landed.
 *
 * A place that keeps something the gate refuses says why, on the line above:
 * `// @estiva-escape: <reason>`, or `{/* @estiva-escape: <reason> *\/}` as a
 * JSX child. Never `eslint-disable`: the count refuses it.
 */
export default gateConfig({
  quiet: { 'react-hooks': reactHooks },
  ignores: ['demo-scenarios', 'convex/_generated'],
})
