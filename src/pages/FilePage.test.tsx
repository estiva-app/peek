/**
 * `/topic/<address>` opens any file in three panes — FOL-19.
 *
 * Two fixtures, deliberately from two apps: a Ship issue and a Peek bare file.
 * The page must draw them identically, because the address is the whole of
 * what the route carries and everything else comes off the owner's manifest
 * at runtime; a difference between the two would be a kind number somewhere
 * it must not be.
 *
 * The first test is the ticket's reason: a file the Folder's listing does not
 * hold. `FoldersPage.test.tsx` used to pin that such a file "opens nothing",
 * which was true of the pane and is the gap this route closes.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ForeignObject } from '@estiva-app/interop'
import { READ_DWELL_MS } from '@/api'
import { FilePage } from './FilePage'

const FOLDER = '925897ad-796e-4bc6-999c-ca19df26c4aa'
const OTHER_FOLDER = '3789d2ca-103c-40e5-906f-0490782db5fd'
const SHIP = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const CATH = 'a8a7d739dda599143ec2e88a1c3b2d69808cd2a50001179c786f51d00dc3c697'
const PROJECT_ADDRESS = `30850:${SHIP}:0ebd5fdd-c58a-416e-b8a7-cbdcec77b77f`
const ISSUE_ADDRESS = `30851:${SHIP}:d68a8c78-5ec7-4652-b236-89ab57ac5b1e`
const TOPIC_ADDRESS = `30840:${CATH}:0f7d2c1e-2b0a-4a25-9a2a-1a2b3c4d5e6f`

const comment = (id: string, body: string, createdAt: number) => ({
  id: id.repeat(64).slice(0, 64),
  author: CATH,
  body,
  createdAt,
})

const foreign = (over: Partial<ForeignObject>): ForeignObject =>
  ({
    naddr: 'naddr1x',
    eventId: 'e'.repeat(64),
    widget: 'card',
    slots: {},
    meta: [],
    comments: [],
    actions: [{ id: 'comment', label: 'Comment' }],
    viaRecommendation: false,
    folder: FOLDER,
    ...over,
  }) as unknown as ForeignObject

/** A Ship project: in the Folder's listing, and the issue's parent. */
const project = foreign({
  ref: PROJECT_ADDRESS,
  address: PROJECT_ADDRESS,
  kind: 30850,
  appName: 'Estiva Ship',
  slots: { title: { value: 'Folders: navigation for the whole suite' } },
  listsChildren: true,
})

/** A Ship issue: the project's child, never a peer in the listing. */
const issue = foreign({
  ref: ISSUE_ADDRESS,
  address: ISSUE_ADDRESS,
  kind: 30851,
  appName: 'Estiva Ship',
  parentRef: PROJECT_ADDRESS,
  slots: { title: { value: 'The file route' } },
  comments: [comment('1', 'First on the issue', 1_700_000_000), comment('2', 'Second', 1_700_000_100)],
})

/** A Peek bare file, at the top of the same Folder. */
const topic = foreign({
  ref: TOPIC_ADDRESS,
  address: TOPIC_ADDRESS,
  kind: 30840,
  appName: 'File',
  slots: { title: { value: 'FOL-15 test topic 2' } },
  comments: [comment('3', 'First on the topic', 1_700_000_000)],
})

/*
  The knobs. `objects` is what the resolve answers per address — the route's
  whole input; `relay.files` is the Folder's listing, which is navigation and
  not the source of truth; `threads` is the `#e` read the thread pane makes.
*/
const objects = vi.hoisted(() => ({ byAddress: {} as Record<string, unknown> }))
const relay = vi.hoisted(() => ({ files: [] as unknown[] }))
const threads = vi.hoisted(() => ({
  state: { roots: {}, replies: {} } as unknown,
  reload: vi.fn(async () => {}),
}))
const writes = vi.hoisted(() => ({
  replyToComment: vi.fn(async () => ({ ok: true })),
  applyAction: vi.fn(async () => ({ ok: true })),
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
      { id: FOLDER, name: 'Folders', hasState: true },
      { id: OTHER_FOLDER, name: 'Elsewhere', hasState: false },
    ],
    signedOut: false,
    reload: async () => {},
  }),
  useFolderContents: (id: string | undefined) => ({
    state: id
      ? { id, name: 'Folders', hasState: true, source: 'state', files: relay.files }
      : 'loading',
    reload: async () => {},
  }),
  useForeignObjects: () => writes,
  useForeignConversation: (address: string | null | undefined) => ({
    state: address ? (objects.byAddress[address] ?? 'unresolved') : 'loading',
    reload: async () => {},
  }),
  useForeignChildren: () => ({ state: [], reload: async () => {} }),
  useFileThreads: () => ({ state: threads.state, reload: threads.reload }),
  useConversationBadges: () => ({ counts: {}, unread: {} }),
  useTeamUnread: () => ({ unread: {} }),
  // The tree's "Open folder" asks whether a Folder is one of Peek's topics.
  useTopics: () => [],
  useWorkspaceDirectory: () => undefined,
  useIsTopicResolved: () => () => false,
  useResolvedReferences: () => ({}),
}))
vi.mock('@/lib/toast', () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock('@/layouts/AppShell', () => ({
  AppShell: ({ leftPanel, rightPanel, threadPanel }: Record<string, React.ReactNode>) => (
    <div>
      <section data-testid="left">{leftPanel}</section>
      <section data-testid="middle">{rightPanel}</section>
      <section data-testid="thread">{threadPanel}</section>
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
        <Route path="/topic/:ref" element={<><FilePage /><Probe /></>} />
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  )
}

/** What one mounted page looks like, reduced to what must not differ between apps. */
function shape() {
  const left = screen.getByTestId('left')
  const middle = screen.getByTestId('middle')
  return {
    foldersHeading: within(left).queryAllByText('Folders').length > 0,
    folderRows: within(left).getAllByRole('button').length > 0,
    listingOpen: left.querySelector(`[data-folder="${FOLDER}"]`) !== null,
    comments: middle.querySelectorAll('[data-comment]').length,
    threadButtons: within(middle).queryAllByRole('button', { name: /Open thread/ }).length,
    composer: within(middle).queryByRole('textbox') !== null,
    openFolder: within(middle).queryByRole('button', { name: 'Open folder' }) !== null,
  }
}

beforeEach(() => {
  objects.byAddress = { [ISSUE_ADDRESS]: issue, [TOPIC_ADDRESS]: topic, [PROJECT_ADDRESS]: project }
  relay.files = [project, topic]
  threads.state = { roots: {}, replies: {} }
  marks.file.mockClear()
  marks.container.mockClear()
  marks.thread.mockClear()
  writes.replyToComment.mockClear()
})

describe('FilePage opens a file by address, not against the listing', () => {
  it('opens a Ship issue the Folder listing does not hold — the ticket', () => {
    // The listing holds the project and the topic; the issue is the project's
    // child, resolved from the project's manifest, and appears in no listing.
    // FOL-17's pane opened nothing here. This route opens the file.
    mount(`/topic/${ISSUE_ADDRESS}`)
    const middle = screen.getByTestId('middle')
    expect(within(middle).getByText('The file route')).toBeInTheDocument()
    expect(within(middle).getByText('In Estiva Ship')).toBeInTheDocument()
    expect(middle.querySelectorAll('[data-comment]')).toHaveLength(2)
  })

  it('pins the route: a percent-encoded address in the path still opens', () => {
    mount(`/topic/${encodeURIComponent(ISSUE_ADDRESS)}`)
    expect(within(screen.getByTestId('middle')).getByText('The file route')).toBeInTheDocument()
  })

  it('says so for a link that is not an address at all', () => {
    // The route is shared with topics; `App.tsx` sends a slug to `TopicsPage`.
    // Mounted directly, a non-address is the honest empty state, not a crash.
    mount('/topic/not-an-address')
    expect(screen.getByText('That link does not point at anything Peek can open.')).toBeInTheDocument()
  })

  it('sends a topic address to the topic page rather than drawing it as a file', () => {
    // A `39000:` resolves — it is a real event — but its conversation is
    // `kind:9` under `h`, which no `#a` read returns. It has its own page.
    mount(`/topic/39000:${CATH}:${FOLDER}`)
    expect(screen.getByTestId('url').textContent).toBe(`/topic/${FOLDER}`)
  })
})

describe('FilePage draws every app’s file in the same panes', () => {
  it('a Ship issue and a Peek bare file get identical panes', () => {
    mount(`/topic/${ISSUE_ADDRESS}`)
    const ship = shape()
    // Both have comments and both may be commented on; the numbers differ
    // by fixture, the shape must not.
    expect(ship).toEqual({
      foldersHeading: true,
      folderRows: true,
      listingOpen: true,
      comments: 2,
      threadButtons: 2,
      composer: true,
      openFolder: true,
    })
  })

  it('…and the Peek file, from the same address grammar', () => {
    mount(`/topic/${TOPIC_ADDRESS}`)
    expect(shape()).toEqual({
      foldersHeading: true,
      folderRows: true,
      listingOpen: true,
      comments: 1,
      threadButtons: 1,
      composer: true,
      openFolder: true,
    })
  })

  it('opens the right Folder on the left, and the parent row inside it', () => {
    mount(`/topic/${ISSUE_ADDRESS}`)
    const left = screen.getByTestId('left')
    // Only this file's Folder is expanded — one read, not eighty-one.
    expect(left.querySelector(`[data-folder="${FOLDER}"]`)).not.toBeNull()
    expect(left.querySelector(`[data-folder="${OTHER_FOLDER}"]`)).toBeNull()
    // The project row is open, so the issue's place in the tree is visible.
    const projectRow = left.querySelector(`[data-file="${PROJECT_ADDRESS}"]`)
    expect(projectRow).not.toBeNull()
    expect(within(projectRow as HTMLElement).getByRole('button', { name: /Hide what is in/ })).toBeInTheDocument()
    expect(left.querySelector(`[data-children-of="${PROJECT_ADDRESS}"]`)).not.toBeNull()
  })

  it('a Peek file at the top of the Folder expands nothing, since it has no parent', () => {
    mount(`/topic/${TOPIC_ADDRESS}`)
    const left = screen.getByTestId('left')
    expect(left.querySelector(`[data-children-of="${PROJECT_ADDRESS}"]`)).toBeNull()
  })

  it("clicking another file's row leads to that file's address", () => {
    mount(`/topic/${ISSUE_ADDRESS}`)
    const left = screen.getByTestId('left')
    const topicRow = left.querySelector(`[data-file="${TOPIC_ADDRESS}"]`) as HTMLElement
    fireEvent.click(within(topicRow).getByText('FOL-15 test topic 2'))
    expect(screen.getByTestId('url').textContent).toBe(`/topic/${TOPIC_ADDRESS}`)
  })

  it('draws the tree as rows, not cards — no widget in the column', () => {
    mount(`/topic/${ISSUE_ADDRESS}`)
    const left = screen.getByTestId('left')
    // A card would carry the project's status pill and app name; a row is
    // its title alone, on the Topics list's row.
    expect(left.querySelector('[data-foreign-object]')).toBeNull()
    expect(within(left).getByText('Folders: navigation for the whole suite')).toBeInTheDocument()
    expect(within(left).queryByText('Estiva Ship')).toBeNull()
  })
})

describe('FilePage opens a thread beside the conversation', () => {
  const rootId = issue.comments[0].id

  it('opens the thread pane for a comment, and puts it in the URL', () => {
    mount(`/topic/${ISSUE_ADDRESS}`)
    expect(screen.getByTestId('thread')).toBeEmptyDOMElement()
    const middle = screen.getByTestId('middle')
    fireEvent.click(within(middle).getAllByRole('button', { name: /Open thread/ })[0])
    const thread = screen.getByTestId('thread')
    expect(thread.querySelector(`[data-thread="${rootId}"]`)).not.toBeNull()
    expect(within(thread).getByText('First on the issue')).toBeInTheDocument()
    expect(screen.getByTestId('url').textContent).toBe(`/topic/${ISSUE_ADDRESS}?thread=${rootId}`)
    // The comment whose thread is open is marked in the middle pane.
    expect(within(middle).getByRole('button', { name: /Open thread/, current: true })).toBeInTheDocument()
  })

  it('opens from a pasted ?thread= link', () => {
    mount(`/topic/${ISSUE_ADDRESS}?thread=${rootId}`)
    expect(within(screen.getByTestId('thread')).getByText('First on the issue')).toBeInTheDocument()
  })

  it('draws the replies the #e read returned, and a count on the comment', () => {
    threads.state = {
      roots: { [rootId]: { ...issue.comments[0], kind: 1111 } },
      replies: {
        [rootId]: [
          { id: 'r'.repeat(64), author: SHIP, body: 'A reply from Ship', createdAt: 1_700_000_050, kind: 9 },
        ],
      },
    }
    mount(`/topic/${ISSUE_ADDRESS}?thread=${rootId}`)
    expect(within(screen.getByTestId('thread')).getByText('A reply from Ship')).toBeInTheDocument()
    const middle = screen.getByTestId('middle')
    expect(within(middle).getByRole('button', { name: 'Open thread, 1 replies' })).toBeInTheDocument()
    // No count on the comment nobody replied to: absent, not "0".
    expect(middle.querySelectorAll('[data-replies]')).toHaveLength(1)
  })

  it('replies name the root comment as the parent, with its kind', async () => {
    const root = { ...issue.comments[0], kind: 1111 }
    threads.state = { roots: { [rootId]: root }, replies: {} }
    mount(`/topic/${ISSUE_ADDRESS}?thread=${rootId}`)
    const thread = screen.getByTestId('thread')
    const box = within(thread).getByRole('textbox')
    fireEvent.change(box, { target: { value: 'Agreed.' } })
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter' })
    })
    expect(writes.replyToComment).toHaveBeenCalledWith({
      reference: ISSUE_ADDRESS,
      parent: root,
      body: 'Agreed.',
    })
    // The relay has it; the thread re-reads rather than appending a copy.
    expect(threads.reload).toHaveBeenCalled()
  })

  it('offers no reply until the root’s kind is known — a guessed k is wrong for ever', () => {
    threads.state = 'loading'
    mount(`/topic/${ISSUE_ADDRESS}?thread=${rootId}`)
    expect(within(screen.getByTestId('thread')).queryByRole('textbox')).toBeNull()
  })

  it('closing the thread drops the parameter', () => {
    mount(`/topic/${ISSUE_ADDRESS}?thread=${rootId}`)
    fireEvent.click(screen.getByRole('button', { name: 'Close thread' }))
    expect(screen.getByTestId('thread')).toBeEmptyDOMElement()
    expect(screen.getByTestId('url').textContent).toBe(`/topic/${ISSUE_ADDRESS}`)
  })
})

/*
  Reading one file reads that file — SPEC §11.1–§11.2, FOL-16. The model is
  the test that used to live in `FoldersPage.test.tsx`; what changed is the
  page, not the rule. A topic page advances its container and this one must
  not: the person is reading one file's talk, not the team's general chat.
*/
describe('FilePage marks the file read, and only the file', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("advances the file's own address after the dwell, and never the Folder's channel", () => {
    mount(`/topic/${ISSUE_ADDRESS}`)
    expect(marks.file).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(READ_DWELL_MS)
    })
    expect(marks.file).toHaveBeenCalledTimes(1)
    expect(marks.file).toHaveBeenCalledWith(ISSUE_ADDRESS)
    expect(marks.container).not.toHaveBeenCalled()
    expect(marks.thread).not.toHaveBeenCalled()
  })

  it('opening a thread marks nothing more — the thread is the file’s own talk', () => {
    mount(`/topic/${ISSUE_ADDRESS}?thread=${issue.comments[0].id}`)
    act(() => {
      vi.advanceTimersByTime(READ_DWELL_MS)
    })
    expect(marks.file).toHaveBeenCalledWith(ISSUE_ADDRESS)
    expect(marks.container).not.toHaveBeenCalled()
    expect(marks.thread).not.toHaveBeenCalled()
  })

  it('marks nothing for an address that resolved to nothing', () => {
    // A file the person never saw was never read, and marking it would clear
    // a dot for something that is still unread.
    objects.byAddress = {}
    mount(`/topic/${ISSUE_ADDRESS}`)
    act(() => {
      vi.advanceTimersByTime(READ_DWELL_MS * 2)
    })
    expect(marks.file).not.toHaveBeenCalled()
  })

  it('marks nothing when the page is left before the dwell', () => {
    const { unmount } = mount(`/topic/${ISSUE_ADDRESS}`)
    unmount()
    act(() => {
      vi.advanceTimersByTime(READ_DWELL_MS * 2)
    })
    expect(marks.file).not.toHaveBeenCalled()
  })
})
