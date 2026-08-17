/**
 * Every resolution write must also publish (PEEK-128).
 *
 * A source-level check rather than a behavioural one, because this failure is
 * invisible from every other angle: the Convex row still resolves, the card
 * still renders resolved, the suite still passes, and only the relay is quietly
 * short an assertion. It shipped exactly that way once — the `→ msg` reply path
 * called the mutation bare while the two toggle paths were wired — and nothing
 * caught it until the relay was read back by hand.
 *
 * If a new call site legitimately should not publish, name it in ALLOWED with
 * the reason rather than loosening the rule.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Repo-relative: the jsdom env gives `import.meta.url` a non-file scheme, and
// vitest runs from the project root.
const SOURCE = 'src/api/actions.ts'

/** Call sites that deliberately do not publish. */
const ALLOWED: string[] = []

describe('resolution publishing', () => {
  it('wraps every setResolutionRemote call in publishResolution', () => {
    const src = readFileSync(SOURCE, 'utf8')
    const lines = src.split('\n')

    const callSites = lines
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter(({ line }) => line.includes('setResolutionRemote(') && !line.startsWith('*'))
      // The `useMutation` binding itself is the declaration, not a call site.
      .filter(({ line }) => !line.includes('useMutation'))

    expect(callSites.length).toBeGreaterThan(0)

    const unwrapped = callSites.filter(({ line, n }) => {
      if (ALLOWED.includes(String(n))) return false
      // Either wrapped inline, or the preceding non-empty line opens the wrapper.
      if (line.includes('publishResolution(')) return false
      const prev = lines
        .slice(0, n - 1)
        .reverse()
        .find((l) => l.trim() !== '')
      return !prev?.includes('publishResolution(')
    })

    expect(
      unwrapped.map(({ n, line }) => `line ${n}: ${line}`),
      'a resolution that never reaches the relay looks identical to one that does',
    ).toEqual([])
  })
})
