/**
 * Peek's Topics column as a person sees it (TOP-4): each of your topics with
 * its files under it, one level deep; "Other topics" shut until opened, and
 * kept as it was left on this browser; and somewhere to go when you have no
 * topic at all.
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
const STRANGER = file(30840, 'stranger', 'Somebody else’s')
const BUILD_1 = file(30850, 'build-1', 'Widgets 2: build 1')
const TESTING = file(30851, 'testing', 'Testing Widgets')

function mount(state: TopicsColumnState, props: { selectedRef?: string; unread?: Record<string, boolean> } = {}) {
  return render(
    <MemoryRouter>
      <TopicsColumnView state={state} {...props} />
    </MemoryRouter>,
  )
}
/** The rows a topic's own toggle shows and hides. */
const panelOf = (topic: ForeignObject) => {
  const toggle = screen.getByRole('button', { name: `Hide what is under ${topic.slots.title?.value}` })
  return document.getElementById(toggle.getAttribute('aria-controls')!)!
}
const rowsUnder = (topic: ForeignObject) => [...panelOf(topic).querySelectorAll('a[data-file]')].map((row) => row.textContent)

beforeEach(() => window.localStorage.clear())

describe('the Topics column (TOP-4)', () => {
  it('draws each of your topics with its files under it, a file two of them list under both', () => {
    mount({ mine: [{ topic: DESIGN, files: [TESTING] }, { topic: WIDGETS, files: [BUILD_1, TESTING] }], others: [] })
    expect(rowsUnder(WIDGETS)).toEqual(['Widgets 2: build 1', 'Testing Widgets'])
    expect(rowsUnder(DESIGN)).toEqual(['Testing Widgets'])
    // One level deep: a listed file is a row of its own, opening onto nothing.
    expect(screen.queryByRole('button', { name: 'Hide what is under Widgets 2: build 1' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Show what is under Widgets 2: build 1/ })).toBeNull()
  })

  it('a row under a topic links to its file, and a click on it opens the file with Topics beside it', async () => {
    mount({ mine: [{ topic: WIDGETS, files: [TESTING] }], others: [] })
    const link = panelOf(WIDGETS).querySelector('a[data-file]')!
    expect(link.getAttribute('href')).toBe(filePath(TESTING.address!, 'Testing Widgets'))
    await userEvent.click(link)
    expect(openedFrom(TESTING.address!)).toBe('topics')
  })

  it('the files under a topic carry the unread dot as the Folder tree’s rows do', () => {
    mount({ mine: [{ topic: WIDGETS, files: [BUILD_1, TESTING] }], others: [] }, { unread: { [TESTING.ref]: true } })
    const row = (f: ForeignObject) => panelOf(WIDGETS).querySelector(`[data-file="${CSS.escape(f.ref)}"]`)!.parentElement!
    expect(row(TESTING).querySelector('[data-unread]')).not.toBeNull()
    expect(row(BUILD_1).querySelector('[data-unread]')).toBeNull()
  })

  it('keeps the other topics shut until “Other topics” is opened, and remembers it open on this browser', async () => {
    const state = { mine: [{ topic: WIDGETS, files: [] }], others: [STRANGER] }
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
    mount({ mine: [{ topic: WIDGETS, files: [] }], others: [STRANGER] }, { selectedRef: STRANGER.ref })
    expect(screen.getByText('Somebody else’s')).toBeVisible()
  })

  it('with no topic at all, says your files are in Folders', () => {
    mount({ mine: [], others: [] })
    expect(screen.getByText('No topics yet. Your files are in Folders.')).toBeInTheDocument()
  })
})
