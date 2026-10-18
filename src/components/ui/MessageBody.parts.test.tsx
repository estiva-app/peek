/**
 * One block of another object, live in a message — SPEC §13.6.1, COM-2.
 *
 * The card's five states are the feature, and two of them — deleted and not
 * available to you — must never look alike. The relay read behind them is
 * `usePart`'s and is tested in `src/nostr/partTags.test.ts`; here it is a seam.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { markerTextToBlockDocument } from '@estiva-app/protocol'
import type { PartView } from '@/api'
import { MessageBody } from './MessageBody'

const AUTHOR = 'f'.repeat(64)
const UUID = 'b4ea696a-d4a2-4833-8f2a-6aa1e2f3c4d5'
const ADDRESS = `30851:${AUTHOR}:${UUID}`
const LINK = `https://ship.estiva.app/issue/plan-${UUID}#block-p1`

const views = new Map<string, PartView>()
const widgets: string[] = []
const asked: { address: string; anchorTags?: string[][] }[] = []

vi.mock('@/api', () => ({
  DOCUMENT_FILES: [],
  useResolvedReferences: (refs: string[]) => Object.fromEntries(refs.map((ref) => [ref, null])),
  useLinkResolver: () => () => undefined,
  usePart: (pointer: { address: string; anchorTags?: string[][] }) => {
    asked.push(pointer)
    return views.get(pointer.address) ?? { state: 'loading' }
  },
}))
vi.mock('./ForeignObjectWidget', () => ({
  ForeignObjectWidget: ({ naddr }: { naddr: string }) => {
    widgets.push(naddr)
    return <div data-widget={naddr} />
  },
  ForeignObjectSkeleton: () => <div data-skeleton />,
}))

const object = { slots: { title: { value: 'Plan the launch' } }, noun: 'issue', appName: 'Ship', openUrl: 'https://ship.estiva.app/o/x' } as never
const blockOf = (text: string) => markerTextToBlockDocument(text).content[0]

const show = (view: PartView, body = `what do you think? ${LINK}`, parts = [{ address: ADDRESS, block: 'p1' }]) => {
  views.set(ADDRESS, view)
  widgets.length = 0
  return render(<MessageBody body={body} parts={parts} />)
}
const card = (container: HTMLElement) => container.querySelector('[data-part]') as HTMLElement | null

describe('a part is drawn while the body names its object', () => {
  it('draws the card in place of the plain link widget', () => {
    const { container } = show({ state: 'resolved', block: blockOf('Ship it on Friday'), object, link: LINK })
    expect(card(container)?.dataset.part).toBe('resolved')
    expect(screen.getByText('Ship it on Friday')).toBeTruthy()
    expect(screen.getByText('Plan the launch')).toBeTruthy()
    expect(widgets).not.toContain(LINK)
  })

  it('is not named by a link that merely contains a short d', () => {
    const SHORT = `30851:${AUTHOR}:s`
    const { container } = show({ state: 'resolved', block: blockOf('Ship it'), object }, 'see https://example.com/posts', [
      { address: SHORT, block: 'p1' },
    ])
    expect(card(container)).toBeNull()
  })

  it('draws nothing once an edit took the link out', () => {
    const { container } = show({ state: 'resolved', block: blockOf('Ship it'), object }, 'never mind')
    expect(card(container)).toBeNull()
  })

  it("draws a comment's own anchor above the text, though the body does not name it", () => {
    const { container } = show({ state: 'resolved', block: blockOf('Ship it'), object }, 'this is wrong', [
      { address: ADDRESS, block: 'p1', anchor: true } as never,
    ])
    expect(card(container)?.dataset.part).toBe('resolved')
  })
})

describe('deleted and not available read the same (Miky, 15 Oct)', () => {
  for (const state of ['deleted', 'unreadable'] as const) {
    it(`${state} says only that a part of the issue is not available: no title, no text`, () => {
      const { container } = show({ state })
      expect(card(container)?.dataset.part).toBe(state)
      expect(card(container)?.textContent).toBe('A part of this issue — not available.')
      expect(screen.queryByText(/Plan the launch/)).toBeNull()
    })
  }

  it('a deleted block of a readable object names the object it was in', () => {
    const { container } = show({ state: 'detached', object, link: LINK })
    expect(card(container)?.dataset.part).toBe('detached')
    expect(screen.getByText('This part was deleted')).toBeTruthy()
    expect(screen.getByText('Plan the launch')).toBeTruthy()
    expect(card(container)?.textContent).not.toContain('not available')
  })
})

/**
 * A comment on a selection (§13.6, LEAF-7): its card reads the whole run and
 * the words at its ends, and words that changed are never shown as the page's.
 */
describe("a comment's anchor on a selection", () => {
  const RUN = [['block', 'p1', 'p2'], ['quote', 'ship on Friday.', 'QA signs']]
  const anchor = [{ address: ADDRESS, block: 'p1', anchor: true as const, anchorTags: RUN }]
  const showAnchor = (view: PartView) => {
    views.set(ADDRESS, view)
    return render(<MessageBody body="this is wrong" parts={anchor} authorName="QA-1" />)
  }

  it('asks for the run and its words, not only the first block', () => {
    asked.length = 0
    showAnchor({ state: 'loading' })
    expect(asked.at(-1)?.anchorTags).toEqual(RUN)
  })

  it('draws every block of the run', () => {
    showAnchor({ state: 'resolved', block: blockOf('We ship on Friday.'), run: [blockOf('We ship on Friday.'), blockOf('QA signs off.')], object })
    expect(screen.getByText('We ship on Friday.')).toBeTruthy()
    expect(screen.getByText('QA signs off.')).toBeTruthy()
  })

  it('shows changed words as what the commenter quoted, beside the blocks, never as deleted', () => {
    const { container } = showAnchor({
      state: 'reworded',
      block: blockOf('We ship next week.'),
      run: [blockOf('We ship next week.'), blockOf('QA sign off.')],
      quote: { start: 'ship on Friday.', end: 'QA signs' },
      object,
    })
    expect(card(container)?.dataset.part).toBe('reworded')
    expect(screen.getByText('We ship next week.')).toBeTruthy()
    expect(screen.getByText('QA-1 quoted: “ship on Friday. … QA signs” · No longer in the text')).toBeTruthy()
    expect(screen.queryByText(/deleted/i)).toBeNull()
  })
})

describe('a long block opens in place, and the way into its app is a button', () => {
  it('draws the block once, with no dialog: ShowMore cuts and opens it where it is', () => {
    const long = 'word '.repeat(80).trim()
    show({ state: 'resolved', block: blockOf(long), object, link: LINK })
    expect(screen.getAllByText(long)).toHaveLength(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens the block in its app from the button at the foot of the card', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    show({ state: 'resolved', block: blockOf('Short'), object, link: LINK })
    fireEvent.click(screen.getByRole('button', { name: 'Open in Ship' }))
    expect(open).toHaveBeenCalledWith(LINK, '_blank', 'noopener,noreferrer')
    open.mockRestore()
  })

  it('offers no way in when the app gave no link', () => {
    show({ state: 'resolved', block: blockOf('Short'), object })
    expect(screen.queryByRole('button', { name: /Open in/ })).toBeNull()
  })
})
