import { tokenConfig } from '@estiva-app/ui/gates'
import reactHooks from 'eslint-plugin-react-hooks'

/**
 * The token rules on their own — `npm run lint:tokens`, and the CI gate (D55).
 *
 * The whole config is the package's own piece, `tokenConfig` in
 * `@estiva-app/ui/gates` (UIG-37, estiva-ui docs/GATES.md §23). Until then
 * this file put it together by hand from `tokenLint` and `tokenValues`, and
 * knew only `react-hooks`' rule names: PR #324's
 * `eslint-disable-line @typescript-eslint/no-explicit-any` failed it with
 * "Definition for rule ... was not found". The package now registers
 * TypeScript's plugin itself, every rule off.
 *
 * `npm run lint` runs everything, token rules included, and reports the
 * pre-existing errors Peek already carries. This config runs the token contract
 * by itself so CI can fail on a class that emits nothing without also failing
 * on a backlog nobody is clearing this week.
 *
 * `react-hooks` is named for one reason: source files carry
 * `eslint-disable-next-line react-hooks/exhaustive-deps` comments, and ESLint
 * refuses a directive for a rule it does not know. Its rules are off here — the
 * full lint is where they run.
 */
export default tokenConfig({
  quiet: { 'react-hooks': reactHooks },
  ignores: ['demo-scenarios'],
})
