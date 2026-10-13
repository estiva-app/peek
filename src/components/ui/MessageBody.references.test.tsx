/**
 * A topic and a message mentioned in a body — RIC-11.
 *
 * The rendering is `Reference`'s and is tested there; what this guards is the
 * plumbing around it. An `naddr` and an `nevent` written mid-sentence are
 * handed to the resolver, and the bracket form every older message carries is
 * still drawn from the fixture. And a message alone on its line is attached
 * below the prose rather than hidden from it and then drawn by nothing — the
 * gap `standaloneReference` opened for any pointer that was not an address.
 */
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { addrToNaddr, encodeNevent } from '@estiva-app/protocol'

const RELAY = 'f3a38fa6c6a1e5d2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7081920'
const TOPIC = `39000:${RELAY}:b7c1e0a4-2f3d-4a86-9c15-8d0e6f2a4b91`
const NADDR = `nostr:${addrToNaddr(TOPIC, [])}`
const EVENT = 'a1b2c3d4e5f60718293a4b5c6d7e8f9011223344556677889900aabbccddeeff'
const NEVENT = `nostr:${encodeNevent({ id: EVENT, relays: [], kind: 9 })}`

const asked: string[][] = []
const attached: string[] = []

vi.mock('@/api', () => ({
  TOPICS: [{ id: '7', title: 'Updates on the new office layout', isResolved: false }],
  APP_FILES: [],
  DOCUMENT_FILES: [],
  useLinkResolver: () => () => undefined,
  useResolvedReferences: (refs: string[]) => {
    asked.push(refs)
    return Object.fromEntries(
      refs.map((ref) => [
        ref,
        ref === NADDR
          ? { ref: TOPIC, eventId: 'e'.repeat(64), kind: 39000, widget: 'card', slots: { title: { value: 'Office layout (renamed)' } }, meta: [], comments: [], actions: [], viaRecommendation: true }
          : null,
      ]),
    )
  },
}))
vi.mock('./ForeignObjectWidget', () => ({
  ForeignObjectWidget: ({ naddr }: { naddr: string }) => {
    attached.push(naddr)
    return <div data-widget={naddr} />
  },
  StatusPill: () => null,
}))
vi.mock('@/api/mentions', () => ({
  personByPubkey: () => undefined,
  subscribeMentions: () => () => {},
  mentionsVersion: () => 0,
}))

import { MessageBody } from './MessageBody'

const show = (body: string) =>
  render(<MessageBody body={body} />).container

describe('a topic or a message in a message body', () => {
  it('draws a topic address as the title the topic has now', () => {
    const c = show(`see ${NADDR} for the plan`)
    expect(asked.at(-1)).toContain(NADDR)
    expect(c.textContent).toContain('Office layout (renamed)')
    expect(c.textContent).not.toContain('naddr1')
  })

  it('asks the resolver about a message pointer written mid-sentence', () => {
    const c = show(`as ${NEVENT} said`)
    expect(asked.at(-1)).toContain(NEVENT)
    // Resolved to nothing here; still a chip and never a 60-character pointer.
    expect(c.querySelector('[data-reference="unresolved"]')).not.toBeNull()
    expect(c.textContent).not.toContain(NEVENT)
  })

  it('attaches a message that stands alone on its line, rather than losing it', () => {
    attached.length = 0
    const c = show(`Look at this.\n\n${NEVENT}`)
    // Bare, the way `findNaddrs` hands back an address, so the widget list
    // has one spelling and a caller's `resolvedObjects` matches either way.
    expect(attached).toEqual([NEVENT.replace(/^nostr:/, '')])
    expect(c.textContent).toContain('Look at this.')
    expect(c.textContent).not.toContain('nevent1')
  })

  it('still draws the old bracket form from the fixture, for ever', () => {
    const c = show('as discussed in [Updates on the new office layout]')
    expect(c.textContent).toContain('Updates on the new office layout')
    expect(c.textContent).not.toContain('[')
  })
})
