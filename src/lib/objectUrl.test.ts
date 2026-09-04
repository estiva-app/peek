import { describe, it, expect } from 'vitest'
import { slugify, objectRef, identifierFromRef, topicPath, shareableTopicUrl, shareableMessageUrl } from './objectUrl'

/** A real production channel uuid, from RFC 0.5 §7.2's own example. */
const UUID = '925897ad-796e-4bc6-999c-ca19df26c4aa'

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

describe('topicPath', () => {
  it('builds the §7 grammar for a topic with a channel uuid', () => {
    expect(topicPath({ id: '3', title: 'Design review', folderId: UUID })).toBe(
      `/topic/design-review-${UUID}`,
    )
  })

  it('carries the open huddle in the query, not the path', () => {
    expect(
      topicPath({ id: '3', title: 'Design review', folderId: UUID }, { huddleId: 'h1' }),
    ).toBe(`/topic/design-review-${UUID}?huddle=h1`)
  })

  it('falls back to the legacy path when the topic has no channel uuid', () => {
    expect(topicPath({ id: '3', title: 'Ongoing onboarding issues' })).toBe('/topics/3')
    expect(topicPath({ id: '3', title: 'x', folderId: null })).toBe('/topics/3')
  })

  it('round-trips: the path it builds resolves back to the same identity', () => {
    const path = topicPath({ id: '3', title: 'Ongoing onboarding issues', folderId: UUID })
    expect(identifierFromRef(path.slice('/topic/'.length))).toBe(UUID)
  })
})

describe('shareableTopicUrl', () => {
  it('builds an absolute URL in RFC 0.5 §7.2 grammar', () => {
    expect(shareableTopicUrl({ id: '7', title: 'Design review', folderId: UUID }, 'https://peek.estiva.app')).toBe(
      `https://peek.estiva.app/topic/design-review-${UUID}`,
    )
  })

  it('is null for a topic whose only link is Peek-private', () => {
    // A topic created before Nostr emission, and every mock in Storybook.
    expect(shareableTopicUrl({ id: '1', title: 'Old topic', folderId: null }, 'https://peek.estiva.app')).toBe(null)
    expect(shareableTopicUrl({ id: '1', title: 'Old topic' }, 'https://peek.estiva.app')).toBe(null)
  })

  it('does not double the slash when the origin carries one', () => {
    expect(shareableTopicUrl({ id: '7', title: 'X', folderId: UUID }, 'https://peek.estiva.app/')).toBe(
      `https://peek.estiva.app/topic/x-${UUID}`,
    )
  })

  it('still resolves when the title slugs to nothing', () => {
    // The uuid is the whole identity; the slug is decoration that may be absent.
    expect(shareableTopicUrl({ id: '7', title: '日本語', folderId: UUID }, 'https://peek.estiva.app')).toBe(
      `https://peek.estiva.app/topic/${UUID}`,
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
