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
import { useEffect, useRef, useState } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ForeignObject } from '@estiva-app/interop'
import { PeekDataProvider, READ_DWELL_MS } from '@/api'
import { DebugProvider } from '@/lib/debug'
import { LastSelectionProvider, useLastSelection, type PendingTopicMessage } from '@/lib/lastSelection'
import { resetRecentsForTests } from '@/lib/recents'
import { forgetRouteWords, rememberRouteWords, routeWordsOf } from '@/lib/objectUrl'
import { channelDestination } from '@/lib/legacyTopicLinks'
import { FilePage } from './FilePage'

const FOLDER = '925897ad-796e-4bc6-999c-ca19df26c4aa'
const OTHER_FOLDER = '3789d2ca-103c-40e5-906f-0490782db5fd'
const SHIP = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const CATH = 'a8a7d739dda599143ec2e88a1c3b2d69808cd2a50001179c786f51d00dc3c697'
const PROJECT_ADDRESS = `30850:${SHIP}:0ebd5fdd-c58a-416e-b8a7-cbdcec77b77f`
const ISSUE_ADDRESS = `30851:${SHIP}:d68a8c78-5ec7-4652-b236-89ab57ac5b1e`
const TOPIC_D = '0f7d2c1e-2b0a-4a25-9a2a-1a2b3c4d5e6f'
const TOPIC_ADDRESS = `30840:${CATH}:${TOPIC_D}`
/** The short form FOL-37 gives a bare file: its slug and `d`, no author. */
const TOPIC_SHORT = `/topic/fol-15-test-topic-2-${TOPIC_D}`

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
    // No `comment` in the manifest: the viewer may look and not write, which
    // is the read-only page. The fixtures that offer it are further down.
    actions: [],
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
const objects = vi.hoisted(() => ({
  byAddress: {} as Record<string, unknown>,
  /** Addresses whose resolve has not answered yet (SID-2); `wake` redraws once one is let go. */
  pending: new Set<string>(),
  wake: undefined as (() => void) | undefined,
}))
const relay = vi.hoisted(() => ({ files: [] as unknown[] }))
const threads = vi.hoisted(() => ({
  state: { roots: {}, replies: {} } as unknown,
  reload: vi.fn(async () => {}),
}))
const writes = vi.hoisted(() => ({
  replyToComment: vi.fn(async () => ({ ok: true })),
  applyAction: vi.fn(async () => ({ ok: true })),
  moveFile: vi.fn<(...args: unknown[]) => Promise<{ ok: true } | { ok: false; reason: string }>>(async () => ({ ok: true })),
  // The reference widget's own read (FOL-29) — never made for the file the page has already resolved.
  resolveObject: vi.fn(async () => null),
  renameFile: vi.fn(async (): Promise<{ ok: true } | { ok: false; reason: string }> => ({ ok: true })),
  deleteFile: vi.fn<(args: Record<string, unknown>) => Promise<{ ok: true } | { ok: false; reason: string }>>(async () => ({ ok: true })),
  // A record channel placed under its team (interop 0.28 `listedIn`), for FOL-4's typed-parent case.
  listFolders: vi.fn(async () => [{ id: 'record-channel', listedIn: [FOLDER] }, { id: FOLDER, name: 'Folders', hasState: true }]),
  createTopic: vi.fn<(args: Record<string, unknown>) => Promise<{ ok: true; address: string; naddr: string } | { ok: false; reason: string }>>(
    async () => ({ ok: true, address: `30840:${'c'.repeat(64)}:new`, naddr: 'naddr1new' }),
  ),
  // The short form's one read: the author of a `d`, off the fixtures (FOL-37).
  // The word is the seam's to turn into kinds; here every fixture answers.
  resolveFileAddress: vi.fn(async (_word: string, d: string) => Object.keys(objects.byAddress).find((a) => a.endsWith(`:${d}`)) ?? null),
  // The delete flow reads the Folder for `hasState` seconds before the write.
  resolveFolderContents: vi.fn(async (id: string) => ({ id, name: 'Folders', hasState: true, source: 'state', files: [] })),
}))
const toasts = vi.hoisted(() => ({ shown: [] as { label: string; type?: string }[] }))
/**
 * The short form's seam, stood in for (FOL-37): the addresses the page has
 * remembered, and a hook that asks `writes.resolveFileAddress` for the rest.
 * The real hook's own behaviour is `useFileAddress.test.tsx`; what this
 * page's tests pin is when the page reads and when it remembers.
 */
const shortForm = vi.hoisted(() => ({ known: new Map<string, string>() }))
/** What the page handed Peek's own view, per mount. */
const peekView = vi.hoisted(() => ({ args: [] as Record<string, unknown>[] }))
vi.mock('@/components/views/useFileConversationView', () => ({
  useFileConversationView: (args: Record<string, unknown>) => {
    peekView.args.push(args)
    const container = args.container as { address: string; h: string } | null
    const view = container ? (
      <div data-testid="peek-view" data-address={container.address} data-h={container.h}>
        <textarea aria-label="Peek composer" />
      </div>
    ) : null
    return {
      conversation: view,
      // The same, as the page's Panel takes it (estiva-ui 0.37.0).
      conversationParts: { children: view },
      threadPanel: container && args.openThreadId ? <div data-testid="peek-thread">{String(args.openThreadId)}</div> : undefined,
    }
  },
}))
/* Membership (§11.8): known, and a member of nothing, unless a test says otherwise. */
const follows = vi.hoisted(() => ({
  state: 'known' as 'unknown' | 'known',
  keys: new Set<string>(),
  setMember: vi.fn<(file: string, folder: string, member: boolean) => Promise<void>>(async () => {}),
  refresh: vi.fn<() => Promise<void>>(async () => {}),
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
      // A Ship project's own channel, placed in the team — where production's projects and issues live.
      { id: 'record-channel', name: 'project-0ebd5fdd', hasState: false, listedIn: [FOLDER] },
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
  useFileAddress: (word: string, identifier: string | null | undefined) => {
    const [got, setGot] = useState<{ identifier: string; address: string | null }>()
    useEffect(() => {
      if (!identifier || shortForm.known.has(identifier)) return
      void writes.resolveFileAddress(word, identifier).then((address) => setGot({ identifier, address }))
    }, [word, identifier])
    if (!identifier) return 'loading'
    const known = shortForm.known.get(identifier)
    if (known) return { address: known }
    if (got?.identifier !== identifier) return 'loading'
    return got.address ? { address: got.address } : 'unresolved'
  },
  rememberFileAddress: (address: string) => shortForm.known.set(address.split(':')[2], address),
  // The real hook's `previous` is the last answer while the next is loading — pinned in its own test.
  useForeignConversation: (address: string | null | undefined) => {
    const [, redraw] = useState(0)
    useEffect(() => {
      objects.wake = () => redraw((n) => n + 1)
    }, [])
    const state = !address || objects.pending.has(address) ? 'loading' : (objects.byAddress[address] ?? 'unresolved')
    const [held, setHeld] = useState<unknown>(null)
    const answer = state === 'loading' ? held : typeof state === 'object' ? state : null
    if (answer !== held) setHeld(answer)
    return { state, reload: async () => {}, previous: state === 'loading' ? held : null }
  },
  useForeignChildren: () => ({ state: [], reload: async () => {} }),
  useFileThreads: () => ({ state: threads.state, reload: threads.reload }),
  useConversationBadges: () => ({ counts: {}, unread: {} }),
  useTeamUnread: () => ({ unread: {} }),
  useMembership: () => ({
    state: follows.state,
    isMember: (key: string) => follows.keys.has(key),
    setMember: follows.setMember,
    refresh: follows.refresh,
  }),
  useWorkspaceDirectory: () => undefined,
  // The Activity column names the file a mention was said on by resolving it.
  useResolvedReferences: (refs: readonly string[]) =>
    Object.fromEntries(refs.map((ref) => [ref, objects.byAddress[ref] ?? null])),
}))
/** The comments elsewhere that name the open file (CON-11), per address asked. */
const mentions = vi.hoisted(() => ({ byAddress: {} as Record<string, unknown[]>, asked: [] as (string | null | undefined)[] }))
vi.mock('@/api/useFileMentions', () => ({
  useFileMentions: (address: string | null | undefined) => {
    mentions.asked.push(address)
    return { mentions: (address && mentions.byAddress[address]) || [] }
  },
}))
/** The scroll a landing asks for — the DOM anchor is the thread pane's, mocked away above. */
const anchor = vi.hoisted(() => ({ scrollTo: vi.fn(async () => true) }))
vi.mock('@/lib/messageAnchor', () => ({ scrollToMessageWhenReady: anchor.scrollTo }))
vi.mock('@/lib/toast', () => ({
  useToast: () => ({ showToast: (toast: { label: string; type?: string }) => toasts.shown.push(toast) }),
}))
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
  const { pendingTopicMessage } = useLastSelection()
  return (
    <>
      <output data-testid="url">{location.pathname + location.search}</output>
      <output data-testid="pending">{pendingTopicMessage ? JSON.stringify(pendingTopicMessage) : ''}</output>
    </>
  )
}

/** What `ObjectPage` or the launcher leaves for the page before it navigates (RIC-16, FOL-36). */
function Seed({ pending }: { pending: PendingTopicMessage }) {
  const { setPendingTopicMessage } = useLastSelection()
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current) return
    seeded.current = true
    setPendingTopicMessage(pending)
  }, [pending, setPendingTopicMessage])
  return null
}

function mount(url: string, opts?: { pending?: PendingTopicMessage }) {
  return render(
    // The data provider is the real one: an Activity row is a `ConversationCard`, which reads the topic store.
    <DebugProvider>
      <PeekDataProvider>
        <LastSelectionProvider>
          <MemoryRouter initialEntries={[url]}>
            {opts?.pending && <Seed pending={opts.pending} />}
            <Routes>
              {/* The one file route `App` mounts (FOL-39); the word is the page's to read.
                  Peek's own pages rank ahead of it there, and so here. */}
              <Route path="/topic-old/:ref" element={<Probe />} />
              <Route path="/app/*" element={<Probe />} />
              <Route path="/:word/:ref" element={<><FilePage /><Probe /></>} />
              <Route path="*" element={<Probe />} />
            </Routes>
          </MemoryRouter>
        </LastSelectionProvider>
      </PeekDataProvider>
    </DebugProvider>,
  )
}

/*
  The thread control's accessible name is its visible label, which is the point
  of it: FOL-25 replaced an unlabelled icon whose only `aria-label` said "Open
  thread" with the count spelled out, because nobody reading the page could tell
  the icon meant a thread. So the tests match what a person reads.
*/
const THREAD_CONTROL = /^(Reply|\d+ repl(y|ies))$/

/** What one mounted page looks like, reduced to what must not differ between apps. */
function shape() {
  const left = screen.getByTestId('left')
  const middle = screen.getByTestId('middle')
  return {
    foldersHeading: within(left).queryAllByText('Folders').length > 0,
    folderRows: within(left).getAllByRole('button').length > 0,
    listingOpen: left.querySelector(`[data-folder="${FOLDER}"]`) !== null,
    comments: middle.querySelectorAll('[data-comment]').length,
    threadButtons: within(middle).queryAllByRole('button', { name: THREAD_CONTROL }).length,
    composer: within(middle).queryByRole('textbox') !== null,
    // A link since UIG-14 (4.13): the address is real, so a new tab works.
    openFolder: within(middle).queryByRole('link', { name: 'Open folder' })?.getAttribute('href') === `/app/folders/${FOLDER}`,
  }
}

beforeEach(() => {
  objects.byAddress = { [ISSUE_ADDRESS]: issue, [TOPIC_ADDRESS]: topic, [PROJECT_ADDRESS]: project }
  objects.pending.clear()
  relay.files = [project, topic]
  threads.state = { roots: {}, replies: {} }
  follows.state = 'known'
  follows.keys = new Set()
  follows.setMember.mockClear()
  marks.file.mockClear()
  marks.container.mockClear()
  marks.thread.mockClear()
  writes.replyToComment.mockClear()
  writes.renameFile.mockClear()
  writes.deleteFile.mockClear()
  writes.resolveFolderContents.mockClear()
  writes.resolveFileAddress.mockClear()
  writes.resolveObject.mockClear()
  shortForm.known.clear()
  toasts.shown = []
  peekView.args = []
  mentions.byAddress = {}
  mentions.asked = []
  anchor.scrollTo.mockClear()
  window.localStorage.clear()
  resetRecentsForTests()
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

  it('sends a retired topic’s channel address to the file its conversation moved to', () => {
    // A `39000:` resolves — it is a real event — but its conversation is
    // `kind:9` under `h`, which no `#a` read returns. Drawn as a file it would
    // be an empty one; FOL-26 sends it where the conversation is.
    mount(`/topic/39000:${CATH}:${FOLDER}`)
    expect(screen.getByTestId('url').textContent).toBe(
      '/topic/30850:b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46:f3652427-fcf5-4777-86a2-1dd4ee1f3808',
    )
  })

  it('sends any other channel address — a team — to its Folder', () => {
    const PEEK_TEAM = 'fd03975a-eb00-49d6-a4b7-33ead1854672'
    mount(`/topic/39000:${CATH}:${PEEK_TEAM}`)
    expect(screen.getByTestId('url').textContent).toBe(`/app/folders/${PEEK_TEAM}`)
  })
})

/*
  The short form — FOL-37. `/topic/<slug>-<d>` carries a bare file's `d` and no
  author; the page recovers the address with one read and then draws the file
  exactly as it does from the long form, which it turns into the short one.
*/
describe('FilePage opens a topic in a Folder at its short form', () => {
  it('opens /topic/<slug>-<d> from the d alone, with one read for the author', async () => {
    mount(TOPIC_SHORT)
    expect(writes.resolveFileAddress).toHaveBeenCalledTimes(1)
    expect(writes.resolveFileAddress).toHaveBeenCalledWith('topic', TOPIC_D)
    const middle = screen.getByTestId('middle')
    expect(await within(middle).findByText('FOL-15 test topic 2')).toBeInTheDocument()
    expect(screen.getByTestId('url').textContent).toBe(TOPIC_SHORT)
  })

  it('canonicalises the long form to the short one, with no second read', () => {
    mount(`/topic/${TOPIC_ADDRESS}`)
    expect(screen.getByTestId('url').textContent).toBe(TOPIC_SHORT)
    expect(within(screen.getByTestId('middle')).getByText('FOL-15 test topic 2')).toBeInTheDocument()
    // The page had the address; the replace must not throw it away and ask again.
    expect(writes.resolveFileAddress).not.toHaveBeenCalled()
  })

  it('refreshes a slug a rename has left stale — the d is the identity', async () => {
    mount(`/topic/what-it-used-to-be-called-${TOPIC_D}?thread=x`)
    await within(screen.getByTestId('middle')).findByText('FOL-15 test topic 2')
    await waitFor(() => expect(screen.getByTestId('url').textContent).toBe(`${TOPIC_SHORT}?thread=x`))
  })

  it('leaves a Ship issue at its long form until its manifest has been read: no word, no short form', () => {
    mount(`/topic/${ISSUE_ADDRESS}`)
    expect(within(screen.getByTestId('middle')).getByText('The file route')).toBeInTheDocument()
    expect(screen.getByTestId('url').textContent).toBe(`/topic/${ISSUE_ADDRESS}`)
  })

  it('says so for a d no bare file carries, rather than drawing an empty conversation', async () => {
    mount('/topic/nothing-here-00000000-0000-4000-8000-000000000000')
    expect(await screen.findByText('This conversation could not be read.')).toBeInTheDocument()
    expect(screen.queryByText('That link does not point at anything Peek can open.')).toBeNull()
  })

  it('sends an old /topic/<slug>-<channel-uuid> link — a retired topic — to its file', () => {
    // FOLDER is "Claude on Estiva / Estiva Steer", whose conversation is on the
    // Ship project in its channel (FOL-26's table). Convex's topic list is
    // empty here, so this is answered from the bundle.
    mount(`/topic/whatever-${FOLDER}?huddle=h1`)
    expect(screen.getByTestId('url').textContent).toBe(
      '/topic/30850:b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46:f3652427-fcf5-4777-86a2-1dd4ee1f3808',
    )
    expect(writes.resolveFileAddress).not.toHaveBeenCalled()
  })
})

/*
  Every declared shape — RFC 0.5 §7.7, FOL-39. The words are what the
  manifests on the relay declare; here Ship's two are remembered the way
  `nostr/foreign.ts` does it once it has read them, and the page is asked for
  the issue by the word Ship gave it.
*/
describe('FilePage serves every declared shape', () => {
  const ISSUE_D = ISSUE_ADDRESS.split(':')[2]
  const ISSUE_SHORT = `/issue/the-file-route-${ISSUE_D}`
  beforeEach(() => {
    rememberRouteWords(
      routeWordsOf([
        { pattern: 'https://ship.estiva.app/project/<slug>-<d>', kind: 30850 },
        { pattern: 'https://ship.estiva.app/issue/<slug>-<d>', kind: 30851 },
      ]),
    )
  })
  afterEach(() => forgetRouteWords())

  it('opens /issue/<slug>-<d> from the d alone, asking with the word so the read is over Ship’s kind', async () => {
    mount(`/issue/whatever-${ISSUE_D}`)
    expect(writes.resolveFileAddress).toHaveBeenCalledWith('issue', ISSUE_D)
    expect(await within(screen.getByTestId('middle')).findByText('The file route')).toBeInTheDocument()
    // …and takes the slug Ship's title gives it, the d being the identity.
    await waitFor(() => expect(screen.getByTestId('url').textContent).toBe(ISSUE_SHORT))
  })

  it('canonicalises the issue’s long form to /issue/<slug>-<d>, with no second read', () => {
    mount(`/topic/${ISSUE_ADDRESS}`)
    expect(screen.getByTestId('url').textContent).toBe(ISSUE_SHORT)
    expect(writes.resolveFileAddress).not.toHaveBeenCalled()
  })

  it('a word nobody declared still opens the file it names, and lands on the word its app declared', async () => {
    // §7.7 rule 4: the seam resolves over every declared kind; the page does not refuse the word.
    mount(`/ticket/whatever-${ISSUE_D}`)
    expect(writes.resolveFileAddress).toHaveBeenCalledWith('ticket', ISSUE_D)
    expect(await within(screen.getByTestId('middle')).findByText('The file route')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('url').textContent).toBe(ISSUE_SHORT))
  })

  it('the issue’s page keeps its thread in the URL through the canonicalisation', () => {
    // A Ship issue's header has no menu (FOL-33), so the link copied from its
    // page is the address bar — the ticket's done-when — and it must carry the
    // open thread the way the bare file's does.
    mount(`/topic/${ISSUE_ADDRESS}?thread=x`)
    expect(screen.getByTestId('url').textContent).toBe(`${ISSUE_SHORT}?thread=x`)
  })
})

describe('FilePage draws every app’s file in the same panes', () => {
  it('a Ship issue and a Peek bare file get identical panes', () => {
    mount(`/topic/${ISSUE_ADDRESS}`)
    const ship = shape()
    // Both have comments and neither may be commented on; the numbers differ
    // by fixture, the shape must not.
    expect(ship).toEqual({
      foldersHeading: true,
      folderRows: true,
      listingOpen: true,
      comments: 2,
      threadButtons: 2,
      composer: false,
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
      composer: false,
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
    // A bare file's link is its short form (FOL-37); an issue's stays the address.
    expect(screen.getByTestId('url').textContent).toBe(TOPIC_SHORT)
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

describe('FilePage keeps the tree while the next file resolves (SID-2)', () => {
  const OTHER_D = '6b1e0c2d-3f4a-4b5c-8d6e-7f8091a2b3c4'
  const OTHER_ADDRESS = `30840:${CATH}:${OTHER_D}`
  const other = foreign({
    ref: OTHER_ADDRESS,
    address: OTHER_ADDRESS,
    kind: 30840,
    appName: 'File',
    slots: { title: { value: 'Another topic' } },
  })
  const row = (ref: string) => screen.getByTestId('left').querySelector(`[data-file="${ref}"]`) as HTMLElement | null
  const selected = (ref: string) => row(ref)?.querySelector('.bg-bg-selected') != null

  beforeEach(() => {
    relay.files = [project, topic, other]
    objects.byAddress[OTHER_ADDRESS] = other
  })

  it('a click keeps the Folder open and selects the clicked row before its file has resolved', () => {
    objects.pending.add(OTHER_ADDRESS)
    mount(`/topic/${TOPIC_ADDRESS}`)
    fireEvent.click(within(row(OTHER_ADDRESS)!).getByText('Another topic'))

    expect(screen.getByTestId('url').textContent).toBe(`/topic/another-topic-${OTHER_D}`)
    // The listing, not a skeleton and not a shut fold: nothing was thrown away.
    expect(screen.getByTestId('left').querySelector(`[data-folder="${FOLDER}"]`)).not.toBeNull()
    expect(selected(OTHER_ADDRESS)).toBe(true)
    expect(selected(TOPIC_ADDRESS)).toBe(false)
    // The row carried the author, so the short link cost no `#d` read.
    expect(writes.resolveFileAddress).not.toHaveBeenCalled()

    act(() => {
      objects.pending.delete(OTHER_ADDRESS)
      objects.wake?.()
    })
    expect(screen.getByTestId('left').querySelector(`[data-folder="${FOLDER}"]`)).not.toBeNull()
    expect(selected(OTHER_ADDRESS)).toBe(true)
  })

  it('a row opened for the last selection stays open when the next one is elsewhere', () => {
    mount(`/topic/${ISSUE_ADDRESS}`)
    expect(screen.getByTestId('left').querySelector(`[data-children-of="${PROJECT_ADDRESS}"]`)).not.toBeNull()
    fireEvent.click(within(row(TOPIC_ADDRESS)!).getByText('FOL-15 test topic 2'))
    expect(selected(TOPIC_ADDRESS)).toBe(true)
    // The topic has no parent, so nothing asks for the project open — and nobody closed it.
    expect(screen.getByTestId('left').querySelector(`[data-children-of="${PROJECT_ADDRESS}"]`)).not.toBeNull()
  })

  it('a click from a topic to a Ship project whose Folder is its own channel keeps the team open', () => {
    objects.byAddress[PROJECT_ADDRESS] = { ...project, folder: 'record-channel' }
    mount(`/topic/${TOPIC_ADDRESS}`)
    fireEvent.click(within(row(PROJECT_ADDRESS)!).getByText('Folders: navigation for the whole suite'))
    expect(screen.getByTestId('left').querySelector(`[data-folder="${FOLDER}"]`)).not.toBeNull()
    expect(selected(PROJECT_ADDRESS)).toBe(true)
    // And back again.
    fireEvent.click(within(row(TOPIC_ADDRESS)!).getByText('FOL-15 test topic 2'))
    expect(screen.getByTestId('left').querySelector(`[data-folder="${FOLDER}"]`)).not.toBeNull()
    expect(selected(TOPIC_ADDRESS)).toBe(true)
  })

  it('a click that resolves to nothing lets the last file go, as a dead link always has', () => {
    delete objects.byAddress[OTHER_ADDRESS]
    mount(`/topic/${TOPIC_ADDRESS}`)
    fireEvent.click(within(row(OTHER_ADDRESS)!).getByText('Another topic'))
    expect(screen.getByTestId('left').querySelector(`[data-folder="${FOLDER}"]`)).toBeNull()
  })
})

describe('FilePage opens a thread beside the conversation', () => {
  const rootId = issue.comments[0].id

  it('opens the thread pane for a comment, and puts it in the URL', () => {
    mount(`/topic/${ISSUE_ADDRESS}`)
    expect(screen.getByTestId('thread')).toBeEmptyDOMElement()
    const middle = screen.getByTestId('middle')
    fireEvent.click(within(middle).getAllByRole('button', { name: THREAD_CONTROL })[0])
    const thread = screen.getByTestId('thread')
    expect(thread.querySelector(`[data-thread="${rootId}"]`)).not.toBeNull()
    expect(within(thread).getByText('First on the issue')).toBeInTheDocument()
    expect(screen.getByTestId('url').textContent).toBe(`/topic/${ISSUE_ADDRESS}?thread=${rootId}`)
    // The comment whose thread is open is marked in the middle pane.
    expect(within(middle).getByRole('button', { name: THREAD_CONTROL, current: true })).toBeInTheDocument()
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
    expect(within(middle).getByRole('button', { name: '1 reply' })).toBeInTheDocument()
    // No count on the comment nobody replied to: absent, not "0".
    expect(middle.querySelectorAll('[data-replies]')).toHaveLength(1)
  })

  it('offers no composer at all: the manifest declared no comment', () => {
    mount(`/topic/${ISSUE_ADDRESS}?thread=${rootId}`)
    expect(within(screen.getByTestId('thread')).queryByRole('textbox')).toBeNull()
    expect(within(screen.getByTestId('middle')).queryByRole('textbox')).toBeNull()
  })

  it('closing the thread drops the parameter', () => {
    mount(`/topic/${ISSUE_ADDRESS}?thread=${rootId}`)
    fireEvent.click(screen.getByRole('button', { name: 'Close thread' }))
    expect(screen.getByTestId('thread')).toBeEmptyDOMElement()
    expect(screen.getByTestId('url').textContent).toBe(`/topic/${ISSUE_ADDRESS}`)
  })
})

/*
  A file the viewer may comment on gets Peek's own conversation view — FOL-31.
  The choice is the manifest's `comment` action and nothing about the kind:
  the Ship issue and the Peek bare file below differ only in their address,
  and the page hands the view the same container shape for both.
*/
describe('FilePage gives a file the viewer may comment on Peek’s own view', () => {
  const commentable = (object: ForeignObject) => ({ ...object, actions: [{ id: 'comment', label: 'Comment' }] })

  it('a Ship issue: the container is the file’s address and its Folder', () => {
    objects.byAddress[ISSUE_ADDRESS] = commentable(issue)
    mount(`/topic/${ISSUE_ADDRESS}`)
    const middle = screen.getByTestId('middle')
    const view = within(middle).getByTestId('peek-view')
    expect(view.getAttribute('data-address')).toBe(ISSUE_ADDRESS)
    expect(view.getAttribute('data-h')).toBe(FOLDER)
    expect(within(middle).getByRole('textbox', { name: 'Peek composer' })).toBeInTheDocument()
    // The read-only panes are not drawn beside it.
    expect(middle.querySelectorAll('[data-comment]')).toHaveLength(0)
    // The roots come off the object's read, in order.
    const last = peekView.args.at(-1)!
    expect(last.rootIds).toEqual(issue.comments.map((c) => c.id))
    expect(last.title).toBe('The file route')
  })

  it('…and a Peek bare file, identically', () => {
    objects.byAddress[TOPIC_ADDRESS] = commentable(topic)
    mount(`/topic/${TOPIC_ADDRESS}`)
    const view = within(screen.getByTestId('middle')).getByTestId('peek-view')
    expect(view.getAttribute('data-address')).toBe(TOPIC_ADDRESS)
    expect(view.getAttribute('data-h')).toBe(FOLDER)
  })

  it('the open thread is still the URL’s, and closing it drops the parameter', () => {
    objects.byAddress[ISSUE_ADDRESS] = commentable(issue)
    const rootId = issue.comments[0].id
    mount(`/topic/${ISSUE_ADDRESS}?thread=${rootId}`)
    expect(screen.getByTestId('peek-thread').textContent).toBe(rootId)
    const last = peekView.args.at(-1)! as { onOpenThread: (id: string | null) => void }
    act(() => last.onOpenThread(null))
    expect(screen.getByTestId('url').textContent).toBe(`/topic/${ISSUE_ADDRESS}`)
    expect(screen.getByTestId('thread')).toBeEmptyDOMElement()
  })

  it('a signed-out or unresolved file hands the view no container', () => {
    mount(`/topic/${ISSUE_ADDRESS}`)
    expect(peekView.args.every((a) => a.container === null)).toBe(true)
    expect(screen.queryByTestId('peek-view')).toBeNull()
  })

  /*
    PEE-33. A Ship project's record carries no `h` — it is placed under its
    team by a `kind:1852` — and `useForeignConversation` now reads the Folder
    its conversation lives in off the record. Two things to pin: that the
    Folder it found is the container's `h`, and that a commentable file which
    still names none draws its comments read-only rather than a column that
    loads for ever.
  */
  it('a Ship project: the Folder the resolve found, not the record’s absent h, is the container', () => {
    objects.byAddress[PROJECT_ADDRESS] = commentable({ ...project, folder: '2611db6d-57f0-4f39-a454-a198298b526f' })
    mount(`/topic/${PROJECT_ADDRESS}`)
    const view = within(screen.getByTestId('middle')).getByTestId('peek-view')
    expect(view.getAttribute('data-address')).toBe(PROJECT_ADDRESS)
    expect(view.getAttribute('data-h')).toBe('2611db6d-57f0-4f39-a454-a198298b526f')
  })

  it('a commentable file with no Folder at all keeps the read-only conversation — never a spinner', () => {
    objects.byAddress[PROJECT_ADDRESS] = commentable({ ...project, folder: undefined, comments: issue.comments })
    mount(`/topic/${PROJECT_ADDRESS}`)
    const middle = screen.getByTestId('middle')
    expect(peekView.args.every((a) => a.container === null)).toBe(true)
    expect(within(middle).queryByTestId('peek-view')).toBeNull()
    // Its comments, off the same resolve, in the read-only panes.
    expect(middle.querySelectorAll('[data-comment]')).toHaveLength(issue.comments.length)
    expect(within(middle).queryByRole('textbox')).toBeNull()
  })
})

/*
  Activity — CON-11. A comment on another file whose body names this one
  carries the address as an `a` tag, and the page reads those by `#a`. It is
  the third column when no thread is open: labelled Mentioned in, naming the
  file it was said on, and opening the thread there rather than here.
*/
describe('FilePage draws the comments elsewhere that name this file', () => {
  const commentable = (object: ForeignObject) => ({ ...object, actions: [{ id: 'comment', label: 'Comment' }] })
  /** Said on the issue, in a thread rooted there, naming the bare file. */
  const mention = {
    id: 'm'.repeat(64),
    author: CATH,
    body: 'Same shape as the topic, one level down.',
    createdAt: 1_700_000_000,
    kind: 1111,
    folder: FOLDER,
    saidIn: ISSUE_ADDRESS,
    threadId: 'r'.repeat(64),
    references: [ISSUE_ADDRESS, TOPIC_ADDRESS],
    files: [],
  }

  it('asks by the file’s address, and only for a file the viewer may comment on', () => {
    objects.byAddress[TOPIC_ADDRESS] = commentable(topic)
    mount(`/topic/${TOPIC_ADDRESS}`)
    expect(mentions.asked).toContain(TOPIC_ADDRESS)
  })

  it('…and not for a read-only file, whose conversation is not Peek’s view', () => {
    mount(`/topic/${ISSUE_ADDRESS}`)
    expect(mentions.asked.every((a) => !a)).toBe(true)
  })

  it('a mention is the third column: labelled, naming the file it was said on, and leading to its thread', () => {
    objects.byAddress[TOPIC_ADDRESS] = commentable(topic)
    mentions.byAddress[TOPIC_ADDRESS] = [mention]
    mount(`/topic/${TOPIC_ADDRESS}`)
    const column = screen.getByTestId('thread')
    expect(within(column).getByText('Activity')).toBeInTheDocument()
    const row = column.querySelector('[data-relation="mention"]')!
    expect(row).not.toBeNull()
    expect(within(row as HTMLElement).getByText('Mentioned in')).toBeInTheDocument()
    expect(within(row as HTMLElement).getByText('The file route')).toBeInTheDocument()
    expect(within(row as HTMLElement).getByText(mention.body)).toBeInTheDocument()
    fireEvent.click(within(row as HTMLElement).getByText(mention.body))
    expect(screen.getByTestId('url').textContent).toBe(`/topic/${ISSUE_ADDRESS}?thread=${mention.threadId}`)
  })

  it('a file nobody has named keeps its two columns', () => {
    objects.byAddress[TOPIC_ADDRESS] = commentable(topic)
    mount(`/topic/${TOPIC_ADDRESS}`)
    expect(screen.getByTestId('thread')).toBeEmptyDOMElement()
  })

  it('an open thread wins the column', () => {
    objects.byAddress[TOPIC_ADDRESS] = commentable(topic)
    mentions.byAddress[TOPIC_ADDRESS] = [mention]
    mount(`/topic/${TOPIC_ADDRESS}?thread=${'r'.repeat(64)}`)
    const column = screen.getByTestId('thread')
    expect(within(column).getByTestId('peek-thread')).toBeInTheDocument()
    expect(within(column).queryByText('Activity')).toBeNull()
  })
})

/*
  Another app's file has its widget in the third column while no thread is
  open — FOL-29. The column stood empty until a thread opened, and what the
  conversation was about was one line in the header. A bare file is nobody's,
  so it gets nothing there.
*/
describe("FilePage puts another app's widget in the third column", () => {
  const commentable = (object: ForeignObject) => ({ ...object, actions: [{ id: 'comment', label: 'Comment' }] })
  /** The issue as Ship's manifest resolves it on production: a way into Ship, and a status. */
  const shipIssue = foreign({
    ...issue,
    openUrl: 'https://ship.estiva.app/issue/the-file-route',
    slots: { title: { value: 'The file route' }, status: { label: 'Status', value: 'In Progress', colour: 'blue', field: 'status' } },
  })
  const widget = () => screen.getByTestId('thread').querySelector('[data-file-widget]')

  it('a Ship issue: the card, its title the link into Ship, under the app’s name', () => {
    objects.byAddress[ISSUE_ADDRESS] = shipIssue
    mount(`/topic/${ISSUE_ADDRESS}`)
    const column = screen.getByTestId('thread')
    expect(widget()).not.toBeNull()
    // The column's bar says what it is; the card on its own page does not say it again (PEE-45).
    expect(within(column).getAllByText('Estiva Ship')).toHaveLength(1)
    expect(within(column).getByRole('link', { name: 'The file route' })).toHaveAttribute('href', shipIssue.openUrl)
    expect(within(column).getByText('In Progress')).toBeInTheDocument()
    // The same card `data-foreign-object` marks anywhere else; the tree beside it still draws rows.
    expect(column.querySelector(`[data-foreign-object="${ISSUE_ADDRESS}"]`)).not.toBeNull()
    expect(screen.getByTestId('left').querySelector('[data-foreign-object]')).toBeNull()
  })

  it('…and for a file the viewer may comment on, whose column is otherwise Peek’s', () => {
    objects.byAddress[ISSUE_ADDRESS] = commentable(shipIssue)
    mount(`/topic/${ISSUE_ADDRESS}`)
    expect(widget()).not.toBeNull()
    expect(screen.getByTestId('middle').querySelector('[data-testid="peek-view"]')).not.toBeNull()
  })

  it('a bare file gets nothing: it is nobody’s, and its title is already the header', () => {
    objects.byAddress[TOPIC_ADDRESS] = commentable(topic)
    mount(`/topic/${TOPIC_ADDRESS}`)
    expect(screen.getByTestId('thread')).toBeEmptyDOMElement()
  })

  it('opening a thread replaces the widget, and closing it brings the widget back', () => {
    objects.byAddress[ISSUE_ADDRESS] = shipIssue
    mount(`/topic/${ISSUE_ADDRESS}`)
    const middle = screen.getByTestId('middle')
    fireEvent.click(within(middle).getAllByRole('button', { name: THREAD_CONTROL })[0])
    const column = screen.getByTestId('thread')
    expect(within(column).getByText('Thread')).toBeInTheDocument()
    expect(widget()).toBeNull()
    fireEvent.click(within(column).getByRole('button', { name: 'Close thread' }))
    expect(within(column).queryByText('Thread')).toBeNull()
    expect(widget()).not.toBeNull()
  })

  it('a mention sits under the widget, in the same column', () => {
    objects.byAddress[ISSUE_ADDRESS] = commentable(shipIssue)
    mentions.byAddress[ISSUE_ADDRESS] = [
      { id: 'm'.repeat(64), author: CATH, body: 'Names the issue.', createdAt: 1_700_000_000, kind: 1111, folder: FOLDER, saidIn: TOPIC_ADDRESS, threadId: 'r'.repeat(64), references: [TOPIC_ADDRESS, ISSUE_ADDRESS], files: [] },
    ]
    mount(`/topic/${ISSUE_ADDRESS}`)
    const column = screen.getByTestId('thread')
    const card = widget()!
    const activity = within(column).getByText('Activity')
    expect(card.compareDocumentPosition(activity) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('the widget is handed the file the page resolved: no second read for it', () => {
    objects.byAddress[ISSUE_ADDRESS] = shipIssue
    mount(`/topic/${ISSUE_ADDRESS}`)
    expect(widget()).not.toBeNull()
    expect(writes.resolveObject).not.toHaveBeenCalled()
  })
})

/*
  A link to a comment lands on the comment — FOL-36. `ObjectPage` and the
  launcher leave the same one-shot the topic view answers (RIC-16): the
  thread's root as the conversation, the comment as the reply when it is not
  the root. Before this, a `/message/<id>` link to a file comment landed by
  `h` on the team's channel, which is not where the comment is.
*/
describe('FilePage lands on a comment left for it (FOL-36)', () => {
  const commentable = (object: ForeignObject) => ({ ...object, actions: [{ id: 'comment', label: 'Comment' }] })
  const rootId = issue.comments[0].id
  const replyId = 'f'.repeat(64)

  it('opens the thread from the URL, then scrolls to the reply once the pane has drawn, and consumes the one-shot', async () => {
    objects.byAddress[ISSUE_ADDRESS] = commentable(issue)
    mount(`/topic/${ISSUE_ADDRESS}?thread=${rootId}`, { pending: { folder: FOLDER, eventId: rootId, reply: replyId } })
    expect(screen.getByTestId('peek-thread').textContent).toBe(rootId)
    await waitFor(() => expect(anchor.scrollTo).toHaveBeenCalledWith(replyId))
    expect(anchor.scrollTo).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('pending').textContent).toBe('')
  })

  it('a root comment is the thread itself: the scroll is to the root', async () => {
    objects.byAddress[ISSUE_ADDRESS] = commentable(issue)
    mount(`/topic/${ISSUE_ADDRESS}?thread=${rootId}`, { pending: { folder: FOLDER, eventId: rootId } })
    await waitFor(() => expect(anchor.scrollTo).toHaveBeenCalledWith(rootId))
  })

  it('opens the thread itself when the URL did not carry it — the one-shot is enough on its own', async () => {
    objects.byAddress[ISSUE_ADDRESS] = commentable(issue)
    mount(`/topic/${ISSUE_ADDRESS}`, { pending: { folder: FOLDER, eventId: rootId, reply: replyId } })
    await waitFor(() => expect(screen.getByTestId('url').textContent).toBe(`/topic/${ISSUE_ADDRESS}?thread=${rootId}`))
    await waitFor(() => expect(anchor.scrollTo).toHaveBeenCalledWith(replyId))
  })

  it('leaves a one-shot for a comment that is not one of this file’s, so the page it belongs to still answers it', () => {
    objects.byAddress[ISSUE_ADDRESS] = commentable(issue)
    const elsewhere = { folder: OTHER_FOLDER, eventId: 'a'.repeat(64) }
    mount(`/topic/${ISSUE_ADDRESS}`, { pending: elsewhere })
    expect(screen.getByTestId('pending').textContent).toBe(JSON.stringify(elsewhere))
    expect(anchor.scrollTo).not.toHaveBeenCalled()
    expect(screen.getByTestId('url').textContent).toBe(`/topic/${ISSUE_ADDRESS}`)
  })
})

/*
  The launcher's Recent was fed by `TopicsPage` alone, so a topic started
  since #194 — a bare file, which opens here — was never recent (FOL-36). A
  file has no live list to read a title from, so the title is stored with it.
*/
describe('FilePage puts the file in Recent, with its title', () => {
  const recents = () => JSON.parse(window.localStorage.getItem('estiva-peek:recents') ?? '[]') as unknown[]

  it('a bare file, once it has resolved', async () => {
    mount(`/topic/${TOPIC_ADDRESS}`)
    await waitFor(() => expect(recents()).toEqual([{ kind: 'file', id: TOPIC_ADDRESS, title: 'FOL-15 test topic 2' }]))
  })

  it('a Ship issue too — anything this page opens', async () => {
    mount(`/topic/${ISSUE_ADDRESS}`)
    await waitFor(() => expect(recents()).toEqual([{ kind: 'file', id: ISSUE_ADDRESS, title: 'The file route' }]))
  })

  it('nothing for an address that resolved to nothing', async () => {
    objects.byAddress = {}
    mount(`/topic/${ISSUE_ADDRESS}`)
    await act(async () => {})
    expect(recents()).toEqual([])
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
    expect(marks.file.mock.lastCall?.[0]).toBe(ISSUE_ADDRESS)
    expect(marks.container).not.toHaveBeenCalled()
    expect(marks.thread).not.toHaveBeenCalled()
  })

  it('opening a thread marks nothing more — the thread is the file’s own talk', () => {
    mount(`/topic/${ISSUE_ADDRESS}?thread=${issue.comments[0].id}`)
    act(() => {
      vi.advanceTimersByTime(READ_DWELL_MS)
    })
    expect(marks.file.mock.lastCall?.[0]).toBe(ISSUE_ADDRESS)
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

describe('FilePage offers Rename and Delete when the manifest does, and never by kind (FOL-33)', () => {
  /*
    What interop 0.25.0 resolves for a bare file: `comment`, a `rename` that
    sets the field the title slot reads, and a `delete` resolved as `confirm`.
    Ship's issue resolves a status change and a comment. The page must tell the
    two apart by *this* and by nothing else — the fixtures below keep the kinds
    the production objects have, so a kind check would pass the wrong test.
  */
  const bareFile = {
    ...topic,
    slots: { title: { value: 'FOL-15 test topic 2', field: 'title' } },
    // interop 0.29.0 (FOL-4): `move` sets the field `parentField` names.
    parentField: 'parent',
    actions: [
      { id: 'comment', label: 'Comment', control: 'text', effect: 'writes' },
      { id: 'rename', label: 'Rename', control: 'text', effect: 'writes', field: 'title' },
      { id: 'move', label: 'Move', control: 'text', effect: 'writes', field: 'parent' },
      { id: 'delete', label: 'Delete', control: 'confirm', effect: 'destructive' },
    ],
  } as unknown as ForeignObject
  const shipIssue = {
    ...issue,
    slots: { title: { value: 'The file route', field: 'title' } },
    actions: [
      { id: 'set-issue-status', label: 'Set status', control: 'select', field: 'status', options: [] },
      { id: 'comment', label: 'Comment', control: 'text' },
    ],
  } as unknown as ForeignObject

  const openHeaderMenu = () => {
    fireEvent.click(within(screen.getByTestId('middle')).getByRole('button', { name: 'More actions' }))
    return screen.getAllByRole('menuitem').map((item) => item.textContent)
  }
  const hover = (row: HTMLElement) => fireEvent.mouseEnter(row.firstElementChild!.lastElementChild!)

  it('the header of a bare file has the menu: details, rename, delete', () => {
    objects.byAddress[TOPIC_ADDRESS] = bareFile
    mount(`/topic/${TOPIC_ADDRESS}`)
    expect(openHeaderMenu()).toEqual([
      'Details',
      'Rename',
      'New topic inside',
      'Move…',
      'Copy link',
      'Add to Open work',
      'Delete',
    ])
  })

  it('Copy link hands out the short form — the ticket’s done-when (FOL-37)', async () => {
    objects.byAddress[TOPIC_ADDRESS] = bareFile
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    mount(`/topic/${TOPIC_ADDRESS}`)
    openHeaderMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy link' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}${TOPIC_SHORT}`))
  })

  it('the header of a Ship issue has nothing from the manifest — only Move, a topic inside and Open work', () => {
    objects.byAddress[ISSUE_ADDRESS] = shipIssue
    mount(`/topic/${ISSUE_ADDRESS}`)
    const middle = screen.getByTestId('middle')
    expect(within(middle).getByRole('link', { name: 'Open folder' })).toBeInTheDocument()
    // Open work is the reader's, not the manifest's: any addressable file can be put there.
    // So is a topic inside it (FOL-4): any kind may hold one, and no manifest says so.
    // And Move (FOL-45): a Folder lists addresses, so any addressable file can change Folder.
    expect(openHeaderMenu()).toEqual(['New topic inside', 'Move…', 'Add to Open work'])
  })

  it('the tree row of a bare file has the same menu, and an issue’s row has only Move, Open work and Join', () => {
    objects.byAddress[TOPIC_ADDRESS] = bareFile
    // The issue as a peer rather than under its collapsed project, so its row is drawn.
    relay.files = [project, bareFile, { ...shipIssue, parentRef: undefined }]
    mount(`/topic/${TOPIC_ADDRESS}`)
    const left = screen.getByTestId('left')
    const topicRow = left.querySelector(`[data-file="${TOPIC_ADDRESS}"]`) as HTMLElement
    hover(topicRow)
    fireEvent.click(within(topicRow).getByRole('button', { name: 'More options' }))
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Details',
      'Rename',
      'New topic inside',
      'Move…',
      'Add to Open work',
      'Join',
      'Delete',
    ])
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })

    // Nothing from the manifest — but Join and Open work are the reader's, not
    // the manifest's (§11.8, FOL-34): any addressable file can be joined or
    // put in Open work, a Ship issue included — and moved to another Folder (FOL-45).
    const issueRow = left.querySelector(`[data-file="${ISSUE_ADDRESS}"]`) as HTMLElement
    hover(issueRow)
    fireEvent.click(within(issueRow).getByRole('button', { name: 'More options' }))
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'New topic inside',
      'Move…',
      'Add to Open work',
      'Join',
    ])
  })

  it('Rename opens the details dialog on the field, and saves through the manifest’s action', async () => {
    objects.byAddress[TOPIC_ADDRESS] = bareFile
    mount(`/topic/${TOPIC_ADDRESS}`)
    openHeaderMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    const field = await screen.findByRole('textbox', { name: 'Name' })
    fireEvent.change(field, { target: { value: 'FOL-15 test topic, renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(writes.renameFile).toHaveBeenCalledTimes(1))
    expect(writes.renameFile).toHaveBeenCalledWith({
      naddr: bareFile.naddr,
      actionId: 'rename',
      title: 'FOL-15 test topic, renamed',
    })
    // The relay accepted it: the dialog shows the new name, no field open.
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull())
    expect(screen.getByText('FOL-15 test topic, renamed')).toBeInTheDocument()
  })

  it('a refused rename stays in the dialog, with the relay’s reason under the field', async () => {
    objects.byAddress[TOPIC_ADDRESS] = bareFile
    writes.renameFile.mockResolvedValueOnce({ ok: false, reason: 'relay_membership_required' })
    mount(`/topic/${TOPIC_ADDRESS}`)
    openHeaderMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Name' }), { target: { value: 'Nope' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('relay_membership_required')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeInTheDocument()
  })

  it('a Ship issue’s menu and confirm never call it a topic (PEE-41)', async () => {
    objects.byAddress[ISSUE_ADDRESS] = {
      ...shipIssue,
      actions: [
        ...shipIssue.actions,
        { id: 'delete-issue', label: 'Delete', control: 'confirm', effect: 'destructive', listed: true },
      ],
    }
    mount(`/topic/${ISSUE_ADDRESS}`)
    const items = openHeaderMenu()
    expect(items).toEqual(expect.arrayContaining(['Details', 'Delete']))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(await screen.findByText('Delete?')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/topic details|delete topic|this topic|keeps the topic/i)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(writes.deleteFile).toHaveBeenCalledTimes(1))
    expect(writes.deleteFile.mock.calls[0][0]).toMatchObject({ actionId: 'delete-issue', address: ISSUE_ADDRESS })
  })

  it('Delete asks first, reads the Folder for hasState, deletes, and lands on the team', async () => {
    objects.byAddress[TOPIC_ADDRESS] = bareFile
    mount(`/topic/${TOPIC_ADDRESS}`)
    openHeaderMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    // Nothing is written by the menu item itself (D56).
    expect(writes.deleteFile).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(writes.deleteFile).toHaveBeenCalledTimes(1))
    expect(writes.resolveFolderContents).toHaveBeenCalledWith(FOLDER)
    expect(writes.deleteFile).toHaveBeenCalledWith({
      naddr: bareFile.naddr,
      actionId: 'delete',
      address: TOPIC_ADDRESS,
      folder: FOLDER,
      hasState: true,
    })
    await waitFor(() => expect(screen.getByTestId('url').textContent).toBe(`/app/folders/${FOLDER}`))
    expect(toasts.shown).toHaveLength(0)
  })

  it('a Folder without state gets the one write, and the page still lands on the team', async () => {
    objects.byAddress[TOPIC_ADDRESS] = bareFile
    writes.resolveFolderContents.mockResolvedValueOnce({ id: FOLDER, name: 'Folders', hasState: false, source: 'containment', files: [] })
    mount(`/topic/${TOPIC_ADDRESS}`)
    openHeaderMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(writes.deleteFile).toHaveBeenCalledTimes(1))
    expect(writes.deleteFile.mock.calls[0][0]).toMatchObject({ hasState: false })
    await waitFor(() => expect(screen.getByTestId('url').textContent).toBe(`/app/folders/${FOLDER}`))
  })

  it('a non-author’s delete says the relay refused it, in the relay’s words, and stays', async () => {
    objects.byAddress[TOPIC_ADDRESS] = bareFile
    writes.deleteFile.mockResolvedValueOnce({ ok: false, reason: 'invalid: must be event author' })
    mount(`/topic/${TOPIC_ADDRESS}`)
    openHeaderMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(toasts.shown).toHaveLength(1))
    expect(toasts.shown[0]).toMatchObject({ label: 'invalid: must be event author', type: 'warning' })
    // Stays — at the short form the page canonicalised the long link to (FOL-37).
    expect(screen.getByTestId('url').textContent).toBe(TOPIC_SHORT)
  })

  it('an unreadable Folder means no delete at all — hasState is never guessed', async () => {
    objects.byAddress[TOPIC_ADDRESS] = bareFile
    writes.resolveFolderContents.mockRejectedValueOnce(new Error('relay_membership_required'))
    mount(`/topic/${TOPIC_ADDRESS}`)
    openHeaderMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(toasts.shown).toHaveLength(1))
    expect(writes.deleteFile).not.toHaveBeenCalled()
  })
})

/*
  SPEC §11.8. Join / leave and mute on the file page and on the row, the state
  visible without hovering: the header's button is pressed when the person is a
  member, a member row carries its mark when idle, and both write through the
  one seam the dots are judged over. Nothing is offered until the relay has
  said what the person is a member of — a toggle then would write a guess.
  There is no mute control: muting is a private list read, not a screen.
*/
describe('FilePage offers Join and Leave on the header and the row (§11.8)', () => {
  it('the header button joins a file the person is not in, in the file’s Folder', () => {
    mount(`/topic/${ISSUE_ADDRESS}`)
    const join = screen.getByRole('button', { name: 'Join' })
    expect(join).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(join)
    expect(follows.setMember).toHaveBeenCalledWith(ISSUE_ADDRESS, FOLDER, true)
    expect(screen.queryByRole('button', { name: 'Mute' })).toBeNull()
  })

  it('reads pressed for a member, and leaves', () => {
    follows.keys = new Set([ISSUE_ADDRESS])
    mount(`/topic/${ISSUE_ADDRESS}`)
    const leave = screen.getByRole('button', { name: 'Leave' })
    expect(leave).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(leave)
    expect(follows.setMember).toHaveBeenCalledWith(ISSUE_ADDRESS, FOLDER, false)
  })

  it('has no mute control: muting is not built into the screens (Miky, 2026-10-01)', () => {
    follows.keys = new Set([ISSUE_ADDRESS])
    mount(`/topic/${ISSUE_ADDRESS}`)
    for (const name of ['Mute', 'Unmute']) expect(screen.queryByRole('button', { name })).toBeNull()
  })

  it('offers nothing while the relay has not said what the person is a member of', () => {
    follows.state = 'unknown'
    mount(`/topic/${ISSUE_ADDRESS}`)
    for (const name of ['Join', 'Leave']) expect(screen.queryByRole('button', { name })).toBeNull()
  })

  it('a member row shows its mark when idle, and its menu says Leave', () => {
    follows.keys = new Set([TOPIC_ADDRESS])
    mount(`/topic/${ISSUE_ADDRESS}`)
    const row = screen.getByTestId('left').querySelector(`[data-file="${TOPIC_ADDRESS}"]`) as HTMLElement
    expect(row.querySelector('[data-member]')).not.toBeNull()
    fireEvent.mouseEnter(row.firstElementChild!.lastElementChild!)
    fireEvent.click(within(row).getByRole('button', { name: 'More options' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Leave' }))
    expect(follows.setMember).toHaveBeenCalledWith(TOPIC_ADDRESS, FOLDER, false)
  })
})

describe('A file may name a parent file — the trail, the tree, Move and New topic inside (FOL-4)', () => {
  /*
    A chain three deep in one team: project › brief › notes › the open topic.
    The listing is the whole input for the trail — a moved file's parent is
    only right there — so the fixtures carry `parentRef` as the listing folds
    it, and nothing is resolved per level.
  */
  const bare = (d: string, title: string, parent?: string) =>
    foreign({
      ref: `30840:${CATH}:${d}`,
      address: `30840:${CATH}:${d}`,
      kind: 30840,
      appName: 'File',
      parentField: 'parent',
      ...(parent ? { parentRef: parent } : {}),
      slots: { title: { value: title, field: 'title' } },
      actions: [
        { id: 'comment', label: 'Comment', control: 'text', effect: 'writes' },
        { id: 'move', label: 'Move', control: 'text', effect: 'writes', field: 'parent' },
      ] as unknown as ForeignObject['actions'],
    })
  const brief = bare('brief', 'Brief', PROJECT_ADDRESS)
  const notes = bare('notes', 'Notes', brief.address)
  const deep = { ...bare(TOPIC_D, 'FOL-15 test topic 2', notes.address), comments: topic.comments }
  const elsewhere = bare('elsewhere', 'Elsewhere')

  beforeEach(() => {
    objects.byAddress[TOPIC_ADDRESS] = deep
    relay.files = [project, brief, notes, deep, elsewhere]
    writes.applyAction.mockClear()
    writes.createTopic.mockClear()
  })

  it('draws the team and every file above, outermost first, each a link', () => {
    mount(`/topic/${TOPIC_ADDRESS}`)
    const trail = within(screen.getByTestId('middle')).getByRole('navigation')
    const crumbs = within(trail).getAllByRole('link')
    expect(crumbs.map((crumb) => crumb.textContent)).toEqual([
      'Folders',
      'Folders: navigation for the whole suite',
      'Brief',
      'Notes',
    ])
    // `FOLDER` is a retired topic's channel, so its crumb leads where the
    // topic went, as every link to that channel does (FOL-26).
    expect(crumbs[0]).toHaveAttribute('href', channelDestination(FOLDER))
  })

  it('draws no trail for a file at the top', () => {
    objects.byAddress[TOPIC_ADDRESS] = { ...deep, parentRef: undefined }
    relay.files = [project, { ...deep, parentRef: undefined }]
    mount(`/topic/${TOPIC_ADDRESS}`)
    expect(within(screen.getByTestId('middle')).queryByRole('navigation')).toBeNull()
  })

  it('opens every row above the file in the tree, so the open file is visible', () => {
    mount(`/topic/${TOPIC_ADDRESS}`)
    const left = screen.getByTestId('left')
    const row = left.querySelector(`[data-file="${TOPIC_ADDRESS}"]`)
    expect(row).not.toBeNull()
    expect(left.querySelector(`[data-children-of="${notes.ref}"]`)?.contains(row)).toBe(true)
  })

  it('moves through the manifest’s action, offering only the team and never below itself', async () => {
    writes.resolveFolderContents.mockResolvedValueOnce({
      id: FOLDER,
      name: 'Folders',
      hasState: true,
      source: 'state',
      files: [project, brief, notes, deep, elsewhere],
    } as never)
    mount(`/topic/${TOPIC_ADDRESS}`)
    fireEvent.click(within(screen.getByTestId('middle')).getByRole('button', { name: 'More actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move…' }))
    await userEvent.click(await screen.findByRole('combobox', { name: 'Put it under' }))
    // The package's Select marks the chosen option with a check; the label is the rest.
    const options = (await screen.findAllByRole('option')).map((option) => option.textContent?.replace('✔️', ''))
    // The top, then each place by its path; `Notes` is where it is already.
    expect(options).toEqual([
      'The top of Folders',
      'Folders: navigation for the whole suite',
      'Folders: navigation for the whole suite › Brief',
      'Elsewhere',
    ])
    // A move to the top is an empty `parent` — a move, not an absence (SPEC §6.7).
    await userEvent.click(screen.getByRole('option', { name: /The top of Folders/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Move' }))
    await waitFor(() => expect(writes.applyAction).toHaveBeenCalledTimes(1))
    expect(writes.applyAction).toHaveBeenCalledWith({ naddr: deep.naddr, actionId: 'move', value: '' })
  })

  it('moves a topic to the top of another Folder: its listing with what is under it, then its parent (FOL-45)', async () => {
    const under = bare('under', 'Under it', deep.address)
    const listing = [project, brief, notes, deep, under, elsewhere]
    // Not once: the page may read the Folders itself before Move does.
    const listFolders = writes.listFolders.getMockImplementation()
    writes.listFolders.mockResolvedValue([
      { id: FOLDER, name: 'Folders', hasState: true, addresses: listing.map((f) => f.address!) },
      { id: 'steer', name: 'Steer', hasState: true, addresses: [] },
    ] as never)
    writes.resolveFolderContents.mockImplementation(async (id: string) =>
      id === FOLDER
        ? ({ id, name: 'Folders', hasState: true, source: 'state', files: listing } as never)
        : { id, name: 'Steer', hasState: true, source: 'state', files: [] },
    )
    writes.moveFile.mockClear()
    mount(`/topic/${TOPIC_ADDRESS}`)
    fireEvent.click(within(screen.getByTestId('middle')).getByRole('button', { name: 'More actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move…' }))
    await userEvent.click(await screen.findByRole('combobox', { name: 'Folder' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Steer' }))
    await userEvent.click(await screen.findByRole('combobox', { name: 'Put it under' }))
    expect((await screen.findAllByRole('option')).map((option) => option.textContent?.replace('✔️', ''))).toEqual(['The top of Steer'])
    await userEvent.click(screen.getByRole('option', { name: /The top of Steer/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Move' }))
    await waitFor(() => expect(writes.applyAction).toHaveBeenCalledTimes(1))
    // The file and the source listing: interop moves it with what is under it (MAN-17).
    expect(writes.moveFile).toHaveBeenCalledWith(
      expect.objectContaining({ address: deep.address }),
      listing,
      { id: FOLDER, hasState: true },
      { id: 'steer', hasState: true },
    )
    // Out from under `notes`, which stayed behind: the top of Steer is an empty parent.
    expect(writes.applyAction).toHaveBeenCalledWith({ naddr: deep.naddr, actionId: 'move', value: '' })
    expect(writes.moveFile.mock.invocationCallOrder[0]).toBeLessThan(writes.applyAction.mock.invocationCallOrder[0])
    writes.listFolders.mockImplementation(listFolders!)
    writes.resolveFolderContents.mockImplementation(async (id: string) => ({ id, name: 'Folders', hasState: true, source: 'state', files: [] }))
  })

  it('moves an issue to another Folder by its project, and lists nothing (FOL-45)', async () => {
    const steerProject = foreign({ ...project, ref: `30850:${CATH}:steer-project`, address: `30850:${CATH}:steer-project`, slots: { title: { value: 'Steer work' } } })
    // Ship's manifest declares the issue's `project` as what moves it (MAN-4), and `move-issue` sets it.
    const moving = {
      ...issue,
      parentRef: PROJECT_ADDRESS,
      parentField: 'project',
      parentKind: 30850,
      actions: [{ id: 'move-issue', label: 'Move to project', control: 'text', effect: 'writes', field: 'project' }],
    } as unknown as ForeignObject
    objects.byAddress[ISSUE_ADDRESS] = moving
    // Not once: the issue's page reads the Folders itself too, to place the issue in the tree (SID-2).
    const listFolders = writes.listFolders.getMockImplementation()
    writes.listFolders.mockResolvedValue([
      { id: FOLDER, name: 'Folders', hasState: true, addresses: [PROJECT_ADDRESS] },
      { id: 'steer', name: 'Steer', hasState: true, addresses: [steerProject.address!] },
    ] as never)
    writes.resolveFolderContents.mockImplementation(async (id: string) =>
      id === FOLDER
        ? ({ id, name: 'Folders', hasState: true, source: 'state', files: [project] } as never)
        : ({ id, name: 'Steer', hasState: true, source: 'state', files: [steerProject] } as never),
    )
    writes.moveFile.mockClear()
    mount(`/topic/${ISSUE_ADDRESS}`)
    fireEvent.click(within(screen.getByTestId('middle')).getByRole('button', { name: 'More actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move…' }))
    await userEvent.click(await screen.findByRole('combobox', { name: 'Folder' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Steer' }))
    await userEvent.click(await screen.findByRole('combobox', { name: 'Put it under' }))
    // Only Steer's projects: an issue under no project is in no Folder.
    expect((await screen.findAllByRole('option')).map((option) => option.textContent?.replace('✔️', ''))).toEqual(['Steer work'])
    await userEvent.click(await screen.findByRole('option', { name: 'Steer work' }))
    await userEvent.click(screen.getByRole('button', { name: 'Move' }))
    await waitFor(() => expect(writes.applyAction).toHaveBeenCalledTimes(1))
    expect(writes.applyAction).toHaveBeenCalledWith({ naddr: moving.naddr, actionId: 'move-issue', value: steerProject.address })
    expect(writes.moveFile).not.toHaveBeenCalled()
    writes.listFolders.mockImplementation(listFolders!)
    writes.resolveFolderContents.mockImplementation(async (id: string) => ({ id, name: 'Folders', hasState: true, source: 'state', files: [] }))
  }, 15_000) // the first mount of this page in a run is slow on its own

  it('starts a topic inside the file, in the file’s own team, and opens it', async () => {
    mount(`/topic/${TOPIC_ADDRESS}`)
    fireEvent.click(within(screen.getByTestId('middle')).getByRole('button', { name: 'More actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'New topic inside' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Title' }), { target: { value: 'Transcripts' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(writes.createTopic).toHaveBeenCalledTimes(1))
    expect(writes.createTopic).toHaveBeenCalledWith({
      folder: FOLDER,
      title: 'Transcripts',
      parent: TOPIC_ADDRESS,
      hasState: true,
    })
    // Membership of what you create is the address's: nothing is written for it (§11.8).
    expect(follows.setMember).not.toHaveBeenCalled()
  })

  it('starts a topic inside a Ship project in the team that lists it, not in the project’s record channel', async () => {
    /*
      Production, "Conversation standard": the project's Folder is its own
      `buzz-channel`, which has no state and is listed under Estiva HQ. The
      first topic started there went into the record channel, where neither
      the team's tree nor Ship's Related shows it.
    */
    objects.byAddress[PROJECT_ADDRESS] = { ...project, folder: 'record-channel' }
    mount(`/topic/${PROJECT_ADDRESS}`)
    fireEvent.click(within(screen.getByTestId('middle')).getByRole('button', { name: 'More actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'New topic inside' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Title' }), { target: { value: 'Sub A' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(writes.createTopic).toHaveBeenCalledTimes(1))
    expect(writes.resolveFolderContents).toHaveBeenCalledWith(FOLDER)
    expect(writes.createTopic).toHaveBeenCalledWith({ folder: FOLDER, title: 'Sub A', parent: PROJECT_ADDRESS, hasState: true })
  })
})
