/**
 * SID-3: a file on the Desk opens beside the lists, and the Desk stays the
 * page. Since FOL-26 a click had navigated to the file's page, which lit
 * another app on the rail and remounted the shell. A Convex topic row opened
 * the same way until FOL-23 took the topic rows away: a topic in somebody's
 * stars or open work draws nothing now (`internal/starred.tsx`).
 *
 * The pane is `useFileView`, the relay conversation `FilePage` draws, and is
 * stood in for here: its own behaviour is `FilePage.test.tsx`'s. What this pins
 * is which file the Desk hands it, that the URL says so, and that nothing
 * leaves `/app/desk`.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { LastSelectionProvider } from '@/lib/lastSelection'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DebugProvider } from '@/lib/debug'
import { DeskPage } from './DeskPage'

/** "Widgets", a bare-file topic. */
const WIDGETS_FILE = '30840:b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46:7a384136-31a6-4d91-80ac-1d599464d2f2'
/** A file in Open work, a Ship issue say. */
const ISSUE = '30851:aa:issue-1'

const pane = vi.hoisted(() => ({ asked: [] as (string | null)[] }))
vi.mock('@/components/views/useFileView', () => ({
  useFileView: ({ address }: { address: string | null }) => {
    pane.asked.push(address)
    return {
      file: address ? { address, slots: { title: { value: address === ISSUE ? 'Issue one' : 'Widgets' } } } : null,
      // The middle column's parts, for the page's Panel (estiva-ui 0.37.0).
      panel: {
        children: address ? (
          <div data-testid="file-pane" data-address={address}>
            <textarea aria-label="Composer" />
          </div>
        ) : null,
      },
      threadPanel: undefined,
    }
  },
}))
/*
  The page's own pane and header (OPT-12), stood in for: its header is
  `FilePage.test.tsx`'s. What this pins is that the Desk draws the same one,
  and where its writes leave the person.
*/
const filePane = vi.hoisted(() => ({
  callbacks: undefined as
    | { onDeleted: (deleted: unknown) => void; onStarted: (created: { address: string; title: string }) => void }
    | undefined,
}))
vi.mock('@/components/views/useFilePane', () => ({
  useFilePane: (
    view: { panel: { children: React.ReactNode } },
    callbacks: NonNullable<typeof filePane.callbacks>,
  ) => {
    filePane.callbacks = callbacks
    return {
      pane: (
        <div>
          <div data-testid="file-header" />
          {view.panel.children}
        </div>
      ),
      dialogs: null,
      openControl: vi.fn(),
      member: undefined,
    }
  },
}))
vi.mock('@/components/views/useDmConversationView', () => ({
  useDmConversationView: ({ dmId }: { dmId: string | null }) => ({
    rightPanel: dmId ? <div data-testid="dm-pane">{dmId}</div> : <div data-testid="nothing-open" />,
    threadPanel: undefined,
  }),
}))
const openWork = vi.hoisted(() => ({ remove: vi.fn(), removeDm: vi.fn() }))
/** A second Open work file, for the order test. */
const SECOND = '30851:aa:issue-2'
const desk = vi.hoisted(() => ({
  openWork: [] as unknown[],
  unread: {} as Record<string, boolean>,
}))
vi.mock('@/api', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/api')),
  useUnread: () => ({ dmHasUnread: () => false }),
  useStarred: () => ({
    entries: [{ id: 'star-dm', kind: 'dm', dmId: 'dm-1', name: 'Ana' }],
    isDmStarred: () => true,
    toggleDm: vi.fn(),
    isLoading: false,
  }),
  useDeskLoading: () => false,
  useDeskItems: () => ({ openWork: desk.openWork, urgent: [] }),
  useScreenerItems: () => [],
  useLiveConversationBadges: () => ({ counts: {}, unread: desk.unread }),
  useOpenWorkFiles: () => ({ remove: openWork.remove, add: vi.fn(), has: () => true }),
  usePeekActions: () => ({ removeDmFromOpenWork: openWork.removeDm }),
}))
vi.mock('@/layouts/PeekFrame', () => ({
  PeekFrame: ({ leftPanel, rightPanel, threadPanel }: Record<string, React.ReactNode>) => (
    <div>
      <section data-testid="left">{leftPanel}</section>
      <section data-testid="middle">{rightPanel}</section>
      <section data-testid="thread">{threadPanel}</section>
    </div>
  ),
}))

function Probe() {
  const location = useLocation()
  return <output data-testid="url">{location.pathname + location.search}</output>
}

/** A way off Desk and back, plain: what the rail does. */
function Go({ to, label }: { to: string; label: string }) {
  const navigate = useNavigate()
  return <button onClick={() => navigate(to)}>{label}</button>
}

function mount(url = '/app/desk') {
  return render(
    <DebugProvider>
      <LastSelectionProvider>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/app/desk" element={<><DeskPage /><Go to="/app/people" label="Leave Desk" /><Probe /></>} />
            <Route path="/app/people" element={<><Go to="/app/desk" label="Back to Desk" /><Probe /></>} />
            <Route path="*" element={<Probe />} />
          </Routes>
        </MemoryRouter>
      </LastSelectionProvider>
    </DebugProvider>,
  )
}

const url = () => screen.getByTestId('url').textContent
const deskWith = (address: string) => `/app/desk?${new URLSearchParams({ open: address })}`

const openWorkFile = (address: string, title: string) => ({
  id: `ow_file_${address}`,
  kind: 'file',
  address,
  title,
  object: { ref: address, kind: 30851 },
})

beforeEach(() => {
  pane.asked = []
  openWork.remove.mockClear()
  openWork.removeDm.mockClear()
  desk.openWork = [openWorkFile(ISSUE, 'Issue one')]
  desk.unread = {}
})

describe('Open work keeps the person’s order', () => {
  it('does not move an unread file ahead of a read one, so reading it moves nothing', () => {
    // It used to sort unread first: a file opened from the Screener drew first
    // and dropped to last the moment it was read.
    desk.openWork = [openWorkFile(ISSUE, 'Issue one'), openWorkFile(SECOND, 'Issue two')]
    desk.unread = { [SECOND]: true }
    mount()
    const left = screen.getByTestId('left').textContent ?? ''
    expect(left.indexOf('Issue one')).toBeGreaterThanOrEqual(0)
    expect(left.indexOf('Issue one')).toBeLessThan(left.indexOf('Issue two'))
  })
})

describe('Desk opens a file beside its lists (SID-3)', () => {
  it('opens an Open work file in place, with a composer, rather than on its own page', () => {
    mount()
    fireEvent.click(screen.getByText('Issue one'))
    expect(url()).toBe(deskWith(ISSUE))
    expect(screen.getByTestId('file-pane').dataset.address).toBe(ISSUE)
    expect(screen.getByLabelText('Composer')).toBeTruthy()
  })

  it('keeps the file open across a reload of the Desk URL', () => {
    mount(deskWith(WIDGETS_FILE))
    expect(screen.getByTestId('file-pane').dataset.address).toBe(WIDGETS_FILE)
    expect(url()).toBe(deskWith(WIDGETS_FILE))
  })

  it('draws the page’s header, with no link to a full page: there is only one page (OPT-12)', () => {
    mount(deskWith(WIDGETS_FILE))
    expect(within(screen.getByTestId('middle')).getByTestId('file-header')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Open full page' })).toBeNull()
  })

  it('deleting the open file closes its pane and stays on the Desk (OPT-12)', () => {
    mount(deskWith(WIDGETS_FILE))
    act(() => filePane.callbacks!.onDeleted({ address: WIDGETS_FILE }))
    expect(url()).toBe('/app/desk')
    expect(screen.queryByTestId('file-pane')).toBeNull()
  })

  it('a topic started inside the open one opens in the Desk’s pane (OPT-12)', () => {
    mount(deskWith(WIDGETS_FILE))
    act(() => filePane.callbacks!.onStarted({ address: ISSUE, title: 'Issue one' }))
    expect(url()).toBe(deskWith(ISSUE))
    expect(screen.getByTestId('file-pane').dataset.address).toBe(ISSUE)
  })

  it('a DM closes the open file, and the file param goes with it', () => {
    mount(deskWith(WIDGETS_FILE))
    fireEvent.click(screen.getByText('Ana'))
    expect(url()).toBe('/app/desk')
    expect(screen.queryByTestId('file-pane')).toBeNull()
    expect(screen.getByTestId('dm-pane').textContent).toBe('dm-1')
    expect(pane.asked.at(-1)).toBeNull()
  })

  it('the DM Desk had open is open again when the person comes back (5 October)', () => {
    mount(deskWith(WIDGETS_FILE))
    fireEvent.click(screen.getByText('Ana'))
    expect(screen.getByTestId('dm-pane').textContent).toBe('dm-1')
    // Leave Desk, and come back to it.
    fireEvent.click(screen.getByRole('button', { name: 'Leave Desk' }))
    expect(url()).toBe('/app/people')
    fireEvent.click(screen.getByRole('button', { name: 'Back to Desk' }))
    expect(screen.getByTestId('dm-pane').textContent).toBe('dm-1')
  })

  it('removing the open file from Open work closes it', () => {
    mount(deskWith(ISSUE))
    // The ✕ is NavItem's: always there, shown under the pointer by CSS, and named for its row.
    fireEvent.click(within(screen.getByTestId('left')).getByRole('button', { name: 'Remove from list: Issue one' }))
    expect(openWork.remove).toHaveBeenCalledWith(ISSUE)
    expect(url()).toBe('/app/desk')
  })
})

/*
  The Desk's rows are the package's NavItem (Katerina, 14 October): each is a
  link, a plain click still opens it beside the lists, Open work keeps its ✕,
  and an archived file stays on the list and says so under the pointer.
*/
describe('Desk rows on NavItem', () => {
  const left = () => within(screen.getByTestId('left'))
  const linkFor = (name: string) => left().getByText(name).closest('a')!

  it('each row is a link: a file to its Desk address, a DM to the person', () => {
    mount()
    expect(linkFor('Issue one').getAttribute('href')).toBe(deskWith(ISSUE))
    expect(linkFor('Ana').getAttribute('href')).toBe('/app/people/dm-1')
  })

  it('a plain click on a starred DM opens it here, and the Desk stays the page', () => {
    mount()
    fireEvent.click(linkFor('Ana'))
    expect(screen.getByTestId('dm-pane').textContent).toBe('dm-1')
    expect(url()).toBe('/app/desk')
  })

  it('a click with Ctrl or Cmd is the link’s: nothing opens here', () => {
    mount()
    fireEvent.click(linkFor('Issue one'), { ctrlKey: true })
    fireEvent.click(linkFor('Ana'), { metaKey: true })
    expect(screen.queryByTestId('file-pane')).toBeNull()
    expect(screen.queryByTestId('dm-pane')).toBeNull()
    expect(url()).toBe('/app/desk')
  })

  it('an archived file stays in Open work and carries the Archived chip; one that is not, none', () => {
    desk.openWork = [
      { ...openWorkFile(ISSUE, 'Issue one'), object: { ref: ISSUE, kind: 30851, archived: { by: 'aa', at: 1 } } },
      openWorkFile(SECOND, 'Issue two'),
    ]
    mount()
    expect(within(linkFor('Issue one')).getByText('Archived')).toBeTruthy()
    expect(within(linkFor('Issue two')).queryByText('Archived')).toBeNull()
  })

  it('a DM in Open work has the ✕ too, and it takes the DM off by its person', () => {
    desk.openWork = [{ id: 'ow_dm_dm-2', kind: 'dm', dmId: 'dm-2', name: 'Bo' }]
    mount()
    fireEvent.click(left().getByRole('button', { name: 'Remove from list: Bo' }))
    expect(openWork.removeDm).toHaveBeenCalledWith('dm-2')
  })

  it('only Open work has the ✕: a starred row has none', () => {
    mount()
    expect(left().queryByRole('button', { name: 'Remove from list: Ana' })).toBeNull()
    expect(left().getByRole('button', { name: 'Remove from list: Issue one' })).toBeTruthy()
  })

  it('the open file is the current row', () => {
    mount(deskWith(ISSUE))
    expect(linkFor('Issue one').getAttribute('aria-current')).toBe('page')
    expect(linkFor('Ana').getAttribute('aria-current')).toBeNull()
  })
})
