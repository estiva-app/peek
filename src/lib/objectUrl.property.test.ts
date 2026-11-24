/**
 * A link Peek writes reads back as the same file (TES-4), and since LIN-3 it is
 * the shared writer's: every link Peek copies for a file is the short
 * `/<word>/<slug>-<d>`, which must open that file by the rule `FilePage` reads
 * it with and read the same in interop's `matchObjectUrl`, which Ship and Leaf
 * read pasted links with. A `d` no file can have — anything but a random
 * lowercase uuid — gets no link at all, never the old long `/topic/<address>`.
 *
 * Runs 1,000 inputs a rule on a fixed seed; `FC_SEED` / `FC_RUNS` replay or
 * widen a run: `FC_SEED=<seed> npx vitest run src/lib/objectUrl.property.test.ts`.
 */
import { afterEach, describe, expect, it } from 'vitest'
import fc from 'fast-check'
import * as shared from '@estiva-app/interop'
import { isFileId } from '@estiva-app/protocol'
import { PRODUCTION_MANIFESTS } from '@/test/manifests'
import {
  addressFromRef,
  filePath,
  fileRouteFromPath,
  forgetRouteWords,
  refNamesFile,
  rememberRouteWords,
  routeWordsOf,
  shareableFileUrl,
} from './objectUrl'

const settings = {
  seed: process.env.FC_SEED ? Number(process.env.FC_SEED) : 20_261_120,
  numRuns: process.env.FC_RUNS ? Number(process.env.FC_RUNS) : 1000,
}
if (!Number.isSafeInteger(settings.seed) || !Number.isSafeInteger(settings.numRuns) || settings.numRuns < 1) {
  throw new Error(`FC_SEED and FC_RUNS must be whole numbers: ${process.env.FC_SEED} ${process.env.FC_RUNS}`)
}

/** The shapes Peek, Ship and Leaf publish (each repo's `scripts/publish-manifest.ts`). */
const PATTERNS = PRODUCTION_MANIFESTS.flatMap(shared.urlPatternsOf)
const KINDS = [30840, 30842, 30850, 30851]

const hex64 = fc.string({ unit: fc.constantFrom(...'0123456789abcdef'), minLength: 64, maxLength: 64 })
const titleArb = fc.oneof(
  fc.string({ unit: 'grapheme', maxLength: 80 }),
  fc.string({ unit: fc.constantFrom('-', ' ', ':', '/', '%', 'a', 'f', '0', 'É', 'ß', 'ﬁ', '中', '🙂', '́'), maxLength: 80 }),
)
/** A file's `d`: a uuid as the apps make one, or anything an outside app could write — a colon, a slash, a percent sign. */
/** A random (version 4) lowercase uuid, the only `d` a file can have (LIN-1). */
const v4Arb = fc.uuid().map((u) => `${u.slice(0, 14)}4${u.slice(15, 19)}8${u.slice(20)}`.toLowerCase())
const dArb = fc.oneof(
  v4Arb,
  fc.uuid(),
  fc.string({ unit: 'grapheme', minLength: 1, maxLength: 40 }),
  fc.tuple(fc.constantFrom('team:', 'a/b-', '100%-', 'x '), fc.uuid()).map(([a, u]) => `${a}${u}`),
)
const addressArb = fc.tuple(fc.constantFrom(...KINDS), hex64, dArb).map(([kind, pubkey, d]) => ({ kind, pubkey, d, address: `${kind}:${pubkey}:${d}` }))

describe('a link Peek copies for a file', () => {
  afterEach(() => forgetRouteWords())

  it('opens that file on its page, and the launcher knows it is the one open, whatever the title; an odd d gets none', () => {
    rememberRouteWords(routeWordsOf(PRODUCTION_MANIFESTS))
    fc.assert(
      fc.property(addressArb, titleArb, ({ address, d }, title) => {
        const path = filePath(address, title)
        if (!isFileId(d)) {
          expect(path, d).toBeNull()
          return
        }
        expect(path).not.toBeNull()
        // `FilePage` gets the ref from the router, which decodes the segment (react-router's `decodePath`).
        const pageRef = decodeURIComponent(path!.split('/')[2])
        // Never the long link: no address in it.
        expect(addressFromRef(pageRef), path!).toBeNull()
        expect(shared.identifierFromRef(pageRef), path!).toBe(d)
        // The launcher and the rail read the pathname as the address bar has it, escapes and all.
        const route = fileRouteFromPath(path!)
        expect(route, path!).not.toBeNull()
        expect(refNamesFile(route!.ref, address), path!).toBe(true)
      }),
      settings,
    )
  })

  it('reads as the same file and kind where Ship and Leaf read a pasted link', () => {
    rememberRouteWords(routeWordsOf(PRODUCTION_MANIFESTS))
    fc.assert(
      fc.property(fc.constantFrom(...KINDS), hex64, v4Arb, titleArb, (kind, pubkey, d, title) => {
        const url = shareableFileUrl(`${kind}:${pubkey}:${d}`, title, 'https://peek.estiva.app')!
        const match = shared.matchObjectUrl(url, PATTERNS)
        expect(match, url).not.toBeNull()
        expect([match!.identifier, match!.kind]).toEqual([d, kind])
      }),
      settings,
    )
  })

  it("is never taken for another file's link", () => {
    rememberRouteWords(routeWordsOf(PRODUCTION_MANIFESTS))
    fc.assert(
      fc.property(addressArb, addressArb, titleArb, (one, other, title) => {
        const [a, b] = [one.d.toLowerCase(), other.d.toLowerCase()]
        fc.pre(one.address.toLowerCase() !== other.address.toLowerCase() && !a.endsWith(b) && !b.endsWith(a))
        const path = filePath(one.address, title)
        fc.pre(path !== null)
        const route = fileRouteFromPath(path!)
        expect(refNamesFile(route!.ref, other.address)).toBe(false)
      }),
      settings,
    )
  })
})
