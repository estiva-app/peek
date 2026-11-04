/*
  Starting a topic from Peek's Topics screen (TOP-9), as Folders' header does
  (FOL-41): the Folder is chosen in the dialog, and the new topic opens with
  Topics still lit — the column the rail reads from the page's state.
*/
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TopicsPage } from './TopicsPage'
import { TopicsColumn } from '@/components/views/TopicsColumn'
import { PeekSetup } from '@/lib/PeekSetup'
import { LastSelectionProvider } from '@/lib/lastSelection'
import { filePath } from '@/lib/objectUrl'

const PK = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const NEW_TOPIC = `30840:${PK}:4f6a8c2e-1b3d-4e5f-8a9b-0c1d2e3f4a5b`
const HQ = 'a1b2c3d4-0000-4000-8000-000000000001'
const TESTING = 'a1b2c3d4-0000-4000-8000-000000000002'

const created = vi.hoisted(() => ({
  topic: vi.fn<(args: Record<string, unknown>) => Promise<{ ok: true; address: string; naddr: string }>>(async () => ({ ok: true, address: '', naddr: 'naddr1new' })),
}))
const session = vi.hoisted(() => ({ signedOut: false }))
const column = vi.hoisted(() => ({ state: { mine: [], others: [], archived: [] } as unknown }))

vi.mock('@/api', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/api')),
  useTopicsColumn: () => ({ state: column.state, signedOut: session.signedOut }),
  useConversationBadges: () => ({ counts: {}, unread: {} }),
  useFolders: () => ({
    folders: [
      { id: HQ, name: 'Estiva HQ', hasState: true },
      { id: TESTING, name: 'For testing', hasState: true },
    ],
    signedOut: session.signedOut,
    failed: false,
    reload: async () => {},
  }),
  useForeignObjects: () => ({ createTopic: created.topic }),
}))
vi.mock('@/components/views/useFileControls', () => ({ useFileControls: () => ({ open: () => {}, dialogs: null }) }))
vi.mock('@/lib/toast', () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock('@/layouts/PeekFrame', () => ({
  PeekFrame: ({ leftPanel, rightPanel }: Record<string, React.ReactNode>) => (
    <div>
      {leftPanel}
      {rightPanel}
    </div>
  ),
}))

/** Where the page went, and which column it asked the rail to light. */
function Probe() {
  const location = useLocation()
  return <div data-testid="url">{`${location.pathname} ${(location.state as { column?: string } | null)?.column ?? '-'}`}</div>
}

function mount() {
  return render(
    <LastSelectionProvider>
      <MemoryRouter initialEntries={['/app/topics']}>
        <PeekSetup>
          <Routes>
            <Route path="/app/topics" element={<TopicsPage />} />
            <Route path="*" element={<Probe />} />
          </Routes>
        </PeekSetup>
      </MemoryRouter>
    </LastSelectionProvider>,
  )
}

describe('Topics starts a topic from its header (TOP-9)', () => {
  beforeEach(() => {
    session.signedOut = false
    column.state = { mine: [], others: [], archived: [] }
    created.topic.mockClear()
    created.topic.mockResolvedValue({ ok: true, address: NEW_TOPIC, naddr: 'naddr1new' })
  })

  it('starts it in the Folder chosen, and opens it with Topics lit', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: 'New topic' }))
    await user.click(screen.getByRole('combobox', { name: 'Team' }))
    await user.click(await screen.findByRole('option', { name: 'For testing' }))
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Launch plan')
    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(created.topic).toHaveBeenCalledWith(expect.objectContaining({ folder: TESTING, title: 'Launch plan', hasState: true }))
    await waitFor(() => expect(screen.getByTestId('url').textContent).toBe(`${filePath(NEW_TOPIC, 'Launch plan')} topics`))
  })

  it("beside an open topic, chooses that topic's Folder first", async () => {
    const user = userEvent.setup()
    const open = { ref: `30840:${PK}:open`, address: `30840:${PK}:open`, kind: 30840, folder: TESTING, slots: { title: { value: 'Widgets' } } }
    column.state = { mine: [{ topic: open, files: [], archivedFiles: [] }], others: [], archived: [] }
    render(
      <MemoryRouter>
        <PeekSetup>
          <TopicsColumn selectedRef={open.ref} />
        </PeekSetup>
      </MemoryRouter>,
    )
    await user.click(screen.getByRole('button', { name: 'New topic' }))
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Launch plan')
    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(created.topic).toHaveBeenCalledWith(expect.objectContaining({ folder: TESTING }))
  })

  it('offers no New topic to somebody signed out', () => {
    session.signedOut = true
    mount()
    expect(screen.getByText('Sign in to see topics.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'New topic' })).toBeNull()
  })
})
