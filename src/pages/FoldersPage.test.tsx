/**
 * A file's conversation is a page, and this one is the way to it — FOL-19.
 *
 * FOL-17 opened the conversation in a pane here, named by `?file=<address>`,
 * and the address had to be *in this listing* for the pane to find the object.
 * That was the limit: a Ship issue is its project's child, fetched from the
 * project's manifest when a row is expanded, and never a peer in the Folder —
 * so a link to one opened the Folder and nothing else. The pane is gone; a row
 * now leads to `/topic/<slug>-<d>` (FOL-37; `/topic/<address>` for another app's file), where the file is resolved on its own.
 *
 * The dwell tests that were here went with it, to `FilePage.test.tsx`: this
 * page marks nothing read, because a listing is not a reading.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
/*
  Which listed Folders are this Peek's own topics. Empty for the tests above;
  the last group sets one, because a topic's Folder is the one row the page
  must not offer to rename or delete.
*/
const TOPIC_CHANNEL = '3789d2ca-103c-40e5-906f-0490782db5fd'
const RECORD_CHANNEL = '0804b906-1c2d-4e3f-8a5b-6c7d8e9f0a1b'
const peekTopics = vi.hoisted(() => ({ list: [] as { id: string; title: string; folderId: string | null }[] }))
/*
  What the team-unread hook answers per Folder — FOL-18. The judging is unit
  tested in `teamUnread.test.ts`; here the question is only that a Folder row
  draws the dot it is told to, and no dot for a Folder it was told nothing about.
*/
const teamUnread = vi.hoisted(() => ({ unread: {} as Record<string, boolean> }))
/*
  Making a Folder — UIG-7. The row is the package Form: Enter in the name sends
  it. Refused here, so the page stays put and the test reads only the call.
*/
const created = vi.hoisted(() => ({ folder: vi.fn(async (_name: string) => ({ ok: false as const, reason: 'Refused.' })) }))
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
      { id: TOPIC_CHANNEL, name: 'For testing', hasState: true },
      // A Ship record channel: in the list the relay answers, never a section (PEE-31).
      { id: RECORD_CHANNEL, name: 'project-0804b906', hasState: false },
    ],
    signedOut: false,
    reload: async () => {},
  }),
  useTopics: () => peekTopics.list,
  useFolderContents: () => ({
    state: { id: FOLDER, name: 'Folders', hasState: true, source: 'state', files: relay.files },
    reload: async () => {},
  }),
  useForeignObjects: () => ({ createFolder: created.folder }),
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
        <Route path="/app/folders/:id" element={<><FoldersPage /><Probe /></>} />
        {/* Where a topic's Folder leads: the probe alone, so the move can be read. */}
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  )
}

/*
  The route this page hands off to — FOL-19, and the replacement for "a file
  the listing does not hold opens nothing". That assertion was true of the pane
  and is now false of the product: a file this listing does not hold is exactly
  what the route exists to open, which `FilePage.test.tsx` pins from the other
  side. What is left to check here is the handoff, and that nothing is read by
  looking at a list.
*/
describe('FoldersPage opens a file at its own address', () => {
  beforeEach(() => {
    marks.file.mockClear()
    marks.container.mockClear()
    marks.thread.mockClear()
  })

  it("a row's conversation control leads to the file's own page", async () => {
    relay.files = [topic]
    mount(`/app/folders/${FOLDER}`)
    await userEvent.click(screen.getByRole('button', { name: /Conversation/i }))
    /*
      The address, uncut and with its colons intact. A colon is a legal path
      character and `%3A` would make the one part of the URL carrying meaning
      unreadable — RFC 0.5 §7.3's objection to bech32 in URLs, arrived at from
      the other side.
    */
    // A bare file's link is its short form (FOL-37): the slug and the d.
    expect(screen.getByTestId('url').textContent).toBe('/topic/fol-15-test-topic-2-0f7d2c1e-2b0a-4a25-9a2a-1a2b3c4d5e6f')
  })

  it('lists only Folders with state: a record channel is nobody\'s Folder (PEE-31)', () => {
    mount(`/app/folders/${FOLDER}`)
    const listed = [...document.querySelectorAll('[data-tree-folder]')].map((node) => (node as HTMLElement).dataset.treeFolder)
    expect(listed.sort()).toEqual([FOLDER, TOPIC_CHANNEL].sort())
    expect(screen.queryByText('project-0804b906')).toBeNull()
  })

  it('opens no pane of its own — the conversation is a page now', () => {
    relay.files = [topic]
    mount(`/app/folders/${FOLDER}`)
    expect(screen.queryByRole('button', { name: 'Close conversation' })).toBeNull()
  })

  it('marks nothing read: a listing is not a reading', () => {
    relay.files = [topic]
    mount(`/app/folders/${FOLDER}`)
    expect(marks.file).not.toHaveBeenCalled()
    expect(marks.container).not.toHaveBeenCalled()
    expect(marks.thread).not.toHaveBeenCalled()
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
    mount(`/app/folders/${TOPIC_CHANNEL}`)
    expect(screen.queryByRole('button', { name: 'Delete folder' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit folder name' })).toBeNull()
    // The title is drawn, and drawn once: the list row and the header share it.
    expect(screen.getAllByText('For testing').length).toBeGreaterThan(0)
    // A real link (UIG-14, F3): the address is on it, and a plain click routes in place.
    const open = screen.getByRole('link', { name: "Open this folder's topic" })
    expect(open.getAttribute('href')).toBe(`/topic-old/for-testing-${TOPIC_CHANNEL}`)
    await userEvent.click(open)
    expect(screen.getByTestId('url').textContent).toBe(`/topic-old/for-testing-${TOPIC_CHANNEL}`)
  })

  it('still offers the delete and the rename on a Folder that is not a topic', () => {
    mount(`/app/folders/${FOLDER}`)
    expect(screen.getByRole('button', { name: 'Delete folder' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Edit folder name' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: "Open this folder's topic" })).toBeNull()
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
    const { container } = mount(`/app/folders/${TOPIC_CHANNEL}`)
    const lit = container.querySelectorAll('[data-unread]')
    expect(lit).toHaveLength(1)
    // The dot sits in its Folder's section header (FOL-21) — and the section
    // named "Folders" is the one the hook lit, not the open "For testing".
    const section = lit[0].closest('[data-tree-folder]') as HTMLElement
    expect(section.dataset.treeFolder).toBe(FOLDER)
    expect(section.textContent).toContain('Folders')
    expect(section.textContent).not.toContain('For testing')
  })

  it('draws no dot for a Folder it was told nothing about', () => {
    teamUnread.unread = {}
    const { container } = mount(`/app/folders/${FOLDER}`)
    expect(container.querySelectorAll('[data-unread]')).toHaveLength(0)
  })
})

describe('FoldersPage makes a Folder from its name', () => {
  beforeEach(() => created.folder.mockClear())

  it('sends on Enter in the name, and not on Shift+Enter', async () => {
    const user = userEvent.setup()
    mount(`/app/folders/${FOLDER}`)
    const name = screen.getByRole('textbox', { name: 'New folder name' })
    await user.type(name, 'Launch notes{Shift>}{Enter}{/Shift}')
    expect(created.folder).not.toHaveBeenCalled()
    await user.type(name, '{Enter}')
    expect(created.folder).toHaveBeenCalledWith('Launch notes')
  })
})
