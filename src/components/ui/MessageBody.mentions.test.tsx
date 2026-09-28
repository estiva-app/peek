/**
 * Both forms of a mention render — RIC-2's second done-when clause.
 *
 * The point of the new form is not that it replaces the old one. Message
 * content is immutable, so every display-name mention ever published stays a
 * display-name mention for ever; a reader that learned only the new form would
 * lose the entire existing history. This is `alsoRead`'s shape applied to
 * inline content: publish the new, read both.
 */
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { encodeNpub } from '@estiva-app/protocol'

const ADA = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'

vi.mock('@/api', () => ({
  TOPICS: [],
  APP_FILES: [],
  DOCUMENT_FILES: [],
  // RIC-10: a reference drawn mid-sentence needs the object resolved. Nothing
  // resolves here, which is the state these tests want — the mapping to DOM is
  // the subject, and an unresolved reference still draws a chip.
  useResolvedReferences: () => ({}),
}))
vi.mock('./ForeignObjectWidget', () => ({ ForeignObjectWidget: () => null }))
vi.mock('@/api/mentions', () => ({
  personByPubkey: (pubkey: string) =>
    pubkey === ADA ? { id: 'ada', name: 'Ada Lovelace', role: 'Engineer' } : undefined,
  // The chip subscribes so it can redraw when the real directory replaces the
  // mock cast. Nothing here exercises that, so this snapshot never changes —
  // see Reference.test.tsx for the case that does.
  subscribeMentions: () => () => {},
  mentionsVersion: () => 0,
}))

import { MessageBody } from './MessageBody'

const show = (body: string) =>
  render(<MessageBody body={body} />).container

describe('a mention in a message body', () => {
  it('renders the new form as the person it names', () => {
    const c = show(`ask nostr:${encodeNpub(ADA)} about it`)
    expect(c.querySelector(`[data-mention="${ADA}"]`)).not.toBeNull()
    expect(c.textContent).toContain('@Ada Lovelace')
    expect(c.textContent).not.toContain('npub1')
  })

  it('still renders the old display-name form', () => {
    // Every mention published to date is this shape and always will be.
    const c = show('ask @Ada Lovelace about it')
    expect(c.textContent).toContain('Ada Lovelace')
  })

  it('keeps a key it cannot name as a mention rather than as prose', () => {
    const c = show(`ask nostr:${encodeNpub('cd'.repeat(32))} about it`)
    expect(c.querySelector('[data-resolved="false"]')).not.toBeNull()
  })

  it('does not turn a quoted key into a mention', () => {
    // `code` content is literal (§13.1) — an example is not a link.
    const c = show(`type \`nostr:${encodeNpub(ADA)}\` exactly`)
    expect(c.querySelector('[data-mention]')).toBeNull()
    expect(c.querySelector('code')?.textContent).toContain('npub1')
  })

  it('keeps the marks around a mention', () => {
    const c = show(`**ask nostr:${encodeNpub(ADA)} now**`)
    expect(c.querySelector(`[data-mention="${ADA}"]`)).not.toBeNull()
    expect(c.querySelector('strong')).not.toBeNull()
  })
})
