/**
 * Peek's Topics column as a person sees it (TOP-4, TOPI-10): your topics as
 * one flat list, in the order they come (newest activity first, as the hook
 * orders them), with no files folded under any; then one Explore initiatives row,
 * in place of the Other topics and Archived sections (TOPI-6); and the
 * approved empty line when you are in none.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { ForeignObject } from '@estiva-app/interop'
import type { TopicsColumnState } from '@/api'
import { openedFrom } from '@/lib/openedFrom'
import { TopicsColumnView } from './TopicsColumn'

const PK = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const file = (kind: number, d: string, title: string) =>
  ({ ref: `${kind}:${PK}:${d}`, address: `${kind}:${PK}:${d}`, kind, folder: 'f', slots: { title: { value: title } } }) as unknown as ForeignObject

const WIDGETS = file(30840, '9d2f4b6a-8c1e-4a3b-9f5d-7e6c5b4a3d2e', 'Widgets')
const DESIGN = file(30840, 'design', 'Design')
const ALPHA = file(30840, 'alpha', 'alpha')
const STRANGER = file(30840, 'stranger', 'Somebody else’s')
const OLD = file(30840, 'old', 'Level 2')

function mount(state: TopicsColumnState, props: { selectedRef?: string; unread?: Record<string, boolean>; exploring?: boolean; onNewTopic?: () => void } = {}) {
  return render(
    <MemoryRouter>
      <TopicsColumnView state={state} {...props} />
    </MemoryRouter>,
  )
}
const rows = () => [...document.querySelectorAll('a[data-file]')].map((row) => row.textContent)

beforeEach(() => window.localStorage.clear())

describe('the Topics column (TOP-4, TOPI-10)', () => {
  it('draws your topics as one flat list in the order given, not A–Z, with nothing folded under any', () => {
    mount({ mine: [WIDGETS, ALPHA, DESIGN], others: [], archived: [] })
    expect(rows()).toEqual(['Widgets', 'alpha', 'Design'])
    // No topic opens onto rows under it.
    expect(screen.queryByRole('button', { name: /what is under/ })).toBeNull()
  })

  it('a topic’s row links to it, and a click on it opens it with Topics beside it', async () => {
    mount({ mine: [WIDGETS], others: [], archived: [] })
    const link = document.querySelector('a[data-file]')!
    expect(link.getAttribute('href')).toBe('/topic/widgets-9d2f4b6a-8c1e-4a3b-9f5d-7e6c5b4a3d2e')
    await userEvent.click(link)
    expect(openedFrom(WIDGETS.address!)).toBe('topics')
  })

  it('your topics carry the unread dot as the Folder tree’s rows do', () => {
    mount({ mine: [WIDGETS, DESIGN], others: [], archived: [] }, { unread: { [DESIGN.ref]: true } })
    const row = (f: ForeignObject) => document.querySelector(`[data-file="${CSS.escape(f.ref)}"]`)!.parentElement!
    expect(row(DESIGN).querySelector('[data-unread]')).not.toBeNull()
    expect(row(WIDGETS).querySelector('[data-unread]')).toBeNull()
  })

  it('ends with one Explore initiatives row and no Other topics or Archived section, nor any of their topics (TOPI-6)', () => {
    mount({ mine: [WIDGETS, DESIGN], others: [STRANGER], archived: [OLD] })
    const links = [...document.querySelectorAll('a')]
    expect(links.map((link) => link.textContent)).toEqual(['Widgets', 'Design', 'Explore initiatives'])
    expect(links.at(-1)!.getAttribute('href')).toBe('/app/initiatives/explore')
    expect(screen.queryByText('Other topics')).toBeNull()
    expect(screen.queryByText('Archived')).toBeNull()
    expect(screen.queryByText('Somebody else’s')).toBeNull()
    expect(screen.queryByText('Level 2')).toBeNull()
  })

  it('marks Explore initiatives as the current row while its page is open, and only then', () => {
    const first = mount({ mine: [WIDGETS], others: [], archived: [] }, { exploring: true })
    expect(screen.getByText('Explore initiatives').closest('a')!.getAttribute('aria-current')).toBe('page')
    first.unmount()
    mount({ mine: [WIDGETS], others: [], archived: [] })
    expect(screen.getByText('Explore initiatives').closest('a')!.getAttribute('aria-current')).toBeNull()
  })

  it('wears ◎ on every row, and the list-and-magnifier on Explore initiatives (Katerina, 16 November)', () => {
    mount({ mine: [WIDGETS, DESIGN], others: [], archived: [] })
    expect(document.querySelectorAll('a[data-file] .tabler-icon-target')).toHaveLength(2)
    expect(screen.getByText('Explore initiatives').closest('a')!.querySelector('.tabler-icon-list-search')).not.toBeNull()
  })

  it('offers New initiative, a plus, where New topic was (I-04)', async () => {
    const onNewTopic = vi.fn()
    mount({ mine: [], others: [], archived: [] }, { onNewTopic })
    const button = screen.getByRole('button', { name: 'New initiative' })
    expect(button.querySelector('.tabler-icon-plus')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'New topic' })).toBeNull()
    await userEvent.click(button)
    expect(onNewTopic).toHaveBeenCalledTimes(1)
  })

  it('in no initiative, says “You’re in no initiatives yet.” above Explore initiatives', () => {
    mount({ mine: [], others: [STRANGER], archived: [OLD] })
    const empty = screen.getByText('You’re in no initiatives yet.')
    const explore = screen.getByText('Explore initiatives')
    expect(empty.compareDocumentPosition(explore) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
