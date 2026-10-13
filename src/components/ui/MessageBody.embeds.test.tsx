/**
 * The card a message's author asked for — SPEC §13.6.2.
 *
 * Which values get a card is the package's rule (`cardsIn`) and is tested
 * there; what this guards is how Peek draws its answer, the same way Ship does
 * (estiva-app/ship#284): compact as a row, detailed as a card, `none` as
 * nothing — and no card at all without an `embed`, for a reference alone on its
 * line, a bare app link or a link on words: each reads as its chip or its link
 * (OPT-18).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { addrToNaddr, encodeNevent, type Embed } from '@estiva-app/protocol'

const SHIP = 'cb77583ed45cac74ce4e46c626c1edada0204a6fc4c91f9c7be230b5af36156c'
const ISSUE = `30851:${SHIP}:f0b27d90-d5b9-40e7-8078-865ab36a421c`
const ISSUE_REF = `nostr:${addrToNaddr(ISSUE, [])}`
const EVENT = 'a1b2c3d4e5f60718293a4b5c6d7e8f9011223344556677889900aabbccddeeff'
const NEVENT = `nostr:${encodeNevent({ id: EVENT, relays: [], kind: 9 })}`
const ISSUE_URL = 'https://ship.estiva.app/issue/peek-draws-the-card-f0b27d90-d5b9-40e7-8078-865ab36a421c'

const drawn: { naddr: string; layout?: string }[] = []

vi.mock('@/api', () => ({
  TOPICS: [],
  APP_FILES: [],
  DOCUMENT_FILES: [],
  // §7.7 as the reader asks it: Ship's link names the issue; anything else names nothing.
  useLinkResolver: () => (url: string) => (url === ISSUE_URL ? ISSUE : undefined),
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

  it('draws a reference alone on its line as its chip, with no card, when no embed names it (OPT-18)', () => {
    const c = show(`Look.\n\n${ISSUE_REF}`)
    expect(drawn).toEqual([])
    expect(c.textContent).toContain('Peek draws the card')
  })

  it('draws a message that is only a reference as that chip, sent before any embed existed (OPT-18)', () => {
    const c = show(ISSUE_REF)
    expect(drawn).toEqual([])
    expect(c.textContent).toBe('Peek draws the card')
  })

  it('draws a lone message pointer as its chip, not a quote card (OPT-18)', () => {
    show(`Look.\n\n${NEVENT}`)
    expect(drawn).toEqual([])
  })

  it('draws a bare app link as the chip of what it names, alone or mid-sentence, with no card (OPT-18)', () => {
    const lone = show(ISSUE_URL)
    expect(drawn).toEqual([])
    expect(lone.textContent).toBe('Peek draws the card')
    const mid = show(`see ${ISSUE_URL}, then ship`)
    expect(drawn).toEqual([])
    expect(mid.textContent).toContain('see Peek draws the card, then ship')
  })

  it('keeps a link nothing claims as the link it is, with no card under it (OPT-18)', () => {
    const c = show('https://example.com/a')
    expect(drawn).toEqual([])
    expect(c.querySelector('a[href="https://example.com/a"]')).not.toBeNull()
  })

  it('draws the chosen card under a bare app link, and keeps its chip', () => {
    const c = show(ISSUE_URL, [{ value: ISSUE, layout: 'compact' }])
    expect(drawn).toEqual([{ naddr: bare(ISSUE_REF), layout: 'row' }])
    expect(c.textContent).toContain('Peek draws the card')
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

describe('the card a link on words asks for (OPT-17)', () => {
  // As Peek sends it: the link's object is indexed by an `a` (FOL-38), which alone would attach a row.
  const tagged = (body: string, embeds?: Embed[]) => render(<MessageBody body={body} embeds={embeds} nostrReferences={[ISSUE]} />)

  it('draws the chosen layout for the object the link names, instead of the link’s own card', () => {
    tagged(`the plan is [these words](${ISSUE_URL}) for now`, [{ value: ISSUE, layout: 'detailed' }])
    expect(drawn).toEqual([{ naddr: bare(ISSUE_REF), layout: 'card' }])
  })

  it('draws nothing under it for none', () => {
    tagged(`the plan is [these words](${ISSUE_URL}) for now`, [{ value: ISSUE, layout: 'none' }])
    expect(drawn).toEqual([])
  })

  it('draws no card for a link on words with no embed, and its `a` attaches nothing — the words stay a link (OPT-18)', () => {
    const c = tagged(`the plan is [these words](${ISSUE_URL}) for now`).container
    expect(drawn).toEqual([])
    expect(c.querySelector(`a[href="${ISSUE_URL}"]`)?.textContent).toBe('these words')
  })

  it('a URL written in a link’s label names nothing: the link goes elsewhere', () => {
    show(`see [${ISSUE_URL}](https://evil.example/login)`, [{ value: ISSUE, layout: 'detailed' }])
    expect(drawn.filter((d) => d.layout === 'card')).toEqual([])
  })

  it('a link that names nothing by §7.7 carries no card, whatever its embed says', () => {
    const lookalike = 'https://evil.example/issue/peek-draws-the-card-f0b27d90-d5b9-40e7-8078-865ab36a421c'
    show(`see [this](${lookalike})`, [{ value: ISSUE, layout: 'detailed' }])
    expect(drawn.filter((d) => d.layout === 'card')).toEqual([])
  })
})
