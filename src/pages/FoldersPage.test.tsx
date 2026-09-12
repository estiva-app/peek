/**
 * A bare file's conversation is named by the URL — FOL-17.
 *
 * Before this, which file's pane was open lived only in component state, so
 * nothing outside the page could open one: Ship's Related card resolved to
 * `/o/<naddr>`, `ObjectPage` found the Folder, and the person landed on the
 * listing with the conversation closed. `?file=<address>` is the whole of the
 * fix on this side; the tests pin that the page reads it, writes it, and does
 * not invent a pane for a file it cannot see.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { ForeignObject } from '@estiva-app/interop'
import { FoldersPage } from './FoldersPage'

const FOLDER = '925897ad-796e-4bc6-999c-ca19df26c4aa'
const ADDRESS = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46:0f7d2c1e-2b0a-4a25-9a2a-1a2b3c4d5e6f'
const FILE_ADDRESS = `30840:${ADDRESS}`

const topic: ForeignObject = {
  ref: FILE_ADDRESS,
  address: FILE_ADDRESS,
  naddr: 'naddr1topic',
  eventId: 'e'.repeat(64),
  kind: 30840,
  widget: 'card',
  appName: 'File',
  slots: { title: { value: 'FOL-15 test topic 2' } },
  meta: [],
  comments: [],
  actions: [],
  viaRecommendation: false,
} as unknown as ForeignObject

/*
  The listing is the only thing that varies between tests, so it is the one
  hoisted knob. Everything else the page reads is pinned to the quietest
  answer it accepts: a signed-in reader, no counts, no directory, a
  conversation still loading.
*/
const relay = vi.hoisted(() => ({ files: [] as unknown[] }))
vi.mock('@/api', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/api')),
  useFolders: () => ({
    folders: [{ id: FOLDER, name: 'Folders', hasState: true }],
    signedOut: false,
    reload: async () => {},
  }),
  useFolderContents: () => ({
    state: { id: FOLDER, name: 'Folders', hasState: true, source: 'state', files: relay.files },
    reload: async () => {},
  }),
  useForeignObjects: () => ({}),
  useForeignConversation: () => ({ state: 'loading', reload: async () => {} }),
  useForeignChildren: () => ({ state: [], reload: async () => {} }),
  useConversationCounts: () => ({}),
  useWorkspaceDirectory: () => undefined,
  // The pane's view reads these before it looks at its state — the same two
  // seams `ForeignConversationView.test.tsx` stubs, for the same reason.
  useIsTopicResolved: () => () => false,
  useResolvedReferences: () => ({}),
}))
vi.mock('@/lib/toast', () => ({ useToast: () => ({ showToast: () => {} }) }))
// The frame mounts the rail, the top bar and the launcher, none of which is
// under test and all of which want providers. The three panels are what matter.
vi.mock('@/layouts/AppShell', () => ({
  AppShell: ({ leftPanel, rightPanel, threadPanel }: Record<string, React.ReactNode>) => (
    <div>
      {leftPanel}
      {rightPanel}
      {threadPanel}
    </div>
  ),
}))

function Probe() {
  const location = useLocation()
  return <output data-testid="url">{location.pathname + location.search}</output>
}

function mount(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/folders/:id" element={<><FoldersPage /><Probe /></>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('FoldersPage opens the file the URL names', () => {
  it('opens the conversation pane for a listed file named by ?file=', () => {
    // This is the leg Ship's card depends on: `/o/<naddr>` redirects here
    // with the address, and the pane has to be open on arrival.
    relay.files = [topic]
    mount(`/folders/${FOLDER}?file=${encodeURIComponent(FILE_ADDRESS)}`)
    expect(screen.getByRole('button', { name: 'Close conversation' })).toBeInTheDocument()
    expect(screen.getAllByText('FOL-15 test topic 2').length).toBeGreaterThan(0)
  })

  it('opens nothing without the parameter', () => {
    relay.files = [topic]
    mount(`/folders/${FOLDER}`)
    expect(screen.queryByRole('button', { name: 'Close conversation' })).not.toBeInTheDocument()
  })

  it('opens nothing for a file the listing does not hold', () => {
    // A link into a Folder the reader is in, to a file they cannot see — or
    // one since moved. The Folder is still the right place; the pane is not.
    relay.files = []
    mount(`/folders/${FOLDER}?file=${encodeURIComponent(FILE_ADDRESS)}`)
    expect(screen.queryByRole('button', { name: 'Close conversation' })).not.toBeInTheDocument()
  })

  it('closing the pane drops the parameter, so a reload stays closed', async () => {
    relay.files = [topic]
    mount(`/folders/${FOLDER}?file=${encodeURIComponent(FILE_ADDRESS)}`)
    await userEvent.click(screen.getByRole('button', { name: 'Close conversation' }))
    expect(screen.queryByRole('button', { name: 'Close conversation' })).not.toBeInTheDocument()
    expect(screen.getByTestId('url')).toHaveTextContent(`/folders/${FOLDER}`)
    expect(screen.getByTestId('url')).not.toHaveTextContent('file=')
  })
})
