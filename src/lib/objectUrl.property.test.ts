/**
 * A link Peek writes reads back as the same file, and Peek's own copy of the
 * address rules agrees with the shared one (TES-4).
 *
 * Peek keeps `slugify`, `objectRef` and `identifierFromRef` beside interop's
 * (they were written here first, PEE-14). Removing the copy is not this
 * project's; this checks the two give the same answer on thousands of made-up
 * titles and refs, so a change to one that the other misses fails here.
 *
 * And every link Peek copies for a file — the short `/<word>/<slug>-<d>` and,
 * for a `d` a short link cannot carry, the long `/topic/<address>` — must open
 * that file by the rule `FilePage` reads it with, and read the same in
 * interop's `matchObjectUrl`, which Ship and Leaf read pasted links with.
 *
 * Runs 1,000 inputs a rule on a fixed seed; `FC_SEED` / `FC_RUNS` replay or
 * widen a run: `FC_SEED=<seed> npx vitest run src/lib/objectUrl.property.test.ts`.
 */
import { afterEach, describe, expect, it } from 'vitest'
import fc from 'fast-check'
import * as shared from '@estiva-app/interop'
import {
  addressFromRef,
  filePath,
  fileRouteFromPath,
  forgetRouteWords,
  identifierFromRef,
  objectRef,
  refNamesFile,
  rememberRouteWords,
  routeWordsOf,
  shareableFileUrl,
  slugify,
} from './objectUrl'

const settings = {
  seed: process.env.FC_SEED ? Number(process.env.FC_SEED) : 20_261_120,
  numRuns: process.env.FC_RUNS ? Number(process.env.FC_RUNS) : 1000,
}
if (!Number.isSafeInteger(settings.seed) || !Number.isSafeInteger(settings.numRuns) || settings.numRuns < 1) {
  throw new Error(`FC_SEED and FC_RUNS must be whole numbers: ${process.env.FC_SEED} ${process.env.FC_RUNS}`)
}

/** The shapes Peek, Ship and Leaf publish (each repo's `scripts/publish-manifest.ts`). */
const MANIFESTS = [
  { tags: [['web', 'https://peek.estiva.app/o/<bech32>', 'naddr'], ['urls', 'https://peek.estiva.app/topic/<slug>-<d>', '30840']] },
  {
    tags: [
      ['web', 'https://ship.estiva.app/o/<bech32>', 'naddr'],
      ['urls', 'https://ship.estiva.app/project/<slug>-<d>#block-<block>', '30850'],
      ['urls', 'https://ship.estiva.app/issue/<slug>-<d>#block-<block>', '30851'],
    ],
  },
  { tags: [['web', 'https://leaf.estiva.app/f/<bech32>', 'naddr'], ['urls', 'https://leaf.estiva.app/document/<slug>-<d>#block-<block>', '30842']] },
]
const PATTERNS = MANIFESTS.flatMap(shared.urlPatternsOf)
const KINDS = [30840, 30842, 30850, 30851]

const hex64 = fc.string({ unit: fc.constantFrom(...'0123456789abcdef'), minLength: 64, maxLength: 64 })
const titleArb = fc.oneof(
  fc.string({ unit: 'grapheme', maxLength: 80 }),
  fc.string({ unit: fc.constantFrom('-', ' ', ':', '/', '%', 'a', 'f', '0', 'É', 'ß', 'ﬁ', '中', '🙂', '́'), maxLength: 80 }),
)
/** Any ref a link could carry: text, a uuid at the end, a uuid upper-cased, hex that is nearly one. */
const refArb = fc.oneof(
  fc.string({ unit: 'grapheme', maxLength: 60 }),
  fc.tuple(fc.string({ maxLength: 20 }), fc.uuid()).map(([a, u]) => `${a}${u}`),
  fc.tuple(fc.string({ maxLength: 20 }), fc.uuid()).map(([a, u]) => `${a}${u.toUpperCase()}`),
  fc.uuid().map((u) => u.slice(0, 35)),
)
/** A file's `d`: a uuid as the apps make one, or anything an outside app could write — a colon, a slash, a percent sign. */
const dArb = fc.oneof(
  fc.uuid(),
  fc.string({ unit: 'grapheme', minLength: 1, maxLength: 40 }),
  fc.tuple(fc.constantFrom('team:', 'a/b-', '100%-', 'x '), fc.uuid()).map(([a, u]) => `${a}${u}`),
)
const addressArb = fc.tuple(fc.constantFrom(...KINDS), hex64, dArb).map(([kind, pubkey, d]) => ({ kind, pubkey, d, address: `${kind}:${pubkey}:${d}` }))

describe("Peek's own address rules", () => {
  it('make the same slug, ref and identity as the shared ones, for any title and ref', () => {
    fc.assert(
      fc.property(titleArb, refArb, (title, ref) => {
        expect(slugify(title)).toBe(shared.slugify(title))
        expect(identifierFromRef(ref)).toBe(shared.identifierFromRef(ref))
        expect(objectRef(ref, title)).toBe(shared.objectRef(ref, title))
      }),
      settings,
    )
  })
})

describe('a link Peek copies for a file', () => {
  afterEach(() => forgetRouteWords())

  it('opens that file on its page, and the launcher knows it is the one open, whatever the title and the d', () => {
    rememberRouteWords(routeWordsOf(PATTERNS))
    fc.assert(
      fc.property(addressArb, titleArb, ({ address, d }, title) => {
        const path = filePath(address, title)
        // `FilePage` gets the ref from the router, which decodes the segment (react-router's `decodePath`).
        const pageRef = decodeURIComponent(path.split('/')[2])
        const asAddress = addressFromRef(pageRef)
        if (asAddress) expect(asAddress, path).toBe(address)
        else expect(identifierFromRef(pageRef), path).toBe(d)
        // The launcher and the rail read the pathname as the address bar has it, escapes and all.
        const route = fileRouteFromPath(path)
        expect(route, path).not.toBeNull()
        expect(refNamesFile(route!.ref, address), path).toBe(true)
      }),
      settings,
    )
  })

  it('reads as the same file and kind where Ship and Leaf read a pasted link', () => {
    rememberRouteWords(routeWordsOf(PATTERNS))
    fc.assert(
      fc.property(fc.constantFrom(...KINDS), hex64, fc.uuid(), titleArb, (kind, pubkey, d, title) => {
        const url = shareableFileUrl(`${kind}:${pubkey}:${d}`, title, 'https://peek.estiva.app')
        const match = shared.matchObjectUrl(url, PATTERNS)
        expect(match, url).not.toBeNull()
        expect([match!.identifier, match!.kind]).toEqual([d, kind])
      }),
      settings,
    )
  })

  it("is never taken for another file's link", () => {
    rememberRouteWords(routeWordsOf(PATTERNS))
    fc.assert(
      fc.property(addressArb, addressArb, titleArb, (one, other, title) => {
        const [a, b] = [one.d.toLowerCase(), other.d.toLowerCase()]
        fc.pre(one.address.toLowerCase() !== other.address.toLowerCase() && !a.endsWith(b) && !b.endsWith(a))
        const route = fileRouteFromPath(filePath(one.address, title))
        expect(refNamesFile(route!.ref, other.address)).toBe(false)
      }),
      settings,
    )
  })
})
