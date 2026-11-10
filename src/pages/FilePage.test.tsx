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
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { act, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ForeignObject } from '@estiva-app/interop'
import { PeekDataProvider, READ_DWELL_MS, type Team } from '@/api'
import { DebugProvider } from '@/lib/debug'
import { LastSelectionProvider, useLastSelection, type PendingTopicMessage } from '@/lib/lastSelection'
import { rememberOpenedFrom } from '@/lib/openedFrom'
import { resetRecentsForTests } from '@/lib/recents'
import { forgetRouteWords, rememberRouteWords, routeWordsOf } from '@/lib/objectUrl'
import { FilePage } from './FilePage'
import { PeekSetup } from '@/lib/PeekSetup'

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
  markSpace: vi.fn(async () => ({ ok: true })),
  applyAction: vi.fn(async () => ({ ok: true })),
  // The Overview's card (the kit's, as a message draws it): a pick, and whether its file is archived with its parent.
  applyCardAction: vi.fn(async () => ({ ok: true })),
  parentArchiveOf: vi.fn(async () => undefined),
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
const toasts = vi.hoisted(() => ({ shown: [] as { label: string; type?: string; actionLabel?: string; onAction?: () => void }[] }))
/**
 * The short form's seam, stood in for (FOL-37): the addresses the page has
 * remembered, and a hook that asks `writes.resolveFileAddress` for the rest.
 * The real hook's own behaviour is `useFileAddress.test.tsx`; what this
 * page's tests pin is when the page reads and when it remembers.
 */
const shortForm = vi.hoisted(() => ({ known: new Map<string, string>() }))
/** What the page handed Peek's own view, per mount. */
const peekView = vi.hoisted(() => ({ args: [] as Record<string, unknown>[] }))
vi.mock('@/components/views/useFileConversationView', async () => ({
  // The real fold: Activity's mention rows draw each message as it is now with it (PEE-48).
  project: (await vi.importActual<typeof import('@/components/views/useFileConversationView')>('@/components/views/useFileConversationView')).project,
  // A getter: JSX here would run while the mock is hoisted, before the runtime is imported.
  // As the kit's ConversationLayout takes it: no messages, so the stand-in is what the layout draws in their place.
  get conversationPlaceholder() {
    return { items: [], empty: <div data-testid="conversation-placeholder" /> }
  },
  useFileConversationView: (args: Record<string, unknown>) => {
    peekView.args.push(args)
    const container = args.container as { address: string; h: string } | null
    const view = container ? (
      <div data-testid="peek-view" data-address={container.address} data-h={container.h}>
        <textarea aria-label="Peek composer" />
      </div>
    ) : null
    const open = container ? (args.openThreadId as string | undefined) : undefined
    return {
      /*
        As the kit's ConversationLayout takes it: no messages, so the stand-in view is drawn in their place. An open
        thread is the stand-in's, which the layout draws in its own column beside, as Peek's view hands it (B1).
      */
      conversationParts: open
        ? { items: [{ id: open, card: view, thread: () => <div data-testid="peek-thread">{open}</div> }], open, empty: view }
        : { items: [], empty: view },
      threadDrawn: open !== undefined,
    }
  },
}))
/* Membership (§11.8): known, and a member of nothing, unless a test says otherwise. */
const follows = vi.hoisted(() => ({
  state: 'known' as 'unknown' | 'known',
  keys: new Set<string>(),
  setMember: vi.fn<(file: string, folder: string, member: boolean, person?: string) => Promise<true | string>>(async () => true),
  refresh: vi.fn<() => Promise<void>>(async () => {}),
}))
/* The open file's members (REA-3): nobody, unless a test says otherwise — the toolbar's Join then stands in for the pill. */
const roster = vi.hoisted(() => ({
  members: new Map<string, { member: boolean }>() as Map<string, { member: boolean }> | undefined,
  reload: vi.fn<() => Promise<void>>(async () => {}),
  directory: undefined as Record<string, { displayName?: string }> | undefined,
}))
const ME = 'f'.repeat(64)
const marks = vi.hoisted(() => ({
  file: vi.fn<(address: string | null | undefined, newestAt?: number) => void>(),
  container: vi.fn<(kind: string, key: string) => void>(),
  thread: vi.fn<(key: string, newestAt?: number) => void>(),
}))
/** The real `@/api`, for the rules this mock keeps (`mayMove`). */
const real = vi.hoisted(() => ({ api: {} as Record<string, unknown> }))
/* What the Folder listing already holds of a file (OPT-9): nothing, unless a test lists it. */
const listing = vi.hoisted(() => ({ files: [] as { address?: string }[] }))
vi.mock('@/api', async () => ({
  ...(real.api = await vi.importActual<Record<string, unknown>>('@/api')),
  // The real actions, with a team's space mark answered here (TEA-5): its wire is src/wire/teams.wire.test.tsx's.
  usePeekActions: () => ({ ...(real.api.usePeekActions as () => object)(), markSpace: writes.markSpace }),
  listedFile: (address: string) => listing.files.find((file) => file.address === address),
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
  useMembership: () => ({
    state: follows.state,
    me: ME,
    isMember: (key: string) => follows.keys.has(key),
    setMember: follows.setMember,
    refresh: follows.refresh,
  }),
  useFileMembers: () => ({ members: roster.members, failed: roster.members === undefined, reload: roster.reload }),
  useWorkspaceDirectory: () => roster.directory,
  useMentionConversation: () => ({ current: mentionNow.current, viewerPubkey: ME }),
  // The Activity column names the file a mention was said on by resolving it.
  useResolvedReferences: (refs: readonly string[]) =>
    Object.fromEntries(refs.map((ref) => [ref, objects.byAddress[ref] ?? null])),
  // The Teams column and Move read the teams this tab holds (TEA-5): one, the Folder's, unless a test says otherwise.
  // Subscribed, as the real read is: a test that sets them after mounting (`arrive`) redraws the page.
  useTeams: () => ({ teams: useSyncExternalStore(teamsHeld.subscribe, () => teamsHeld.teams), failed: false, reload: async () => {} }),
  useTeamChatNews: () => ({ unread: {}, news: {} }),
  // useMayMove's own rule over the teams above (its hook reads useTeams inside its module, past this mock).
  useMayMove: (address: string | undefined) => (real.api.mayMove as typeof import('@/api/useTeams').mayMove)(teamsHeld.teams as unknown as Team[], address),
  // Which column a file opened by link shows (TOP-4): Folders, unless a test lists it in a topic of yours.
  useTopicsColumn: () => topicsColumnNow(),
  /*
    Open work as the person's list holds it (FOL-34): without a relay the real list ignores a change, so the page's
    button, its key and the rows read and change this one. Its wire is the openWork tests' (src/api/internal).
  */
  useOpenWorkFiles: () => {
    const files = useSyncExternalStore(openWork.subscribe, () => openWork.files)
    return {
      has: (address: string) => files.has(address),
      add: (address: string) => openWork.set(new Set([...openWork.files, address])),
      remove: (address: string) => openWork.set(new Set([...openWork.files].filter((held) => held !== address))),
    }
  },
}))
/** The files in Open work: none, unless a test puts one there. */
const openWork = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  return {
    files: new Set<string>(),
    subscribe: (listener: () => void) => (listeners.add(listener), () => void listeners.delete(listener)),
    set(files: Set<string>) {
      this.files = files
      listeners.forEach((listener) => listener())
    },
  }
})
// The Teams column reads its topics inside `@/api/useTeams`, past the mock above: the same topics there.
vi.mock('@/api/useTopicsColumn', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTopicsColumn: () => topicsColumnNow(),
  useReadableTopics: () => ({ topics: [...topicsColumn.mine.map(({ topic }) => topic), ...topicsColumn.others], loading: false, failed: false, signedOut: false }),
}))
const topicsColumnNow = vi.hoisted(() => () => ({
  // The topics the Teams column titles its rows from: every bare file a test opens.
  state: { mine: topicsColumn.mine, others: topicsColumn.others },
  column: (address: string) => (topicsColumn.mine.some(({ topic, files }) => [topic, ...files].some((file) => file.address === address)) ? 'topics' : 'folders'),
  signedOut: false,
}))
const topicsColumn = vi.hoisted(() => ({
  mine: [] as { topic: { address: string | null }; files: { address: string | null }[] }[],
  others: [] as ForeignObject[],
}))
type HeldTeam = { id: string; name: string; isMember: boolean; listed: { address: string; space: boolean }[] }
const teamsHeld = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  return {
    teams: [] as (HeldTeam & Record<string, unknown>)[],
    subscribe: (listener: () => void) => (listeners.add(listener), () => void listeners.delete(listener)),
    /** The teams read lands after the page is drawn. */
    arrive(teams: (HeldTeam & Record<string, unknown>)[]) {
      this.teams = teams
      listeners.forEach((listener) => listener())
    },
  }
})
/** Move's Team list once its teams are read: before that it says "Reading…", and the dialog is drawn again when they land. */
const readTeamList = async () => {
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Team' })).not.toHaveTextContent('Reading…'))
  return screen.getByRole('combobox', { name: 'Team' })
}
/** A team as `useTeams` hands it: open, nobody's Company team, its people left out (the page's tests draw none). */
const team = (over: HeldTeam) => ({ archived: false, company: false, admins: [], members: [], isFollowing: false, ...over })
/** What has been done to those mentions where they were said (PEE-48): nothing read, unless a test says otherwise. */
const mentionNow = vi.hoisted(() => ({ current: null as unknown }))
/** The comments elsewhere that name the open file (CON-11), per address asked. */
const mentions = vi.hoisted(() => ({ byAddress: {} as Record<string, unknown[]>, asked: [] as (string | null | undefined)[] }))
vi.mock('@/api/useFileMentions', () => ({
  useFileMentions: (address: string | null | undefined) => {
    mentions.asked.push(address)
    return { mentions: (address && mentions.byAddress[address]) || [] }
  },
}))
/** The show a landing asks for (the kit's, C3) — the DOM anchor is the thread pane's, mocked away above. */
const anchor = vi.hoisted(() => ({ scrollTo: vi.fn(async () => true) }))
vi.mock('@estiva-app/ui', async () => ({ ...(await vi.importActual<Record<string, unknown>>('@estiva-app/ui')), showInConversationWhenDrawn: anchor.scrollTo }))
vi.mock('@/lib/toast', () => ({
  useToast: () => ({ showToast: (toast: { label: string; type?: string }) => toasts.shown.push(toast) }),
}))
vi.mock('@/layouts/PeekFrame', () => ({
  PeekFrame: ({ leftPanel, rightPanel, threadPanel }: Record<string, React.ReactNode>) => (
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

/** Where the rail's Topics would lead now. */
function Remembered() {
  const { topicsPath, foldersPath, fileColumn } = useLastSelection()
  return (
    <>
      <output data-testid="topics-path">{topicsPath ?? ''}</output>
      <output data-testid="folders-path">{foldersPath ?? ''}</output>
      <output data-testid="file-column">{fileColumn ?? ''}</output>
    </>
  )
}

function mount(url: string, opts?: { pending?: PendingTopicMessage }) {
  return render(
    // The data provider is the real one: an Activity row is a `ConversationCard`, which reads the topic store.
    <DebugProvider>
      <PeekDataProvider>
        <LastSelectionProvider>
          <MemoryRouter initialEntries={[url]}>
            {opts?.pending && <Seed pending={opts.pending} />}
            {/* Peek's router handed to every kit link, as main.tsx does: a tree row's click changes page through it. */}
            <PeekSetup>
            <Routes>
              {/* The one file route `App` mounts (FOL-39); the word is the page's to read.
                  Peek's own pages rank ahead of it there, and so here. */}
              <Route path="/topic-old/:ref" element={<Probe />} />
              <Route path="/app/*" element={<Probe />} />
              <Route path="/:word/:ref" element={<><FilePage /><Probe /></>} />
              <Route path="*" element={<Probe />} />
            </Routes>
            </PeekSetup>
            <Remembered />
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
// The kit's card (1 November): the replies row says "2 replies, open the thread"; Reply waits on the hover strip.
const THREAD_CONTROL = /^(Reply|\d+ repl(y|ies))(,|$)/

/** Each comment's way into its thread: point at the comment, as a person does, and take its control. One per comment. */
function threadControls(pane: HTMLElement): HTMLElement[] {
  return [...pane.querySelectorAll<HTMLElement>('[data-comment]')].flatMap((comment) => {
    fireEvent.mouseEnter(comment.firstElementChild as Element)
    return within(comment).queryAllByRole('button', { name: THREAD_CONTROL }).slice(0, 1)
  })
}

/** The team's section is drawn in the Teams column (TEA-5): its name leads to its page, and its topic is a row under it. */
const teamDrawn = (box: HTMLElement) =>
  within(box).queryByRole('link', { name: 'Open Folders' }) !== null && box.querySelector(`[data-file="${CSS.escape(TOPIC_ADDRESS)}"]`) !== null

/** What one mounted page looks like, reduced to what must not differ between apps. */
function shape() {
  const left = screen.getByTestId('left')
  const middle = screen.getByTestId('middle')
  return {
    myTeams: within(left).queryByText('My teams') !== null,
    teamDrawn: teamDrawn(left),
    comments: middle.querySelectorAll('[data-comment]').length,
    threadButtons: threadControls(middle).length,
    composer: within(middle).queryByRole('textbox') !== null,
    // No Open folder since 5 October: the Folder is the column beside, its row open.
    openFolder: within(middle).queryByRole('link', { name: 'Open folder' }) !== null,
  }
}

beforeEach(() => {
  objects.byAddress = { [ISSUE_ADDRESS]: issue, [TOPIC_ADDRESS]: topic, [PROJECT_ADDRESS]: project }
  objects.pending.clear()
  relay.files = [project, topic]
  listing.files = []
  threads.state = { roots: {}, replies: {} }
  follows.state = 'known'
  follows.keys = new Set()
  follows.setMember.mockClear()
  topicsColumn.mine = []
  topicsColumn.others = [topic]
  // The Folder is a team the person is in, leading the topic (TEA-5): its section in the column draws the topic's row.
  teamsHeld.teams = [team({ id: FOLDER, name: 'Folders', isMember: true, listed: [{ address: TOPIC_ADDRESS, space: false }] })]
  roster.members = new Map()
  roster.reload.mockClear()
  roster.directory = undefined
  marks.file.mockClear()
  marks.container.mockClear()
  marks.thread.mockClear()
  writes.renameFile.mockClear()
  writes.deleteFile.mockClear()
  writes.resolveFolderContents.mockClear()
  writes.resolveFileAddress.mockClear()
  writes.resolveObject.mockClear()
  shortForm.known.clear()
  toasts.shown = []
  openWork.files = new Set()
  peekView.args = []
  mentions.byAddress = {}
  mentions.asked = []
  mentionNow.current = null
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
    // No chip beside the name (Miky, 14 October): the way into its app is "Open", tested below.
    expect(within(middle).queryByText('Estiva Ship')).toBeNull()
    expect(middle.querySelectorAll('[data-comment]')).toHaveLength(2)
  })

  it('names the file, then Peek, in the browser tab (SFX-2)', () => {
    mount(`/topic/${ISSUE_ADDRESS}`)
    expect(document.title).toBe('The file route – Peek')
  })

  /*
    For a Leaf document (Miky, 14 October): you comment on it in Peek, and you
    can open it easily in Leaf — its text is never edited here. And how the
    header says it: *"I would simplify and just say Open. Less words is better.
    it's more clear."* (Miky, 14 October) — one "Open" link, no chip, the app
    named only in the link's accessible name and tooltip (PRO-24).
  */
  describe('another app’s file: one "Open" link into that app, no chip (Miky, 14 October)', () => {
    const DOCUMENT_ADDRESS = `30842:${CATH}:6f1c9b7e-0d42-4c39-9a1e-1f0e4d7b2c55`
    const LEAF_URL = 'https://leaf.estiva.app/f/naddr1leafdoc'
    const header = () => within(screen.getByTestId('middle'))

    it('a Leaf document: "Open" goes to the URL Leaf’s manifest gave, in a new tab, and is named "Open in Leaf"', () => {
      objects.byAddress[DOCUMENT_ADDRESS] = foreign({
        ref: DOCUMENT_ADDRESS,
        address: DOCUMENT_ADDRESS,
        kind: 30842,
        noun: 'document',
        appName: 'Leaf',
        openUrl: LEAF_URL,
        slots: { title: { value: 'Leaf 1 notes' } },
      })
      mount(`/topic/${DOCUMENT_ADDRESS}`)
      expect(header().getByText('Leaf 1 notes')).toBeInTheDocument()
      // No chip: neither the app's name nor the file's type.
      expect(header().queryByText('Leaf')).toBeNull()
      expect(header().queryByText('Document')).toBeNull()
      const open = header().getByRole('link', { name: 'Open in Leaf' })
      expect(open.textContent).toBe('Open')
      expect(open.getAttribute('href')).toBe(LEAF_URL)
      expect(open.getAttribute('target')).toBe('_blank')
      expect(open.getAttribute('rel')).toContain('noopener')
      expect(open.getAttribute('rel')).toContain('noreferrer')
    })

    it('a Ship issue: "Open" goes to Ship, named "Open in Estiva Ship", and no chip', () => {
      const ISSUE_URL = 'https://ship.estiva.app/o/naddr1issue'
      objects.byAddress[ISSUE_ADDRESS] = { ...issue, noun: 'issue', openUrl: ISSUE_URL }
      mount(`/topic/${ISSUE_ADDRESS}`)
      expect(header().queryByText('Estiva Ship')).toBeNull()
      expect(header().queryByText('Issue')).toBeNull()
      const open = header().getByRole('link', { name: 'Open in Estiva Ship' })
      expect(open.textContent).toBe('Open')
      expect(open.getAttribute('href')).toBe(ISSUE_URL)
    })

    it('a topic — Peek’s own file — is unchanged: no chip and no "Open"', () => {
      objects.byAddress[TOPIC_ADDRESS] = { ...topic, appName: 'Peek', noun: 'topic', openUrl: 'https://peek.estiva.app/o/naddr1x' }
      mount(`/topic/${TOPIC_ADDRESS}`)
      expect(header().getByText('FOL-15 test topic 2')).toBeInTheDocument()
      expect(header().queryByText('Topic')).toBeNull()
      expect(header().queryByRole('link', { name: /^Open/ })).toBeNull()
    })

    it('offers no "Open" for a manifest URL that is not a web page', () => {
      objects.byAddress[DOCUMENT_ADDRESS] = foreign({
        ref: DOCUMENT_ADDRESS,
        address: DOCUMENT_ADDRESS,
        kind: 30842,
        noun: 'document',
        appName: 'Leaf',
        openUrl: 'javascript:alert(1)',
        slots: { title: { value: 'Leaf 1 notes' } },
      })
      mount(`/topic/${DOCUMENT_ADDRESS}`)
      expect(header().getByText('Leaf 1 notes')).toBeInTheDocument()
      expect(header().queryByRole('link', { name: /^Open/ })).toBeNull()
    })
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

  it('opened by link and listed in no topic of yours, it is shown under Folders, which comes back to it with its open thread', () => {
    mount(`/topic/${ISSUE_ADDRESS}?thread=x`)
    expect(screen.getByTestId('file-column').textContent).toBe('folders')
    expect(screen.getByTestId('folders-path').textContent).toBe(`${ISSUE_SHORT}?thread=x`)
    expect(screen.getByTestId('topics-path').textContent).toBe('')
  })

  it('opened by link and listed in a topic of yours, it is shown under Topics, which comes back to it (TOP-4)', () => {
    topicsColumn.mine = [{ topic: topic as { address: string }, files: [issue as { address: string }] }]
    mount(`/topic/${ISSUE_ADDRESS}?thread=x`)
    expect(screen.getByTestId('file-column').textContent).toBe('topics')
    expect(within(screen.getByTestId('left')).getByText('Topics')).toBeInTheDocument()
    expect(screen.getByTestId('topics-path').textContent).toBe(`${ISSUE_SHORT}?thread=x`)
    expect(screen.getByTestId('folders-path').textContent).toBe('')
  })

  it('clicked in Folders, it is shown under Folders though a topic of yours lists it (TOP-4)', () => {
    topicsColumn.mine = [{ topic: topic as { address: string }, files: [issue as { address: string }] }]
    rememberOpenedFrom(ISSUE_ADDRESS, 'folders')
    mount(`/topic/${ISSUE_ADDRESS}`)
    expect(screen.getByTestId('file-column').textContent).toBe('folders')
    expect(screen.getByTestId('folders-path').textContent).toBe(ISSUE_SHORT)
  })
})

describe('FilePage draws every app’s file in the same panes', () => {
  it('a Ship issue and a Peek bare file get identical panes', () => {
    mount(`/topic/${ISSUE_ADDRESS}`)
    const ship = shape()
    // Both have comments and neither may be commented on; the numbers differ
    // by fixture, the shape must not.
    expect(ship).toEqual({
      myTeams: true,
      teamDrawn: true,
      comments: 2,
      threadButtons: 2,
      composer: false,
      openFolder: false,
    })
  })

  it('…and the Peek file, from the same address grammar', () => {
    mount(`/topic/${TOPIC_ADDRESS}`)
    expect(shape()).toEqual({
      myTeams: true,
      teamDrawn: true,
      comments: 1,
      threadButtons: 1,
      composer: false,
      openFolder: false,
    })
  })

  it("clicking a team's topic row leads to that file's address", () => {
    mount(`/topic/${ISSUE_ADDRESS}`)
    const left = screen.getByTestId('left')
    const topicRow = left.querySelector(`[data-file="${TOPIC_ADDRESS}"]`) as HTMLElement
    fireEvent.click(within(topicRow).getByText('FOL-15 test topic 2'))
    // A bare file's link is its short form (FOL-37); an issue's stays the address.
    expect(screen.getByTestId('url').textContent).toBe(TOPIC_SHORT)
  })

  it('draws the column as rows, not cards — no widget in the column', () => {
    mount(`/topic/${ISSUE_ADDRESS}`)
    const left = screen.getByTestId('left')
    // A card would carry the app's name; a row is its title alone, on the Topics list's row.
    expect(left.querySelector('[data-card]')).toBeNull()
    expect(within(left).getByText('FOL-15 test topic 2')).toBeInTheDocument()
    expect(within(left).queryByText('File')).toBeNull()
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
  const selected = (ref: string) => row(ref)?.getAttribute('aria-current') === 'page'

  beforeEach(() => {
    relay.files = [project, topic, other]
    objects.byAddress[OTHER_ADDRESS] = other
    // The team leads both topics: each is a row in its section.
    topicsColumn.others = [topic, other]
    teamsHeld.teams = [
      team({ id: FOLDER, name: 'Folders', isMember: true, listed: [{ address: TOPIC_ADDRESS, space: false }, { address: OTHER_ADDRESS, space: false }] }),
    ]
  })

  it('a click keeps the team drawn and selects the clicked row before its file has resolved', () => {
    objects.pending.add(OTHER_ADDRESS)
    mount(`/topic/${TOPIC_ADDRESS}`)
    fireEvent.click(within(row(OTHER_ADDRESS)!).getByText('Another topic'))

    expect(screen.getByTestId('url').textContent).toBe(`/topic/another-topic-${OTHER_D}`)
    // The team's section, not a skeleton: nothing was thrown away.
    expect(teamDrawn(screen.getByTestId('left'))).toBe(true)
    expect(selected(OTHER_ADDRESS)).toBe(true)
    expect(selected(TOPIC_ADDRESS)).toBe(false)
    // The row carried the author, so the short link cost no `#d` read.
    expect(writes.resolveFileAddress).not.toHaveBeenCalled()

    act(() => {
      objects.pending.delete(OTHER_ADDRESS)
      objects.wake?.()
    })
    expect(teamDrawn(screen.getByTestId('left'))).toBe(true)
    expect(selected(OTHER_ADDRESS)).toBe(true)
  })

  /*
    OPT-9: a topic the listing already holds opens as itself — its title, Peek's
    own view and its composer — while its file resolves, and the read waits for
    the file's comments. Anything the listing cannot vouch for gets the one
    conversation placeholder and no composer, so none is drawn and then taken away.
  */
  const commentableOther = { ...other, actions: [{ id: 'comment', label: 'Comment' }] } as unknown as ForeignObject

  it('a listed topic opens with its title and composer before its file has resolved', () => {
    listing.files = [commentableOther]
    objects.byAddress[OTHER_ADDRESS] = commentableOther
    objects.pending.add(OTHER_ADDRESS)
    mount(`/topic/${TOPIC_ADDRESS}`)
    peekView.args.length = 0
    fireEvent.click(within(row(OTHER_ADDRESS)!).getByText('Another topic'))

    const middle = screen.getByTestId('middle')
    expect(within(middle).getByTestId('peek-view').getAttribute('data-address')).toBe(OTHER_ADDRESS)
    expect(within(middle).getByLabelText('Peek composer')).toBeInTheDocument()
    expect(within(middle).getAllByText('Another topic').length).toBeGreaterThan(0)
    // The listing's copy lists no comments: nothing is read until the file's own do.
    expect(peekView.args.at(-1)?.rootIds).toBeNull()

    act(() => {
      objects.pending.delete(OTHER_ADDRESS)
      objects.wake?.()
    })
    expect(peekView.args.at(-1)?.rootIds).toEqual([])
    expect(within(screen.getByTestId('middle')).getByLabelText('Peek composer')).toBeInTheDocument()
  })

  it('an archived listed topic shows the placeholder alone until its file resolves', () => {
    listing.files = [{ ...commentableOther, archived: { by: CATH, at: 1_790_000_000 } } as unknown as ForeignObject]
    objects.pending.add(OTHER_ADDRESS)
    mount(`/topic/${TOPIC_ADDRESS}`)
    fireEvent.click(within(row(OTHER_ADDRESS)!).getByText('Another topic'))

    const middle = screen.getByTestId('middle')
    expect(within(middle).getByTestId('conversation-placeholder')).toBeInTheDocument()
    expect(within(middle).queryByLabelText('Peek composer')).toBeNull()
  })

  it('a click that resolves to nothing lets the last file go, as a dead link always has', () => {
    delete objects.byAddress[OTHER_ADDRESS]
    mount(`/topic/${TOPIC_ADDRESS}`)
    expect(within(screen.getByTestId('middle')).getByText('First on the topic')).toBeInTheDocument()
    fireEvent.click(within(row(OTHER_ADDRESS)!).getByText('Another topic'))
    expect(within(screen.getByTestId('middle')).queryByText('First on the topic')).toBeNull()
  })
})

describe('FilePage opens a thread beside the conversation', () => {
  const rootId = issue.comments[0].id

  it('opens the thread pane for a comment, and puts it in the URL', () => {
    mount(`/topic/${ISSUE_ADDRESS}`)
    expect(screen.getByTestId('thread')).toBeEmptyDOMElement()
    const middle = screen.getByTestId('middle')
    fireEvent.click(threadControls(middle)[0])
    const thread = screen.getByTestId('thread')
    expect(thread.querySelector(`[data-thread="${rootId}"]`)).not.toBeNull()
    expect(within(thread).getByText('First on the issue')).toBeInTheDocument()
    expect(screen.getByTestId('url').textContent).toBe(`/topic/${ISSUE_ADDRESS}?thread=${rootId}`)
    // The comment whose thread is open is marked in the middle pane.
    expect(middle.querySelector('[data-comment][aria-current="true"]')).not.toBeNull()
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
    expect(within(middle).getByRole('button', { name: /^1 reply,/ })).toBeInTheDocument()
    // No count on the comment nobody replied to: absent, not "0".
    expect(within(middle).getAllByRole('button', { name: /^\d+ repl(y|ies),/ })).toHaveLength(1)
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

  /*
    A Leaf document (30842): "In Peek you can comment" (Miky, 2026-10-14).
    Its comments are a kind:1111 at its address, like an issue's. Peek offers
    no editor on its text anywhere (the kit's card has none).
  */
  it('…and a Leaf document, identically', () => {
    const DOCUMENT_ADDRESS = `30842:${ISSUE_ADDRESS.split(':')[1]}:6f1c9b7e-0d42-4c39-9a1e-1f0e4d7b2c55`
    objects.byAddress[DOCUMENT_ADDRESS] = commentable({ ...issue, kind: 30842, address: DOCUMENT_ADDRESS, noun: 'document', appName: 'Leaf' } as ForeignObject)
    mount(`/topic/${DOCUMENT_ADDRESS}`)
    const middle = screen.getByTestId('middle')
    const view = within(middle).getByTestId('peek-view')
    expect(view.getAttribute('data-address')).toBe(DOCUMENT_ADDRESS)
    expect(view.getAttribute('data-h')).toBe(FOLDER)
    expect(within(middle).getByRole('textbox', { name: 'Peek composer' })).toBeInTheDocument()
  })

  it('the open thread is still the URL’s, and closing it drops the parameter', () => {
    objects.byAddress[ISSUE_ADDRESS] = commentable(issue)
    const rootId = issue.comments[0].id
    mount(`/topic/${ISSUE_ADDRESS}?thread=${rootId}`)
    expect(screen.getByTestId('peek-thread').textContent).toBe(rootId)
    const last = peekView.args.at(-1)! as { onOpenThread: (id: string | null) => void }
    act(() => last.onOpenThread(null))
    expect(screen.getByTestId('url').textContent).toBe(`/topic/${ISSUE_ADDRESS}`)
    expect(screen.queryByTestId('peek-thread')).toBeNull()
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
/*
  Peek's own file draws its Overview and its open thread in the kit's ConversationLayout, in the layout's own column
  beside the messages, inside the page's middle pane (B1): the frame's column is another app's file's only.
*/
const ownColumn = () => screen.getByTestId('middle')
/** Neither an Overview nor a thread beside the conversation: only its two columns. */
const noColumn = () =>
  screen.getByTestId('thread').childElementCount === 0 && screen.queryByText('Overview') === null && screen.queryByTestId('peek-thread') === null

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

  it('a mention is the third column: labelled, naming the file it was said on, and leading to the message itself (PEE-48)', () => {
    objects.byAddress[TOPIC_ADDRESS] = commentable(topic)
    mentions.byAddress[TOPIC_ADDRESS] = [mention]
    mount(`/topic/${TOPIC_ADDRESS}`)
    fireEvent.click(within(screen.getByTestId('middle')).getByRole('button', { name: 'Show side panel' }))
    const column = ownColumn()
    expect(within(column).getByText('Activity')).toBeInTheDocument()
    const row = column.querySelector('[data-relation="mention"]')!
    expect(row).not.toBeNull()
    expect(within(row as HTMLElement).getByText('Mentioned in')).toBeInTheDocument()
    expect(within(row as HTMLElement).getByText('The file route')).toBeInTheDocument()
    expect(within(row as HTMLElement).getByText(mention.body)).toBeInTheDocument()
    fireEvent.click(within(row as HTMLElement).getByText(mention.body))
    expect(screen.getByTestId('url').textContent).toBe(`/message/${mention.id}`)
  })

  /*
    No day divider sits above these rows, so a mention from another day names
    its day, as its hover does: a bare time means today (format.ts). It read
    "11:22 PM" for a message of 30 October (Katerina, 4 November).
  */
  it('a mention from another day names its day beside its time', () => {
    objects.byAddress[TOPIC_ADDRESS] = commentable(topic)
    mentions.byAddress[TOPIC_ADDRESS] = [mention]
    mount(`/topic/${TOPIC_ADDRESS}`)
    fireEvent.click(within(screen.getByTestId('middle')).getByRole('button', { name: 'Show side panel' }))
    const row = ownColumn().querySelector('[data-relation="mention"]') as HTMLElement
    // 1_700_000_000 is 14 November 2023 (the 15th east of UTC+2): a past year names itself.
    expect(within(row).getByText(/^Nov 1[45], 2023 at \d{1,2}:\d{2} [AP]M$/)).toBeInTheDocument()
  })

  /** The mention as a read finds it now: `edit`, reactions and replies as `mentionConversationWith` folds them. */
  const now = (over: { edit?: string; reactions?: string[]; replies?: number; kept?: boolean }) => ({
    asked: new Set([mention.id]),
    conversation: {
      roots: over.kept === false ? [] : [{ ...mention, urgent: [] }],
      replies: {
        [mention.id]: Array.from({ length: over.replies ?? 0 }, (_, i) => ({
          id: `${i}`.repeat(64).slice(0, 64),
          author: CATH,
          body: 'a reply',
          createdAt: mention.createdAt + 60 + i,
          kind: 1111,
          files: [],
          references: [],
        })),
      },
      decorations: {
        byId: {
          [mention.id]: {
            ...(over.edit ? { edit: { body: over.edit, edited: true, editedAt: 1_700_000_100_000, attachments: [] } } : {}),
            reactions: (over.reactions ?? []).map((emoji, i) => ({ id: `r${i}`, target: mention.id, emoji, by: CATH, at: mention.createdAt + 1 })),
            resolutions: [],
          },
        },
        reactionTargetsOmitted: 0,
        reactionEventsCut: false,
        editEventsCut: false,
      },
      threads: {},
    },
  })

  it('draws the message as it is now where it was said: its latest text, reactions and replies (PEE-48)', () => {
    objects.byAddress[TOPIC_ADDRESS] = commentable(topic)
    mentions.byAddress[TOPIC_ADDRESS] = [mention]
    mentionNow.current = now({ edit: 'Same shape, one level down — edited.', reactions: ['👍'], replies: 2 })
    mount(`/topic/${TOPIC_ADDRESS}`)
    fireEvent.click(within(screen.getByTestId('middle')).getByRole('button', { name: 'Show side panel' }))
    const row = ownColumn().querySelector('[data-relation="mention"]') as HTMLElement
    expect(within(row).getByText('Same shape, one level down — edited.')).toBeInTheDocument()
    expect(within(row).queryByText(mention.body)).toBeNull()
    expect(within(row).getByText('(edited)')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: /, 1$/ })).toBeInTheDocument()
    expect(within(row).getByText(/2 replies/)).toBeInTheDocument()
  })

  it('leaves out a mention an edit took the file out of, and counts without it (Katerina, 8 October)', () => {
    objects.byAddress[TOPIC_ADDRESS] = commentable(topic)
    mentions.byAddress[TOPIC_ADDRESS] = [mention]
    mentionNow.current = now({ kept: false })
    mount(`/topic/${TOPIC_ADDRESS}`)
    fireEvent.click(within(screen.getByTestId('middle')).getByRole('button', { name: 'Show side panel' }))
    const column = ownColumn()
    expect(column.querySelector('[data-relation="mention"]')).toBeNull()
    expect(within(column).getByText('No related conversations yet.')).toBeInTheDocument()
  })

  it('offers nothing to act on: no menu when pointed at, no reply, and a reaction does not toggle (PEE-48)', async () => {
    objects.byAddress[TOPIC_ADDRESS] = commentable(topic)
    mentions.byAddress[TOPIC_ADDRESS] = [mention]
    mentionNow.current = now({ reactions: ['👍'] })
    mount(`/topic/${TOPIC_ADDRESS}`)
    fireEvent.click(within(screen.getByTestId('middle')).getByRole('button', { name: 'Show side panel' }))
    const row = ownColumn().querySelector('[data-relation="mention"]') as HTMLElement
    await userEvent.hover(within(row).getByText(mention.body))
    // The reaction pill is the only button, and pressing it changes nothing.
    const buttons = within(row).getAllByRole('button')
    expect(buttons).toHaveLength(1)
    const at = screen.getByTestId('url').textContent
    await userEvent.click(buttons[0])
    expect(within(row).getByRole('button', { name: /, 1$/ })).toBeInTheDocument()
    // Nor does pressing it open the message: a pill is not the row.
    expect(screen.getByTestId('url').textContent).toBe(at)
  })

  it('a file nobody has named keeps its two columns', () => {
    objects.byAddress[TOPIC_ADDRESS] = commentable(topic)
    mount(`/topic/${TOPIC_ADDRESS}`)
    expect(noColumn()).toBe(true)
  })

  it('…and so does a file somebody has named: closed until asked for (Katerina, 13 October)', () => {
    objects.byAddress[TOPIC_ADDRESS] = commentable(topic)
    mentions.byAddress[TOPIC_ADDRESS] = [mention]
    mount(`/topic/${TOPIC_ADDRESS}`)
    expect(noColumn()).toBe(true)
    expect(within(screen.getByTestId('middle')).getByRole('button', { name: 'Show side panel' })).toBeInTheDocument()
  })

  it('the sidebar button shows its Overview, with Activity’s empty line when nobody has named it', () => {
    objects.byAddress[TOPIC_ADDRESS] = commentable(topic)
    mount(`/topic/${TOPIC_ADDRESS}`)
    fireEvent.click(within(screen.getByTestId('middle')).getByRole('button', { name: 'Show side panel' }))
    const column = ownColumn()
    expect(within(column).getByText('Overview')).toBeInTheDocument()
    expect(within(column).getByText('No related conversations yet.')).toBeInTheDocument()
    fireEvent.click(within(screen.getByTestId('middle')).getByRole('button', { name: 'Hide side panel' }))
    expect(noColumn()).toBe(true)
  })

  it('opening it holds for the visit: back on the file, it is closed again', () => {
    objects.byAddress[TOPIC_ADDRESS] = commentable(topic)
    mentions.byAddress[TOPIC_ADDRESS] = [mention]
    const first = mount(`/topic/${TOPIC_ADDRESS}`)
    fireEvent.click(within(screen.getByTestId('middle')).getByRole('button', { name: 'Show side panel' }))
    expect(within(ownColumn()).getByText('Activity')).toBeInTheDocument()
    first.unmount()
    mount(`/topic/${TOPIC_ADDRESS}`)
    expect(noColumn()).toBe(true)
  })

  it('an open thread wins the column', () => {
    objects.byAddress[TOPIC_ADDRESS] = commentable(topic)
    mentions.byAddress[TOPIC_ADDRESS] = [mention]
    mount(`/topic/${TOPIC_ADDRESS}?thread=${'r'.repeat(64)}`)
    const column = ownColumn()
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
    // Its type's word, as Ship's manifest names it: without one the kit names the app instead (ui 0.92).
    noun: 'issue',
    openUrl: 'https://ship.estiva.app/issue/the-file-route',
    slots: { title: { value: 'The file route' }, status: { label: 'Status', value: 'In Progress', colour: 'blue', field: 'status' } },
  })
  // In the frame's column for a file the viewer may only read, in Peek's own view's column for one they may comment on (B1).
  const widget = () => document.querySelector('[data-file-widget]')

  it('a Ship issue: closed until asked for, like every file (Katerina, 13 October)', () => {
    objects.byAddress[ISSUE_ADDRESS] = shipIssue
    mount(`/topic/${ISSUE_ADDRESS}`)
    expect(screen.getByTestId('thread')).toBeEmptyDOMElement()
  })

  it('a Ship issue: the card, its title the link into Ship, under the app’s name', () => {
    objects.byAddress[ISSUE_ADDRESS] = shipIssue
    mount(`/topic/${ISSUE_ADDRESS}`)
    fireEvent.click(within(screen.getByTestId('middle')).getByRole('button', { name: 'Show side panel' }))
    const column = screen.getByTestId('thread')
    expect(widget()).not.toBeNull()
    // One title whatever is in the column (Katerina, 7 October); the card on its own page does not name its app (PEE-45).
    expect(within(column).getByText('Overview')).toBeInTheDocument()
    expect(within(column).queryByText('Estiva Ship')).toBeNull()
    expect(within(column).getByRole('link', { name: 'The file route' })).toHaveAttribute('href', shipIssue.openUrl)
    expect(within(column).getByText('In Progress')).toBeInTheDocument()
    // The card a message draws under it, the kit's (Katerina, 30 Oct); the tree beside it still draws rows.
    expect(column.querySelector('[data-card="detailed"]')).not.toBeNull()
    expect(screen.getByTestId('left').querySelector('[data-card]')).toBeNull()
  })

  it('…and for a file the viewer may comment on, whose column is otherwise Peek’s', () => {
    objects.byAddress[ISSUE_ADDRESS] = commentable(shipIssue)
    mount(`/topic/${ISSUE_ADDRESS}`)
    fireEvent.click(within(screen.getByTestId('middle')).getByRole('button', { name: 'Show side panel' }))
    expect(widget()).not.toBeNull()
    expect(ownColumn().contains(widget())).toBe(true)
    expect(screen.getByTestId('middle').querySelector('[data-testid="peek-view"]')).not.toBeNull()
  })

  it('a bare file gets nothing: it is nobody’s, and its title is already the header', () => {
    objects.byAddress[TOPIC_ADDRESS] = commentable(topic)
    mount(`/topic/${TOPIC_ADDRESS}`)
    expect(noColumn()).toBe(true)
  })

  it('opening a thread replaces the widget, and closing it brings the widget back', () => {
    objects.byAddress[ISSUE_ADDRESS] = shipIssue
    mount(`/topic/${ISSUE_ADDRESS}`)
    const middle = screen.getByTestId('middle')
    fireEvent.click(within(middle).getByRole('button', { name: 'Show side panel' }))
    fireEvent.click(threadControls(middle)[0])
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
    fireEvent.click(within(screen.getByTestId('middle')).getByRole('button', { name: 'Show side panel' }))
    const column = ownColumn()
    const card = widget()!
    const activity = within(column).getByText('Activity')
    expect(card.compareDocumentPosition(activity) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('the widget is handed the file the page resolved: no second read for it', () => {
    objects.byAddress[ISSUE_ADDRESS] = shipIssue
    mount(`/topic/${ISSUE_ADDRESS}`)
    fireEvent.click(within(screen.getByTestId('middle')).getByRole('button', { name: 'Show side panel' }))
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

  /*
    A reply is read by opening its thread, and only that (Miky, 2026-10-03):
    the file's marker stops at its newest top-level comment, so a reply newer
    than it keeps the file's dot until the thread is opened (PEE-44).
  */
  it('opening a thread marks that thread up to its newest reply, and the file only up to its comments', () => {
    const rootId = issue.comments[0].id
    const replyAt = Math.max(...issue.comments.map((c) => c.createdAt)) + 50
    threads.state = {
      roots: { [rootId]: { ...issue.comments[0], kind: 1111 } },
      replies: { [rootId]: [{ id: 'r'.repeat(64), author: SHIP, body: 'A reply from Ship', createdAt: replyAt, kind: 9 }] },
    }
    mount(`/topic/${ISSUE_ADDRESS}?thread=${rootId}`)
    act(() => {
      vi.advanceTimersByTime(READ_DWELL_MS)
    })
    expect(marks.thread).toHaveBeenCalledWith(rootId, replyAt)
    expect(marks.file.mock.lastCall?.[0]).toBe(ISSUE_ADDRESS)
    expect(marks.file.mock.lastCall?.[1]).toBeLessThan(replyAt)
    expect(marks.container).not.toHaveBeenCalled()
  })

  it('a reply in a thread that is not open is not read by opening the file', () => {
    const rootId = issue.comments[0].id
    const replyAt = Math.max(...issue.comments.map((c) => c.createdAt)) + 50
    threads.state = {
      roots: { [rootId]: { ...issue.comments[0], kind: 1111 } },
      replies: { [rootId]: [{ id: 'r'.repeat(64), author: SHIP, body: 'A reply from Ship', createdAt: replyAt, kind: 9 }] },
    }
    mount(`/topic/${ISSUE_ADDRESS}`)
    act(() => {
      vi.advanceTimersByTime(READ_DWELL_MS)
    })
    expect(marks.file.mock.lastCall?.[1]).toBeLessThan(replyAt)
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

  it('the header of a topic has what is done to the topic itself — details, rename, move, copy link, delete — and nothing done from a list (TOPI-7)', () => {
    objects.byAddress[TOPIC_ADDRESS] = bareFile
    mount(`/topic/${TOPIC_ADDRESS}`)
    // Open work is the button beside the ⋮, Make it a space is on the topic's row, Add is in Who follows (TOPI-7);
    // the default team here leads it and has the person in it, so Make it a space would have been offered.
    expect(openHeaderMenu()).toEqual(['Details', 'Rename', 'Move…', 'Copy link', 'Delete'])
  })

  /*
    An archived file is read-only until it is unarchived (Katerina, 7 October):
    the menu keeps what reads it, the way back and Delete; the header drops
    Join; the conversation is handed read-only; the notice is drawn.
  */
  it('an archived file offers Details, Copy link, Unarchive and Delete — and no Join', () => {
    objects.byAddress[TOPIC_ADDRESS] = {
      ...bareFile,
      archived: { by: CATH, at: 1_790_000_000, resolution: 'Done.' },
      actions: [...(bareFile.actions ?? []), { id: 'archive', label: 'Archive', control: 'toggle', effect: 'writes', field: 'archived' }],
    }
    mount(`/topic/${TOPIC_ADDRESS}`)
    const middle = screen.getByTestId('middle')
    expect(within(middle).getByText(/^Archived by/)).toBeInTheDocument()
    expect(within(middle).queryByRole('button', { name: 'Join' })).toBeNull()
    expect(peekView.args.at(-1)!.readOnly).toBe(true)
    expect(openHeaderMenu()).toEqual(['Details', 'Copy link', 'Unarchive', 'Delete'])
  })

  // Above the messages, as Ship's issue page has it; the box's line alone under them (Miky, 25 October, PEEKM-3).
  it('an archived file shows its card above the messages and the box line under them', () => {
    objects.byAddress[TOPIC_ADDRESS] = { ...bareFile, archived: { by: CATH, at: 1_790_000_000, resolution: 'Done.' } }
    mount(`/topic/${TOPIC_ADDRESS}`)
    const middle = screen.getByTestId('middle')
    const card = within(middle).getByText(/^Archived by/)
    const messages = within(middle).getByTestId('peek-view')
    const line = within(middle).getByText('Archived. Unarchive it to comment.')
    expect(card.compareDocumentPosition(messages) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(messages.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
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

  it('the page’s Copy link says “Link copied” once the clipboard holds it (TOPI-7)', async () => {
    objects.byAddress[TOPIC_ADDRESS] = bareFile
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    mount(`/topic/${TOPIC_ADDRESS}`)
    openHeaderMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy link' }))
    await waitFor(() => expect(toasts.shown).toEqual([expect.objectContaining({ label: 'Link copied', type: 'success' })]))
  })

  it('the header of a Ship issue has nothing from the manifest — only Move and Open work, still in its ⋮', () => {
    objects.byAddress[ISSUE_ADDRESS] = shipIssue
    mount(`/topic/${ISSUE_ADDRESS}`)
    const middle = screen.getByTestId('middle')
    expect(within(middle).queryByRole('link', { name: 'Open folder' })).toBeNull()
    // Open work is the reader's, not the manifest's: any addressable file can be put there.
    // And Move (FOL-45): a Folder lists addresses, so any addressable file can change Folder.
    expect(openHeaderMenu()).toEqual(['Add to Open work', 'Move…'])
    // Only a topic has Open work as a button beside its ⋮ (TOPI-7).
    expect(within(middle).queryByRole('button', { name: /Open work/ })).toBeNull()
  })

  it('the team’s row of a topic offers Open work, Copy link and Make it a space — nothing done to the topic itself (TOPI-7)', () => {
    const archivable = {
      ...bareFile,
      actions: [...(bareFile.actions ?? []), { id: 'archive', label: 'Archive', control: 'toggle', effect: 'writes', field: 'archived' }],
    } as unknown as ForeignObject
    objects.byAddress[TOPIC_ADDRESS] = archivable
    topicsColumn.others = [archivable]
    mount(`/topic/${TOPIC_ADDRESS}`)
    const left = screen.getByTestId('left')
    const topicRow = left.querySelector(`[data-file="${TOPIC_ADDRESS}"]`) as HTMLElement
    hover(topicRow)
    fireEvent.click(within(topicRow.parentElement!).getByRole('button', { name: 'More options' }))
    const items = screen.getAllByRole('menuitem')
    // Open work names its key, as the topic's page binds it.
    expect(items.map((item) => item.textContent)).toEqual([expect.stringMatching(/^Add to Open work(Ctrl|⌘)/), 'Copy link', 'Make it a space'])
    // Details, Rename, Move, Archive and Delete are on the topic's own page, though its manifest offers them;
    // and Leave only in the Topics column, where every topic is yours.
    for (const gone of ['Details', 'Rename', 'Move…', 'Archive…', 'Delete', 'Leave', 'New topic inside']) {
      expect(screen.queryByRole('menuitem', { name: gone })).toBeNull()
    }
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

  describe('a topic’s summary lives in Details, and its page shows none (SPEC §6.12; Miky, 15 Oct)', () => {
    const SUMMARY = 'Where the launch name is picked, by Friday.'
    const summarized = {
      ...bareFile,
      slots: { ...bareFile.slots, subtitle: { value: SUMMARY, field: 'summary' } },
      actions: [
        ...bareFile.actions,
        { id: 'summarize', label: 'Summary', control: 'text', effect: 'writes', field: 'summary', current: SUMMARY },
      ],
    } as unknown as ForeignObject

    it('the page draws no summary; Details does, and saves a change through the manifest’s summarize action', async () => {
      objects.byAddress[TOPIC_ADDRESS] = summarized
      writes.applyAction.mockClear()
      mount(`/topic/${TOPIC_ADDRESS}`)
      expect(screen.queryByText(SUMMARY)).toBeNull()
      openHeaderMenu()
      fireEvent.click(screen.getByRole('menuitem', { name: 'Details' }))
      expect(await screen.findByText(SUMMARY)).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
      fireEvent.change(screen.getByRole('textbox', { name: 'Summary' }), { target: { value: 'Picked by Friday.' } })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(writes.applyAction).toHaveBeenCalledTimes(1))
      expect(writes.applyAction).toHaveBeenCalledWith({ naddr: bareFile.naddr, actionId: 'summarize', value: 'Picked by Friday.' })
      // Accepted: the dialog shows the new summary, no field open.
      await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Summary' })).toBeNull())
      expect(screen.getByText('Picked by Friday.')).toBeInTheDocument()
    })

    it('a file whose manifest declares no summary change offers no Edit in Details', async () => {
      objects.byAddress[TOPIC_ADDRESS] = { ...summarized, actions: bareFile.actions } as unknown as ForeignObject
      mount(`/topic/${TOPIC_ADDRESS}`)
      openHeaderMenu()
      fireEvent.click(screen.getByRole('menuitem', { name: 'Details' }))
      expect(await screen.findByText(SUMMARY)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    })
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

  /*
    REA-3, as Ship's SHI-31: once anybody is in the file, the members pill
    stands where the toggle was, and its dialog lists them — you first, the
    author and the owner's person fields as second lines, whoever holds a part
    and left as "· not following" — with Join or Leave and "Add members".
  */
  it('once somebody is in, the pill replaces the toggle and its dialog lists who, with their parts', () => {
    objects.byAddress[ISSUE_ADDRESS] = { ...issue, meta: [{ label: 'Assignee', value: CATH, isPubkey: true }] } as ForeignObject
    roster.members = new Map([[ME, { member: true }]])
    roster.directory = { [ME]: { displayName: 'Miky' }, [CATH]: { displayName: 'Cath' }, [SHIP]: { displayName: 'Ship bot' } }
    follows.keys = new Set([ISSUE_ADDRESS])
    mount(`/topic/${ISSUE_ADDRESS}`)
    for (const name of ['Join', 'Leave']) expect(screen.queryByRole('button', { name })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '1 member' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('You')).toBeInTheDocument()
    expect(within(dialog).getByText('Assignee · not following')).toBeInTheDocument()
    expect(within(dialog).getByText('Author · not following')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Leave' }))
    expect(follows.setMember).toHaveBeenCalledWith(ISSUE_ADDRESS, FOLDER, false)
  })

  it('Join from the dialog for somebody not in, and the roster is read again once the relay holds it', async () => {
    roster.members = new Map([[CATH, { member: true }]])
    mount(`/topic/${ISSUE_ADDRESS}`)
    fireEvent.click(screen.getByRole('button', { name: '1 member' }))
    const dialog = screen.getByRole('dialog')
    // Only a member brings others in, as in Ship.
    expect(within(dialog).queryByText('Add members')).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Join' }))
    expect(follows.setMember).toHaveBeenCalledWith(ISSUE_ADDRESS, FOLDER, true)
    await waitFor(() => expect(roster.reload).toHaveBeenCalled())
  })

  it('keeps the toolbar Join when the roster could not be read: no pill, and Join does not go with it', () => {
    roster.members = undefined
    mount(`/topic/${ISSUE_ADDRESS}`)
    expect(screen.queryByRole('button', { name: /members?$/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Join' }))
    expect(follows.setMember).toHaveBeenCalledWith(ISSUE_ADDRESS, FOLDER, true)
  })

  it('a project says that leaving it does not leave its issues', () => {
    // The child's noun is the owner's own word for it, from its manifest.
    rememberRouteWords(routeWordsOf([{ pattern: 'https://ship.estiva.app/issue/<slug>-<d>', kind: 30851 }]))
    objects.byAddress[PROJECT_ADDRESS] = { ...project, children: [issue] } as ForeignObject
    roster.members = new Map([[ME, { member: true }]])
    mount(`/topic/${PROJECT_ADDRESS}`)
    fireEvent.click(screen.getByRole('button', { name: '1 member' }))
    expect(within(screen.getByRole('dialog')).getByText('Your issues here still notify you.')).toBeInTheDocument()
    forgetRouteWords()
  })

  it('an archived file lists its members and offers no Join, Leave or Add', () => {
    objects.byAddress[ISSUE_ADDRESS] = { ...issue, archived: { by: CATH, at: 1_790_000_000 } } as ForeignObject
    roster.members = new Map([[ME, { member: true }]])
    mount(`/topic/${ISSUE_ADDRESS}`)
    fireEvent.click(screen.getByRole('button', { name: '1 member' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('You')).toBeInTheDocument()
    for (const name of ['Join', 'Leave']) expect(within(dialog).queryByRole('button', { name })).toBeNull()
    expect(within(dialog).queryByText('Add members')).toBeNull()
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

  it('a topic’s row offers no Join or Leave: it is followed with the switch on its header (TEA-6) — and no mark when idle', () => {
    follows.keys = new Set([TOPIC_ADDRESS])
    mount(`/topic/${ISSUE_ADDRESS}`)
    const row = screen.getByTestId('left').querySelector(`[data-file="${TOPIC_ADDRESS}"]`) as HTMLElement
    expect(row.parentElement!.querySelector('[data-member]')).toBeNull()
    fireEvent.mouseEnter(row)
    fireEvent.click(within((row).parentElement!).getByRole('button', { name: 'More options' }))
    for (const name of ['Join', 'Leave']) expect(screen.queryByRole('menuitem', { name })).toBeNull()
    expect(follows.setMember).not.toHaveBeenCalled()
  })
})

describe('A file may name a parent file — the tree, Move and New topic inside (FOL-4)', () => {
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

  it('draws no trail over the file — the tree beside shows where it sits (5 October)', () => {
    mount(`/topic/${TOPIC_ADDRESS}`)
    expect(within(screen.getByTestId('middle')).queryByRole('navigation')).toBeNull()
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
    await userEvent.click(await readTeamList())
    await userEvent.click(await screen.findByRole('option', { name: 'Steer' }))
    await userEvent.click(await screen.findByRole('combobox', { name: 'Put it under' }))
    expect((await screen.findAllByRole('option')).map((option) => option.textContent?.replace('✔️', ''))).toEqual(['The top of Steer'])
    await userEvent.click(screen.getByRole('option', { name: /The top of Steer/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Move' }))
    await waitFor(() => expect(writes.applyAction).toHaveBeenCalledTimes(1))
    // The file and the Folders it leaves, with what each one's state lists: the move reads each
    // again, archived files included, and interop moves it with what is under it (MAN-17, SHI-37).
    expect(writes.moveFile).toHaveBeenCalledWith(
      expect.objectContaining({ address: deep.address }),
      [{ id: FOLDER, name: 'Folders', hasState: true, addresses: listing.map((f) => f.address!) }],
      { id: 'steer', hasState: true },
      // Not one of its team's spaces, so nothing asked to keep it one (TEA-5).
      false,
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
    await userEvent.click(await readTeamList())
    await userEvent.click(await screen.findByRole('option', { name: 'Steer' }))
    await userEvent.click(await screen.findByRole('combobox', { name: 'Put it under' }))
    // Only Steer's projects: an issue under no project is in no Folder.
    expect((await screen.findAllByRole('option')).map((option) => option.textContent?.replace('✔️', ''))).toEqual(['Steer work'])
    await userEvent.click(await screen.findByRole('option', { name: 'Steer work' }))
    await userEvent.click(screen.getByRole('button', { name: 'Move' }))
    await waitFor(() => expect(writes.applyAction).toHaveBeenCalledTimes(1))
    expect(writes.applyAction).toHaveBeenCalledWith({ naddr: moving.naddr, actionId: 'move-issue', value: steerProject.address })
    // Then whatever is listed under it follows; with nothing under it, `moveFileAsViewer` sends
    // nothing (folderManagement.test.ts) — the listing it reads may hold an archived sub-file.
    expect(writes.moveFile.mock.invocationCallOrder[0]).toBeGreaterThan(writes.applyAction.mock.invocationCallOrder[0])
    writes.listFolders.mockImplementation(listFolders!)
    writes.resolveFolderContents.mockImplementation(async (id: string) => ({ id, name: 'Folders', hasState: true, source: 'state', files: [] }))
  }, 15_000) // the first mount of this page in a run is slow on its own

  it('offers an issue in its own Folder no project as "None", and picks nothing for it (FOL-45)', async () => {
    const otherProject = foreign({ ...project, ref: `30850:${CATH}:other-project`, address: `30850:${CATH}:other-project`, slots: { title: { value: 'Other work' } } })
    const moving = {
      ...issue,
      parentRef: PROJECT_ADDRESS,
      parentField: 'project',
      parentKind: 30850,
      actions: [{ id: 'move-issue', label: 'Move to project', control: 'text', effect: 'writes', field: 'project' }],
    } as unknown as ForeignObject
    objects.byAddress[ISSUE_ADDRESS] = moving
    const listFolders = writes.listFolders.getMockImplementation()
    writes.listFolders.mockResolvedValue([
      { id: FOLDER, name: 'Folders', hasState: true, addresses: [PROJECT_ADDRESS, otherProject.address!] },
    ] as never)
    writes.resolveFolderContents.mockImplementation(
      async (id: string) => ({ id, name: 'Folders', hasState: true, source: 'state', files: [project, otherProject, moving] }) as never,
    )
    mount(`/topic/${ISSUE_ADDRESS}`)
    fireEvent.click(within(screen.getByTestId('middle')).getByRole('button', { name: 'More actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move…' }))
    // The empty place takes an issue out of its project rather than to a top, and is said so; it is never chosen for the person.
    await userEvent.click(await screen.findByRole('combobox', { name: 'Put it under' }))
    expect((await screen.findAllByRole('option')).map((option) => option.textContent?.replace('✔️', ''))).toEqual([
      'None — under none of these',
      'Other work',
    ])
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Move' })).toBeDisabled()
    writes.listFolders.mockImplementation(listFolders!)
    writes.resolveFolderContents.mockImplementation(async (id: string) => ({ id, name: 'Folders', hasState: true, source: 'state', files: [] }))
  }, 15_000)

  it('offers New topic inside nowhere: not on a topic’s ⋮ or its row, not on a Ship project’s ⋮ (TOPI-7)', () => {
    const offered = () => screen.queryAllByRole('menuitem').map((item) => item.textContent)
    const topicPage = mount(`/topic/${TOPIC_ADDRESS}`)
    fireEvent.click(within(screen.getByTestId('middle')).getByRole('button', { name: 'More actions' }))
    // The ⋮ opened, with Move in it: what is missing is New topic inside, not the menu.
    expect(offered()).toContain('Move…')
    expect(offered()).not.toContain('New topic inside')
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    const row = screen.getByTestId('left').querySelector(`[data-file="${TOPIC_ADDRESS}"]`) as HTMLElement
    fireEvent.mouseEnter(row.firstElementChild!.lastElementChild!)
    fireEvent.click(within(row.parentElement!).getByRole('button', { name: 'More options' }))
    expect(offered().length).toBeGreaterThan(0)
    expect(offered()).not.toContain('New topic inside')
    topicPage.unmount()

    mount(`/topic/${PROJECT_ADDRESS}`)
    fireEvent.click(within(screen.getByTestId('middle')).getByRole('button', { name: 'More actions' }))
    expect(offered().length).toBeGreaterThan(0)
    expect(offered()).not.toContain('New topic inside')
    expect(writes.createTopic).not.toHaveBeenCalled()
  })
})

describe('Moving one of a team’s spaces asks to keep it a space (TEA-5, SPEC §3.3)', () => {
  const STEER = 'steer'
  const DESIGN = 'design'
  /** The topic is one of the Folder team's spaces unless a test says otherwise; the person is in Steer, not in Design. */
  const teamsOf = ({ space = true, inSource = true } = {}) => [
    team({ id: FOLDER, name: 'Folders', isMember: inSource, listed: [{ address: TOPIC_ADDRESS, space }] }),
    team({ id: STEER, name: 'Steer', isMember: true, listed: [] }),
    team({ id: DESIGN, name: 'Design', isMember: false, listed: [] }),
  ]
  const holdTeams = (options?: { space?: boolean; inSource?: boolean }) => {
    teamsHeld.teams = teamsOf(options)
  }
  let listFolders: ReturnType<typeof writes.listFolders.getMockImplementation>

  beforeEach(() => {
    listFolders = writes.listFolders.getMockImplementation()
    writes.listFolders.mockResolvedValue([
      { id: FOLDER, name: 'Folders', hasState: true, addresses: [TOPIC_ADDRESS] },
      { id: STEER, name: 'Steer', hasState: true, addresses: [] },
      { id: DESIGN, name: 'Design', hasState: true, addresses: [] },
    ] as never)
    writes.resolveFolderContents.mockImplementation(async (id: string) => ({ id, name: 'Folders', hasState: true, source: 'state', files: [topic] }) as never)
    writes.moveFile.mockClear()
  })
  afterEach(() => {
    writes.listFolders.mockImplementation(listFolders!)
    writes.resolveFolderContents.mockImplementation(async (id: string) => ({ id, name: 'Folders', hasState: true, source: 'state', files: [] }))
  })

  const openMove = async (to: string) => {
    mount(`/topic/${TOPIC_ADDRESS}`)
    fireEvent.click(within(screen.getByTestId('middle')).getByRole('button', { name: 'More actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move…' }))
    await userEvent.click(await readTeamList())
    await userEvent.click(await screen.findByRole('option', { name: to }))
  }

  it('into a team the person is in, the box is there and ticked, and the move keeps it a space', async () => {
    holdTeams()
    await openMove('Steer')
    expect(screen.getByRole('checkbox', { name: 'Keep it a space in Steer' })).toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: 'Move' }))
    await waitFor(() => expect(writes.moveFile).toHaveBeenCalledTimes(1))
    expect(writes.moveFile.mock.calls[0][2]).toEqual({ id: STEER, hasState: true })
    expect(writes.moveFile.mock.calls[0][3]).toBe(true)
  })

  it('unticked, it arrives as a topic the team leads', async () => {
    holdTeams()
    await openMove('Steer')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Keep it a space in Steer' }))
    await userEvent.click(screen.getByRole('button', { name: 'Move' }))
    await waitFor(() => expect(writes.moveFile).toHaveBeenCalledTimes(1))
    expect(writes.moveFile.mock.calls[0][3]).toBe(false)
  })

  it('into a team the person is not in, nothing is asked: only its members may mark a space', async () => {
    holdTeams()
    await openMove('Design')
    expect(screen.queryByRole('checkbox')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Move' }))
    await waitFor(() => expect(writes.moveFile).toHaveBeenCalledTimes(1))
    expect(writes.moveFile.mock.calls[0][3]).toBe(false)
  })

  it('a topic that was not a space is not asked', async () => {
    holdTeams({ space: false })
    await openMove('Steer')
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('opens at once while the teams are read, saying so, with no team to pick and nothing to move yet', async () => {
    teamsHeld.teams = null as never
    mount(`/topic/${TOPIC_ADDRESS}`)
    fireEvent.click(within(screen.getByTestId('middle')).getByRole('button', { name: 'More actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move…' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Reading…')).toBeInTheDocument()
    expect(within(dialog).queryByRole('option')).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Move' })).toBeDisabled()
  })

  it('opens at once while its own team is read too, and closed meanwhile, stays closed when the read lands', async () => {
    holdTeams()
    let land!: (folders: unknown) => void
    writes.listFolders.mockReturnValueOnce(new Promise((resolve) => (land = resolve)) as never)
    mount(`/topic/${TOPIC_ADDRESS}`)
    fireEvent.click(within(screen.getByTestId('middle')).getByRole('button', { name: 'More actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move…' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Reading…')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await act(async () => land([{ id: FOLDER, name: 'Folders', hasState: true, addresses: [TOPIC_ADDRESS] }]))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opened before the teams are read, the box is still ticked once they are, and the move keeps it a space', async () => {
    teamsHeld.teams = null as never
    mount(`/topic/${TOPIC_ADDRESS}`)
    fireEvent.click(within(screen.getByTestId('middle')).getByRole('button', { name: 'More actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move…' }))
    await screen.findByText('Reading…')
    act(() => teamsHeld.arrive(teamsOf()))
    await userEvent.click(await readTeamList())
    await userEvent.click(await screen.findByRole('option', { name: 'Steer' }))
    expect(screen.getByRole('checkbox', { name: 'Keep it a space in Steer' })).toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: 'Move' }))
    await waitFor(() => expect(writes.moveFile).toHaveBeenCalledTimes(1))
    expect(writes.moveFile.mock.calls[0][3]).toBe(true)
  })

  it('a space of a team the person is not in offers no Move at all, in the header or on its row', () => {
    holdTeams({ inSource: false })
    // Followed, so its section — and the space's row — is drawn for them.
    teamsHeld.teams[0] = { ...teamsHeld.teams[0], isFollowing: true }
    mount(`/topic/${TOPIC_ADDRESS}`)
    // Its manifest offers only Move, so with Move gone its header has no ⋮ at all (TOPI-7: Open work is the button).
    expect(within(screen.getByTestId('middle')).queryByRole('button', { name: 'More actions' })).toBeNull()
    expect(within(screen.getByTestId('middle')).getByRole('button', { name: 'Add to Open work' })).toBeInTheDocument()
    const row = screen.getByTestId('left').querySelector(`[data-file="${TOPIC_ADDRESS}"]`) as HTMLElement
    fireEvent.mouseEnter(row.firstElementChild!.lastElementChild!)
    fireEvent.click(within(row.parentElement!).getByRole('button', { name: 'More options' }))
    expect(screen.getAllByRole('menuitem').length).toBeGreaterThan(0)
    expect(screen.queryByRole('menuitem', { name: 'Move…' })).toBeNull()
  })

  it('…and the same space offers Move to a member of its team', () => {
    holdTeams()
    mount(`/topic/${TOPIC_ADDRESS}`)
    fireEvent.click(within(screen.getByTestId('middle')).getByRole('button', { name: 'More actions' }))
    expect(screen.getByRole('menuitem', { name: 'Move…' })).toBeInTheDocument()
  })
})

describe('A topic is marked a space of its team from its row, not its page’s ⋮ (TEA-5, TOPI-7)', () => {
  const headerMenu = () => {
    fireEvent.click(within(screen.getByTestId('middle')).getByRole('button', { name: 'More actions' }))
    const items = screen.getAllByRole('menuitem').map((item) => item.textContent)
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    return items
  }
  const rowMenu = () => {
    const row = screen.getByTestId('left').querySelector(`[data-file="${TOPIC_ADDRESS}"]`) as HTMLElement
    fireEvent.mouseEnter(row.firstElementChild!.lastElementChild!)
    fireEvent.click(within(row.parentElement!).getByRole('button', { name: 'More options' }))
  }
  beforeEach(() => writes.markSpace.mockClear())

  it('a member of the team that leads it makes it a space from its row; its page’s ⋮ does not offer it', () => {
    teamsHeld.teams = [team({ id: FOLDER, name: 'Folders', isMember: true, listed: [{ address: TOPIC_ADDRESS, space: false }] })]
    mount(`/topic/${TOPIC_ADDRESS}`)
    expect(headerMenu()).not.toContain('Make it a space')
    rowMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Make it a space' }))
    expect(writes.markSpace).toHaveBeenCalledWith(FOLDER, TOPIC_ADDRESS, true)
  })

  it('a member stops one of its spaces being a space from its row; its page’s ⋮ does not offer it', () => {
    teamsHeld.teams = [team({ id: FOLDER, name: 'Folders', isMember: true, listed: [{ address: TOPIC_ADDRESS, space: true }] })]
    mount(`/topic/${TOPIC_ADDRESS}`)
    expect(headerMenu()).not.toContain('Stop being a space')
    rowMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Stop being a space' }))
    expect(writes.markSpace).toHaveBeenCalledWith(FOLDER, TOPIC_ADDRESS, false)
  })

  it('somebody not in the team is offered neither on its row', () => {
    // Followed, so its section — and the space's row — is drawn for them.
    teamsHeld.teams = [{ ...team({ id: FOLDER, name: 'Folders', isMember: false, listed: [{ address: TOPIC_ADDRESS, space: true }] }), isFollowing: true }]
    mount(`/topic/${TOPIC_ADDRESS}`)
    rowMenu()
    expect(screen.getAllByRole('menuitem').length).toBeGreaterThan(0)
    expect(screen.queryByRole('menuitem', { name: 'Stop being a space' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Make it a space' })).toBeNull()
  })
})

describe('A topic’s Open work is a button on its page, and Ctrl/Cmd+O anywhere on it (TOPI-7)', () => {
  /** Press a key on the page as the browser would; whether the page took it from the browser (its Open file). */
  const press = (init: KeyboardEventInit) => {
    const event = createEvent.keyDown(document.body, init)
    fireEvent(document.body, event)
    return { prevented: event.defaultPrevented }
  }
  const middle = () => screen.getByTestId('middle')

  it('the button adds the topic to Open work, reads pressed, and a toast says so with Undo', () => {
    mount(`/topic/${TOPIC_ADDRESS}`)
    expect(within(middle()).queryByRole('button', { name: 'Add to Open work' })).not.toBeNull()
    fireEvent.click(within(middle()).getByRole('button', { name: 'Add to Open work' }))
    expect([...openWork.files]).toEqual([TOPIC_ADDRESS])
    expect(within(middle()).getByRole('button', { name: 'In Open work' })).toHaveAttribute('aria-pressed', 'true')
    expect(toasts.shown).toEqual([expect.objectContaining({ label: 'Added to Open work', type: 'success', actionLabel: 'Undo' })])
    // Undo takes it back out.
    act(() => toasts.shown[0].onAction!())
    expect([...openWork.files]).toEqual([])
    expect(within(middle()).getByRole('button', { name: 'Add to Open work' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('Ctrl+O takes it out of Open work and Cmd+O puts it back, each said in a toast, and the browser’s Open file never runs', () => {
    openWork.files = new Set([TOPIC_ADDRESS])
    mount(`/topic/${TOPIC_ADDRESS}`)
    expect(press({ key: 'o', ctrlKey: true }).prevented).toBe(true)
    expect([...openWork.files]).toEqual([])
    expect(within(middle()).getByRole('button', { name: 'Add to Open work' })).toHaveAttribute('aria-pressed', 'false')
    expect(toasts.shown.at(-1)).toMatchObject({ label: 'Taken out of Open work', type: 'neutral', actionLabel: 'Undo' })

    expect(press({ key: 'o', metaKey: true }).prevented).toBe(true)
    expect([...openWork.files]).toEqual([TOPIC_ADDRESS])
    expect(within(middle()).getByRole('button', { name: 'In Open work' })).toHaveAttribute('aria-pressed', 'true')
    expect(toasts.shown.at(-1)).toMatchObject({ label: 'Added to Open work', type: 'success' })
    expect(toasts.shown).toHaveLength(2)
  })

  describe('on a topic’s row', () => {
    const OTHER_D = '7c2f1d3e-4a5b-4c6d-9e7f-8091a2b3c4d5'
    const OTHER_ADDRESS = `30840:${CATH}:${OTHER_D}`
    const other = foreign({ ref: OTHER_ADDRESS, address: OTHER_ADDRESS, kind: 30840, appName: 'File', slots: { title: { value: 'Another topic' } } })
    const hover = (row: HTMLElement) => fireEvent.mouseEnter(row.firstElementChild!.lastElementChild!)
    /** The items of a row's ⋮, by the row's file. */
    const rowMenu = (address: string) => {
      const row = screen.getByTestId('left').querySelector(`[data-file="${address}"]`) as HTMLElement
      hover(row)
      fireEvent.click(within(row.parentElement!).getByRole('button', { name: 'More options' }))
      return screen.getAllByRole('menuitem')
    }

    beforeEach(() => {
      relay.files = [project, topic, other]
      objects.byAddress[OTHER_ADDRESS] = other
      topicsColumn.others = [topic, other]
      teamsHeld.teams = [
        team({ id: FOLDER, name: 'Folders', isMember: true, listed: [{ address: TOPIC_ADDRESS, space: false }, { address: OTHER_ADDRESS, space: false }] }),
      ]
    })

    // The open topic's row names it: "the team's row of a topic offers Open work…" above.
    it('another topic’s row does not name Ctrl/Cmd+O, since the key acts on the open topic’s page alone', () => {
      mount(`/topic/${TOPIC_ADDRESS}`)
      const otherItem = rowMenu(OTHER_ADDRESS).find((item) => item.textContent?.startsWith('Add to Open work'))!
      expect(otherItem.textContent).toBe('Add to Open work')
    })

    it('Add to Open work says so in a toast with Undo, as the page’s button does', () => {
      mount(`/topic/${TOPIC_ADDRESS}`)
      fireEvent.click(rowMenu(OTHER_ADDRESS).find((item) => item.textContent?.startsWith('Add to Open work'))!)
      expect([...openWork.files]).toEqual([OTHER_ADDRESS])
      expect(toasts.shown).toEqual([expect.objectContaining({ label: 'Added to Open work', type: 'success', actionLabel: 'Undo' })])
      act(() => toasts.shown[0].onAction!())
      expect([...openWork.files]).toEqual([])
    })

    it('Copy link puts the topic’s link on the clipboard and says “Link copied”', async () => {
      const writeText = vi.fn(async () => {})
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
      mount(`/topic/${TOPIC_ADDRESS}`)
      fireEvent.click(rowMenu(OTHER_ADDRESS).find((item) => item.textContent === 'Copy link')!)
      await waitFor(() => expect(toasts.shown).toEqual([expect.objectContaining({ label: 'Link copied', type: 'success' })]))
      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/topic/another-topic-${OTHER_D}`)
    })
  })

  it('an archived topic has no button, and Ctrl+O is left to the browser and changes nothing', () => {
    objects.byAddress[TOPIC_ADDRESS] = { ...topic, archived: { by: CATH, at: 1_790_000_000, resolution: 'Done.' } } as ForeignObject
    mount(`/topic/${TOPIC_ADDRESS}`)
    expect(within(middle()).getByText(/^Archived by/)).toBeInTheDocument()
    expect(within(middle()).queryByRole('button', { name: /Open work/ })).toBeNull()
    expect(press({ key: 'o', ctrlKey: true }).prevented).toBe(false)
    expect([...openWork.files]).toEqual([])
    expect(toasts.shown).toHaveLength(0)
  })
})
