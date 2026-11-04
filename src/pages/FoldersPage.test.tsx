/**
 * `/app/folders`, `/app/folders/:id` and `/app/folders/:id/chat` — the Teams
 * column with no file open (TEA-5: a Folder with state is a team; its link
 * opens the team's page, where its ⋮ manages it, and `/chat` its chat). What
 * the route still decides for itself is pinned here: a team's page or chat,
 * old topic channels, DM channels, a stateless channel's Delete, and an
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
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ForeignObject } from '@estiva-app/interop'
import { FoldersPage } from './FoldersPage'
import { PeekSetup } from '@/lib/PeekSetup'
import { channelDestination } from '@/lib/legacyTopicLinks'
import { filePath } from '@/lib/objectUrl'
import { LastSelectionProvider, useLastSelection } from '@/lib/lastSelection'

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
/* A Ship project's channel, listed in its team, and the project it belongs to (5 October). */
const PROJECT_CHANNEL = 'dddddddd-0000-4000-8000-000000000000'
const SHIP_PROJECT = `30850:${'e'.repeat(64)}:launch`
const projects = vi.hoisted(() => ({ resolve: vi.fn<(folder: string) => Promise<unknown>>(async () => null) }))
// PEE-42: a listing read that failed hands back `[]`, which is not "no Folders".
const listing = vi.hoisted(() => ({ failed: false }))
const deletable = vi.hoisted(() => ({
  check: vi.fn(async (uuid: string) =>
    uuid === 'bbbbbbbb-0000-4000-8000-000000000000'
      ? { ok: true as const }
      : { ok: false as const, reason: "This is a Ship project's folder." },
  ),
}))
/*
  The teams (TEA-5): a Folder with state is a team, and its link opens the
  team's page. Who is in which is the one knob; `null` is still being read.
*/
const teamsRead = vi.hoisted(() => ({ teams: null as unknown[] | null, failed: false }))
const teamOf = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  name,
  archived: false,
  company: false,
  admins: [],
  members: [],
  isMember: false,
  isFollowing: false,
  listed: [],
  chat: 'never',
  ...over,
})
/* What the team's page lists among its places: topics this reader can read, by address. */
const places = vi.hoisted(() => ({ topics: [] as unknown[] }))
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
      { id: PROJECT_CHANNEL, name: 'project-dddddddd', hasState: false, listedIn: [FOLDER] },
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
    resolveFolderProject: projects.resolve,
  }),
  useForeignChildren: () => ({ state: [], reload: async () => {} }),
  useConversationBadges: () => ({ counts: {}, unread: {} }),
  useWorkspaceDirectory: () => undefined,
  useMembership: () => ({ isMember: () => false, setMember: async () => {} }),
  useCurrentUser: () => ({ id: viewer.me, name: 'Me' }),
  // The pane's view reads these before it looks at its state — the same two
  // seams `ForeignConversationView.test.tsx` stubs, for the same reason.
  useResolvedReferences: () => ({}),
  useTeams: () => ({ teams: teamsRead.teams, failed: teamsRead.failed }),
  // The team page's writes are `TeamPage.test.tsx`'s; here they are never pressed.
  usePeekActions: () => ({}),
  useMentionNames: () => [],
  useTopicsColumn: () => ({ state: { mine: [], others: places.topics }, signedOut: false }),
  useTeamFiles: () => ({ files: [], failed: false }),
}))
/*
  The column's Teams view and the team's chat, as what they were handed: their
  own rows and conversation are `TeamsColumn.test.tsx`'s and the chat's.
*/
vi.mock('@/components/views/TeamsColumn', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/components/views/TeamsColumn')),
  TeamsColumn: () => <div data-testid="teams-column" />,
}))
vi.mock('@/components/views/TeamChat', () => ({
  TeamChat: ({ team }: { team: { name: string } }) => <div data-testid="team-chat">{team.name}</div>,
}))
vi.mock('@/lib/toast', () => ({ useToast: () => ({ showToast: () => {} }) }))
// The frame mounts the rail, the top bar and the launcher, none of which is
// under test and all of which want providers. The three panels are what matter.
vi.mock('@/layouts/PeekFrame', () => ({
  PeekFrame: ({ leftPanel, rightPanel, threadPanel }: Record<string, React.ReactNode>) => (
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
  window.sessionStorage.clear()
  teamsRead.teams = [teamOf(FOLDER, 'Folders'), teamOf(TOPIC_CHANNEL, 'For testing')]
  teamsRead.failed = false
  places.topics = []
})
afterEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  viewer.admins.splice(0)
})

/** The column's title: the view, and the button that opens the views' menu. */
const title = (name: string) => screen.getAllByRole('button', { name }).find((button) => button.getAttribute('aria-haspopup') === 'menu')!
/** The team page's ⋮, opened, once the page has drawn. */
async function teamMenu() {
  await userEvent.click(await screen.findByRole('button', { name: 'More' }))
}

/** Where the rail's Topics would lead now. */
function Remembered() {
  const { foldersPath } = useLastSelection()
  return <output data-testid="folders-path">{foldersPath ?? ''}</output>
}

function mount(url: string) {
  return render(
    <LastSelectionProvider>
      <MemoryRouter initialEntries={[url]}>
        {/* Peek's router handed to every kit link, as main.tsx does: a tree row's click changes page through it. */}
        <PeekSetup>
        <Routes>
          <Route path="/app/folders" element={<><FoldersPage /><Probe /></>} />
          <Route path="/app/folders/:id" element={<><FoldersPage /><Probe /></>} />
          <Route path="/app/folders/:id/chat" element={<><FoldersPage chat /><Probe /></>} />
          {/* Where a topic's Folder leads: the probe alone, so the move can be read. */}
          <Route path="*" element={<Probe />} />
        </Routes>
        </PeekSetup>
        <Remembered />
      </MemoryRouter>
    </LastSelectionProvider>,
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

  it("a team's link opens the column on Teams and the team's page beside it, where a place leads to the file's own page", async () => {
    teamsRead.teams = [teamOf(FOLDER, 'Folders', { listed: [{ address: FILE_ADDRESS, space: false }] })]
    places.topics = [topic]
    mount(`/app/folders/${FOLDER}`)
    expect(title('Teams')).toBeTruthy()
    expect(await screen.findByText(/^Members · /)).toBeTruthy()
    expect(screen.queryByText('No file selected')).toBeNull()
    await userEvent.click(screen.getByText('FOL-15 test topic 2'))
    // A bare file's link is its short form (FOL-37): the slug and the d.
    expect(screen.getByTestId('url').textContent).toBe('/topic/fol-15-test-topic-2-0f7d2c1e-2b0a-4a25-9a2a-1a2b3c4d5e6f')
  })

  it('names the open team in the browser tab, and leaving it does not leave its name behind (SFX-2)', async () => {
    teamsRead.teams = [teamOf(FOLDER, 'Folders', { listed: [{ address: FILE_ADDRESS, space: false }] })]
    places.topics = [topic]
    // A channel drawn as a Folder page with no project (FOL-9): the tab names it as its heading does.
    mount(`/app/folders/${RECORD_CHANNEL}`)
    await waitFor(() => expect(document.title).toBe('project-0804b906 – Peek'))
    cleanup()
    mount(`/app/folders/${FOLDER}`)
    await waitFor(() => expect(document.title).toBe('Folders – Peek'))
    await userEvent.click(await screen.findByText('FOL-15 test topic 2'))
    expect(document.title).toBe('Peek')
  })

  it('with no team open, draws no pane of its own and no cards: the right side waits for a file', () => {
    mount('/app/folders')
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

})

// SPEC §3.2: every reader ignores an archive from anybody but the Folder's owners and admins (MAN-17).
// The relay refuses a rename (`kind:9002`) from the same people, so it is not offered to them either.
describe("a team's page offers the team's own actions, in its ⋮, to who may take them (TEA-5)", () => {
  it('Start a topic to anyone; Rename and Archive… only to its owners and admins', async () => {
    const { unmount } = mount(`/app/folders/${FOLDER}`)
    await teamMenu()
    expect(await screen.findByRole('menuitem', { name: 'Start a topic' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Rename' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Archive…' })).toBeNull()
    unmount()

    viewer.admins.push(viewer.me)
    mount(`/app/folders/${FOLDER}`)
    await teamMenu()
    expect(await screen.findByRole('menuitem', { name: 'Rename' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Archive…' })).toBeTruthy()
  })

  it('never Delete on a team, and never asks the relay about one (FOL-9)', async () => {
    viewer.admins.push(viewer.me)
    mount(`/app/folders/${FOLDER}`)
    await teamMenu()
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
describe('the rail’s memory of Folders (Katerina, 5 October; TOP-4)', () => {
  it('the Folders page with no file open is where the rail comes back to: a closed file is not brought back', () => {
    mount('/app/folders')
    expect(screen.getByTestId('folders-path').textContent).toBe('/app/folders')
  })
})

describe('a stateless channel’s link (5 October)', () => {
  it('a Ship project’s channel opens the project, to be drawn open under its Folder', async () => {
    projects.resolve.mockResolvedValueOnce({ project: { address: SHIP_PROJECT, slots: { title: { value: 'Launch' } } } })
    mount(`/app/folders/${PROJECT_CHANNEL}`)
    // On its way there the tab never names the channel's machine id (SFX-2 review).
    expect(document.title).toBe('Peek')
    await waitFor(() => expect(screen.getByTestId('url').textContent).toBe(filePath(SHIP_PROJECT, 'Launch')))
    expect(projects.resolve).toHaveBeenCalledWith(PROJECT_CHANNEL)
  })

  it('a channel with no project lists what it holds, not a sentence about folder state', async () => {
    mount(`/app/folders/${BARE_CHANNEL}`)
    expect(await screen.findByText('Nothing in this folder yet.')).toBeTruthy()
    expect(screen.queryByText(/no folder state/)).toBeNull()
  })
})

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
  A team's link and its chat's (TEA-5): `/app/folders/<id>` is the team's
  page, `/app/folders/<id>/chat` its chat, which is a member's.
*/
describe("a team's page and its chat, at their own links (TEA-5)", () => {
  it('the chat’s link opens the chat for a member of the team', async () => {
    teamsRead.teams = [teamOf(FOLDER, 'Folders', { isMember: true })]
    mount(`/app/folders/${FOLDER}/chat`)
    expect((await screen.findByTestId('team-chat')).textContent).toBe('Folders')
    expect(screen.queryByText(/^Members · /)).toBeNull()
  })

  it('the chat’s link says to join, to anyone not in the team, and draws no chat', async () => {
    teamsRead.teams = [teamOf(FOLDER, 'Folders', { isFollowing: true })]
    mount(`/app/folders/${FOLDER}/chat`)
    expect(await screen.findByText('Join Folders to read its chat.')).toBeTruthy()
    expect(screen.queryByTestId('team-chat')).toBeNull()
  })

  it('draws a skeleton while the teams are read, and neither the page nor No file selected', async () => {
    teamsRead.teams = null
    mount(`/app/folders/${FOLDER}`)
    await waitFor(() => expect(dms.forChannel).toHaveBeenCalledWith(FOLDER))
    await waitFor(() => expect(document.querySelector('.animate-skeleton-in')).not.toBeNull())
    expect(screen.queryByText(/^Members · /)).toBeNull()
    expect(screen.queryByText('No file selected')).toBeNull()
  })

  it('says the team could not be read when the read failed, rather than waiting for ever', async () => {
    teamsRead.teams = null
    teamsRead.failed = true
    mount(`/app/folders/${FOLDER}`)
    expect(await screen.findByText('This team could not be read.')).toBeTruthy()
    expect(document.querySelector('.animate-skeleton-in')).toBeNull()
  })
})

describe('FoldersPage makes a Folder from its name, in Teams', () => {
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
    expect(created.topic).toHaveBeenCalledWith(expect.objectContaining({ folder: FOLDER, title: 'Launch plan', hasState: true }))
  })

  it('starts it in the Folder that was chosen', async () => {
    const user = userEvent.setup()
    mount(`/app/folders/${FOLDER}`)
    await user.click(screen.getByRole('button', { name: 'New topic' }))
    await user.click(screen.getByRole('combobox', { name: 'Folder' }))
    await user.click(await screen.findByRole('option', { name: 'For testing' }))
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Launch plan')
    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(created.topic).toHaveBeenCalledWith(expect.objectContaining({ folder: TOPIC_CHANNEL, title: 'Launch plan', hasState: true }))
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
