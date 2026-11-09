/**
 * Peek's Topics column as a person sees it (TOP-4, TOPI-10): your topics as
 * one flat list, in the order they come (newest activity first, as the hook
 * orders them), with no files folded under any; "Other topics" shut until
 * opened, and kept as it was left on this browser; "Archived" last, shut the
 * same way (b1ace226); and the approved empty line when you are in none.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { ForeignObject } from '@estiva-app/interop'
import type { TopicsColumnState } from '@/api'
import { filePath } from '@/lib/objectUrl'
import { openedFrom } from '@/lib/openedFrom'
import { TopicsColumnView } from './TopicsColumn'

const PK = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const file = (kind: number, d: string, title: string) =>
  ({ ref: `${kind}:${PK}:${d}`, address: `${kind}:${PK}:${d}`, kind, folder: 'f', slots: { title: { value: title } } }) as unknown as ForeignObject

const WIDGETS = file(30840, 'widgets', 'Widgets')
const DESIGN = file(30840, 'design', 'Design')
const ALPHA = file(30840, 'alpha', 'alpha')
const STRANGER = file(30840, 'stranger', 'Somebody else’s')
const OLD = file(30840, 'old', 'Level 2')

function mount(state: TopicsColumnState, props: { selectedRef?: string; unread?: Record<string, boolean> } = {}) {
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
    expect(link.getAttribute('href')).toBe(filePath(WIDGETS.address!, 'Widgets'))
    await userEvent.click(link)
    expect(openedFrom(WIDGETS.address!)).toBe('topics')
  })

  it('your topics carry the unread dot as the Folder tree’s rows do', () => {
    mount({ mine: [WIDGETS, DESIGN], others: [], archived: [] }, { unread: { [DESIGN.ref]: true } })
    const row = (f: ForeignObject) => document.querySelector(`[data-file="${CSS.escape(f.ref)}"]`)!.parentElement!
    expect(row(DESIGN).querySelector('[data-unread]')).not.toBeNull()
    expect(row(WIDGETS).querySelector('[data-unread]')).toBeNull()
  })

  it('keeps the other topics shut until “Other topics” is opened, and remembers it open on this browser', async () => {
    const state = { mine: [WIDGETS], others: [STRANGER], archived: [] }
    const first = mount(state)
    // The section's panel stays mounted while shut, for find-in-page; shut is not seen.
    expect(screen.getByText('Somebody else’s')).not.toBeVisible()
    await userEvent.click(screen.getByText('Other topics'))
    expect(screen.getByText('Somebody else’s')).toBeVisible()
    first.unmount()
    mount(state)
    expect(screen.getByText('Somebody else’s')).toBeVisible()
  })

  it('opens “Other topics” when the open file is one of them, so its row is seen', () => {
    mount({ mine: [WIDGETS], others: [STRANGER], archived: [] }, { selectedRef: STRANGER.ref })
    expect(screen.getByText('Somebody else’s')).toBeVisible()
  })

  it('keeps archived topics shut under “Archived” at the end until opened, and remembers it open (b1ace226)', async () => {
    const state = { mine: [WIDGETS], others: [STRANGER], archived: [OLD] }
    const first = mount(state)
    expect(screen.getByText('Level 2')).not.toBeVisible()
    const sections = screen.getAllByRole('button').map((button) => button.textContent?.trim())
    expect(sections.indexOf('Archived')).toBeGreaterThan(sections.indexOf('Other topics'))
    await userEvent.click(screen.getByText('Archived'))
    expect(screen.getByText('Level 2').closest('a')!.getAttribute('href')).toBe(filePath(OLD.address!, 'Level 2'))
    expect(screen.getByText('Level 2')).toBeVisible()
    first.unmount()
    mount(state)
    expect(screen.getByText('Level 2')).toBeVisible()
  })

  it('opens “Archived” when the open file is an archived topic, so its row is seen (b1ace226)', () => {
    mount({ mine: [WIDGETS], others: [], archived: [OLD] }, { selectedRef: OLD.ref })
    expect(screen.getByText('Level 2')).toBeVisible()
  })

  it('in no topic at all, says “You’re in no topics yet.” and draws no section', () => {
    mount({ mine: [], others: [], archived: [] })
    expect(screen.getByText('You’re in no topics yet.')).toBeInTheDocument()
    expect(screen.queryByText('Archived')).toBeNull()
    expect(screen.queryByText('Other topics')).toBeNull()
  })

  it('in no topic, with others and archived ones to read, says so and still offers both sections', () => {
    mount({ mine: [], others: [STRANGER], archived: [OLD] })
    expect(screen.getByText('You’re in no topics yet.')).toBeInTheDocument()
    expect(screen.getByText('Other topics')).toBeInTheDocument()
    expect(screen.getByText('Archived')).toBeInTheDocument()
  })
})
