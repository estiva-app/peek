/**
 * Where a chip leads — RIC-16.
 *
 * The grammar is the one the app already owns: `topicPath` for a topic,
 * `shareableMessageUrl` for a message, `/o/` for a file. These tests pin that
 * a chip and a "Copy link" produce the same URL for the same thing, and that a
 * chip for nothing leads nowhere.
 */
import { describe, expect, it } from 'vitest'
import type { ForeignObject } from '@estiva-app/interop'
import { addrToNaddr, encodeNevent } from '@estiva-app/protocol'
import { shareableMessageUrl, topicPath } from './objectUrl'
import { writtenLinkOf, referenceLink } from './referenceLink'

const RELAY_KEY = 'ab'.repeat(32)
const UUID = '0212db6d-bcbf-40d0-890e-f4f056db2f5d'
const TOPIC_ADDRESS = `39000:${RELAY_KEY}:${UUID}`
const TOPIC_URI = `nostr:${addrToNaddr(TOPIC_ADDRESS, [])}`
const MESSAGE_ID = 'CD'.repeat(32)
const MESSAGE_URI = `nostr:${encodeNevent({ id: MESSAGE_ID.toLowerCase(), relays: [], kind: 9 })}`

const object = (overrides: Partial<ForeignObject>): ForeignObject =>
  ({
    ref: 'x',
    eventId: 'e'.repeat(64),
    kind: 0,
    widget: 'card',
    slots: {},
    meta: [],
    comments: [],
    actions: [],
    viaRecommendation: true,
    ...overrides,
  }) as ForeignObject

describe('referenceLink', () => {
  it('a topic leads to the path the app owns for it, slug and all', () => {
    const link = referenceLink(
      TOPIC_URI,
      object({ kind: 39000, address: TOPIC_ADDRESS, slots: { title: { value: 'Feedback on Ship' } } }),
    )
    expect(link).toEqual({ place: 'topic', href: topicPath({ id: 'ignored', title: 'Feedback on Ship', folderId: UUID }) })
    expect(link?.href).toBe(`/topic-old/feedback-on-ship-${UUID}`)
  })

  it('a message leads to the same URL "Copy link" hands out, and carries its id', () => {
    const link = referenceLink(MESSAGE_URI, object({ kind: 9, eventId: MESSAGE_ID }))
    expect(link).toEqual({
      place: 'message',
      href: shareableMessageUrl(MESSAGE_ID, 'https://peek.test')!.replace('https://peek.test', ''),
      eventId: MESSAGE_ID.toLowerCase(),
    })
  })

  /* FOL-37: a bare file's link is the short form the page canonicalises to and "Copy link" hands out. */
  it('a bare file opens at /topic/<slug>-<d>, its short form', () => {
    const d = '5b6d0f2e-4c1a-4e7b-9a3c-2f8e1d0c9b7a'
    const link = referenceLink(
      'nostr:naddr1file',
      object({ kind: 30840, address: `30840:${RELAY_KEY}:${d}`, slots: { title: { value: 'Design review' } } }),
    )
    expect(link).toEqual({ place: 'file', href: `/topic/design-review-${d}` })
  })

  it('a bare file that resolved without an address still opens, through /o/', () => {
    expect(referenceLink('nostr:naddr1file', object({ kind: 30840 }))).toEqual({ place: 'file', href: '/o/naddr1file' })
  })

  it("another app's object leads to that app, at the URL its manifest gave", () => {
    const link = referenceLink('nostr:naddr1issue', object({ kind: 30851, openUrl: 'https://ship.estiva.app/i/abc' }))
    expect(link).toEqual({ place: 'app', href: 'https://ship.estiva.app/i/abc' })
  })

  it('leads nowhere for a reference nothing resolved, or one that may not be read', () => {
    expect(referenceLink(TOPIC_URI, undefined)).toBeNull()
    expect(referenceLink(TOPIC_URI, null)).toBeNull()
    expect(referenceLink(TOPIC_URI, object({ kind: 39000, address: TOPIC_ADDRESS, unreachable: true }))).toBeNull()
    // Resolved, but its app published no `web` template: a label is honest.
    expect(referenceLink('nostr:naddr1x', object({ kind: 30852 }))).toBeNull()
  })
})

describe('writtenLinkOf', () => {
  const PEEK = 'https://peek.estiva.app'
  const SHIP_ISSUE = 'https://ship.estiva.app/o/30851:ab:x'

  it('a block link on the origin its file opens on leads to that block', () => {
    expect(writtenLinkOf('https://ship.estiva.app/issue/plan-x#block-p1', SHIP_ISSUE, PEEK)).toEqual({ place: 'app', href: 'https://ship.estiva.app/issue/plan-x#block-p1' })
  })

  /*
    WBM-11's security review: a chip draws one file and must never open another
    site. A host that merely ends in the file's host is another site, and http
    is not the file's https origin; the origin is compared exactly.
  */
  it('a block link on a lookalike host (suffix, prefix, before an @, a port, a subdomain) or over http leads nowhere', () => {
    for (const url of [
      'https://evilship.estiva.app/issue/plan-x#block-p1',
      'http://ship.estiva.app/issue/plan-x#block-p1',
      'https://ship.estiva.app.evil.com/issue/plan-x#block-p1',
      'https://ship.estiva.app@evil.com/issue/plan-x#block-p1',
      'https://ship.estiva.app:8443/issue/plan-x#block-p1',
      'https://x.ship.estiva.app/issue/plan-x#block-p1',
    ]) {
      expect(writtenLinkOf(url, SHIP_ISSUE, PEEK), url).toBeUndefined()
    }
  })

  const DECLARED = ['https://ship.estiva.app', 'https://leaf.estiva.app', PEEK]

  it('an address on another declared host opens there as written, block or not (LTX-6)', () => {
    expect(writtenLinkOf('https://leaf.estiva.app/issue/plan-x', SHIP_ISSUE, PEEK, DECLARED)).toEqual({ place: 'app', href: 'https://leaf.estiva.app/issue/plan-x' })
    expect(writtenLinkOf('https://leaf.estiva.app/issue/plan-x#block-p1', SHIP_ISSUE, PEEK, DECLARED)).toEqual({ place: 'app', href: 'https://leaf.estiva.app/issue/plan-x#block-p1' })
  })

  it('another app’s file written on Peek’s host opens in Peek, through the router', () => {
    expect(writtenLinkOf('https://peek.estiva.app/issue/plan-x', SHIP_ISSUE, PEEK, DECLARED)).toEqual({ place: 'file', href: '/issue/plan-x' })
  })

  it('Peek’s own file written on Peek’s host keeps its own route unless it names a block', () => {
    expect(writtenLinkOf('https://peek.estiva.app/topic/plan-x?thread=1', '/topic/plan-x', PEEK, DECLARED)).toBeUndefined()
    expect(writtenLinkOf('https://peek.estiva.app/topic/plan-x#block-p1', '/topic/plan-x', PEEK, DECLARED)).toEqual({ place: 'file', href: '/topic/plan-x#block-p1' })
  })

  // PEEKM-7: the opener is https only in every app — an http:// link stays a link, even on a host an app declares.
  it('an http link never opens as a card, even on a host an app declares over http or on Peek’s own', () => {
    expect(writtenLinkOf('http://ship.estiva.app/issue/plan-x', SHIP_ISSUE, PEEK, [...DECLARED, 'http://ship.estiva.app'])).toBeUndefined()
    expect(writtenLinkOf('http://localhost:5173/issue/plan-x#block-p1', '/topic/plan-x', 'http://localhost:5173', DECLARED)).toBeUndefined()
  })

  it('a lookalike of a declared host is still another site', () => {
    expect(writtenLinkOf('https://leaf.estiva.app.evil.com/issue/plan-x', SHIP_ISSUE, PEEK, DECLARED)).toBeUndefined()
    expect(writtenLinkOf('http://leaf.estiva.app/issue/plan-x', SHIP_ISSUE, PEEK, DECLARED)).toBeUndefined()
  })

  // LTX-6 security re-review: a route starting `//` is another host to the router and the browser.
  it('a path on Peek’s host that starts with two slashes (or a slash and a backslash) never becomes a route to another host', () => {
    for (const url of ['https://peek.estiva.app//issue/plan-x', 'https://peek.estiva.app/\\issue/plan-x', 'https://peek.estiva.app//evil.example/issue/plan-x#block-p1']) {
      expect(writtenLinkOf(url, SHIP_ISSUE, PEEK, DECLARED), url).toBeUndefined()
    }
  })
})
