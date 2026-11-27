// @vitest-environment jsdom
// A document, for Copy link's clipboard and origin.
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { identifierFromRef, matchObjectUrl, urlPatternsOf } from '@estiva-app/interop'
import {
  filePath,
  fileRouteFromPath,
  routeWordsOf,
  declaredKinds,
  rememberRouteWords,
  forgetRouteWords,
  subscribeRouteWords,
  refNamesFile,
  shareableFileUrl,
  copyFileLink,
  topicPath,
  shareableTopicUrl,
  shareableMessageUrl,
} from './objectUrl'
import { LEAF_MANIFEST, PEEK_MANIFEST, PRODUCTION_MANIFESTS, SHIP_MANIFEST } from '@/test/manifests'

/** A real production channel uuid, from RFC 0.5 §7.2's own example. */
const UUID = '925897ad-796e-4bc6-999c-ca19df26c4aa'
const SHIP = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const ISSUE = `30851:${SHIP}:d68a8c78-5ec7-4652-b236-89ab57ac5b1e`

/** A bare file — a topic in a Folder — by the person who started it. */
const FILE_D = 'd68a8c78-5ec7-4652-b236-89ab57ac5b1e'
const FILE = `30840:${SHIP}:${FILE_D}`

/*
  Every link Peek writes is the shared writer's (LIN-3), with the words the
  apps' manifests declare. The test setup reads production's manifests first,
  as a signed-in session does; the cases about the moment before forget them.
*/
describe('filePath', () => {
  it("writes each kind's link with its owner's word: a topic, a page, a project, an issue", () => {
    expect(filePath(FILE, 'Launch naming')).toBe(`/topic/launch-naming-${FILE_D}`)
    expect(filePath(`30842:${SHIP}:${FILE_D}`, 'Weekly plans')).toBe(`/document/weekly-plans-${FILE_D}`)
    expect(filePath(`30850:${SHIP}:${FILE_D}`, 'Q4 roadmap')).toBe(`/project/q4-roadmap-${FILE_D}`)
    expect(filePath(ISSUE, 'Copy link is wrong')).toBe(`/issue/copy-link-is-wrong-${FILE_D}`)
  })

  it('writes the bare d when there is no title, for the page to canonicalise', () => {
    expect(filePath(FILE)).toBe(`/topic/${FILE_D}`)
  })

  it('never writes the long /topic/<kind>:<pubkey>:<d> link: a kind with no word is /o/<naddr>', () => {
    // A named file (30852): no app can declare a word for it today.
    const named = `30852:${SHIP}:${FILE_D}`
    const path = filePath(named, 'Invoice')!
    expect(path).toMatch(/^\/o\/naddr1[0-9a-z]+$/)
    expect(path).not.toContain(':')
  })

  it('gives no link for an id no file can have — the relay refuses any but a random lowercase uuid', () => {
    expect(filePath(`30850:${SHIP}:PROJ-1`, 'Project one')).toBeNull()
    expect(filePath(`30840:${SHIP}:${FILE_D.toUpperCase()}`)).toBeNull()
    // A uuid that is not version 4.
    expect(filePath(`30840:${SHIP}:d68a8c78-5ec7-1652-b236-89ab57ac5b1e`)).toBeNull()
  })

  it('round-trips: the route it writes reads back as the same file', () => {
    const path = filePath(FILE, 'FOL-15 test topic')!
    const route = fileRouteFromPath(path)!
    expect(route.word).toBe('topic')
    expect(identifierFromRef(route.ref)).toBe(FILE_D)
    expect(refNamesFile(route.ref, FILE)).toBe(true)
  })

  it('reads as the same file where Ship and Leaf read a pasted link', () => {
    const url = shareableFileUrl(ISSUE, 'Copy link is wrong', 'https://peek.estiva.app')!
    const patterns = PRODUCTION_MANIFESTS.flatMap((manifest) => urlPatternsOf(manifest))
    expect(matchObjectUrl(url, patterns)).toMatchObject({ kind: 30851, identifier: FILE_D })
  })
})

describe('a link before the manifests are read', () => {
  beforeEach(() => forgetRouteWords())

  it("is the file's /o/<naddr>, with no word of Peek's own — not even topic", () => {
    expect(filePath(FILE, 'Launch naming')).toMatch(/^\/o\/naddr1/)
    expect(filePath(ISSUE)).toMatch(/^\/o\/naddr1/)
  })

  it('becomes the short link once they are read, and subscribers are told so links drawn early are drawn again', () => {
    const told = vi.fn()
    const unsubscribe = subscribeRouteWords(told)
    rememberRouteWords(routeWordsOf(PRODUCTION_MANIFESTS))
    unsubscribe()
    expect(told).toHaveBeenCalled()
    expect(filePath(FILE, 'Launch naming')).toBe(`/topic/launch-naming-${FILE_D}`)
  })
})

describe("the words, read off the apps' manifests", () => {
  it('give a kind the word only its owner declares: another app declaring a word for it is not the owner', () => {
    // A stranger's manifest declaring `/ticket/` for Ship's issues: Ship claims 30851, so the word stays Ship's.
    const stranger = {
      pubkey: 'd'.repeat(64),
      created_at: 1_796_000_000,
      content: '{}',
      tags: [
        ['d', 'tickets'],
        ['web', 'https://tickets.example.com/o/<bech32>', 'naddr'],
        ['urls', 'https://tickets.example.com/ticket/<slug>-<d>', '30851'],
      ],
    }
    const words = routeWordsOf([...PRODUCTION_MANIFESTS, stranger])
    expect(words.byKind[30851]).toBe('issue')
  })

  it.each(['message', 'folders', 'topics', 'people'])(
    "never write a topic's link onto Peek's own /%s/ page, whoever publishes the newest conversation manifest (security review)",
    (page) => {
      // Any member can publish a manifest; the newest `conversation` one owns the topic's word (§7.7 rule 1).
      const planted = {
        pubkey: 'e'.repeat(64),
        created_at: 1_797_000_000,
        content: JSON.stringify({ aspect: 'conversation' }),
        tags: [
          ['d', 'planted'],
          ['web', 'https://evil.example/o/<bech32>', 'naddr'],
          ['urls', `https://evil.example/${page}/<slug>-<d>`, '30840'],
        ],
      }
      rememberRouteWords(routeWordsOf([...PRODUCTION_MANIFESTS, planted]))
      const path = filePath(FILE, 'Plan')
      expect(path?.startsWith(`/${page}/`)).toBe(false)
      // It still opens the file: its `naddr` form.
      expect(path).toMatch(/^\/o\/naddr1/)
    },
  )

  it("read every declared /<word>/ shape for Peek's route, the stranger's included, and skip a query, a hash route and Peek's own pages", () => {
    const stranger = {
      pubkey: 'd'.repeat(64),
      created_at: 1_796_000_000,
      content: '{}',
      tags: [
        ['d', 'tickets'],
        ['web', 'https://tickets.example.com/o/<bech32>', 'naddr'],
        ['urls', 'https://tickets.example.com/ticket/<slug>-<d>', '30851'],
      ],
    }
    const words = routeWordsOf([...PRODUCTION_MANIFESTS, stranger])
    expect(words.byWord).toEqual({ topic: [30840], project: [30850], issue: [30851], document: [30842], ticket: [30851] })
    expect(words.origins).toEqual(
      expect.arrayContaining(['https://peek.estiva.app', 'https://ship.estiva.app', 'https://leaf.estiva.app', 'https://tickets.example.com']),
    )
  })

  it('hold nothing of Peek’s own: without its manifest there is no topic word, to write or to read', () => {
    const words = routeWordsOf([SHIP_MANIFEST, LEAF_MANIFEST])
    expect(words.byKind[30840]).toBeUndefined()
    expect(words.byWord.topic).toBeUndefined()
    expect(routeWordsOf([PEEK_MANIFEST]).byKind[30840]).toBe('topic')
  })

  it('answer every declared kind for the unknown-word fallback — never a bare #d', () => {
    expect(declaredKinds(routeWordsOf(PRODUCTION_MANIFESTS)).sort()).toEqual([30840, 30842, 30850, 30851])
  })
})

describe('Copy link', () => {
  let copied: string[]
  beforeEach(() => {
    copied = []
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text: string) => void copied.push(text) },
    })
  })
  afterEach(() => vi.useRealTimers())

  it('copies the short link', async () => {
    await expect(copyFileLink(FILE, 'Launch naming')).resolves.toBe(true)
    expect(copied).toEqual([`${window.location.origin}/topic/launch-naming-${FILE_D}`])
  })

  it('pressed before the manifests are read, waits for them and copies the short link, not /o/', async () => {
    vi.useFakeTimers()
    forgetRouteWords()
    const copying = copyFileLink(FILE, 'Launch naming')
    await vi.advanceTimersByTimeAsync(300)
    expect(copied).toEqual([])
    rememberRouteWords(routeWordsOf(PRODUCTION_MANIFESTS))
    await expect(copying).resolves.toBe(true)
    expect(copied).toEqual([`${window.location.origin}/topic/launch-naming-${FILE_D}`])
  })

  it('gives the /o/ link when the manifests never come, after two seconds', async () => {
    vi.useFakeTimers()
    forgetRouteWords()
    const copying = copyFileLink(FILE, 'Launch naming')
    await vi.advanceTimersByTimeAsync(2000)
    await expect(copying).resolves.toBe(true)
    expect(copied).toHaveLength(1)
    expect(copied[0]).toMatch(new RegExp(`^${window.location.origin}/o/naddr1`))
  })

  it('copies nothing for an id no file can have', async () => {
    await expect(copyFileLink(`30850:${SHIP}:PROJ-1`, 'Project one')).resolves.toBe(false)
    expect(copied).toEqual([])
  })
})

describe('fileRouteFromPath', () => {
  it('reads the word and the ref off a two-segment root path', () => {
    expect(fileRouteFromPath('/issue/fix-the-header-d68a8c78-5ec7-4652-b236-89ab57ac5b1e')).toEqual({
      word: 'issue',
      ref: 'fix-the-header-d68a8c78-5ec7-4652-b236-89ab57ac5b1e',
    })
    expect(fileRouteFromPath(`/topic/${ISSUE}`)).toEqual({ word: 'topic', ref: ISSUE })
  })

  it('is null for a page of Peek’s own, at the root or under /app/', () => {
    for (const path of ['/app/desk', '/app/teams/x', '/app/dms/alice', '/topics/1', '/topic-old/x', '/o/naddr1', '/message/abc', '/']) {
      expect(fileRouteFromPath(path)).toBeNull()
    }
  })
})

/* The launcher's "the page you are on is not somewhere to go" — FOL-37. */
describe('refNamesFile', () => {
  it('matches a short ref on the file’s d, whatever the slug', () => {
    expect(refNamesFile(`design-review-${FILE_D}`, FILE)).toBe(true)
    expect(refNamesFile(`stale-name-${FILE_D}`, FILE)).toBe(true)
    expect(refNamesFile(FILE_D, FILE)).toBe(true)
    expect(refNamesFile(`design-review-${UUID}`, FILE)).toBe(false)
  })

  it('names nothing for the old long ref, the file’s own address included (LIN-8)', () => {
    expect(refNamesFile(ISSUE, ISSUE)).toBe(false)
    expect(refNamesFile(FILE, FILE)).toBe(false)
  })

  it('names nothing when the ref carries no identity', () => {
    expect(refNamesFile('just-a-slug', FILE)).toBe(false)
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
