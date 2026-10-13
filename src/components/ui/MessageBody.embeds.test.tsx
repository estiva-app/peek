/**
 * The card a message's author asked for — SPEC §13.6.2.
 *
 * Which values get a card is the package's rule (`cardsIn`) and is tested
 * there; what this guards is how Peek draws its answer, the same way Ship does
 * (estiva-app/ship#284): compact as a row, detailed as a card, `none` as
 * nothing, and an `embed` on a reference alone on its line taking the place of
 * the card that line would otherwise attach, leaving the chip in the text.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { addrToNaddr, encodeNevent, type Embed } from '@estiva-app/protocol'

const SHIP = 'cb77583ed45cac74ce4e46c626c1edada0204a6fc4c91f9c7be230b5af36156c'
const ISSUE = `30851:${SHIP}:f0b27d90-d5b9-40e7-8078-865ab36a421c`
const ISSUE_REF = `nostr:${addrToNaddr(ISSUE, [])}`
const EVENT = 'a1b2c3d4e5f60718293a4b5c6d7e8f9011223344556677889900aabbccddeeff'
const NEVENT = `nostr:${encodeNevent({ id: EVENT, relays: [], kind: 9 })}`

const drawn: { naddr: string; layout?: string }[] = []

vi.mock('@/api', () => ({
  TOPICS: [],
  APP_FILES: [],
  DOCUMENT_FILES: [],
  useResolvedReferences: (refs: string[]) =>
    Object.fromEntries(
      refs.map((ref) => [
        ref,
        { ref: ISSUE, eventId: 'e'.repeat(64), kind: 30851, widget: 'row', slots: { title: { value: 'Peek draws the card' } }, meta: [], comments: [], actions: [] },
      ]),
    ),
}))
vi.mock('./ForeignObjectWidget', () => ({
  ForeignObjectWidget: ({ naddr, layout }: { naddr: string; layout?: string }) => {
    drawn.push({ naddr, layout })
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

const bare = (ref: string) => ref.replace(/^nostr:/, '')
const show = (body: string, embeds?: Embed[]) => render(<MessageBody body={body} embeds={embeds} />).container

beforeEach(() => {
  drawn.length = 0
})

describe('the card a message asks for', () => {
  it('draws a detailed card for an issue named mid-sentence, and keeps its chip', () => {
    const c = show(`see ${ISSUE_REF} please`, [{ value: ISSUE, layout: 'detailed' }])
    expect(drawn).toEqual([{ naddr: bare(ISSUE_REF), layout: 'card' }])
    expect(c.textContent).toContain('Peek draws the card')
    expect(c.querySelector('[data-card="detailed"]')).not.toBeNull()
  })

  it('draws a compact one as a row', () => {
    show(`see ${ISSUE_REF} please`, [{ value: ISSUE, layout: 'compact' }])
    expect(drawn).toEqual([{ naddr: bare(ISSUE_REF), layout: 'row' }])
  })

  it('draws no card without an embed, as before', () => {
    show(`see ${ISSUE_REF} please`)
    expect(drawn).toEqual([])
  })

  it('draws the lone-line card as before when no embed names it', () => {
    show(`Look.\n\n${ISSUE_REF}`)
    expect(drawn).toEqual([{ naddr: bare(ISSUE_REF), layout: undefined }])
  })

  it('replaces a lone-line card with the chosen layout, and the line stays as its chip', () => {
    const c = show(`Look.\n\n${ISSUE_REF}`, [{ value: ISSUE, layout: 'detailed' }])
    expect(drawn).toEqual([{ naddr: bare(ISSUE_REF), layout: 'card' }])
    expect(c.textContent).toContain('Peek draws the card')
  })

  it('leaves only the chip for none — on a lone line too', () => {
    const c = show(`Look.\n\n${ISSUE_REF}`, [{ value: ISSUE, layout: 'none' }])
    expect(drawn).toEqual([])
    expect(c.textContent).toContain('Peek draws the card')
  })

  it('treats a lone message pointer the same way', () => {
    show(`Look.\n\n${NEVENT}`, [{ value: EVENT, layout: 'none' }])
    expect(drawn).toEqual([])
    show(`Look.\n\n${NEVENT}`, [{ value: EVENT, layout: 'compact' }])
    expect(drawn).toEqual([{ naddr: bare(NEVENT), layout: 'row' }])
  })

  it('draws nothing for an embed whose value the body no longer names', () => {
    show('the link was taken out', [{ value: ISSUE, layout: 'detailed' }])
    expect(drawn).toEqual([])
  })
})
