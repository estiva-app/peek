/**
 * A comment written on a few words of an issue in Leaf (LEAF-7) shows those words in Peek, under its author's name, as
 * Leaf and Ship show them, not the paragraph around them; changed or deleted since, it says so; and the words open the
 * issue at that spot, in its own app (ONE-12; Miky, 10 November).
 *
 * The relay read behind it is `usePart`'s, tested in `src/api/part.test.tsx`; here it is a seam.
 */
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { blockRunTag, markerTextToBlockDocument, quoteTag } from '@estiva-app/protocol'
import type { PartView } from '@/api'

const views = vi.hoisted(() => new Map<string, PartView>())
vi.mock(import('@/api'), async (importOriginal) => ({
  ...(await importOriginal()),
  usePart: ({ address }: { address: string }) => views.get(address) ?? { state: 'loading' },
}))

import { PeekDataProvider } from '@/api'
import { DebugProvider } from '@/lib/debug'
import { ConversationCard } from './ConversationCard'

const UUID = 'b4ea696a-d4a2-4833-8f2a-6aa1e2f3c4d5'
const ADDRESS = `30851:${'f'.repeat(64)}:${UUID}`
const LINK = `https://ship.estiva.app/issue/plan-${UUID}#block-p1`
const PARAGRAPH = 'The quarterly lantern inventory lists every brass fitting in the east warehouse.'
const object = { slots: { title: { value: 'Plan the launch' } }, noun: 'issue', appName: 'Ship', kind: 30851, openUrl: 'https://ship.estiva.app/o/x' } as never
const block = markerTextToBlockDocument(PARAGRAPH).content[0]

// The comment's own anchor as Peek reads it off a Leaf comment: its block, and the words selected.
const anchor = { address: ADDRESS, block: 'p1', anchor: true as const, anchorTags: [blockRunTag(['p1']), quoteTag({ start: 'brass fitting' })] }

function show(view: PartView, parts: (typeof anchor | { address: string; block: string; anchor: true })[] = [anchor]) {
  views.set(ADDRESS, view)
  return render(
    <MemoryRouter>
      <DebugProvider>
        <PeekDataProvider>
          <ConversationCard authorName="QA-1" timestamp="10:24" body="On these words" parts={parts} />
        </PeekDataProvider>
      </DebugProvider>
    </MemoryRouter>,
  ).container
}

describe('a comment on a few words of an issue', () => {
  it('shows the words it quoted, highlighted, not the paragraph around them', () => {
    const c = show({ state: 'resolved', block, object, link: LINK })
    expect(c.querySelector('[data-quoted]')?.getAttribute('data-quoted')).toBe('here')
    expect(c.querySelector('[data-quoted]')?.textContent).toBe('brass fitting')
    expect(c.textContent).not.toContain('quarterly lantern')
    expect(c.querySelector('[data-part="resolved"]')).toBeNull()
  })

  it('puts the words above the comment’s own, under the author', () => {
    const c = show({ state: 'resolved', block, object, link: LINK })
    const words = c.querySelector('[data-quoted]')
    const text = [...c.querySelectorAll('*')].find((el) => el.textContent === 'On these words' && el.children.length === 0)
    expect(words).not.toBeNull()
    expect(text).toBeDefined()
    expect(words!.compareDocumentPosition(text!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('opens the issue at those words in Ship, in a new tab', () => {
    const c = show({ state: 'resolved', block, object, link: LINK })
    const link = c.querySelector('[data-quoted] a')
    expect(link?.textContent).toBe('brass fitting')
    expect(link?.getAttribute('href')).toBe(LINK)
    expect(link?.getAttribute('target')).toBe('_blank')
  })

  it('says the words changed since', () => {
    const c = show({ state: 'reworded', block, object, link: LINK, quote: { start: 'brass fitting' } })
    expect(c.querySelector('[data-quoted]')?.getAttribute('data-quoted')).toBe('reworded')
    expect(c.textContent).toContain('Changed since')
  })

  it('says the words were deleted from the page, once their paragraph is gone', () => {
    const c = show({ state: 'detached', object, link: LINK })
    expect(c.querySelector('[data-quoted]')?.getAttribute('data-quoted')).toBe('gone')
    expect(c.textContent).toContain('Deleted from the page')
    // Their spot is gone from the file: no link to it.
    expect(c.querySelector('[data-quoted] a')).toBeNull()
  })

  it('shows the words with no claim about them until the issue is read', () => {
    const c = show({ state: 'loading' })
    expect(c.querySelector('[data-quoted]')?.getAttribute('data-quoted')).toBe('part')
    expect(c.textContent).toContain('brass fitting')
  })

  it('keeps the paragraph card for a comment on a whole block, which quotes no words (Decided 2026-10-07)', () => {
    const c = show({ state: 'resolved', block, object, link: LINK }, [{ address: ADDRESS, block: 'p1', anchor: true }])
    expect(c.querySelector('[data-quoted]')).toBeNull()
    expect(c.querySelector('[data-part="resolved"]')?.textContent).toContain('quarterly lantern')
  })
})
