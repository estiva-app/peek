import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import {
  slugify,
  objectRef,
  identifierFromRef,
  addressFromRef,
  filePath,
  shortFilePath,
  fileRouteFromPath,
  routeWordsOf,
  declaredKinds,
  rememberRouteWords,
  forgetRouteWords,
  subscribeRouteWords,
  currentRouteWords,
  refNamesFile,
  shareableFileUrl,
  topicPath,
  shareableTopicUrl,
  shareableMessageUrl,
} from './objectUrl'

/** A real production channel uuid, from RFC 0.5 §7.2's own example. */
const UUID = '925897ad-796e-4bc6-999c-ca19df26c4aa'
const SHIP = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const ISSUE = `30851:${SHIP}:d68a8c78-5ec7-4652-b236-89ab57ac5b1e`

/** A bare file — a topic in a Folder — by the person who started it. */
const FILE_D = 'd68a8c78-5ec7-4652-b236-89ab57ac5b1e'
const FILE = `30840:${SHIP}:${FILE_D}`

/*
  One route, two grammars — FOL-19, FOL-37. `/topic/<slug>-<d>` is a bare
  file's short form and `/topic/<address>` is any file; the link says which,
  and nothing is fetched to find out.
*/
describe('addressFromRef', () => {
  it('reads an address out of the ref, colons and all', () => {
    expect(addressFromRef(ISSUE)).toBe(ISSUE)
  })

  it('is null for a short ref, which carries a d and no author', () => {
    // A slug cannot contain a colon, so nothing a short link carries can be
    // mistaken for an address.
    expect(addressFromRef(`design-review-${UUID}`)).toBe(null)
    expect(addressFromRef(UUID)).toBe(null)
  })

  it('tolerates a link whose colons were percent-encoded on the way', () => {
    expect(addressFromRef(encodeURIComponent(ISSUE))).toBe(ISSUE)
  })

  it('does not decode twice: a d with a literal percent survives', () => {
    // `useParams` has already decoded the segment once. A second decode would
    // turn `%25` into `%` and the address into a different address.
    const odd = `30840:${SHIP}:a%25b`
    expect(addressFromRef(odd)).toBe(odd)
  })

  it('is null for things that are nearly an address', () => {
    expect(addressFromRef(`30851:${SHIP.slice(0, 63)}:x`)).toBe(null)
    expect(addressFromRef(`30851:${SHIP}:`)).toBe(null)
    expect(addressFromRef('naddr1qq')).toBe(null)
    expect(addressFromRef('%E0%A4%A')).toBe(null)
  })
})

describe('filePath', () => {
  it('opens a file of a kind no manifest declares under /topic/ at its bare address', () => {
    // The colons stay: a legal path character, and the one part of the URL
    // that carries meaning stays readable (§7.3, from the other side).
    expect(filePath(ISSUE)).toBe(`/topic/${ISSUE}`)
    // A title does not buy a short form: only a declared word does (FOL-39),
    // and until the manifests have been read Ship's issue has none.
    expect(filePath(ISSUE, 'Fix the header')).toBe(`/topic/${ISSUE}`)
  })

  /* A topic in a Folder takes §7's short form — FOL-37. */
  it('opens a bare file at /topic/<slug>-<d>, the d alone being the identity', () => {
    expect(filePath(FILE, 'Design review')).toBe(`/topic/design-review-${FILE_D}`)
  })

  it('writes the bare d when there is no title, for the page to canonicalise', () => {
    expect(filePath(FILE)).toBe(`/topic/${FILE_D}`)
    expect(filePath(FILE, '日本語')).toBe(`/topic/${FILE_D}`)
  })

  it('lowercases an upper-cased d so the short link resolves against the relay spelling', () => {
    expect(filePath(`30840:${SHIP}:${FILE_D.toUpperCase()}`, 'X')).toBe(`/topic/x-${FILE_D}`)
  })

  it('keeps the long form for a 30840 whose d is not a uuid, since the tail could not be read back', () => {
    expect(filePath(`30840:${SHIP}:handmade`, 'X')).toBe(`/topic/30840:${SHIP}:handmade`)
  })

  it('round-trips the short form: what it writes, identifierFromRef reads', () => {
    const path = filePath(FILE, 'A very, very long name — with punctuation')
    expect(identifierFromRef(path.slice('/topic/'.length))).toBe(FILE_D)
    expect(addressFromRef(path.slice('/topic/'.length))).toBe(null)
  })

  it('escapes only the d, which is the one segment an app may put anything in', () => {
    expect(filePath(`30840:${SHIP}:a b/c`)).toBe(`/topic/30840:${SHIP}:a%20b%2Fc`)
  })

  it('lowercases the pubkey so a link that was upper-cased in transit still resolves', () => {
    expect(filePath(`30851:${SHIP.toUpperCase()}:d`)).toBe(`/topic/30851:${SHIP}:d`)
  })

  it('round-trips through the router and addressFromRef', () => {
    // A `/` in the d would split the path into two segments, so it must be
    // escaped; the router decodes the segment once before the page sees it.
    const withSlash = `30840:${SHIP}:a/b`
    const segment = filePath(withSlash).slice('/topic/'.length)
    expect(segment).not.toContain('/')
    expect(addressFromRef(decodeURIComponent(segment))).toBe(withSlash)
  })
})

describe('shareableFileUrl', () => {
  it('is the short form for a bare file and the address for anything else, on the origin', () => {
    expect(shareableFileUrl(FILE, 'Design review', 'https://peek.estiva.app/')).toBe(
      `https://peek.estiva.app/topic/design-review-${FILE_D}`,
    )
    expect(shareableFileUrl(ISSUE, 'Fix the header', 'https://peek.estiva.app')).toBe(
      `https://peek.estiva.app/topic/${ISSUE}`,
    )
  })
})

/*
  Every declared shape — RFC 0.5 §7.7, FOL-39. The words come off the
  manifests' `urls` tags; these are the shapes production's manifests declared
  on 2026-09-21 (`scripts/probe-fol38-manifest-readback.ts`), Ship's and Peek's.
*/
const SHIP_SHAPES = [
  { pattern: 'https://ship.estiva.app/project/<slug>-<d>', kind: 30850 },
  { pattern: 'https://ship.estiva.app/issue/<slug>-<d>', kind: 30851 },
  { pattern: 'https://ship.estiva.app/#/project/<d>', kind: 30850 },
  { pattern: 'https://ship.estiva.app/#/issue/<d>', kind: 30851 },
]
const PEEK_SHAPES = [
  { pattern: 'https://peek.estiva.app/topic/<slug>-<d>', kind: 30840 },
  { pattern: 'https://peek.estiva.app/topic/<slug>-<d>?thread=<id>', kind: 1111 },
  { pattern: 'https://peek.estiva.app/topic-old/<slug>-<d>', kind: 39000 },
  { pattern: 'https://peek.estiva.app/message/<id>', kind: 9 },
]
const PROJECT = `30850:${SHIP}:fa6af533-2fa1-48d8-b7f0-1f6330443e61`

describe('routeWordsOf', () => {
  it('reads a word per declared /<word>/<slug>-<d> shape, whatever the host', () => {
    const words = routeWordsOf([...SHIP_SHAPES, ...PEEK_SHAPES])
    expect(words.byWord).toEqual({ topic: [30840], project: [30850], issue: [30851] })
    expect(words.byKind).toEqual({ 30840: 'topic', 30850: 'project', 30851: 'issue' })
  })

  it('skips a shape whose identity is in the query, an <id> shape, a hash route and a page of Peek’s own', () => {
    // `?thread=<id>` is about the comment (FOL-38); `/message/<id>` and
    // `/topic-old/` are Peek's own pages; `/#/issue/<d>` has no path word.
    const words = routeWordsOf(PEEK_SHAPES)
    expect(words.byWord).toEqual({ topic: [30840] })
    expect(routeWordsOf([{ pattern: 'https://ship.estiva.app/#/issue/<d>', kind: 30851 }]).byWord).toEqual({ topic: [30840] })
  })

  it('skips a shape that does not say its kind — there is nothing to resolve against', () => {
    expect(routeWordsOf([{ pattern: 'https://other.example/note/<slug>-<d>' }]).byWord).toEqual({ topic: [30840] })
  })

  it('gathers two apps’ kinds under one word, and gives a kind the first word declared for it', () => {
    const words = routeWordsOf([
      { pattern: 'https://a.example/issue/<slug>-<d>', kind: 30851 },
      { pattern: 'https://b.example/issue/<slug>-<d>', kind: 41000 },
      { pattern: 'https://b.example/ticket/<slug>-<d>', kind: 41000 },
    ])
    expect(words.byWord).toEqual({ topic: [30840], issue: [30851, 41000], ticket: [41000] })
    expect(words.byKind[41000]).toBe('issue')
  })

  it('always holds Peek’s own shape, so a bare file is short before the manifests answer', () => {
    expect(routeWordsOf([])).toEqual({ byWord: { topic: [30840] }, byKind: { 30840: 'topic' }, origins: [] })
  })

  it('answers every declared kind for the unknown-word fallback — never a bare #d', () => {
    expect(declaredKinds(routeWordsOf([...SHIP_SHAPES, ...PEEK_SHAPES]))).toEqual([30840, 30850, 30851])
  })
})

describe('filePath with the manifests read', () => {
  beforeEach(() => rememberRouteWords(routeWordsOf([...SHIP_SHAPES, ...PEEK_SHAPES])))
  afterEach(() => forgetRouteWords())

  it('writes /<word>/<slug>-<d> for a kind with a declared word', () => {
    expect(filePath(ISSUE, 'Fix the header')).toBe('/issue/fix-the-header-d68a8c78-5ec7-4652-b236-89ab57ac5b1e')
    expect(filePath(PROJECT, 'Composition')).toBe('/project/composition-fa6af533-2fa1-48d8-b7f0-1f6330443e61')
    expect(filePath(FILE, 'Design review')).toBe(`/topic/design-review-${FILE_D}`)
  })

  it('keeps the long form for a kind no manifest declares', () => {
    const other = `30890:${SHIP}:${FILE_D}`
    expect(filePath(other, 'State')).toBe(`/topic/${other}`)
    expect(shortFilePath(other, 'State')).toBeNull()
  })

  it('keeps the long form for a declared kind whose d is not a uuid, since the tail could not be read back', () => {
    expect(filePath(`30851:${SHIP}:SHI-4`, 'Refs collide')).toBe(`/topic/30851:${SHIP}:SHI-4`)
  })

  it('round-trips: the word and the d it writes are what the route reads', () => {
    const path = filePath(PROJECT, 'Composition')
    const route = fileRouteFromPath(path)
    expect(route?.word).toBe('project')
    expect(identifierFromRef(route!.ref)).toBe('fa6af533-2fa1-48d8-b7f0-1f6330443e61')
    expect(refNamesFile(route!.ref, PROJECT)).toBe(true)
  })

  it('is what Copy link hands out', () => {
    expect(shareableFileUrl(ISSUE, 'Fix the header', 'https://peek.estiva.app')).toBe(
      'https://peek.estiva.app/issue/fix-the-header-d68a8c78-5ec7-4652-b236-89ab57ac5b1e',
    )
  })

  it('tells subscribers when the words change, so links drawn early are drawn again', () => {
    const seen: string[] = []
    const stop = subscribeRouteWords(() => seen.push(filePath(ISSUE)))
    rememberRouteWords(routeWordsOf([]))
    stop()
    rememberRouteWords(routeWordsOf(SHIP_SHAPES))
    expect(seen).toEqual([`/topic/${ISSUE}`])
    expect(currentRouteWords().byKind[30851]).toBe('issue')
  })
})

/* The root is files; Peek's own pages are under /app/ — FOL-39. */
describe('fileRouteFromPath', () => {
  it('reads the word and the ref off a two-segment root path', () => {
    expect(fileRouteFromPath('/issue/fix-the-header-d68a8c78-5ec7-4652-b236-89ab57ac5b1e')).toEqual({
      word: 'issue',
      ref: 'fix-the-header-d68a8c78-5ec7-4652-b236-89ab57ac5b1e',
    })
    expect(fileRouteFromPath(`/topic/${ISSUE}`)).toEqual({ word: 'topic', ref: ISSUE })
  })

  it('is null for a page of Peek’s own, at the root or under /app/', () => {
    for (const path of ['/app/desk', '/app/folders/x', '/app/people/alice', '/topics/1', '/topic-old/x', '/o/naddr1', '/message/abc', '/']) {
      expect(fileRouteFromPath(path)).toBeNull()
    }
  })
})

/* The launcher's "the page you are on is not somewhere to go", in both grammars — FOL-37. */
describe('refNamesFile', () => {
  it('matches a short ref on the file’s d, whatever the slug', () => {
    expect(refNamesFile(`design-review-${FILE_D}`, FILE)).toBe(true)
    expect(refNamesFile(`stale-name-${FILE_D}`, FILE)).toBe(true)
    expect(refNamesFile(FILE_D, FILE)).toBe(true)
    expect(refNamesFile(`design-review-${UUID}`, FILE)).toBe(false)
  })

  it('matches a long ref on the whole address', () => {
    expect(refNamesFile(ISSUE, ISSUE)).toBe(true)
    expect(refNamesFile(ISSUE.toUpperCase(), ISSUE)).toBe(true)
    expect(refNamesFile(ISSUE, FILE)).toBe(false)
  })

  it('names nothing when the ref carries no identity', () => {
    expect(refNamesFile('just-a-slug', FILE)).toBe(false)
  })
})

describe('slugify', () => {
  it('reduces a title to url-safe words', () => {
    expect(slugify('Design review')).toBe('design-review')
    expect(slugify('Launch checklist for v2 of the mobile app')).toBe(
      'launch-checklist-for-v2-of-the-mobile-app',
    )
  })

  it('folds accents and drops punctuation rather than escaping it', () => {
    expect(slugify('Café déjà vu')).toBe('cafe-deja-vu')
    expect(slugify('Q3 planning — "the big one"!')).toBe('q3-planning-the-big-one')
  })

  it('collapses runs and never leaves a leading or trailing hyphen', () => {
    expect(slugify('  spaced   out  ')).toBe('spaced-out')
    expect(slugify('!!!')).toBe('')
  })

  it('caps length without leaving a dangling hyphen at the cut', () => {
    const slug = slugify('a'.repeat(40) + ' ' + 'b'.repeat(40))
    expect(slug.length).toBeLessThanOrEqual(60)
    expect(slug.endsWith('-')).toBe(false)
  })
})

describe('objectRef', () => {
  it('puts the identity last, where the resolver reads it', () => {
    expect(objectRef(UUID, 'Design review')).toBe(`design-review-${UUID}`)
  })

  it('degrades to the bare identity when a title slugs to nothing', () => {
    expect(objectRef(UUID, '???')).toBe(UUID)
    expect(objectRef(UUID)).toBe(UUID)
  })
})

describe('identifierFromRef', () => {
  it('reads the identity out of a ref', () => {
    expect(identifierFromRef(`design-review-${UUID}`)).toBe(UUID)
    expect(identifierFromRef(UUID)).toBe(UUID)
  })

  /**
   * §7.2's rule, and the property that keeps old links working: a consumer MUST
   * ignore everything before the final uuid, so a stale slug still resolves.
   */
  it('ignores everything before the final uuid, however stale', () => {
    expect(identifierFromRef(`the-old-name-${UUID}`)).toBe(UUID)
    expect(identifierFromRef(`-${UUID}`)).toBe(UUID)
  })

  /** A slug may itself contain hyphens, digits and hex — the tail still wins. */
  it('is not confused by a slug that looks like an identifier', () => {
    expect(identifierFromRef(`deadbeef-1234-5678-9abc-${UUID}`)).toBe(UUID)
  })

  it('accepts an upper-cased uuid and normalises it to the relay spelling', () => {
    expect(identifierFromRef(`design-review-${UUID.toUpperCase()}`)).toBe(UUID)
  })

  it('returns null for a ref carrying no identity', () => {
    expect(identifierFromRef('3')).toBeNull()
    expect(identifierFromRef('design-review')).toBeNull()
    // Truncated: 11 hex in the last group rather than 12. A near-miss must not
    // resolve — a link that half-matches is worse than one that does not.
    expect(identifierFromRef('925897ad-796e-4bc6-999c-ca19df26c4a')).toBeNull()
  })
})

// The Convex channel topics moved to /topic-old/ (FOL-37); the grammar is unchanged.
describe('topicPath', () => {
  it('builds the §7 grammar for a topic with a channel uuid', () => {
    expect(topicPath({ id: '3', title: 'Design review', folderId: UUID })).toBe(
      `/topic-old/design-review-${UUID}`,
    )
  })

  it('carries the open huddle in the query, not the path', () => {
    expect(
      topicPath({ id: '3', title: 'Design review', folderId: UUID }, { huddleId: 'h1' }),
    ).toBe(`/topic-old/design-review-${UUID}?huddle=h1`)
  })

  it('falls back to the legacy path when the topic has no channel uuid', () => {
    expect(topicPath({ id: '3', title: 'Ongoing onboarding issues' })).toBe('/topics/3')
    expect(topicPath({ id: '3', title: 'x', folderId: null })).toBe('/topics/3')
  })

  it('round-trips: the path it builds resolves back to the same identity', () => {
    const path = topicPath({ id: '3', title: 'Ongoing onboarding issues', folderId: UUID })
    expect(identifierFromRef(path.slice('/topic-old/'.length))).toBe(UUID)
  })
})

describe('shareableTopicUrl', () => {
  it('builds an absolute URL in RFC 0.5 §7.2 grammar', () => {
    expect(shareableTopicUrl({ id: '7', title: 'Design review', folderId: UUID }, 'https://peek.estiva.app')).toBe(
      `https://peek.estiva.app/topic-old/design-review-${UUID}`,
    )
  })

  it('is null for a topic whose only link is Peek-private', () => {
    // A topic created before Nostr emission, and every mock in Storybook.
    expect(shareableTopicUrl({ id: '1', title: 'Old topic', folderId: null }, 'https://peek.estiva.app')).toBe(null)
    expect(shareableTopicUrl({ id: '1', title: 'Old topic' }, 'https://peek.estiva.app')).toBe(null)
  })

  it('does not double the slash when the origin carries one', () => {
    expect(shareableTopicUrl({ id: '7', title: 'X', folderId: UUID }, 'https://peek.estiva.app/')).toBe(
      `https://peek.estiva.app/topic-old/x-${UUID}`,
    )
  })

  it('still resolves when the title slugs to nothing', () => {
    // The uuid is the whole identity; the slug is decoration that may be absent.
    expect(shareableTopicUrl({ id: '7', title: '日本語', folderId: UUID }, 'https://peek.estiva.app')).toBe(
      `https://peek.estiva.app/topic-old/${UUID}`,
    )
  })

  it('round-trips: what it builds is what the router reads', () => {
    // The property the whole grammar rests on — a link is only useful if the
    // identity survives being written and read back.
    const url = shareableTopicUrl({ id: '7', title: 'A very, very long name — with punctuation', folderId: UUID }, 'https://peek.estiva.app')!
    expect(url.endsWith(UUID)).toBe(true)
  })
})

describe('shareableMessageUrl', () => {
  const EVENT = 'a3f1'.repeat(16)

  it('names a message by its event id, not by an nevent', () => {
    // RFC 0.5 §7.6, amended: bech32 in a URL is what §7.3 argues against, and
    // its objections apply to `nevent` exactly as to `naddr`.
    expect(shareableMessageUrl(EVENT, 'https://peek.estiva.app')).toBe(`https://peek.estiva.app/message/${EVENT}`)
  })

  it('is null for a message that has not reached the relay', () => {
    // A reply exists in Convex the moment it is sent and gains its event id
    // only on publish. An anchor before then points at nothing.
    expect(shareableMessageUrl(undefined, 'https://peek.estiva.app')).toBe(null)
    expect(shareableMessageUrl(null, 'https://peek.estiva.app')).toBe(null)
  })

  it('refuses anything that is not a full event id', () => {
    // A truncated id resolves to nothing, or to something nobody intended.
    expect(shareableMessageUrl(EVENT.slice(0, 63), 'https://peek.estiva.app')).toBe(null)
    expect(shareableMessageUrl('not-hex', 'https://peek.estiva.app')).toBe(null)
  })

  it('lowercases, so a link built from an upper-cased id still resolves', () => {
    expect(shareableMessageUrl(EVENT.toUpperCase(), 'https://peek.estiva.app')).toBe(
      `https://peek.estiva.app/message/${EVENT}`,
    )
  })
})
