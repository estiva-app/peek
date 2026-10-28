/**
 * The left column is the Folder tree — FOL-21.
 *
 * What the ticket's done-when promises, pinned at the seam: the Folders as
 * folds, only the current one open; a Folder's first level read when its fold
 * opens and never before; a row's children read when the row is expanded and
 * never before; no dot on a Folder, collapsed or open; and where a Folder and a
 * row lead. The relay's side of "one query on expand" is measured by
 * `scripts/probe-fol21-tree-cost.ts`, against production; this file proves
 * *when* the read is asked for, which no probe can.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FolderSummary, ForeignObject } from '@estiva-app/interop'
import { FolderTree, PENDING_MS } from './FolderTree'
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
  /** Folders whose read has not answered yet. */
  pending: new Set<string>(),
  contents: vi.fn<(folder: string | null | undefined, options?: { archived?: boolean }) => unknown>(),
  children: vi.fn<(naddr: string | null | undefined) => unknown>(),
  /** More rows in the team's listing, for one test. */
  extra: [] as ForeignObject[],
}))
const dots = vi.hoisted(() => ({ unread: {} as Record<string, boolean>, member: {} as Record<string, boolean> }))
const viewer = vi.hoisted(() => ({ id: undefined as string | undefined }))
/** Joined files no listing holds (an issue, under its project), for the Topics tests: by parent, and as read. */
const joined = vi.hoisted(() => ({
  under: {} as Record<string, string[]>,
  resolved: {} as Record<string, ForeignObject>,
}))

vi.mock('@/api', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/api')
  const useMembership = actual.useMembership as () => { isMember: (address: string) => boolean }
  return {
  ...actual,
  useMembership: () => {
    const membership = useMembership()
    return { ...membership, isMember: (address: string) => address in joined.resolved || membership.isMember(address) }
  },
  useResolvedReferences: (refs: readonly string[]) =>
    Object.fromEntries(refs.filter((ref) => ref in joined.resolved).map((ref) => [ref, joined.resolved[ref]])),
  useFolders: () => ({ folders, signedOut: false, reload: async () => {} }),
  useFolderContents: (folder: string | null | undefined, options?: { archived?: boolean }) => {
    reads.contents(folder, options)
    return {
      state: folder && !reads.pending.has(folder)
        ? { id: folder, name: 'Peek', hasState: true, source: 'state', files: folder === TEAM ? [project, file, ...reads.extra] : [] }
        : 'loading',
      reload: async () => {},
    }
  },
  useForeignChildren: (naddr: string | null | undefined) => {
    reads.children(naddr)
    return { state: [], reload: async () => {} }
  },
  useConversationBadges: () => ({ counts: {}, unread: {} }),
  useTeamUnread: () => ({
    unread: dots.unread,
    member: dots.member,
    holdsJoined: new Set(Object.keys(joined.under)),
    joinedUnder: joined.under,
  }),
  useCurrentUser: () => (viewer.id ? { id: viewer.id } : undefined),
  }
})

function Probe() {
  const location = useLocation()
  return <output data-testid="url">{location.pathname}</output>
}

function page(props: Parameters<typeof FolderTree>[0]) {
  return (
    <MemoryRouter initialEntries={['/topics']}>
      <Routes>
        <Route path="*" element={<><FolderTree {...props} /><Probe /></>} />
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
const fold = (name: string) => screen.getByRole('button', { name })

/** Folder ids `useFolderContents` was asked to read — `null` is "nothing". */
const contentsAsked = () => [...new Set(reads.contents.mock.calls.map(([folder]) => folder).filter(Boolean))]
const childrenAsked = () => [...new Set(reads.children.mock.calls.map(([naddr]) => naddr).filter(Boolean))]

beforeEach(() => {
  reads.pending.clear()
  reads.contents.mockClear()
  reads.children.mockClear()
  reads.extra = []
  dots.unread = {}
  dots.member = {}
  joined.under = {}
  joined.resolved = {}
  viewer.id = undefined
  window.localStorage.clear()
  // The tree's mechanics are the Folders view's — every Folder. Topics is `describe('The two views')`.
  window.localStorage.setItem('peek.tree.view', 'all')
})
afterEach(() => {
  window.localStorage.clear()
})

describe('the Folders, as folds', () => {
  it('lists the top-level Folders alphabetically, as a section each, and no topic list', () => {
    mount()
    const titles = [...document.querySelectorAll('[data-nav-group]')].map(
      (node) => within(node as HTMLElement).getAllByRole('button')[0].textContent,
    )
    expect(titles).toEqual(['A topic of ours', 'Peek', 'Zebra'])
    // A placed channel is a row in its team; a bare record channel is nobody's
    // section (PEE-31). Both are in `listFolders`, neither is navigation.
    expect(document.querySelector(`[data-nav-group="${PLACED}"]`)).toBeNull()
    expect(document.querySelector(`[data-nav-group="${RECORD}"]`)).toBeNull()
    expect(screen.queryByText('project-0804b906')).toBeNull()
    expect(screen.queryByText('Your topics')).toBeNull()
    expect(screen.queryByText('Other topics')).toBeNull()
  })

  it('a Folder another Folder lists is a row in that section, not a section of its own (FOL-22)', () => {
    mount()
    expect(section(PLACED)).toBeNull()
    expect(screen.queryByText('Aardvark, placed')).toBeNull()
  })

  it('opens only the Folder holding the page, and reads only that one — none before', () => {
    mount({ currentFolder: TEAM })
    expect(openOf(section(TEAM))).toBe('true')
    expect(openOf(section(OTHER))).toBe('false')
    expect(openOf(section(TOPIC_FOLDER))).toBe('false')
    // The first level of the open Folder is drawn, as rows.
    expect(section(TEAM).querySelector(`[data-file="${PROJECT_ADDRESS}"]`)).not.toBeNull()
    expect(section(TEAM).querySelector(`[data-file="${FILE_ADDRESS}"]`)).not.toBeNull()
    expect(document.querySelector('[data-card]')).toBeNull()
    // And it is the only Folder whose contents were asked for.
    expect(contentsAsked()).toEqual([TEAM])
  })

  it('opens nothing when no Folder is current', () => {
    mount()
    expect([...document.querySelectorAll('[data-nav-group]')].every((n) => openOf(n as HTMLElement) === 'false')).toBe(true)
    expect(contentsAsked()).toEqual([])
  })

  it("reads a Folder's first level when its fold opens, and remembers the fold", () => {
    mount()
    expect(contentsAsked()).toEqual([])
    fireEvent.click(fold('Zebra'))
    expect(openOf(section(OTHER))).toBe('true')
    expect(contentsAsked()).toEqual([OTHER])
    expect(window.localStorage.getItem(`peek.tree.folder.${OTHER}`)).toBe('open')
  })

  it('a fold the person opened stays open on the next mount, whatever is current', () => {
    window.localStorage.setItem(`peek.tree.folder.${OTHER}`, 'open')
    mount({ currentFolder: TEAM })
    expect(openOf(section(OTHER))).toBe('true')
    expect(openOf(section(TEAM))).toBe('true')
    expect(contentsAsked().sort()).toEqual([OTHER, TEAM].sort())
  })

  it("a fold the person closed stays closed even when it holds the page — the section's own ruling", () => {
    window.localStorage.setItem(`peek.tree.folder.${TEAM}`, 'closed')
    mount({ currentFolder: TEAM })
    expect(openOf(section(TEAM))).toBe('false')
    expect(contentsAsked()).toEqual([])
  })

  /*
    A Folder carries no dot, open or closed (Miky, 2026-10-03) — only its file
    rows do. The rows' badges are mocked empty here, so any dot in a section
    would be the Folder's own.
  */
  it('draws no dot on a Folder that holds something new, open or closed', () => {
    dots.unread = { [OTHER]: true, [TEAM]: true }
    mount({ currentFolder: TEAM })
    expect(openOf(section(TEAM))).toBe('true')
    expect(openOf(section(OTHER))).toBe('false')
    expect(section(OTHER).querySelector('[data-unread]')).toBeNull()
    expect(section(TEAM).querySelector('[data-unread]')).toBeNull()
  })
})

describe('the second level', () => {
  it("reads a row's children only after its chevron is clicked — one ask, none before", () => {
    mount({ currentFolder: TEAM })
    expect(childrenAsked()).toEqual([])
    const row = section(TEAM).querySelector(`[data-file="${PROJECT_ADDRESS}"]`) as HTMLElement
    fireEvent.click(within((row).parentElement!).getByRole('button', { name: /Show what is under/ }))
    expect(childrenAsked()).toEqual([project.naddr])
    expect(document.querySelector(`[data-children-of="${PROJECT_ADDRESS}"]`)).not.toBeNull()
  })

  it("expands the open file's parent row so the file is where the tree says it is", () => {
    mount({ currentFolder: TEAM, selectedParent: PROJECT_ADDRESS })
    expect(section(TEAM).querySelector(`[data-children-of="${PROJECT_ADDRESS}"]`)).not.toBeNull()
    expect(childrenAsked()).toEqual([project.naddr])
  })
})

/*
  Opened before its listing is in, a Folder stays shut with its arrow turned,
  then opens once with every row (OPT-11, Miky 12 October): a skeleton the
  rows replaced moved everything below it twice.
*/
describe('a Folder opened before its listing is in (OPT-11)', () => {
  const hidden = (node: Element | null) => !!node?.closest('[hidden]')

  it('says open and busy, draws nothing yet, and opens with every row when the listing lands', () => {
    reads.pending.add(TEAM)
    const { rerender } = mount()
    fireEvent.click(fold('Peek'))
    const heading = section(TEAM).querySelector('[aria-expanded]')!
    expect(heading.getAttribute('aria-expanded')).toBe('true')
    expect(heading.getAttribute('aria-busy')).toBe('true')
    expect(hidden(section(TEAM).querySelector('[data-loading]'))).toBe(true)

    reads.pending.delete(TEAM)
    rerender({})
    expect(heading.getAttribute('aria-busy')).toBeNull()
    expect(hidden(section(TEAM).querySelector(`[data-file="${FILE_ADDRESS}"]`))).toBe(false)
  })

  it('a read still out after PENDING_MS opens on the skeleton', () => {
    vi.useFakeTimers()
    try {
      reads.pending.add(TEAM)
      mount()
      fireEvent.click(fold('Peek'))
      act(() => vi.advanceTimersByTime(PENDING_MS))
      expect(section(TEAM).querySelector('[aria-expanded]')!.getAttribute('aria-busy')).toBeNull()
      expect(hidden(section(TEAM).querySelector('[data-loading]'))).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a Folder whose listing is already in opens at once, never busy', () => {
    mount()
    fireEvent.click(fold('Peek'))
    expect(section(TEAM).querySelector('[aria-expanded]')!.getAttribute('aria-busy')).toBeNull()
    expect(hidden(section(TEAM).querySelector(`[data-file="${FILE_ADDRESS}"]`))).toBe(false)
  })
})

describe('a Ship project opens in the team that lists its channel (SID-2)', () => {
  const channelListing = { id: PROJECT_CHANNEL, name: 'project-5b2e7c90', hasState: false, source: 'h', files: [project] }
  const teamListing = { id: TEAM, name: 'Peek', hasState: true, source: 'state', files: [project, file] }

  it('the team is current, reads its own listing, and opens the project row', () => {
    mount({ currentFolder: PROJECT_CHANNEL, selectedRef: PROJECT_ADDRESS, currentContents: channelListing as never })
    expect(openOf(section(TEAM))).toBe('true')
    // The page's read is the channel's; the team is not handed it.
    expect(contentsAsked()).toEqual([TEAM])
    expect(section(TEAM).querySelector(`[data-file="${FILE_ADDRESS}"]`)).not.toBeNull()
  })

  it('topic → project: the rows stay while the team reads its own listing', () => {
    const { rerender } = mount({ currentFolder: TEAM, selectedRef: FILE_ADDRESS, currentContents: teamListing as never })
    reads.pending.add(TEAM)
    rerender({ currentFolder: PROJECT_CHANNEL, selectedRef: PROJECT_ADDRESS, currentContents: channelListing as never })
    expect(openOf(section(TEAM))).toBe('true')
    expect(section(TEAM).querySelector(`[data-file="${FILE_ADDRESS}"]`)).not.toBeNull()
  })

  it('project → topic: the rows stay while the page reads the team', () => {
    const { rerender } = mount({ currentFolder: PROJECT_CHANNEL, selectedRef: PROJECT_ADDRESS, currentContents: channelListing as never })
    rerender({ currentFolder: TEAM, selectedRef: FILE_ADDRESS, currentContents: 'loading' })
    expect(section(TEAM).querySelector(`[data-file="${FILE_ADDRESS}"]`)).not.toBeNull()
  })
})

describe('where things lead', () => {
  it('a row opens the file at its address, in three panes', () => {
    mount({ currentFolder: TEAM })
    fireEvent.click(within(section(TEAM)).getByText('FOL-15 test topic 2'))
    // A bare file's link is its short form (FOL-37): the slug and the d.
    expect(screen.getByTestId('url').textContent).toBe('/topic/fol-15-test-topic-2-7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f')
  })

  it('a click on a Folder only folds it, and leads nowhere — the Folders page and its Open folder are gone (5 October)', () => {
    mount()
    expect(within(section(OTHER)).queryByRole('button', { name: 'Open folder' })).toBeNull()
    expect(openOf(section(OTHER))).toBe('false')
    fireEvent.click(fold('Zebra'))
    expect(openOf(section(OTHER))).toBe('true')
    expect(screen.getByTestId('url').textContent).toBe('/topics')
  })
})

describe('the two views (Katerina, 5 October)', () => {
  /** The column's title: the view, and the button that opens their menu. */
  const title = (name: string) => screen.getByRole('button', { name })

  it('opens on Topics: the Folders you are a member of something in, and the one holding the open file', () => {
    window.localStorage.removeItem('peek.tree.view')
    dots.member = { [TEAM]: true }
    mount({ currentFolder: OTHER })
    expect(title('Topics')).not.toBeNull()
    expect(section(TEAM)).not.toBeNull()
    // Not yours, but the open file is in it: where the tree says it is.
    expect(section(OTHER)).not.toBeNull()
    expect(section(TOPIC_FOLDER)).toBeNull()
  })

  it('an archived issue you joined is not in Topics; a live one beside it is (PEE-58)', () => {
    const ARCHIVED_ISSUE = `30851:${SHIP}:aa000000-0000-4000-8000-000000000001`
    const LIVE_ISSUE = `30851:${SHIP}:bb000000-0000-4000-8000-000000000002`
    const issue = (address: string, name: string, over: Partial<ForeignObject> = {}) =>
      foreign({ ref: address, address, kind: 30851, appName: 'Estiva Ship', slots: { title: { value: name } }, ...over })
    joined.under = { [PROJECT_ADDRESS]: [ARCHIVED_ISSUE, LIVE_ISSUE] }
    joined.resolved = {
      [ARCHIVED_ISSUE]: issue(ARCHIVED_ISSUE, 'Archived issue of mine', { archived: { by: SHIP, at: 1 } } as Partial<ForeignObject>),
      [LIVE_ISSUE]: issue(LIVE_ISSUE, 'Live issue of mine'),
    }
    dots.member = { [TEAM]: true }
    window.localStorage.setItem('peek.tree.view', 'mine')
    mount()
    expect(within(section(TEAM)).queryByText('Live issue of mine')).not.toBeNull()
    expect(within(section(TEAM)).queryByText('Archived issue of mine')).toBeNull()
  })

  it('a Folder closed in Topics stays closed when the column is drawn again, and only in Topics (PEE-74)', () => {
    window.localStorage.setItem('peek.tree.view', 'mine')
    dots.member = { [TEAM]: true, [OTHER]: true }
    const first = mount({ currentFolder: OTHER })
    expect(openOf(section(TEAM))).toBe('true')
    fireEvent.click(within(section(TEAM)).getAllByRole('button')[0])
    expect(openOf(section(TEAM))).toBe('false')
    // Leaving the file for Desk and coming back draws the column again.
    first.unmount()
    const again = mount({ currentFolder: OTHER })
    expect(openOf(section(TEAM))).toBe('false')
    expect(openOf(section(OTHER))).toBe('true')
    // Folders keeps its own folds: the one holding the open file is open there.
    again.unmount()
    window.localStorage.setItem('peek.tree.view', 'all')
    mount({ currentFolder: TEAM })
    expect(openOf(section(TEAM))).toBe('true')
  })

  it('the title opens a menu of the views, and the choice is remembered in this browser', async () => {
    window.localStorage.removeItem('peek.tree.view')
    mount()
    await userEvent.click(title('Topics'))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Folders' }))
    expect(title('Folders')).not.toBeNull()
    expect(window.localStorage.getItem('peek.tree.view')).toBe('all')
    expect(section(TOPIC_FOLDER)).not.toBeNull()
  })

  it('New folder is offered in Folders only — a Folder is made where Folders are; New topic in both', async () => {
    window.localStorage.setItem('peek.tree.view', 'mine')
    mount()
    expect(screen.queryByRole('button', { name: 'New folder' })).toBeNull()
    expect(screen.getByRole('button', { name: 'New topic' })).not.toBeNull()
    await userEvent.click(title('Topics'))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Folders' }))
    expect(screen.getByRole('button', { name: 'New folder' })).not.toBeNull()
  })

  it("a Folder's own link turns the column to Folders, where it is — for this visit, not saved", () => {
    window.localStorage.setItem('peek.tree.view', 'mine')
    mount({ currentFolder: OTHER, showFolder: true })
    expect(title('Folders')).not.toBeNull()
    expect(window.localStorage.getItem('peek.tree.view')).toBe('mine')
  })

  it("a Folder's own link opens it, though the person had closed it", () => {
    window.localStorage.setItem('peek.tree.view', 'all')
    window.localStorage.setItem(`peek.tree.folder.${OTHER}`, 'closed')
    mount({ currentFolder: OTHER, showFolder: true })
    expect(openOf(section(OTHER))).toBe('true')
  })

  it('in Folders each heading wears the folder icon; in Topics none does', async () => {
    window.localStorage.setItem('peek.tree.view', 'all')
    mount()
    expect(section(OTHER).querySelector('.tabler-icon-folder')).not.toBeNull()
    await userEvent.click(title('Folders'))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Topics' }))
    dots.member = {}
    expect(document.querySelector('.tabler-icon-folder')).toBeNull()
  })
})

describe('the page only shows a file the column draws (Katerina, 5 October)', () => {
  const title = (name: string) => screen.getByRole('button', { name })
  const LIVE = { currentFolder: TEAM, selectedRef: FILE_ADDRESS, selectedArchived: false, selectedMine: true }
  const ARCHIVED_FILE = { ...LIVE, selectedArchived: true }

  it('an archived file that arrives turns the column to Archive, for this visit only', () => {
    window.localStorage.setItem('peek.tree.view', 'mine')
    mount(ARCHIVED_FILE)
    expect(title('Archive')).not.toBeNull()
    expect(window.localStorage.getItem('peek.tree.view')).toBe('mine')
    expect(screen.getByTestId('url').textContent).toBe('/topics')
  })

  it('a live file that arrives while Archive is showing turns the column back to the person’s own view', () => {
    window.localStorage.setItem('peek.tree.view', 'all')
    window.sessionStorage.setItem('peek.tree.visit', 'archive')
    mount(LIVE)
    expect(title('Folders')).not.toBeNull()
  })

  it('judges nothing while the file is still resolving', () => {
    window.sessionStorage.setItem('peek.tree.visit', 'archive')
    mount({ ...LIVE, selectedArchived: undefined })
    expect(title('Archive')).not.toBeNull()
    expect(screen.getByTestId('url').textContent).toBe('/topics')
  })

  it('a file archived while it is open closes: it left the list it was in', () => {
    window.localStorage.setItem('peek.tree.view', 'mine')
    const { rerender } = mount(LIVE)
    rerender(ARCHIVED_FILE)
    expect(screen.getByTestId('url').textContent).toBe('/app/folders')
  })

  it('a file unarchived while it is open in Archive stays open, and the column goes where it now is', () => {
    window.localStorage.setItem('peek.tree.view', 'all')
    window.sessionStorage.setItem('peek.tree.visit', 'archive')
    const { rerender } = mount(ARCHIVED_FILE)
    expect(title('Archive')).not.toBeNull()
    rerender(LIVE)
    expect(screen.getByTestId('url').textContent).toBe('/topics')
    expect(title('Folders')).not.toBeNull()
  })

  it('a topic left while it is open in Topics leaves the list, and closes', () => {
    window.localStorage.setItem('peek.tree.view', 'mine')
    const { rerender } = mount(LIVE)
    rerender({ ...LIVE, selectedMine: false })
    expect(screen.getByTestId('url').textContent).toBe('/app/folders')
  })

  it('a file left while Folders is showing stays open: Folders draws every file', () => {
    window.localStorage.setItem('peek.tree.view', 'all')
    const { rerender } = mount(LIVE)
    rerender({ ...LIVE, selectedMine: false })
    expect(screen.getByTestId('url').textContent).toBe('/topics')
  })

  it('a file not joined, opened from a link, is shown in Topics where it is', () => {
    window.localStorage.setItem('peek.tree.view', 'mine')
    mount({ ...LIVE, selectedMine: false })
    expect(title('Topics')).not.toBeNull()
    expect(section(TEAM)).not.toBeNull()
    expect(screen.getByTestId('url').textContent).toBe('/topics')
  })

  it('the open file’s Folder opens though the person had closed it', () => {
    window.localStorage.setItem('peek.tree.view', 'all')
    window.localStorage.setItem(`peek.tree.folder.${TEAM}`, 'closed')
    mount(LIVE)
    expect(openOf(section(TEAM))).toBe('true')
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

describe('a project reached by its channel’s link (5 October)', () => {
  it('is selected and open, what is under it drawn', () => {
    window.localStorage.setItem('peek.tree.view', 'all')
    mount({ currentFolder: TEAM, selectedRef: PROJECT_ADDRESS, expandSelected: true })
    expect(document.querySelector(`[data-children-of="${CSS.escape(PROJECT_ADDRESS)}"]`)).not.toBeNull()
  })

  it('stays closed when opened any other way', () => {
    window.localStorage.setItem('peek.tree.view', 'all')
    mount({ currentFolder: TEAM, selectedRef: PROJECT_ADDRESS })
    expect(document.querySelector(`[data-children-of="${CSS.escape(PROJECT_ADDRESS)}"]`)).toBeNull()
  })
})

describe('the Archive view (Katerina, 5 October)', () => {
  const title = (name: string) => screen.getByRole('button', { name })

  it('is the title menu’s third view: every Folder, the archived too, each closed, and it makes nothing', async () => {
    window.localStorage.setItem('peek.tree.view', 'all')
    mount()
    expect(section(ARCHIVED)).toBeNull()
    await userEvent.click(title('Folders'))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Archive' }))
    expect(title('Archive')).not.toBeNull()
    expect(section(ARCHIVED)).not.toBeNull()
    // The archived one says so beside its name; the others do not.
    expect(within(section(ARCHIVED)).getByText('Archived')).not.toBeNull()
    expect(within(section(OTHER)).queryByText('Archived')).toBeNull()
    expect(openOf(section(OTHER))).toBe('false')
    expect(screen.queryByRole('button', { name: 'New topic' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Filter' })).toBeNull()
    // Never saved: the next visit opens on the person's own view.
    expect(window.localStorage.getItem('peek.tree.view')).toBe('all')
  })

  it('switching to it closes the open file: the page says No file selected', async () => {
    window.localStorage.setItem('peek.tree.view', 'all')
    mount({ currentFolder: TEAM, selectedRef: FILE_ADDRESS })
    await userEvent.click(title('Folders'))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Archive' }))
    expect(screen.getByTestId('url').textContent).toBe('/app/folders')
  })

  it('an archived file open in Archive closes when the column turns to Topics or Folders', async () => {
    window.sessionStorage.setItem('peek.tree.visit', 'archive')
    mount({ currentFolder: TEAM, selectedRef: FILE_ADDRESS, selectedArchived: true })
    await userEvent.click(title('Archive'))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Topics' }))
    expect(screen.getByTestId('url').textContent).toBe('/app/folders')
  })

  it('switching between Topics and Folders keeps the open file', async () => {
    window.localStorage.setItem('peek.tree.view', 'all')
    mount({ currentFolder: TEAM, selectedRef: FILE_ADDRESS })
    await userEvent.click(title('Folders'))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Topics' }))
    expect(screen.getByTestId('url').textContent).toBe('/topics')
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
    window.localStorage.setItem('peek.tree.view', 'mine')
    mount({ currentFolder: ARCHIVED, showFolder: true })
    expect(title('Archive')).not.toBeNull()
    expect(openOf(section(ARCHIVED))).toBe('true')
  })
})

describe("a Folder's own menu, on its heading", () => {
  it('offers Start a topic to anyone in it, and nothing they may not do', async () => {
    viewer.id = SHIP
    mount()
    await userEvent.click(within(section(OTHER)).getByRole('button', { name: 'More options for Zebra' }))
    expect(await screen.findByRole('menuitem', { name: 'Start a topic' })).not.toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Rename' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Archive…' })).toBeNull()
    // Every Folder the tree draws has state, and a Folder with state is never deleted (FOL-9).
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull()
  })

  it('offers Rename and Archive… to its owners and admins', async () => {
    viewer.id = CATH
    mount()
    await userEvent.click(within(section(OTHER)).getByRole('button', { name: 'More options for Zebra' }))
    expect(await screen.findByRole('menuitem', { name: 'Rename' })).not.toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Archive…' })).not.toBeNull()
  })

  it('Rename opens the dialog with the name in it', async () => {
    viewer.id = CATH
    // A dialog reports a refused write in a toast: the app's provider, as it has at its root.
    render(<ToastProvider>{page({})}</ToastProvider>)
    await userEvent.click(within(section(OTHER)).getByRole('button', { name: 'More options for Zebra' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }))
    expect(await screen.findByRole('dialog', { name: 'Rename folder' })).not.toBeNull()
    expect((screen.getByRole('textbox', { name: 'Folder name' }) as HTMLInputElement).value).toBe('Zebra')
  })
})
