/**
 * The left column is the Folder tree — FOL-21.
 *
 * What the ticket's done-when promises, pinned at the seam: the Folders as
 * folds, only the current one open; a Folder's first level read when its fold
 * opens and never before; a row's children read when the row is expanded and
 * never before; the union dot on a collapsed Folder; and where a Folder and a
 * row lead. The relay's side of "one query on expand" is measured by
 * `scripts/probe-fol21-tree-cost.ts`, against production; this file proves
 * *when* the read is asked for, which no probe can.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FolderSummary, ForeignObject } from '@estiva-app/interop'
import { FolderTree } from './FolderTree'
import { channelDestination } from '@/lib/legacyTopicLinks'

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

const folders: FolderSummary[] = [
  { id: OTHER, name: 'Zebra', hasState: true },
  { id: TEAM, name: 'Peek', hasState: true },
  { id: TOPIC_FOLDER, name: 'A topic of ours', hasState: true },
  { id: PLACED, name: 'Aardvark, placed', hasState: false, listedIn: [TEAM] },
  { id: RECORD, name: 'project-0804b906', hasState: false },
  { id: PROJECT_CHANNEL, name: 'project-5b2e7c90', hasState: false, listedIn: [TEAM] },
]

const reads = vi.hoisted(() => ({
  /** Folders whose read has not answered yet. */
  pending: new Set<string>(),
  contents: vi.fn<(folder: string | null | undefined) => unknown>(),
  children: vi.fn<(naddr: string | null | undefined) => unknown>(),
}))
const dots = vi.hoisted(() => ({ unread: {} as Record<string, boolean> }))

vi.mock('@/api', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/api')),
  useFolders: () => ({ folders, signedOut: false, reload: async () => {} }),
  useFolderContents: (folder: string | null | undefined) => {
    reads.contents(folder)
    return {
      state: folder && !reads.pending.has(folder)
        ? { id: folder, name: 'Peek', hasState: true, source: 'state', files: folder === TEAM ? [project, file] : [] }
        : 'loading',
      reload: async () => {},
    }
  },
  useForeignChildren: (naddr: string | null | undefined) => {
    reads.children(naddr)
    return { state: [], reload: async () => {} }
  },
  useConversationBadges: () => ({ counts: {}, unread: {} }),
  useTeamUnread: () => ({ unread: dots.unread }),
}))

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

const section = (id: string) => document.querySelector(`[data-tree-folder="${id}"]`) as HTMLElement
const fold = (name: string) => screen.getByRole('button', { name })

/** Folder ids `useFolderContents` was asked to read — `null` is "nothing". */
const contentsAsked = () => [...new Set(reads.contents.mock.calls.map(([folder]) => folder).filter(Boolean))]
const childrenAsked = () => [...new Set(reads.children.mock.calls.map(([naddr]) => naddr).filter(Boolean))]

beforeEach(() => {
  reads.pending.clear()
  reads.contents.mockClear()
  reads.children.mockClear()
  dots.unread = {}
  window.localStorage.clear()
})
afterEach(() => {
  window.localStorage.clear()
})

describe('the Folders, as folds', () => {
  it('lists the top-level Folders alphabetically, as a section each, and no topic list', () => {
    mount()
    const titles = [...document.querySelectorAll('[data-tree-folder]')].map(
      (node) => within(node as HTMLElement).getAllByRole('button')[0].textContent,
    )
    expect(titles).toEqual(['A topic of ours', 'Peek', 'Zebra'])
    // A placed channel is a row in its team; a bare record channel is nobody's
    // section (PEE-31). Both are in `listFolders`, neither is navigation.
    expect(document.querySelector(`[data-tree-folder="${PLACED}"]`)).toBeNull()
    expect(document.querySelector(`[data-tree-folder="${RECORD}"]`)).toBeNull()
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
    expect(section(TEAM).dataset.open).toBe('true')
    expect(section(OTHER).dataset.open).toBe('false')
    expect(section(TOPIC_FOLDER).dataset.open).toBe('false')
    // The first level of the open Folder is drawn, as rows.
    expect(section(TEAM).querySelector(`[data-file="${PROJECT_ADDRESS}"]`)).not.toBeNull()
    expect(section(TEAM).querySelector(`[data-file="${FILE_ADDRESS}"]`)).not.toBeNull()
    expect(document.querySelector('[data-foreign-object]')).toBeNull()
    // And it is the only Folder whose contents were asked for.
    expect(contentsAsked()).toEqual([TEAM])
  })

  it('opens nothing when no Folder is current', () => {
    mount()
    expect([...document.querySelectorAll('[data-tree-folder]')].every((n) => (n as HTMLElement).dataset.open === 'false')).toBe(true)
    expect(contentsAsked()).toEqual([])
  })

  it("reads a Folder's first level when its fold opens, and remembers the fold", () => {
    mount()
    expect(contentsAsked()).toEqual([])
    fireEvent.click(fold('Zebra'))
    expect(section(OTHER).dataset.open).toBe('true')
    expect(contentsAsked()).toEqual([OTHER])
    expect(window.localStorage.getItem(`peek.tree.folder.${OTHER}`)).toBe('open')
  })

  it('a fold the person opened stays open on the next mount, whatever is current', () => {
    window.localStorage.setItem(`peek.tree.folder.${OTHER}`, 'open')
    mount({ currentFolder: TEAM })
    expect(section(OTHER).dataset.open).toBe('true')
    expect(section(TEAM).dataset.open).toBe('true')
    expect(contentsAsked().sort()).toEqual([OTHER, TEAM].sort())
  })

  it("a fold the person closed stays closed even when it holds the page — the section's own ruling", () => {
    window.localStorage.setItem(`peek.tree.folder.${TEAM}`, 'closed')
    mount({ currentFolder: TEAM })
    expect(section(TEAM).dataset.open).toBe('false')
    expect(contentsAsked()).toEqual([])
  })

  it('draws the union dot on a Folder that has something new, open or closed', () => {
    dots.unread = { [OTHER]: true, [TEAM]: false }
    mount({ currentFolder: TEAM })
    expect(section(OTHER).querySelector('[data-unread]')).not.toBeNull()
    expect(section(TEAM).querySelector('[data-unread]')).toBeNull()
    // Unjudged is not unread.
    expect(section(TOPIC_FOLDER).querySelector('[data-unread]')).toBeNull()
  })
})

describe('the second level', () => {
  it("reads a row's children only after its chevron is clicked — one ask, none before", () => {
    mount({ currentFolder: TEAM })
    expect(childrenAsked()).toEqual([])
    const row = section(TEAM).querySelector(`[data-file="${PROJECT_ADDRESS}"]`) as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: /Show what is in/ }))
    expect(childrenAsked()).toEqual([project.naddr])
    expect(row.querySelector(`[data-children-of="${PROJECT_ADDRESS}"]`)).not.toBeNull()
  })

  it("expands the open file's parent row so the file is where the tree says it is", () => {
    mount({ currentFolder: TEAM, selectedParent: PROJECT_ADDRESS })
    expect(section(TEAM).querySelector(`[data-children-of="${PROJECT_ADDRESS}"]`)).not.toBeNull()
    expect(childrenAsked()).toEqual([project.naddr])
  })
})

describe('a Ship project opens in the team that lists its channel (SID-2)', () => {
  const channelListing = { id: PROJECT_CHANNEL, name: 'project-5b2e7c90', hasState: false, source: 'h', files: [project] }
  const teamListing = { id: TEAM, name: 'Peek', hasState: true, source: 'state', files: [project, file] }

  it('the team is current, reads its own listing, and opens the project row', () => {
    mount({ currentFolder: PROJECT_CHANNEL, selectedRef: PROJECT_ADDRESS, currentContents: channelListing as never })
    expect(section(TEAM).dataset.open).toBe('true')
    // The page's read is the channel's; the team is not handed it.
    expect(contentsAsked()).toEqual([TEAM])
    expect(section(TEAM).querySelector(`[data-file="${FILE_ADDRESS}"]`)).not.toBeNull()
  })

  it('topic → project: the rows stay while the team reads its own listing', () => {
    const { rerender } = mount({ currentFolder: TEAM, selectedRef: FILE_ADDRESS, currentContents: teamListing as never })
    reads.pending.add(TEAM)
    rerender({ currentFolder: PROJECT_CHANNEL, selectedRef: PROJECT_ADDRESS, currentContents: channelListing as never })
    expect(section(TEAM).dataset.open).toBe('true')
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

  it("a Folder that was one of Peek's topics opens where the topic went (FOL-23)", () => {
    mount()
    fireEvent.click(within(section(TOPIC_FOLDER)).getByRole('button', { name: 'Open folder' }))
    const url = screen.getByTestId('url').textContent
    expect(url).toBe(channelDestination(TOPIC_FOLDER))
    expect(url).not.toContain('/app/folders/')
  })

  it('any other Folder opens on the Folders page, for now', () => {
    mount()
    fireEvent.click(within(section(OTHER)).getByRole('button', { name: 'Open folder' }))
    expect(screen.getByTestId('url').textContent).toBe(`/app/folders/${OTHER}`)
  })

  it('offers a new topic only when the page can start one', () => {
    const onNewTopic = vi.fn()
    const { unmount } = mount({ onNewTopic })
    fireEvent.click(screen.getByRole('button', { name: 'New topic' }))
    expect(onNewTopic).toHaveBeenCalledOnce()
    unmount()
    mount()
    expect(screen.queryByRole('button', { name: 'New topic' })).toBeNull()
  })
})
