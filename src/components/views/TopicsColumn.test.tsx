/**
 * Peek's Topics column as a person sees it (TOP-4): each of your topics with
 * its files under it, one level deep; "Other topics" shut until opened, and
 * kept as it was left on this browser; "Archived" last, shut the same way, and
 * a topic's archived files behind one "Archived" line that opens them in a
 * dialog (b1ace226); and somewhere to go when you have no topic at all.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
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
const OLD = file(30840, 'old', 'Level 2')
const BUILD_1 = file(30850, 'build-1', 'Widgets 2: build 1')
const BUILD_2 = file(30850, 'build-2', 'Widgets 2: build 2')
const TESTING = file(30851, 'testing', 'Testing Widgets')

/** One of your topics with its live files, and its archived ones. */
const yours = (topic: ForeignObject, files: ForeignObject[] = [], archivedFiles: ForeignObject[] = []) => ({ topic, files, archivedFiles })

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
    mount({ mine: [yours(DESIGN, [TESTING]), yours(WIDGETS, [BUILD_1, TESTING])], others: [], archived: [] })
    expect(rowsUnder(WIDGETS)).toEqual(['Widgets 2: build 1', 'Testing Widgets'])
    expect(rowsUnder(DESIGN)).toEqual(['Testing Widgets'])
    // One level deep: a listed file is a row of its own, opening onto nothing.
    expect(screen.queryByRole('button', { name: 'Hide what is under Widgets 2: build 1' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Show what is under Widgets 2: build 1/ })).toBeNull()
  })

  it('a row under a topic links to its file, and a click on it opens the file with Topics beside it', async () => {
    mount({ mine: [yours(WIDGETS, [TESTING])], others: [], archived: [] })
    const link = panelOf(WIDGETS).querySelector('a[data-file]')!
    expect(link.getAttribute('href')).toBe(filePath(TESTING.address!, 'Testing Widgets'))
    await userEvent.click(link)
    expect(openedFrom(TESTING.address!)).toBe('topics')
  })

  it('the files under a topic carry the unread dot as the Folder tree’s rows do', () => {
    mount({ mine: [yours(WIDGETS, [BUILD_1, TESTING])], others: [], archived: [] }, { unread: { [TESTING.ref]: true } })
    const row = (f: ForeignObject) => panelOf(WIDGETS).querySelector(`[data-file="${CSS.escape(f.ref)}"]`)!.parentElement!
    expect(row(TESTING).querySelector('[data-unread]')).not.toBeNull()
    expect(row(BUILD_1).querySelector('[data-unread]')).toBeNull()
  })

  it('keeps the other topics shut until “Other topics” is opened, and remembers it open on this browser', async () => {
    const state = { mine: [yours(WIDGETS)], others: [STRANGER], archived: [] }
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
    mount({ mine: [yours(WIDGETS)], others: [STRANGER], archived: [] }, { selectedRef: STRANGER.ref })
    expect(screen.getByText('Somebody else’s')).toBeVisible()
  })

  it('keeps archived topics shut under “Archived” at the end until opened, and remembers it open (b1ace226)', async () => {
    const state = { mine: [yours(WIDGETS)], others: [STRANGER], archived: [OLD] }
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
    mount({ mine: [yours(WIDGETS)], others: [], archived: [OLD] }, { selectedRef: OLD.ref })
    expect(screen.getByText('Level 2')).toBeVisible()
  })

  it('a topic’s archived files are one “Archived” line under it, after its files, which opens them in a dialog (b1ace226)', async () => {
    mount({ mine: [yours(WIDGETS, [TESTING], [BUILD_1, BUILD_2])], others: [], archived: [] })
    // Not rows of their own under the topic: only the live file is, then the line.
    expect(rowsUnder(WIDGETS)).toEqual(['Testing Widgets'])
    const line = within(panelOf(WIDGETS)).getByRole('link', { name: /Archived/ })
    expect(line.textContent).toContain('2')
    expect(screen.queryByRole('dialog')).toBeNull()
    await userEvent.click(line)
    const dialog = screen.getByRole('dialog', { name: 'Archived in Widgets' })
    const links = within(dialog).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual([filePath(BUILD_1.address!, 'Widgets 2: build 1'), filePath(BUILD_2.address!, 'Widgets 2: build 2')])
    // Opening one closes the dialog: the file opens beside the column, with Topics.
    await userEvent.click(links[0]!)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(openedFrom(BUILD_1.address!)).toBe('topics')
  })

  it('a file unarchived while the dialog is open leaves it, and the dialog closes once none is left (b1ace226)', async () => {
    const view = mount({ mine: [yours(WIDGETS, [], [BUILD_1, BUILD_2])], others: [], archived: [] })
    await userEvent.click(within(panelOf(WIDGETS)).getByRole('link', { name: /Archived/ }))
    const again = (state: TopicsColumnState) =>
      view.rerender(
        <MemoryRouter>
          <TopicsColumnView state={state} />
        </MemoryRouter>,
      )
    again({ mine: [yours(WIDGETS, [BUILD_1], [BUILD_2])], others: [], archived: [] })
    expect(within(screen.getByRole('dialog')).getAllByRole('link').map((link) => link.textContent)).toEqual(['Widgets 2: build 2'])
    again({ mine: [yours(WIDGETS, [BUILD_1, BUILD_2])], others: [], archived: [] })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a file sent to a new tab from the dialog leaves it open (b1ace226)', async () => {
    mount({ mine: [yours(WIDGETS, [], [BUILD_1, BUILD_2])], others: [], archived: [] })
    await userEvent.click(within(panelOf(WIDGETS)).getByRole('link', { name: /Archived/ }))
    const link = within(screen.getByRole('dialog')).getAllByRole('link')[0]!
    link.addEventListener('click', (event) => event.preventDefault())
    // One session, so Control is still held for the click.
    const user = userEvent.setup()
    await user.keyboard('{Control>}')
    await user.click(link)
    await user.keyboard('{/Control}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('a topic whose files are all archived still opens onto its “Archived” line (b1ace226)', () => {
    mount({ mine: [yours(WIDGETS, [], [BUILD_1])], others: [], archived: [] })
    expect(within(panelOf(WIDGETS)).getByRole('link', { name: /Archived/ })).toBeVisible()
  })

  it('with no topic at all, says your files are in Folders, and draws no Archived section', () => {
    mount({ mine: [], others: [], archived: [] })
    expect(screen.getByText('No topics yet. Your files are in your teams.')).toBeInTheDocument()
    expect(screen.queryByText('Archived')).toBeNull()
  })

  it('with every topic archived, says none is active and still offers the archived ones (b1ace226)', () => {
    mount({ mine: [], others: [], archived: [OLD] })
    expect(screen.getByText('No active topics.')).toBeInTheDocument()
    expect(screen.getByText('Archived')).toBeInTheDocument()
  })
})
