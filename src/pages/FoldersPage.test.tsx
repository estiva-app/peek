/**
 * `/app/folders` and `/app/folders/:id` — the Topics column with no file open
 * (Katerina, 5 October: the Folders page and its cards went; a Folder is
 * managed from its heading's ⋮, and a Folder's link opens the column on
 * Folders with it open). What the route still decides for itself is pinned
 * here: old topic channels, DM channels, a stateless channel's Delete, and an
 * archived Folder's notice.
 *
 * A file's conversation is a page, and this one is a way to it — FOL-19.
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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ForeignObject } from '@estiva-app/interop'
import { FoldersPage } from './FoldersPage'
import { channelDestination } from '@/lib/legacyTopicLinks'

const FOLDER = 'e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b'
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
  A file and a topic started under it (SPEC §6.7) — the pair the filter's
  "parents of a match are drawn" needs: `peersOf` hides the child at the top
  level, and `listedChildrenOf` puts it back under its parent.
*/
const PARENT_ADDRESS = `30850:${ADDRESS.split(':')[0]}:1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d`
const CHILD_ADDRESS = `30840:${ADDRESS.split(':')[0]}:2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e`
const parent = {
  ...topic,
  ref: PARENT_ADDRESS,
  address: PARENT_ADDRESS,
  kind: 30850,
  appName: 'Estiva Ship',
  slots: { title: { value: 'A parent project' } },
} as unknown as ForeignObject
const child = {
  ...topic,
  ref: CHILD_ADDRESS,
  address: CHILD_ADDRESS,
  parentRef: PARENT_ADDRESS,
  slots: { title: { value: 'A child topic' } },
} as unknown as ForeignObject

/*
  The listing is the only thing that varies between tests, so it is the one
  hoisted knob. Everything else the page reads is pinned to the quietest
  answer it accepts: a signed-in reader, no counts, no directory, a
  conversation still loading.
*/
const relay = vi.hoisted(() => ({ files: [] as unknown[] }))
/*
  A listed Folder that was one of Peek's topics — *For testing*, from the
  bundled table (FOL-26) — because a topic's Folder is the one row the page must
  not offer to rename or delete.
*/
const TOPIC_CHANNEL = '3789d2ca-103c-40e5-906f-0490782db5fd'
const RECORD_CHANNEL = '0804b906-1c2d-4e3f-8a5b-6c7d8e9f0a1b'
/*
  What the team-unread hook answers per Folder — FOL-18. The judging is unit
  tested in `teamUnread.test.ts`; here the question is only that a Folder row
  draws the dot it is told to, and no dot for a Folder it was told nothing about.
*/
const teamUnread = vi.hoisted(() => ({
  unread: {} as Record<string, boolean>,
  /* And which hold a stream the person is a member of — the other half of the same read (FOL-41). */
  member: {} as Record<string, boolean>,
}))
/* The per-row dots, keyed by `ref` — what the tree's own filter reads (FOL-41). */
const badges = vi.hoisted(() => ({ unread: {} as Record<string, boolean> }))
/* Who is signed in, and who the relay lists as the Folder's owners and admins (MAN-17). */
const viewer = vi.hoisted(() => ({ me: 'a'.repeat(64), admins: [] as string[] }))
/*
  Making a Folder — UIG-7. The row is the package Form: Enter in the name sends
  it. Refused here, so the page stays put and the test reads only the call.
*/
const created = vi.hoisted(() => ({
  folder: vi.fn(async (_name: string) => ({ ok: false as const, reason: 'Refused.' })),
  /*
    Starting a topic from the header (FOL-41) — a bare file on the relay, the
    same writer the folder pane's control uses. Refused, like the folder create
    above, so the page stays put and the test reads only what was asked for.
  */
  topic: vi.fn(async () => ({ ok: false as const, reason: 'Refused.' })),
}))
/*
  The read-state writers, spied — FOL-16. What the page must do is mark the
  open file's own stream after a dwell, and what it must never do is mark the
  Folder's channel, so both are recorded and one is asserted absent.
*/
/*
  Which channels are DMs — PEE-36. Stable across renders, as the seam's own
  callback is, so the page's check runs once per Folder.
*/
const DM_CHANNEL = 'cbdb84c1-f0f2-4eaf-b3d1-4c4509dfe09c'
const GROUP_DM_CHANNEL = 'aaaaaaaa-0000-4000-8000-000000000000'
const PARTNER = 'd'.repeat(64)
const dms = vi.hoisted(() => ({
  forChannel: vi.fn(async (uuid: string) =>
    uuid === 'cbdb84c1-f0f2-4eaf-b3d1-4c4509dfe09c'
      ? 'd'.repeat(64)
      : uuid === 'aaaaaaaa-0000-4000-8000-000000000000'
        ? 'not-a-person'
        : null,
  ),
}))
/*
  FOL-9: whether Delete may be offered, as the relay answered it. A bare channel
  with nothing in it says yes; a Ship record channel says no. Neither has state,
  so the page asks — it never asks about a Folder with state.
*/
const BARE_CHANNEL = 'bbbbbbbb-0000-4000-8000-000000000000'
// PEE-42: a listing read that failed hands back `[]`, which is not "no Folders".
const listing = vi.hoisted(() => ({ failed: false }))
const deletable = vi.hoisted(() => ({
  check: vi.fn(async (uuid: string) =>
    uuid === 'bbbbbbbb-0000-4000-8000-000000000000'
      ? { ok: true as const }
      : { ok: false as const, reason: "This is a Ship project's folder." },
  ),
}))
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
      { id: FOLDER, name: 'Folders', hasState: true, channel: `39000:${'f'.repeat(64)}:${FOLDER}`, admins: viewer.admins },
      { id: TOPIC_CHANNEL, name: 'For testing', hasState: true, admins: viewer.admins },
      // A Ship record channel: in the list the relay answers, never a section (PEE-31).
      { id: RECORD_CHANNEL, name: 'project-0804b906', hasState: false },
      // A bare channel: listed by its `39000`, with no state and no name.
      { id: BARE_CHANNEL, hasState: false },
    ].filter(() => !listing.failed),
    signedOut: false,
    failed: listing.failed,
    reload: async () => {},
  }),
  useFolderContents: (folder: string | undefined) => ({
    state:
      folder === BARE_CHANNEL || folder === RECORD_CHANNEL
        ? { id: folder, hasState: false, source: 'channel', files: [] }
        : { id: FOLDER, name: 'Folders', hasState: true, source: 'state', files: relay.files },
    reload: async () => {},
  }),
  useForeignObjects: () => ({
    createFolder: created.folder,
    createTopic: created.topic,
    dmForChannel: dms.forChannel,
    folderDeletable: deletable.check,
  }),
  useForeignChildren: () => ({ state: [], reload: async () => {} }),
  useConversationBadges: () => ({ counts: {}, unread: badges.unread }),
  useTeamUnread: () => ({ unread: teamUnread.unread, member: teamUnread.member }),
  useWorkspaceDirectory: () => undefined,
  useCurrentUser: () => ({ id: viewer.me, name: 'Me' }),
  // The pane's view reads these before it looks at its state — the same two
  // seams `ForeignConversationView.test.tsx` stubs, for the same reason.
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

beforeEach(() => {
  window.localStorage.clear()
})
afterEach(() => {
  window.localStorage.clear()
  viewer.admins.splice(0)
})

/** The column's title: the view, and the button that opens the views' menu (one Folder here is called Folders too). */
const title = (name: string) => screen.getAllByRole('button', { name }).find((button) => button.getAttribute('aria-haspopup') === 'menu' && !button.closest('[data-nav-group]'))!
/** A Folder heading's ⋮, opened. */
async function folderMenu(name: string) {
  await userEvent.click(screen.getByRole('button', { name: `More options for ${name}` }))
}

function mount(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/app/folders" element={<><FoldersPage /><Probe /></>} />
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

  it("a Folder's link opens the column on Folders, with it open, and a row leads to the file's own page", async () => {
    relay.files = [topic]
    mount(`/app/folders/${FOLDER}`)
    expect(title('Folders')).toBeTruthy()
    await userEvent.click(screen.getByText('FOL-15 test topic 2'))
    // A bare file's link is its short form (FOL-37): the slug and the d.
    expect(screen.getByTestId('url').textContent).toBe('/topic/fol-15-test-topic-2-0f7d2c1e-2b0a-4a25-9a2a-1a2b3c4d5e6f')
  })

  it('lists only Folders with state: a record channel is nobody\'s Folder (PEE-31)', () => {
    mount(`/app/folders/${FOLDER}`)
    const listed = [...document.querySelectorAll('[data-nav-group]')].map((node) => (node as HTMLElement).dataset.navGroup)
    expect(listed.sort()).toEqual([FOLDER, TOPIC_CHANNEL].sort())
    expect(screen.queryByText('project-0804b906')).toBeNull()
  })

  it('draws no pane of its own and no cards: the right side waits for a file', () => {
    relay.files = [topic]
    mount(`/app/folders/${FOLDER}`)
    expect(screen.getByText('No file selected')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Conversation/i })).toBeNull()
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
  A topic's channel is its Folder. Deleting or renaming one from the Folders
  page reached only the relay, and fourteen topics went that way (FOL-23). A
  topic's Folder is managed from where the topic went.
*/
describe('a Folder that was one of Peek’s topics', () => {
  it('its link leads to where the topic went', async () => {
    mount(`/app/folders/${TOPIC_CHANNEL}`)
    await waitFor(() => expect(screen.getByTestId('url').textContent).toBe(channelDestination(TOPIC_CHANNEL)))
  })

  it('its heading offers Start a topic only — never the rename or the archive, even to its admins', async () => {
    viewer.admins.push(viewer.me)
    mount(`/app/folders/${FOLDER}`)
    await folderMenu('For testing')
    expect(await screen.findByRole('menuitem', { name: 'Start a topic' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Rename' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Archive…' })).toBeNull()
  })
})

// SPEC §3.2: every reader ignores an archive from anybody but the Folder's owners and admins (MAN-17).
// The relay refuses a rename (`kind:9002`) from the same people, so it is not offered to them either.
describe("a Folder's heading offers its actions to who may take them", () => {
  it('Start a topic to anyone; Rename and Archive… only to its owners and admins', async () => {
    const { unmount } = mount(`/app/folders/${FOLDER}`)
    await folderMenu('Folders')
    expect(await screen.findByRole('menuitem', { name: 'Start a topic' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Rename' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Archive…' })).toBeNull()
    unmount()

    viewer.admins.push(viewer.me)
    mount(`/app/folders/${FOLDER}`)
    await folderMenu('Folders')
    expect(await screen.findByRole('menuitem', { name: 'Rename' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Archive…' })).toBeTruthy()
  })

  it('never Delete on a Folder with state, and never asks the relay about one (FOL-9)', async () => {
    viewer.admins.push(viewer.me)
    mount(`/app/folders/${FOLDER}`)
    await folderMenu('Folders')
    await screen.findByRole('menuitem', { name: 'Rename' })
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete folder' })).toBeNull()
    expect(deletable.check).not.toHaveBeenCalledWith(FOLDER)
  })
})

/*
  FOL-9: a `kind:9008` hides every event carrying the Folder's `h`, Ship issues
  included. A channel with no state is in no list, so its link is where it can
  be deleted — drawn only once the relay has said it holds nothing.
*/
describe('a stateless channel’s link offers Delete only where it loses nothing but the Folder', () => {
  it('offers it on an empty channel the relay says may go, and says what goes', async () => {
    mount(`/app/folders/${BARE_CHANNEL}`)
    await userEvent.click(await screen.findByRole('button', { name: 'Delete folder' }))
    expect(await screen.findByText(/every message in it disappear for everyone/)).toBeTruthy()
    expect(screen.queryByText(/not deleted/)).toBeNull()
  })

  it('does not offer it on a Ship record channel', async () => {
    mount(`/app/folders/${RECORD_CHANNEL}`)
    await waitFor(() => expect(deletable.check).toHaveBeenCalledWith(RECORD_CHANNEL))
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByRole('button', { name: 'Delete folder' })).toBeNull()
  })
})

/*
  PEE-36: a link to a DM message landed here by the message's `h`, and the page
  drew an empty Folder called "DM" with a Delete that would have hidden the
  conversation from both people.
*/
describe('FoldersPage never treats a DM channel as a Folder', () => {
  it('opens the viewer’s DM as the DM', async () => {
    mount(`/app/folders/${DM_CHANNEL}`)
    await waitFor(() => expect(screen.getByTestId('url').textContent).toBe(`/app/people/${PARTNER}`))
  })

  it('says a DM with no single partner is not a folder, and offers nothing on it', async () => {
    mount(`/app/folders/${GROUP_DM_CHANNEL}`)
    expect(await screen.findByText('This is not a folder.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Delete folder' })).toBeNull()
  })

  /*
    PEE-42: a DM the viewer is not in hides its `39000`, so the DM check says
    "not a DM". A channel the relay does not list as a Folder is not one.
  */
  it('says a channel the relay does not list is not a folder, and never shows its uuid', async () => {
    const unlisted = 'cccccccc-0000-4000-8000-000000000000'
    mount(`/app/folders/${unlisted}`)
    expect(await screen.findByText('This is not a folder.')).toBeTruthy()
    await waitFor(() => expect(dms.forChannel).toHaveBeenCalledWith(unlisted))
    expect(screen.queryByText(unlisted)).toBeNull()
    expect(screen.queryByRole('toolbar', { name: 'Folder actions' })).toBeNull()
  })

  it('does not call a Folder "not a folder" when the listing read failed', async () => {
    listing.failed = true
    try {
      mount(`/app/folders/${FOLDER}`)
      await waitFor(() => expect(dms.forChannel).toHaveBeenCalledWith(FOLDER))
      await new Promise((r) => setTimeout(r, 0))
      expect(screen.queryByText('This is not a folder.')).toBeNull()
    } finally {
      listing.failed = false
    }
  })
})

/*
  A Folder carries no unread mark (Miky, 2026-10-03; Katerina, 5 October):
  neither a dot nor bold. The union of its streams decides what Unread keeps.
*/
describe('FoldersPage draws no unread mark on a Folder', () => {
  afterEach(() => {
    teamUnread.unread = {}
  })

  it('draws none on a Folder the hook says is unread', () => {
    teamUnread.unread = { [FOLDER]: true, [TOPIC_CHANNEL]: true }
    const { container } = mount(`/app/folders/${FOLDER}`)
    expect(container.querySelectorAll('[data-nav-group] > div > div:first-child [data-unread]')).toHaveLength(0)
  })
})

describe('FoldersPage makes a Folder from its name, in Folders', () => {
  beforeEach(() => created.folder.mockClear())

  it('sends on Enter in the name, and not on Shift+Enter', async () => {
    const user = userEvent.setup()
    mount(`/app/folders/${FOLDER}`)
    await user.click(screen.getByRole('button', { name: 'New folder' }))
    const name = screen.getByRole('textbox', { name: 'Folder name' })
    await user.type(name, 'Launch notes{Shift>}{Enter}{/Shift}')
    expect(created.folder).not.toHaveBeenCalled()
    await user.type(name, '{Enter}')
    expect(created.folder).toHaveBeenCalledWith('Launch notes')
  })

  it('offers no New folder in Topics — a Folder is made where Folders are', () => {
    window.localStorage.setItem('peek.tree.view', 'mine')
    mount('/app/folders')
    expect(title('Topics')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'New folder' })).toBeNull()
  })
})

/*
  The header's filter and the two views — FOL-41, 5 October. What is judged is
  unit tested in `treeFilter.test.ts`; here the question is that the controls
  are wired to the column, and that the two verdicts come from the two maps.
*/
describe('FoldersPage filters the column', () => {
  beforeEach(() => {
    teamUnread.unread = {}
    teamUnread.member = {}
    badges.unread = {}
    relay.files = []
  })
  afterEach(() => {
    teamUnread.unread = {}
    teamUnread.member = {}
    badges.unread = {}
    relay.files = []
  })

  async function choose(label: string, url = `/app/folders/${FOLDER}`) {
    const user = userEvent.setup()
    const view = mount(url)
    await user.click(screen.getByRole('button', { name: 'Filter' }))
    await user.click(await screen.findByRole('menuitem', { name: label }))
    return view
  }

  it('shows every Folder in Folders until the filter says otherwise', () => {
    mount(`/app/folders/${FOLDER}`)
    expect(screen.getByRole('button', { name: 'For testing' })).toBeTruthy()
  })

  it('Unread keeps the Folders with a dot and drops the rest', async () => {
    teamUnread.unread = { [FOLDER]: true, [TOPIC_CHANNEL]: false }
    await choose('Unread')
    expect(screen.queryByRole('button', { name: 'For testing' })).toBeNull()
  })

  it('Unread drops a Folder it was told nothing about', async () => {
    teamUnread.unread = { [FOLDER]: true }
    await choose('Unread')
    expect(screen.queryByRole('button', { name: 'For testing' })).toBeNull()
  })

  it('Topics reads the other verdict, not the dots', async () => {
    // Lit, but nothing in it is the person's — the two questions are not the same one.
    teamUnread.unread = { [FOLDER]: true, [TOPIC_CHANNEL]: true }
    teamUnread.member = { [FOLDER]: false, [TOPIC_CHANNEL]: true }
    window.localStorage.setItem('peek.tree.view', 'mine')
    mount('/app/folders')
    expect(screen.getByRole('button', { name: 'For testing' })).toBeTruthy()
    expect(document.querySelector(`[data-nav-group="${FOLDER}"]`)).toBeNull()
  })

  it('says the filter is hiding them, not that there are none', async () => {
    window.localStorage.setItem('peek.tree.view', 'all')
    await choose('Unread', '/app/folders')
    expect(screen.getByText('Nothing unread.')).toBeTruthy()
  })

  /*
    The parents of a match are drawn (Miky, FOL-41). The parent row has no dot
    of its own and would be hidden on its own account; it survives because the
    child does, and it is expanded so the child is on screen without a click.
  */
  it('keeps and expands a row whose child is the match', async () => {
    relay.files = [parent, child]
    badges.unread = { [child.ref]: true }
    teamUnread.unread = { [FOLDER]: true }
    const { container } = await choose('Unread')
    expect(container.querySelector(`[data-file="${CSS.escape(parent.ref)}"]`)).toBeTruthy()
    expect(container.querySelector(`[data-file="${CSS.escape(child.ref)}"]`)).toBeTruthy()
  })

  it('drops the rows that hold no match', async () => {
    relay.files = [parent, child, topic]
    badges.unread = { [child.ref]: true }
    teamUnread.unread = { [FOLDER]: true }
    const { container } = await choose('Unread')
    const tree = container.querySelector(`[data-nav-group="${FOLDER}"]`)!
    expect(tree.querySelector(`[data-file="${CSS.escape(topic.ref)}"]`)).toBeNull()
    expect(tree.querySelector(`[data-file="${CSS.escape(parent.ref)}"]`)).toBeTruthy()
  })
})

/*
  Starting a topic from the header — FOL-41. The Folder is chosen here, so what
  is pinned is which Folder the write names, and that `hasState` came from that
  Folder's own summary.
*/
describe('FoldersPage starts a topic from the header', () => {
  beforeEach(() => created.topic.mockClear())

  it("starts it in the link's Folder by default", async () => {
    const user = userEvent.setup()
    mount(`/app/folders/${FOLDER}`)
    await user.click(screen.getByRole('button', { name: 'New topic' }))
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Launch plan')
    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(created.topic).toHaveBeenCalledWith({ folder: FOLDER, title: 'Launch plan', hasState: true })
  })

  it('starts it in the Folder that was chosen', async () => {
    const user = userEvent.setup()
    mount(`/app/folders/${FOLDER}`)
    await user.click(screen.getByRole('button', { name: 'New topic' }))
    await user.click(screen.getByRole('combobox', { name: 'Folder' }))
    await user.click(await screen.findByRole('option', { name: 'For testing' }))
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Launch plan')
    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(created.topic).toHaveBeenCalledWith({ folder: TOPIC_CHANNEL, title: 'Launch plan', hasState: true })
  })

  /*
    The record channel is not offered: `topLevelFolders` drops it — no folder
    state — and it is exactly the Folder a `kind:1852` must never be sent
    against.
  */
  it('offers only the Folders the tree draws', async () => {
    const user = userEvent.setup()
    mount(`/app/folders/${FOLDER}`)
    await user.click(screen.getByRole('button', { name: 'New topic' }))
    await user.click(screen.getByRole('combobox', { name: 'Folder' }))
    expect(await screen.findByRole('option', { name: 'For testing' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'project-0804b906' })).toBeNull()
  })
})
