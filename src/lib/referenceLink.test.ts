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
import { referenceLink } from './referenceLink'

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
    expect(link?.href).toBe(`/topic/feedback-on-ship-${UUID}`)
  })

  it('a message leads to the same URL "Copy link" hands out, and carries its id', () => {
    const link = referenceLink(MESSAGE_URI, object({ kind: 9, eventId: MESSAGE_ID }))
    expect(link).toEqual({
      place: 'message',
      href: shareableMessageUrl(MESSAGE_ID, 'https://peek.test')!.replace('https://peek.test', ''),
      eventId: MESSAGE_ID.toLowerCase(),
    })
  })

  it('a bare file opens beside its Folder, through /o/', () => {
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
