/**
 * The left column under the rail's Teams — FOL-21, then TEA-5.
 *
 * Since TEA-5 the column has two views: Teams, which is `TeamsColumn` (its own
 * rows are pinned in `TeamsColumn.test.tsx`), and Archive, which is still the
 * Folder tree: every top-level Folder as a fold, the archived included, each
 * fold read when it opens. What this file pins is the column's own part: which
 * view it opens on, what it hands the teams column, the header, and that the
 * page beside it only ever shows a file the column draws.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FolderSummary, ForeignObject } from '@estiva-app/interop'
import { FolderTree } from './FolderTree'
import { PeekSetup } from '@/lib/PeekSetup'
import { ToastProvider } from '@/lib/toast'

const SHIP = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const CATH = 'a8a7d739dda599143ec2e88a1c3b2d69808cd2a50001179c786f51d00dc3c697'
const TEAM = '925897ad-796e-4bc6-999c-ca19df26c4aa'
const OTHER = '5d4c3b2a-1f0e-4d9c-8b7a-6e5f4d3c2b1a'
/** An old topic's channel, from the bundled table (FOL-26). */
const TOPIC_FOLDER = '2303e8c1-c866-43b8-9b4c-e263f313a683'
const PROJECT_ADDRESS = `30850:${SHIP}:0ebd5fdd-c58a-416e-b8a7-cbdcec77b77f`
const FILE_ADDRESS = `30840:${CATH}:7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f`

const foreign = (over: Partial<ForeignObject>): ForeignObject =>
  ({
    naddr: 'naddr1x',
    eventId: 'e'.repeat(64),
    widget: 'card',
    slots: {},
    meta: [],
    comments: [],
    actions: [],
    viaRecommendation: false,
    folder: TEAM,
    ...over,
  }) as unknown as ForeignObject

/** A Ship project in the team Folder: a row with a chevron. */
const project = foreign({
  ref: PROJECT_ADDRESS,
  address: PROJECT_ADDRESS,
  naddr: 'naddr1project',
  kind: 30850,
  appName: 'Estiva Ship',
  slots: { title: { value: 'Folders: navigation for the whole suite' } },
  listsChildren: true,
})

/** A Peek bare file beside it: a row with none. */
const file = foreign({
  ref: FILE_ADDRESS,
  address: FILE_ADDRESS,
  kind: 30840,
  appName: 'File',
  slots: { title: { value: 'FOL-15 test topic 2' } },
})

/** A topic placed in the team by address (FOL-22): a row in Peek, never a section. */
const PLACED = '9e1b7f3a-5c2d-4e8f-9a1b-2c3d4e5f6a7b'

/** A Ship project's record channel: in `listFolders`, nobody's Folder (PEE-31). */
const RECORD = '0804b906-1c2d-4e3f-8a5b-6c7d8e9f0a1b'

/**
 * The project's own channel, placed in the team — production's shape: a Ship
 * project's Folder is its `buzz-channel` and an issue's is the same one.
 */
const PROJECT_CHANNEL = '5b2e7c90-3d4a-4f1b-9c8e-7a6b5c4d3e2f'

// Archived by its admin: in no list but the Archive view's (5 October).
const ARCHIVED = '7f6e5d4c-3b2a-4190-8f7e-6d5c4b3a2918'

/** A project Cath deleted at `at`, in `team`; `restorable` when its app declares Delete as a change it can undo. */
function deletedProject(title: string, at: number, restorable: boolean, team = TEAM): ForeignObject {
  return foreign({
    ref: `30850:${SHIP}:${title}`,
    address: `30850:${SHIP}:${title}`,
    naddr: `naddr-${title}`,
    kind: 30850,
    folder: team,
    slots: { title: { value: title } },
    deleted: { by: CATH, at },
    people: { [CATH]: { displayName: 'Cath' } },
    actions: restorable ? [{ id: 'delete-project', label: 'Delete', control: 'select', field: 'deleted' }] : [],
  } as Partial<ForeignObject>)
}

const folders: FolderSummary[] = [
  // Its owners and admins may rename and archive it (SPEC §3.2); its channel is what an archive names.
  { id: OTHER, name: 'Zebra', hasState: true, admins: [CATH], channel: `39000:relay:${OTHER}` },
  { id: TEAM, name: 'Peek', hasState: true },
  { id: TOPIC_FOLDER, name: 'A topic of ours', hasState: true },
  { id: PLACED, name: 'Aardvark, placed', hasState: false, listedIn: [TEAM] },
  { id: RECORD, name: 'project-0804b906', hasState: false },
  { id: PROJECT_CHANNEL, name: 'project-5b2e7c90', hasState: false, listedIn: [TEAM] },
  { id: ARCHIVED, name: 'Old work', hasState: true, admins: [CATH], channel: `39000:relay:${ARCHIVED}`, archived: { by: CATH, at: 1 } },
]

const reads = vi.hoisted(() => ({
  contents: vi.fn<(folder: string | null | undefined, options?: { archived?: boolean }) => unknown>(),
  /** More rows in the team's listing, for one test. */
  extra: [] as ForeignObject[],
  /** Whether every deleted project was asked for: while Archive shows. */
  deleted: vi.fn<(enabled: boolean) => unknown>(),
  /** Every deleted project, newest deleted first, as the seam answers them. */
  deletedProjects: [] as ForeignObject[],
  /** Restore's answer; what it sends is `projectFieldsWrite.test.ts`'s. */
  restore: vi.fn(async () => ({ ok: true as const })),
  actual: {} as Record<string, unknown>,
}))
const viewer = vi.hoisted(() => ({ id: undefined as string | undefined }))

vi.mock('@/api', async () => ({
  ...(reads.actual = await vi.importActual<Record<string, unknown>>('@/api')),
  useForeignObjects: () => ({ ...(reads.actual.useForeignObjects as () => object)(), restoreFile: reads.restore }),
  useResolvedReferences: () => ({}),
  useFolders: () => ({ folders, signedOut: false, reload: async () => {} }),
  useFolderContents: (folder: string | null | undefined, options?: { archived?: boolean }) => {
    reads.contents(folder, options)
    return {
      state: folder
        ? { id: folder, name: 'Peek', hasState: true, source: 'state', files: folder === TEAM ? [project, file, ...reads.extra] : [] }
        : 'loading',
      reload: async () => {},
    }
  },
  useDeletedProjects: (enabled: boolean) => {
    reads.deleted(enabled)
    return { state: enabled ? reads.deletedProjects : 'loading', reload: async () => {} }
  },
  useForeignChildren: () => ({ state: [], reload: async () => {} }),
  useConversationBadges: () => ({ counts: {}, unread: {} }),
  useCurrentUser: () => (viewer.id ? { id: viewer.id } : undefined),
}))

/**
 * The Teams view's body, as what it was handed: its rows are
 * `TeamsColumn.test.tsx`'s, and here the question is only what the column
 * tells it.
 */
const teams = vi.hoisted(() => ({
  props: undefined as { show: string; selectedRef?: string; openTeam?: string | null; chatOpen?: boolean } | undefined,
}))
vi.mock('@/components/views/TeamsColumn', () => ({
  TeamsColumn: (props: { show: string; selectedRef?: string; openTeam?: string | null; chatOpen?: boolean }) => {
    teams.props = props
    return <div data-testid="teams-column" />
  },
}))

function Probe() {
  const location = useLocation()
  return <output data-testid="url">{location.pathname}</output>
}

function page(props: Parameters<typeof FolderTree>[0]) {
  return (
    <MemoryRouter initialEntries={['/topics']}>
      <Routes>
        {/* Peek's router given to every kit link, as main.tsx does: a row's plain click changes page through it. */}
        <Route path="*" element={<PeekSetup><ToastProvider><FolderTree {...props} /><Probe /></ToastProvider></PeekSetup>} />
      </Routes>
    </MemoryRouter>
  )
}

function mount(props: Parameters<typeof FolderTree>[0] = {}) {
  const view = render(page(props))
  return { ...view, rerender: (next: Parameters<typeof FolderTree>[0]) => view.rerender(page(next)) }
}

/** A group's open state: its heading's `aria-expanded`, as the package's section draws it. */
const openOf = (group: HTMLElement) => group.querySelector('[aria-expanded]')?.getAttribute('aria-expanded') ?? undefined
const section = (id: string) => document.querySelector(`[data-nav-group="${id}"]`) as HTMLElement
/** The column's title: the view, and the button that opens their menu. */
const title = (name: string) => screen.getByRole('button', { name })

beforeEach(() => {
  reads.contents.mockClear()
  reads.extra = []
  viewer.id = undefined
  teams.props = undefined
  window.localStorage.clear()
  window.sessionStorage.clear()
})
afterEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
})

describe('the Teams view (TEA-5)', () => {
  it('the column opens on Teams, which is the teams column and not the Folders as folds', () => {
    mount()
    expect(title('Teams')).not.toBeNull()
    expect(screen.getByTestId('teams-column')).not.toBeNull()
    expect(document.querySelector('[data-nav-group]')).toBeNull()
    // Nothing is read for a Folder's fold: there are none.
    expect(reads.contents.mock.calls.filter(([folder]) => folder)).toEqual([])
  })

  it('forgets a Joined an older Peek saved in this browser, rather than obeying it', () => {
    window.localStorage.setItem('peek.tree.view', 'mine')
    mount()
    expect(title('Teams')).not.toBeNull()
    expect(window.localStorage.getItem('peek.tree.view')).toBeNull()
  })

  it('its title menu offers Teams and Archive, and no Joined', async () => {
    mount()
    await userEvent.click(title('Teams'))
    const items = (await screen.findAllByRole('menuitem')).map((item) => item.textContent)
    expect(items).toEqual(['Teams', 'Archive'])
  })

  it('offers New folder and New topic in its header', () => {
    mount()
    expect(screen.getByRole('button', { name: 'New team' })).not.toBeNull()
    expect(screen.getByRole('button', { name: 'New topic' })).not.toBeNull()
  })

  it('the filter’s Unread reaches the teams column', async () => {
    mount()
    expect(teams.props?.show).toBe('all')
    await userEvent.click(screen.getByRole('button', { name: 'Filter' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Unread' }))
    expect(teams.props?.show).toBe('unread')
  })

  it('a Ship project opened by its channel opens the team that lists the channel (SID-2), with the file current', () => {
    mount({ currentFolder: PROJECT_CHANNEL, selectedRef: PROJECT_ADDRESS })
    expect(teams.props?.openTeam).toBe(TEAM)
    expect(teams.props?.selectedRef).toBe(PROJECT_ADDRESS)
  })

  it('the open team’s chat is current there, and only while it is the page', () => {
    const view = mount({ currentFolder: TEAM, chatOpen: true })
    expect(teams.props).toMatchObject({ openTeam: TEAM, chatOpen: true })
    view.rerender({ currentFolder: TEAM })
    expect(teams.props?.chatOpen).toBe(false)
  })

  it("a team's own link turns the column from Archive to Teams, where it is", () => {
    window.sessionStorage.setItem('peek.tree.visit', 'archive')
    mount({ currentFolder: OTHER, showFolder: true })
    expect(title('Teams')).not.toBeNull()
    expect(teams.props?.openTeam).toBe(OTHER)
  })
})

describe('the page only shows a file the column draws (Katerina, 5 October)', () => {
  const LIVE = { currentFolder: TEAM, selectedRef: FILE_ADDRESS, selectedArchived: false }
  const ARCHIVED_FILE = { ...LIVE, selectedArchived: true }

  it('an archived file that arrives turns the column to Archive, for this visit only', () => {
    mount(ARCHIVED_FILE)
    expect(title('Archive')).not.toBeNull()
    expect(window.localStorage.getItem('peek.tree.view')).toBeNull()
    expect(screen.getByTestId('url').textContent).toBe('/topics')
  })

  it('a deleted file that arrives turns the column to Archive, on its Deleted tab, and its row is current (ALO-6)', () => {
    reads.deletedProjects = [deletedProject('Roadmap', 2_000, true)]
    mount({ ...LIVE, selectedRef: reads.deletedProjects[0].ref, selectedDeleted: true })
    expect(title('Archive')).not.toBeNull()
    expect(screen.getByRole('tab', { name: /Deleted/ }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('link', { name: 'Roadmap' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByTestId('url').textContent).toBe('/topics')
  })

  it('a live file that arrives while Archive is showing turns the column back to Teams', () => {
    window.sessionStorage.setItem('peek.tree.visit', 'archive')
    mount(LIVE)
    expect(title('Teams')).not.toBeNull()
  })

  it('judges nothing while the file is still resolving', () => {
    window.sessionStorage.setItem('peek.tree.visit', 'archive')
    mount({ ...LIVE, selectedArchived: undefined })
    expect(title('Archive')).not.toBeNull()
    expect(screen.getByTestId('url').textContent).toBe('/topics')
  })

  it('a file archived while it is open closes: it left the list it was in', () => {
    const { rerender } = mount(LIVE)
    rerender(ARCHIVED_FILE)
    expect(screen.getByTestId('url').textContent).toBe('/app/teams')
  })

  it('a file unarchived while it is open in Archive stays open, and the column goes where it now is', () => {
    window.sessionStorage.setItem('peek.tree.visit', 'archive')
    const { rerender } = mount(ARCHIVED_FILE)
    expect(title('Archive')).not.toBeNull()
    rerender(LIVE)
    expect(screen.getByTestId('url').textContent).toBe('/topics')
    expect(title('Teams')).not.toBeNull()
  })

  it('in Archive, the open file’s Folder opens, and a Folder opened there stays open on the next page', () => {
    window.sessionStorage.setItem('peek.tree.visit', 'archive')
    const first = mount(ARCHIVED_FILE)
    expect(openOf(section(TEAM))).toBe('true')
    fireEvent.click(within(section(OTHER)).getByRole('button', { name: /Zebra/ }))
    expect(openOf(section(OTHER))).toBe('true')
    // The next page draws the column again.
    first.unmount()
    mount({ currentFolder: OTHER })
    expect(openOf(section(OTHER))).toBe('true')
  })
})

describe('the Archive view (Katerina, 5 October)', () => {
  it('is the title menu’s other view: every Folder, the archived too, each closed, and it makes nothing', async () => {
    mount()
    expect(section(ARCHIVED)).toBeNull()
    await userEvent.click(title('Teams'))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Archive' }))
    expect(title('Archive')).not.toBeNull()
    expect(section(ARCHIVED)).not.toBeNull()
    // The archived one says so beside its name; the others do not.
    expect(within(section(ARCHIVED)).getByText('Archived')).not.toBeNull()
    expect(within(section(OTHER)).queryByText('Archived')).toBeNull()
    expect(openOf(section(OTHER))).toBe('false')
    expect(screen.queryByRole('button', { name: 'New topic' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Filter' })).toBeNull()
    // Never saved: the next visit opens on Teams.
    expect(window.localStorage.getItem('peek.tree.view')).toBeNull()
  })

  it('switching to it closes the open file: the page says No file selected', async () => {
    mount({ currentFolder: TEAM, selectedRef: FILE_ADDRESS })
    await userEvent.click(title('Teams'))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Archive' }))
    expect(screen.getByTestId('url').textContent).toBe('/app/teams')
  })

  it('an archived file open in Archive closes when the column turns to Teams', async () => {
    window.sessionStorage.setItem('peek.tree.visit', 'archive')
    mount({ currentFolder: TEAM, selectedRef: FILE_ADDRESS, selectedArchived: true })
    await userEvent.click(title('Archive'))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Teams' }))
    expect(screen.getByTestId('url').textContent).toBe('/app/teams')
  })

  /*
    A file archived itself, or with a page above it, is read-only (SPEC §6.5,
    PEEKM-2): its row keeps what its page keeps, and nothing that changes it
    or adds a topic under it.
  */
  const archivedTopic = (archived: ForeignObject['archived']) =>
    foreign({
      ref: `30840:${CATH}:old-topic`,
      address: `30840:${CATH}:old-topic`,
      naddr: 'naddr1old',
      kind: 30840,
      slots: { title: { value: 'Old topic', field: 'title' } },
      parentField: 'parent',
      actions: [
        { id: 'rename', control: 'text', field: 'title' },
        { id: 'move', control: 'picker', field: 'parent' },
        { id: 'archive', control: 'toggle', field: 'archived' },
        { id: 'delete', control: 'confirm' },
      ],
      archived,
    } as unknown as Partial<ForeignObject>)
  const menuOf = async (name: string) => {
    window.sessionStorage.setItem('peek.tree.visit', 'archive')
    mount({ onControl: vi.fn() })
    fireEvent.click(within(section(TEAM)).getByRole('button', { name: /Peek/ }))
    await within(section(TEAM)).findByText(name)
    // The row's menu button sits beside its link, which carries `data-file`.
    const row = document.querySelector(`[data-file="30840:${CATH}:old-topic"]`)!.parentElement as HTMLElement
    await userEvent.click(within(row).getByRole('button', { name: 'More options' }))
    return screen.findAllByRole('menuitem').then((items) => items.map((item) => item.textContent))
  }

  it('an archived topic offers Unarchive and Delete, and no Rename, New topic inside, Move, Open work or Join', async () => {
    reads.extra = [archivedTopic({ by: CATH, at: 1 })]
    const items = await menuOf('Old topic')
    expect(items).toContain('Unarchive')
    expect(items).toContain('Delete')
    for (const gone of ['Rename', 'New topic inside', 'Move…', 'Add to Open work', 'Join']) expect(items).not.toContain(gone)
  })

  it('a topic archived with a page above it offers neither Unarchive nor anything that changes it', async () => {
    reads.extra = [archivedTopic({ by: CATH, at: 1, with: `30840:${CATH}:page-a` })]
    const items = await menuOf('Old topic')
    expect(items).toContain('Delete')
    for (const gone of ['Unarchive', 'Rename', 'New topic inside', 'Move…']) expect(items).not.toContain(gone)
  })
  it('its Deleted tab is one list of every deleted project, counted, each with its team, who and when, and Restore where declared (ALO-6)', async () => {
    reads.deletedProjects = [deletedProject('Roadmap', 2_000, true), deletedProject('Launch', 1_000, false, OTHER)]
    window.sessionStorage.setItem('peek.tree.visit', 'archive')
    mount()
    await userEvent.click(screen.getByRole('tab', { name: /Deleted/ }))
    expect(screen.getByRole('tab', { name: /Deleted/ }).textContent).toContain('2')

    const rows = screen.getAllByRole('listitem')
    expect(rows.map((row) => within(row).getByRole('link').textContent)).toEqual(['Roadmap', 'Launch'])
    expect(rows[0].textContent).toMatch(/Peek · Deleted by Cath · /)
    expect(rows[1].textContent).toMatch(/Zebra · Deleted by Cath · /)
    // Restore only on the project whose app declares its delete as a change it can undo.
    expect(within(rows[0]).getByRole('button', { name: 'Restore' })).not.toBeNull()
    expect(within(rows[1]).queryByRole('button', { name: 'Restore' })).toBeNull()
  })

  it('holds the Deleted tab for the visit, as it holds the teams opened there', async () => {
    reads.deletedProjects = [deletedProject('Roadmap', 2_000, true)]
    window.sessionStorage.setItem('peek.tree.visit', 'archive')
    const { unmount } = mount()
    await userEvent.click(screen.getByRole('tab', { name: /Deleted/ }))
    unmount()
    mount()
    expect(screen.getByRole('tab', { name: /Deleted/ }).getAttribute('aria-selected')).toBe('true')
  })

  it('Restore on the project that is open hands it back to the page to re-read, and no other (ALO-6)', async () => {
    reads.deletedProjects = [deletedProject('Roadmap', 2_000, true)]
    window.sessionStorage.setItem('peek.tree.visit', 'archive')
    const onRestored = vi.fn()
    mount({ selectedRef: `30850:${SHIP}:Roadmap`, selectedDeleted: true, onRestored })
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(onRestored).toHaveBeenCalledTimes(1))
    expect(onRestored.mock.calls[0][0].ref).toBe(`30850:${SHIP}:Roadmap`)

    reads.restore.mockResolvedValueOnce({ ok: false, reason: 'No.' } as never)
    onRestored.mockClear()
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(reads.restore).toHaveBeenCalledTimes(2))
    expect(onRestored).not.toHaveBeenCalled()
  })

  it('says so when nothing is deleted', async () => {
    reads.deletedProjects = []
    window.sessionStorage.setItem('peek.tree.visit', 'archive')
    mount()
    await userEvent.click(screen.getByRole('tab', { name: /Deleted/ }))
    expect(screen.getByText('Nothing deleted.')).not.toBeNull()
  })


  it('a Folder opened there reads what is archived in it', async () => {
    window.sessionStorage.setItem('peek.tree.visit', 'archive')
    mount()
    reads.contents.mockClear()
    fireEvent.click(within(section(OTHER)).getByRole('button', { name: /Zebra/ }))
    expect(reads.contents).toHaveBeenCalledWith(OTHER, expect.objectContaining({ archived: true }))
  })

  it('an archived Folder offers its admins Unarchive, and nothing else', async () => {
    viewer.id = CATH
    window.sessionStorage.setItem('peek.tree.visit', 'archive')
    mount()
    await userEvent.click(within(section(ARCHIVED)).getByRole('button', { name: 'More options for Old work' }))
    expect(await screen.findByRole('menuitem', { name: 'Unarchive' })).not.toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Start a topic' })).toBeNull()
    // A Folder that is not archived has no menu here.
    expect(within(section(OTHER)).queryByRole('button', { name: 'More options for Zebra' })).toBeNull()
  })

  it("an archived Folder's link opens Archive, with it open", () => {
    mount({ currentFolder: ARCHIVED, showFolder: true })
    expect(title('Archive')).not.toBeNull()
    expect(openOf(section(ARCHIVED))).toBe('true')
  })
})
