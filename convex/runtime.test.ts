/**
 * Convex runtime rules that only the deploy would otherwise catch.
 *
 * This exists because of a real failure: `nostr/sync.ts` kept its `"use node"`
 * pragma after losing every reason to have one, and two queries were added to
 * it. `tsc -b` passed, `vite build` passed, 251 tests passed, CI was green, the
 * PR merged — and the deploy died with *"`pubkeysMissingProfile` defined in
 * `nostr/sync.js` is a Query function. Only actions can be defined in Node.js."*
 *
 * Nothing in the local toolchain runs Convex's module loader, so nothing local
 * could see it. That is the same shape as every other bug in this project: the
 * tool reporting success is not the tool that would notice.
 *
 * A file-level rule needs no deployment to check, so it goes here.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const CONVEX_DIR = join(import.meta.dirname, '.')

function convexSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    // `_generated` is Convex's own output, and tests are never deployed.
    if (entry === '_generated' || entry === 'node_modules') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...convexSourceFiles(full))
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(full)
  }
  return out
}

describe('Node-runtime files', () => {
  it('export only actions', () => {
    const offenders: string[] = []
    for (const file of convexSourceFiles(CONVEX_DIR)) {
      const source = readFileSync(file, 'utf8')
      // The pragma is only honoured as the very first statement.
      if (!/^\s*['"]use node['"]/.test(source)) continue
      for (const match of source.matchAll(
        /export const (\w+) = (query|mutation|internalQuery|internalMutation)\(/g,
      )) {
        offenders.push(`${file.replace(CONVEX_DIR, 'convex')}: ${match[1]} is a ${match[2]}`)
      }
    }
    // Convex refuses the whole push, so one of these breaks every deploy —
    // including deploys of changes that have nothing to do with it.
    expect(offenders).toEqual([])
  })
})
