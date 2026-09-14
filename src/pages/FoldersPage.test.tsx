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
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ForeignObject } from '@estiva-app/interop'
import { READ_DWELL_MS } from '@/api'
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
/*
  Which listed Folders are this Peek's own topics. Empty for the tests above;
  the last group sets one, because a topic's Folder is the one row the page
  must not offer to rename or delete.
*/
const TOPIC_CHANNEL = '3789d2ca-103c-40e5-906f-0490782db5fd'
const peekTopics = vi.hoisted(() => ({ list: [] as { id: string; title: string; folderId: string | null }[] }))
/*
  What the team-unread hook answers per Folder — FOL-18. The judging is unit
  tested in `teamUnread.test.ts`; here the question is only that a Folder row
  draws the dot it is told to, and no dot for a Folder it was told nothing about.
*/
const teamUnread = vi.hoisted(() => ({ unread: {} as Record<string, boolean> }))
/*
  The read-state writers, spied — FOL-16. What the page must do is mark the
  open file's own stream after a dwell, and what it must never do is mark the
  Folder's channel, so both are recorded and one is asserted absent.
*/
const marks = vi.hoisted(() => ({
  file: vi.fn<(address: string | null | undefined) => void>(),
  container: vi.fn<(kind: string, key: string) => void>(),
  thread: vi.fn<(key: string) => void>(),
}))
vi.mock('@/api', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/api')),
  useReadActions: () => ({
    markFileRead: marks.file,
    markContainerRead: marks.container,
    markThreadRead: marks.thread,
  }),
  useFolders: () => ({
    folders: [
      { id: FOLDER, name: 'Folders', hasState: true },
      { id: TOPIC_CHANNEL, name: 'For testing', hasState: false },
    ],
    signedOut: false,
    reload: async () => {},
  }),
  useTopics: () => peekTopics.list,
  useFolderContents: () => ({
    state: { id: FOLDER, name: 'Folders', hasState: true, source: 'state', files: relay.files },
    reload: async () => {},
  }),
  useForeignObjects: () => ({}),
  useForeignConversation: () => ({ state: 'loading', reload: async () => {} }),
  useForeignChildren: () => ({ state: [], reload: async () => {} }),
  useConversationBadges: () => ({ counts: {}, unread: {} }),
  useTeamUnread: () => ({ unread: teamUnread.unread }),
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
        {/* Where a topic's Folder leads: the probe alone, so the move can be read. */}
        <Route path="*" element={<Probe />} />
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

/*
  Reading one file's conversation reads that file — SPEC §11.1–§11.2, FOL-16.
  The Folder's channel is not advanced here, ever: a person reading one issue's
  talk has not read the team's general chat, and a sibling issue in the same
  Folder must stay exactly as unread as it was.
*/
describe('FoldersPage marks the open file read, and only the file', () => {
  beforeEach(() => {
    marks.file.mockClear()
    marks.container.mockClear()
    marks.thread.mockClear()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("advances the file's own address after the dwell, and never the Folder's channel", () => {
    relay.files = [topic]
    mount(`/folders/${FOLDER}?file=${encodeURIComponent(FILE_ADDRESS)}`)
    expect(marks.file).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(READ_DWELL_MS)
    })
    expect(marks.file).toHaveBeenCalledTimes(1)
    expect(marks.file).toHaveBeenCalledWith(FILE_ADDRESS)
    expect(marks.container).not.toHaveBeenCalled()
    expect(marks.thread).not.toHaveBeenCalled()
  })

  it('marks nothing when no pane is open — a listing is not a reading', () => {
    relay.files = [topic]
    mount(`/folders/${FOLDER}`)
    act(() => {
      vi.advanceTimersByTime(READ_DWELL_MS * 2)
    })
    expect(marks.file).not.toHaveBeenCalled()
    expect(marks.container).not.toHaveBeenCalled()
  })

  it('marks nothing when the pane closes before the dwell', () => {
    relay.files = [topic]
    mount(`/folders/${FOLDER}?file=${encodeURIComponent(FILE_ADDRESS)}`)
    // A plain DOM click: `userEvent` waits on real timers, which are faked here.
    fireEvent.click(screen.getByRole('button', { name: 'Close conversation' }))
    act(() => {
      vi.advanceTimersByTime(READ_DWELL_MS * 2)
    })
    expect(marks.file).not.toHaveBeenCalled()
  })
})

/*
  A topic's channel is its Folder, so every topic is in this list beside the
  Folders people made on purpose. Deleting one here reached only the relay:
  the topic stayed in Peek with every publish into it refused and none of its
  messages readable by pointer, and the dialog had promised nothing in the
  folder would be deleted. Fourteen topics went that way in the two days after
  the delete shipped. A topic's Folder is managed from the topic.
*/
describe('FoldersPage manages a topic’s Folder from the topic', () => {
  beforeEach(() => {
    peekTopics.list = [{ id: 'k1', title: 'For testing', folderId: TOPIC_CHANNEL }]
  })
  afterEach(() => {
    peekTopics.list = []
  })

  it('offers neither the delete nor the rename on a Folder that is a topic, and leads to the topic', async () => {
    mount(`/folders/${TOPIC_CHANNEL}`)
    expect(screen.queryByRole('button', { name: 'Delete folder' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit folder name' })).toBeNull()
    // The title is drawn, and drawn once: the list row and the header share it.
    expect(screen.getAllByText('For testing').length).toBeGreaterThan(0)
    await userEvent.click(screen.getByRole('button', { name: "Open this folder's topic" }))
    expect(screen.getByTestId('url').textContent).toBe(`/topic/for-testing-${TOPIC_CHANNEL}`)
  })

  it('still offers the delete and the rename on a Folder that is not a topic', () => {
    mount(`/folders/${FOLDER}`)
    expect(screen.getByRole('button', { name: 'Delete folder' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Edit folder name' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: "Open this folder's topic" })).toBeNull()
  })
})

/*
  SPEC §11.3, FOL-18: the dot on a Folder row is the union of its streams. The
  rule is `teamHasUnread`'s; what the page owes it is a dot on exactly the rows
  it says, and none on a row it did not judge — "not judged" is not "dark".
*/
describe('FoldersPage draws the union dot on a Folder row', () => {
  afterEach(() => {
    teamUnread.unread = {}
  })

  it('lights the Folder the hook says is unread, and only that one', () => {
    teamUnread.unread = { [FOLDER]: true, [TOPIC_CHANNEL]: false }
    const { container } = mount(`/folders/${TOPIC_CHANNEL}`)
    const lit = container.querySelectorAll('[data-unread]')
    expect(lit).toHaveLength(1)
    // The dot is the row's last child, so its parent is the row — and the row
    // named "Folders" is the one the hook lit, not the selected "For testing".
    expect(lit[0].parentElement?.textContent).toContain('Folders')
    expect(lit[0].parentElement?.textContent).not.toContain('For testing')
  })

  it('draws no dot for a Folder it was told nothing about', () => {
    teamUnread.unread = {}
    const { container } = mount(`/folders/${FOLDER}`)
    expect(container.querySelectorAll('[data-unread]')).toHaveLength(0)
  })
})
