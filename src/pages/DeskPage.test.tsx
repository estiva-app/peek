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
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DebugProvider } from '@/lib/debug'
import { filePath } from '@/lib/objectUrl'
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
      body: address ? (
        <div data-testid="file-pane" data-address={address}>
          <textarea aria-label="Composer" />
        </div>
      ) : null,
      threadPanel: undefined,
    }
  },
}))
vi.mock('@/components/views/useDmConversationView', () => ({
  useDmConversationView: ({ dmId }: { dmId: string | null }) => ({
    rightPanel: dmId ? <div data-testid="dm-pane">{dmId}</div> : <div data-testid="nothing-open" />,
    threadPanel: undefined,
  }),
}))
const openWork = vi.hoisted(() => ({ remove: vi.fn() }))
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
  useDeskItems: () => ({
    openWork: [
      { id: 'ow-issue', kind: 'file', address: ISSUE, title: 'Issue one', object: { ref: ISSUE, kind: 30851 } },
    ],
    urgent: [],
  }),
  useScreenerItems: () => [],
  useConversationBadges: () => ({ counts: {}, unread: {} }),
  useOpenWorkFiles: () => ({ remove: openWork.remove, add: vi.fn(), has: () => true }),
  usePeekActions: () => ({ removeDmFromOpenWork: vi.fn() }),
}))
vi.mock('@/layouts/AppShell', () => ({
  AppShell: ({ leftPanel, rightPanel, threadPanel }: Record<string, React.ReactNode>) => (
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

function mount(url = '/app/desk') {
  return render(
    <DebugProvider>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/app/desk" element={<><DeskPage /><Probe /></>} />
          <Route path="*" element={<Probe />} />
        </Routes>
      </MemoryRouter>
    </DebugProvider>,
  )
}

const url = () => screen.getByTestId('url').textContent
const deskWith = (address: string) => `/app/desk?${new URLSearchParams({ open: address })}`

beforeEach(() => {
  pane.asked = []
  openWork.remove.mockClear()
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

  it('offers the full page as a link, which is the only way off the Desk', () => {
    mount(deskWith(WIDGETS_FILE))
    const link = screen.getByRole('link', { name: 'Open full page' })
    expect(link.getAttribute('href')).toBe(filePath(WIDGETS_FILE, 'Widgets'))
  })

  it('a DM closes the open file, and the file param goes with it', () => {
    mount(deskWith(WIDGETS_FILE))
    fireEvent.click(screen.getByText('Ana'))
    expect(url()).toBe('/app/desk')
    expect(screen.queryByTestId('file-pane')).toBeNull()
    expect(screen.getByTestId('dm-pane').textContent).toBe('dm-1')
    expect(pane.asked.at(-1)).toBeNull()
  })

  it('removing the open file from Open work closes it', () => {
    mount(deskWith(ISSUE))
    // The ✕ is drawn under the pointer only.
    fireEvent.mouseEnter(within(screen.getByTestId('left')).getByText('Issue one'))
    fireEvent.click(screen.getByRole('button', { name: 'Remove from list' }))
    expect(openWork.remove).toHaveBeenCalledWith(ISSUE)
    expect(url()).toBe('/app/desk')
  })
})
