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

vi.mock('@/api', () => ({
  DOCUMENT_FILES: [],
  useResolvedReferences: (refs: string[]) => Object.fromEntries(refs.map((ref) => [ref, null])),
  usePart: ({ address }: { address: string }) => views.get(address) ?? { state: 'loading' },
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
    expect(screen.getByText('Issue · Plan the launch')).toBeTruthy()
    expect(widgets).not.toContain(LINK)
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

describe('deleted and not available never look alike', () => {
  it('deleted says so, and shows no title', () => {
    const { container } = show({ state: 'deleted' })
    expect(card(container)?.dataset.part).toBe('deleted')
    expect(screen.getByText('Deleted')).toBeTruthy()
    expect(screen.queryByText(/Plan the launch/)).toBeNull()
  })

  it('not available shows neither title nor text, in a different frame', () => {
    const { container } = show({ state: 'unreadable' })
    expect(card(container)?.dataset.part).toBe('unreadable')
    expect(screen.getByText('Not available to you')).toBeTruthy()
    expect(screen.queryByText(/Plan the launch|Deleted/)).toBeNull()
    // The package Card's `unreadable` look — a dashed hairline — and only here.
    expect(card(container)?.className).toMatch(/dashed/)
  })

  it('a deleted block of a readable object names the object it was in', () => {
    const { container } = show({ state: 'detached', object, link: LINK })
    expect(card(container)?.dataset.part).toBe('detached')
    expect(screen.getByText('This part was deleted')).toBeTruthy()
    expect(screen.getByText('Issue · Plan the launch')).toBeTruthy()
    expect(card(container)?.className).not.toMatch(/dashed/)
  })
})

describe('a long block is cut, and opens whole', () => {
  it('opens a dialog with the whole block and the way into its app', () => {
    const long = 'word '.repeat(80).trim()
    show({ state: 'resolved', block: blockOf(long), object, link: LINK })
    expect(screen.getAllByText(long)).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }))
    expect(screen.getAllByText(long)).toHaveLength(2)
    expect(screen.getByRole('link', { name: /Open in Ship/ }).getAttribute('href')).toBe(LINK)
  })

  it('draws a short block whole, with nothing to open', () => {
    show({ state: 'resolved', block: blockOf('Short'), object, link: LINK })
    expect(screen.queryByRole('button', { name: 'Show all' })).toBeNull()
  })
})
