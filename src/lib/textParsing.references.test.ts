/**
 * A topic and a message are mentioned by pointer, not by title — RIC-11.
 *
 * RIC-2 did this for people: `@Ada Lovelace` became `nostr:npub…`, so the
 * mention resolves in an app that holds no shared directory and survives a
 * rename. A topic was still `[Topic Title]`, resolved against Peek's own list,
 * and a message could not be mentioned at all. The same three guarantees
 * apply here, plus one the old form cannot be released from: every bracket
 * mention ever published stays one, because content is immutable.
 */
import { describe, expect, it, vi } from 'vitest'
import { addrToNaddr, encodeNevent } from '@estiva-app/protocol'

const RELAY = 'f3a38fa6c6a1e5d2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7081920'
/** A real channel from the bundled legacy-topic table (FOL-26). */
const UUID = '2303e8c1-c866-43b8-9b4c-e263f313a683'
const ADDRESS = `39000:${RELAY}:${UUID}`
const NADDR = `nostr:${addrToNaddr(ADDRESS, [])}`
const EVENT = 'a1b2c3d4e5f60718293a4b5c6d7e8f9011223344556677889900aabbccddeeff'
const NEVENT = `nostr:${encodeNevent({ id: EVENT, relays: [], kind: 9 })}`

vi.mock('@/api/mentions', () => ({
  personByPubkey: () => undefined,
}))

vi.mock('@/lib/conversationRegistry', () => ({
  findMessageByEventId: (id: string) =>
    id === EVENT ? { id: 'm1', author: 'Ada Lovelace', timestamp: '9:41 AM', body: '**Build** #4821 failed again', eventId: EVENT } : undefined,
}))

import { parseInlineContent, serializeInline } from './textParsing'

const node = (children: Record<string, unknown>[]) => ({
  forEach: (cb: (c: never) => void) => children.forEach((c) => cb(c as never)),
})

describe('what the composer writes', () => {
  it('writes a topic as its address when it has one', () => {
    const text = serializeInline(
      node([{ type: { name: 'topicMention' }, attrs: { id: '7', label: 'Office layout', isResolved: false, address: ADDRESS } }]),
    )
    expect(text).toBe(NADDR)
  })

  it('falls back to the bracket form for a topic with no address', () => {
    // A mock topic, or a session that has not read the relay's key: exactly
    // what every message published before this already says.
    const text = serializeInline(
      node([{ type: { name: 'topicMention' }, attrs: { id: '1', label: 'CI/CD pipeline', isResolved: false, address: null } }]),
    )
    expect(text).toBe('[CI/CD pipeline] ')
  })

  it('writes a message as the nevent it was picked as, verbatim', () => {
    const text = serializeInline(
      node([{ type: { name: 'messageMention' }, attrs: { id: EVENT, label: 'Ada Lovelace', snippet: 'Build…', uri: NEVENT } }]),
    )
    expect(text).toBe(NEVENT)
  })
})

describe('what the editor loads back', () => {
  it('turns an old topic address into a chip wearing its title from the bundled table', () => {
    // Not from Convex: the topics went in FOL-23, and a mention written before
    // then still loads back as the chip it was picked from.
    const [chip] = parseInlineContent(NADDR)
    expect(chip).toMatchObject({
      type: 'topicMention',
      attrs: { id: 't_1784708243871_2', label: 'Feedback on Peek', address: ADDRESS },
    })
  })

  it('round-trips a topic address unchanged through an edit', () => {
    const content = parseInlineContent(`see ${NADDR} for the plan`)
    expect(serializeInline(node(content.map((c) => ({ ...c, type: { name: c.type } }))))).toBe(`see ${NADDR} for the plan`)
  })

  it('leaves an address this workspace cannot name as the text it was', () => {
    // Another app's object, or a topic nobody here holds: no chip would say
    // more than the URI does, and the text is written back as it came.
    const other = `nostr:${addrToNaddr(`30850:${RELAY}:some-project`, [])}`
    const content = parseInlineContent(`about ${other} today`)
    expect(content.map((c) => c.type)).toEqual(['text', 'text', 'text'])
    expect(serializeInline(node(content.map((c) => ({ ...c, type: { name: c.type } }))))).toBe(`about ${other} today`)
  })

  it('turns a message pointer into a chip captioned from the thread on screen', () => {
    const [chip] = parseInlineContent(NEVENT)
    expect(chip).toMatchObject({
      type: 'messageMention',
      attrs: { id: EVENT, label: 'Ada Lovelace', snippet: 'Build #4821 failed again', uri: NEVENT },
    })
  })

  it('shows a shortened pointer for a message that is not on screen, never blank', () => {
    const elsewhere = `nostr:${encodeNevent({ id: EVENT.replace(/a/g, 'b'), relays: [] })}`
    const [chip] = parseInlineContent(elsewhere)
    expect(chip).toMatchObject({ type: 'messageMention', attrs: { uri: elsewhere } })
    expect(chip.attrs).toMatchObject({ label: `${elsewhere.slice(6, 18)}…`, snippet: '' })
  })

  it('round-trips a message pointer unchanged through an edit', () => {
    const content = parseInlineContent(`as ${NEVENT} said`)
    expect(serializeInline(node(content.map((c) => ({ ...c, type: { name: c.type } }))))).toBe(`as ${NEVENT} said`)
  })

  it('still loads the old bracket form as a chip, with no address', () => {
    // 'Updates on the new office layout' is in the TOPICS fixture — the
    // resolution every bracket mention ever published depends on, for ever.
    const [chip] = parseInlineContent('[Updates on the new office layout]')
    expect(chip).toMatchObject({ type: 'topicMention', attrs: { label: 'Updates on the new office layout' } })
    expect(chip.attrs).not.toHaveProperty('address')
  })
})
