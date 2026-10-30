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
import { fireEvent, render, screen } from '@testing-library/react'
import { addrToNaddr, encodeNevent, type Embed } from '@estiva-app/protocol'

const SHIP = 'cb77583ed45cac74ce4e46c626c1edada0204a6fc4c91f9c7be230b5af36156c'
const ISSUE = `30851:${SHIP}:f0b27d90-d5b9-40e7-8078-865ab36a421c`
const ISSUE_REF = `nostr:${addrToNaddr(ISSUE, [])}`
const EVENT = 'a1b2c3d4e5f60718293a4b5c6d7e8f9011223344556677889900aabbccddeeff'
const NEVENT = `nostr:${encodeNevent({ id: EVENT, relays: [], kind: 9 })}`
const ISSUE_URL = 'https://ship.estiva.app/issue/peek-draws-the-card-f0b27d90-d5b9-40e7-8078-865ab36a421c'

// What the relay answers for each reference: the issue, nothing yet, or an object this reader cannot see.
let answer: 'issue' | 'none' | 'unreachable' = 'issue'
const object = () =>
  answer === 'none'
    ? null
    : { ref: ISSUE, address: ISSUE, eventId: 'e'.repeat(64), kind: 30851, widget: 'row', slots: { title: { value: 'Peek draws the card' } }, meta: [], comments: [], actions: [], ...(answer === 'unreachable' ? { unreachable: true } : {}) }

vi.mock('@/api', () => ({
  // Whether a file that came back as nothing was deleted, and the links in a message's words: neither asked here.
  useDeleted: () => false,
  useLinksIn: () => {},
  TOPICS: [],
  APP_FILES: [],
  DOCUMENT_FILES: [],
  hasRelay: true,
  isFromCopy: () => false,
  // §7.7 as the reader asks it: Ship's link names the issue; anything else names nothing.
  // Only a link the message asked about is answered: one past its cap is never asked.
  useLinkResolver: (asked: readonly string[]) => (url: string) => (url === ISSUE_URL && asked.includes(url) ? ISSUE : undefined),
  useResolvedReferences: (refs: string[]) => Object.fromEntries(refs.map((ref) => [ref, object()])),
  useHeldObject: () => ({ object: object(), reload: async () => {}, gone: answer === 'none' }),
  useForeignObjects: () => ({ applyAction: async () => ({ ok: true }) }),
  useWorkspaceDirectory: () => ({}),
  useConversationBadges: () => ({ counts: {}, unread: {} }),
}))
vi.mock('@/api/mentions', () => ({
  personByPubkey: () => undefined,
  subscribeMentions: () => () => {},
  mentionsVersion: () => 0,
}))

import { MessageBody } from './MessageBody'

const bare = (ref: string) => ref.replace(/^nostr:/, '')
let drawn: { naddr: string; layout: string }[] = []
/** What the message drew: each card under it, by the file it stands for and its layout; and each row in its text. */
const show = (body: string, embeds?: Embed[], props: { nostrReferences?: string[] } = {}) => {
  const { container } = render(<MessageBody body={body} embeds={embeds} {...props} />)
  drawn = [...container.querySelectorAll<HTMLElement>('[data-card]')].map((card) => ({
    naddr: card.dataset.cardValue ?? '',
    layout: card.dataset.card === 'detailed' ? 'card' : 'row',
  }))
  return container
}
const rows = (c: HTMLElement) => c.querySelectorAll('[data-link-row]').length

beforeEach(() => {
  drawn = []
  answer = 'issue'
})

describe('the card a message asks for', () => {
  it('draws a detailed card for an issue named mid-sentence, and keeps its chip', () => {
    const c = show(`see ${ISSUE_REF} please`, [{ value: ISSUE, layout: 'detailed' }])
    expect(drawn).toEqual([{ naddr: bare(ISSUE_REF), layout: 'card' }])
    // The chip in the sentence, and the card's title under it.
    expect(c.textContent?.match(/Peek draws the card/g)).toHaveLength(2)
    expect(c.querySelector('[data-card="detailed"]')?.textContent).toContain('Peek draws the card')
  })

  it('draws a compact one, an old message’s, as a row under it', () => {
    const c = show(`see ${ISSUE_REF} please`, [{ value: ISSUE, layout: 'compact' }])
    expect(drawn).toEqual([{ naddr: bare(ISSUE_REF), layout: 'row' }])
    expect(c.querySelector('[data-card="compact"]')?.textContent).toContain('Peek draws the card')
  })

  it('draws no card without an embed, as before', () => {
    show(`see ${ISSUE_REF} please`)
    expect(drawn).toEqual([])
  })

  it('draws a reference alone on its line as its row, with no card, when no embed names it', () => {
    const c = show(`Look.\n\n${ISSUE_REF}`)
    expect(drawn).toEqual([])
    expect(rows(c)).toBe(1)
    expect(c.querySelector('[data-link-row]')?.textContent).toContain('Peek draws the card')
  })

  it('draws a message that is only a reference as that row, sent before any embed existed', () => {
    const c = show(ISSUE_REF)
    expect(drawn).toEqual([])
    expect(rows(c)).toBe(1)
    // The row alone: its title, and under it what it is (ui 0.91.0).
    expect(c.textContent).toBe('Peek draws the cardIssue')
  })

  it('draws a lone message pointer as its row, not a quote card', () => {
    const c = show(`Look.\n\n${NEVENT}`)
    expect(drawn).toEqual([])
    expect(rows(c)).toBe(1)
  })

  it('draws a bare app link as the row of what it names alone, and its chip mid-sentence, with no card', () => {
    const lone = show(ISSUE_URL)
    expect(drawn).toEqual([])
    expect(rows(lone)).toBe(1)
    expect(lone.textContent).toBe('Peek draws the cardIssue')
    const mid = show(`see ${ISSUE_URL}, then ship`)
    expect(drawn).toEqual([])
    expect(rows(mid)).toBe(0)
    expect(mid.textContent).toContain('see Peek draws the card, then ship')
  })

  it('keeps a bare app link a link until what it names has come back, and for good when it cannot be read (OPT-18)', () => {
    for (const state of ['none', 'unreachable'] as const) {
      answer = state
      const c = show(`see ${ISSUE_URL}`)
      expect(c.querySelector(`a[href="${ISSUE_URL}"]`)).not.toBeNull()
      expect(c.querySelector('[data-reference]')).toBeNull()
    }
  })

  it('keeps a link nothing claims as the link it is, with no card under it (OPT-18)', () => {
    const c = show('https://example.com/a')
    expect(drawn).toEqual([])
    expect(c.querySelector('a[href="https://example.com/a"]')).not.toBeNull()
  })

  it('draws the chosen card under a bare app link, and the link’s line draws nothing, since the card stands for it', () => {
    const c = show(ISSUE_URL, [{ value: ISSUE, layout: 'compact' }])
    expect(drawn).toEqual([{ naddr: bare(ISSUE_REF), layout: 'row' }])
    expect(rows(c)).toBe(0)
    expect(c.textContent?.match(/Peek draws the card/g)).toHaveLength(1)
  })

  it('draws the card under an app link that follows many mailto links: a mailto names nothing and takes no place in the links asked about', () => {
    const mails = Array.from({ length: 10 }, (_, i) => `[write ${i}](mailto:person${i}@estiva.app)`).join(' ')
    show(`${mails}\n\nand the plan: ${ISSUE_URL}`, [{ value: ISSUE, layout: 'compact' }])
    expect(drawn).toEqual([{ naddr: bare(ISSUE_REF), layout: 'row' }])
  })

  it('draws a lone line whose file has the card as nothing: the card stands for it, with no row of its own', () => {
    const c = show(`Look.\n\n${ISSUE_REF}`, [{ value: ISSUE, layout: 'detailed' }])
    expect(drawn).toEqual([{ naddr: bare(ISSUE_REF), layout: 'card' }])
    expect(rows(c)).toBe(0)
    expect(c.textContent?.match(/Peek draws the card/g)).toHaveLength(1)
  })

  it('draws no card for none, and the lone line keeps its row', () => {
    const c = show(`Look.\n\n${ISSUE_REF}`, [{ value: ISSUE, layout: 'none' }])
    expect(drawn).toEqual([])
    expect(rows(c)).toBe(1)
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
  const tagged = (body: string, embeds?: Embed[]) => ({ container: show(body, embeds, { nostrReferences: [ISSUE] }) })

  it('draws the card a link on words asks for, and the words stay a link: its target names its file (protocol 0.40)', () => {
    const c = tagged(`the plan is [these words](${ISSUE_URL}) for now`, [{ value: ISSUE, layout: 'detailed' }]).container
    expect(drawn).toEqual([{ naddr: bare(ISSUE_REF), layout: 'card' }])
    expect(c.querySelector(`a[href="${ISSUE_URL}"]`)?.textContent).toBe('these words')
  })

  it('still draws the card a link on words asks for beside a plain web link', () => {
    tagged(`the plan is [these words](${ISSUE_URL}), see https://example.com/a`, [{ value: ISSUE, layout: 'detailed' }])
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

describe('the author’s ✕ on a sent card (4136f999)', () => {
  const OTHER = `30851:${SHIP}:e0b27d90-d5b9-40e7-8078-865ab36a421c`
  const OTHER_REF = `nostr:${addrToNaddr(OTHER, [])}`

  it('takes off the card it is on, by its file, and leaves the other card of an old two-card message', () => {
    const onRemoveCard = vi.fn()
    render(
      <MessageBody
        body={`${ISSUE_REF} and ${OTHER_REF}`}
        embeds={[{ value: ISSUE, layout: 'detailed' }, { value: OTHER, layout: 'detailed' }]}
        onRemoveCard={onRemoveCard}
      />,
    )
    const removes = screen.getAllByRole('button', { name: 'Remove' })
    expect(removes).toHaveLength(2)
    fireEvent.click(removes[1])
    expect(onRemoveCard).toHaveBeenCalledExactlyOnceWith(OTHER)
  })

  it('is not offered to a reader who cannot edit the message', () => {
    render(<MessageBody body={`see ${ISSUE_REF}`} embeds={[{ value: ISSUE, layout: 'detailed' }]} />)
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
  })
})
