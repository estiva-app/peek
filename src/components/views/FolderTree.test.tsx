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

const SHIP = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const CATH = 'a8a7d739dda599143ec2e88a1c3b2d69808cd2a50001179c786f51d00dc3c697'
const TEAM = '925897ad-796e-4bc6-999c-ca19df26c4aa'
const OTHER = '3789d2ca-103c-40e5-906f-0490782db5fd'
const TOPIC_FOLDER = '0f7d2c1e-2b0a-4a25-9a2a-1a2b3c4d5e6f'
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

const folders: FolderSummary[] = [
  { id: OTHER, name: 'Zebra', hasState: false },
  { id: TEAM, name: 'Peek', hasState: true },
  { id: TOPIC_FOLDER, name: 'A topic of ours', hasState: false },
]

const reads = vi.hoisted(() => ({
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
      state: folder
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
  // One of the Folders is one of Peek's own topics.
  useTopics: () => [{ id: '7', title: 'A topic of ours', folderId: TOPIC_FOLDER }],
}))

function Probe() {
  const location = useLocation()
  return <output data-testid="url">{location.pathname}</output>
}

function mount(props: Parameters<typeof FolderTree>[0] = {}) {
  return render(
    <MemoryRouter initialEntries={['/topics']}>
      <Routes>
        <Route path="*" element={<><FolderTree {...props} /><Probe /></>} />
      </Routes>
    </MemoryRouter>,
  )
}

const section = (id: string) => document.querySelector(`[data-tree-folder="${id}"]`) as HTMLElement
const fold = (name: string) => screen.getByRole('button', { name })

/** Folder ids `useFolderContents` was asked to read — `null` is "nothing". */
const contentsAsked = () => [...new Set(reads.contents.mock.calls.map(([folder]) => folder).filter(Boolean))]
const childrenAsked = () => [...new Set(reads.children.mock.calls.map(([naddr]) => naddr).filter(Boolean))]

beforeEach(() => {
  reads.contents.mockClear()
  reads.children.mockClear()
  dots.unread = {}
  window.localStorage.clear()
})
afterEach(() => {
  window.localStorage.clear()
})

describe('the Folders, as folds', () => {
  it('lists every Folder alphabetically, as a section each, and no topic list', () => {
    mount()
    const titles = [...document.querySelectorAll('[data-tree-folder]')].map(
      (node) => within(node as HTMLElement).getAllByRole('button')[0].textContent,
    )
    expect(titles).toEqual(['A topic of ours', 'Peek', 'Zebra'])
    expect(screen.queryByText('Your topics')).toBeNull()
    expect(screen.queryByText('Other topics')).toBeNull()
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

describe('where things lead', () => {
  it('a row opens the file at its address, in three panes', () => {
    mount({ currentFolder: TEAM })
    fireEvent.click(within(section(TEAM)).getByText('FOL-15 test topic 2'))
    expect(screen.getByTestId('url').textContent).toBe(`/topic/${FILE_ADDRESS}`)
  })

  it("a Folder that is one of Peek's topics opens as the topic", () => {
    mount()
    fireEvent.click(within(section(TOPIC_FOLDER)).getByRole('button', { name: 'Open folder' }))
    expect(screen.getByTestId('url').textContent).toBe(`/topic/a-topic-of-ours-${TOPIC_FOLDER}`)
  })

  it('any other Folder opens on the Folders page, for now', () => {
    mount()
    fireEvent.click(within(section(OTHER)).getByRole('button', { name: 'Open folder' }))
    expect(screen.getByTestId('url').textContent).toBe(`/folders/${OTHER}`)
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
