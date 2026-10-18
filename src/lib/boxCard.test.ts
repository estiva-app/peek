/**
 * What the message box puts under itself and sends (4136f999; record
 * a-link-on-words-counts-toward-the-card): one file's card, `none` never
 * written, ✕ kept, a block link's part instead of a card, and an edit adding a
 * card only for a file it links first.
 */
import { describe, expect, it } from 'vitest'
import { addressToPointer, encodeNaddr, type PartPointer } from '@estiva-app/protocol'
import { boxLinksOf, embedsToEdit, embedsToSend, linkTargetOf, namedBefore, withoutCard, type BoxLinkContext } from './boxCard'

const SHIP = 'a'.repeat(64)
const ISSUE = `30851:${SHIP}:f0b27d90-d5b9-40e7-8078-865ab36a421c`
const OTHER = `30851:${SHIP}:e0b27d90-d5b9-40e7-8078-865ab36a421c`
const PAGE = `30023:${SHIP}:d0b27d90-d5b9-40e7-8078-865ab36a421c`
const FOLDER = `39000:${SHIP}:c0b27d90-d5b9-40e7-8078-865ab36a421c`
const PERSON = `nostr:npub1${'q'.repeat(58)}`

const ref = (address: string) => `nostr:${encodeNaddr(addressToPointer(address))}`
const ISSUE_URL = 'https://ship.estiva.app/issue/plan-f0b27d90-d5b9-40e7-8078-865ab36a421c'
const BLOCK_URL = 'https://leaf.estiva.app/page/notes-d0b27d90-d5b9-40e7-8078-865ab36a421c#block-8373a025427f'

const context: Pick<BoxLinkContext, 'resolveLink' | 'blockOf'> = {
  resolveLink: (url) => (url === ISSUE_URL ? ISSUE : undefined),
  blockOf: (url): PartPointer | undefined => (url === BLOCK_URL ? { address: PAGE, block: '8373a025427f' } : undefined),
}
const links = (text: string, extra: Partial<BoxLinkContext> = {}) => boxLinksOf(text, { ...context, ...extra })
const NONE = new Set<string>()

describe('the card under the message box', () => {
  it('one file linked gets its detailed card, and Send writes it', () => {
    const box = links(`see ${ref(ISSUE)} today`)
    expect(box.card).toBe(ISSUE)
    expect(embedsToSend(box, NONE)).toEqual([{ value: ISSUE, layout: 'detailed' }])
  })

  it('✕ before sending sends no card, and never a `none`', () => {
    expect(embedsToSend(links(ref(ISSUE)), new Set([ISSUE]))).toEqual([])
  })

  it('a pasted app URL and a link on words count as the file', () => {
    expect(links(ISSUE_URL).card).toBe(ISSUE)
    expect(links(`the plan is [these words](${ISSUE_URL}) for now`).card).toBe(ISSUE)
  })

  it('two files give no card, written bare or on words', () => {
    expect(links(`${ref(ISSUE)} and ${ref(OTHER)}`).card).toBeUndefined()
    expect(links(`[the plan](${ISSUE_URL}) and ${ref(OTHER)}`).card).toBeUndefined()
  })

  it('a Folder, a person or a plain web link beside the file still give its card', () => {
    expect(links(`${ref(ISSUE)} in ${ref(FOLDER)}`).card).toBe(ISSUE)
    expect(links(`${PERSON} look at ${ref(ISSUE)}`).card).toBe(ISSUE)
    expect(links(`${ref(ISSUE)} and https://example.com/x`).card).toBe(ISSUE)
  })

  it('a block link shows its part and takes the card from the issue beside it', () => {
    const box = links(`${ref(ISSUE)} and ${BLOCK_URL}`)
    expect(box.parts).toEqual([{ address: PAGE, block: '8373a025427f' }])
    expect(box.card).toBeUndefined()
    expect(embedsToSend(box, NONE)).toEqual([])
  })

  it('the file whose conversation it is gets no card, and one other file does', () => {
    expect(links(ref(ISSUE), { here: ISSUE }).card).toBeUndefined()
    expect(links(`${ref(ISSUE)} and ${ref(OTHER)}`, { here: ISSUE }).card).toBe(OTHER)
  })

  it('a pasted block link reads as its file, an issue link as the issue', () => {
    expect(linkTargetOf(BLOCK_URL, context)).toBe(PAGE)
    expect(linkTargetOf(ISSUE_URL, context)).toBe(ISSUE)
    expect(linkTargetOf('https://example.com/x', context)).toBeUndefined()
  })
})

describe('an edit', () => {
  const editOf = (before: string, after: string) => links(after, { previous: namedBefore(before, context) })

  it('adding the first link adds its card and carries the folded set', () => {
    const folded = [{ value: OTHER, layout: 'none' as const }]
    expect(embedsToEdit(editOf('no links yet', `now ${ref(ISSUE)}`), NONE, folded)).toEqual([
      { value: OTHER, layout: 'none' },
      { value: ISSUE, layout: 'detailed' },
    ])
  })

  it('fixing a word of a message whose card was removed with ✕ writes no card', () => {
    expect(embedsToEdit(editOf(`see ${ref(ISSUE)}`, `see ${ref(ISSUE)} now`), NONE, [{ value: ISSUE, layout: 'none' }])).toBeUndefined()
    expect(embedsToEdit(editOf(`see ${ref(ISSUE)}`, `see ${ref(ISSUE)} now`), NONE, undefined)).toBeUndefined()
  })

  it('a link taken out and put back gets its card again, over an earlier none', () => {
    expect(embedsToEdit(editOf('nothing now', ref(ISSUE)), NONE, [{ value: ISSUE, layout: 'none' }])).toEqual([{ value: ISSUE, layout: 'detailed' }])
  })

  it('✕ in the edit box on the card it would add leaves the set alone', () => {
    expect(embedsToEdit(editOf('no links yet', ref(ISSUE)), new Set([ISSUE]), undefined)).toBeUndefined()
  })
})

describe('✕ on a sent message', () => {
  it('turns that card none and keeps every other', () => {
    const folded = [
      { value: ISSUE, layout: 'detailed' as const },
      { value: OTHER, layout: 'detailed' as const },
    ]
    expect(withoutCard(folded, ISSUE)).toEqual([
      { value: ISSUE, layout: 'none' },
      { value: OTHER, layout: 'detailed' },
    ])
  })
})
