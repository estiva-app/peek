/**
 * The composer writes a key, and the editor reads one back — RIC-2, part 3.
 *
 * A display name in a body needs the reader's directory and goes stale on a
 * rename, permanently, because message content is immutable. A key needs
 * nothing and cannot go stale, because it never said the name.
 *
 * The round trip is the part worth guarding: an author who edits a message must
 * not find a wall of bech32 where a name used to be, and must not have their
 * mention silently downgraded to a name on the way back out.
 */
import { describe, expect, it, vi } from 'vitest'
import { encodeNpub } from '@estiva-app/protocol'

const ADA = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const NPUB = encodeNpub(ADA)

vi.mock('@/api/mentions', () => ({
  personByPubkey: (pubkey: string) =>
    pubkey === ADA ? { id: 'ada', name: 'Ada Lovelace', role: 'Engineer' } : undefined,
}))

import { parseInlineContent, serializeInline } from './textParsing'

/** A Tiptap inline node, in the shape `serializeInline` walks. */
const node = (children: Record<string, unknown>[]) => ({
  forEach: (cb: (c: never) => void) => children.forEach((c) => cb(c as never)),
})

describe('what the composer writes', () => {
  it('writes a key when the person has one', () => {
    const text = serializeInline(
      node([{ type: { name: 'mention' }, attrs: { id: 'ada', label: 'Ada Lovelace', pubkey: ADA } }]),
    )
    expect(text).toBe(`nostr:${NPUB}`)
  })

  it('falls back to the name when they have none', () => {
    // The mock cast, and anyone who has not signed in with Estiva ID. Exactly
    // what every message published to date already says.
    const text = serializeInline(
      node([{ type: { name: 'mention' }, attrs: { id: 'alice', label: 'Alice Johnson', pubkey: null } }]),
    )
    expect(text).toBe('@Alice Johnson')
  })

  it('drops the urgency marker for a key, because urgency has no wire form', () => {
    const text = serializeInline(
      node([{ type: { name: 'urgentMention' }, attrs: { id: 'ada', label: 'Ada Lovelace', pubkey: ADA } }]),
    )
    expect(text).toBe(`nostr:${NPUB}`)
  })

  it('keeps the urgency marker when there is no key to write', () => {
    const text = serializeInline(
      node([{ type: { name: 'urgentMention' }, attrs: { id: 'alice', label: 'Alice Johnson', pubkey: null } }]),
    )
    expect(text).toBe('!@Alice Johnson')
  })
})

describe('what the editor loads back', () => {
  it('turns a key into a chip with the name it resolves to now', () => {
    const [chip] = parseInlineContent(`nostr:${NPUB}`) as { type: string; attrs: Record<string, unknown> }[]
    expect(chip.type).toBe('mention')
    expect(chip.attrs.pubkey).toBe(ADA)
    expect(chip.attrs.label).toBe('Ada Lovelace')
  })

  it('shows a shortened key for somebody it cannot name, rather than raw bech32', () => {
    const [chip] = parseInlineContent(`nostr:${encodeNpub('cd'.repeat(32))}`) as {
      attrs: Record<string, unknown>
    }[]
    expect(String(chip.attrs.label)).toMatch(/^npub1.*…$/)
    expect(chip.attrs.pubkey).toBe('cd'.repeat(32))
  })

  it('round-trips: edit a message and the key comes back out unchanged', () => {
    const original = `ask nostr:${NPUB} about it`
    const nodes = parseInlineContent(original) as Record<string, unknown>[]
    const back = serializeInline(
      node(nodes.map((n) => ({ ...n, type: { name: (n as { type: string }).type }, text: (n as { text?: string }).text }))),
    )
    expect(back).toBe(original)
  })

  it('still loads the old display-name form as a chip', () => {
    // Every mention published to date is this shape, for ever.
    const [chip] = parseInlineContent('@Alice Johnson') as { type: string }[]
    expect(chip.type).toBe('mention')
  })
})
