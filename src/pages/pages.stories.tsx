import type { Meta, StoryObj } from '@storybook/react-vite'
import { MemoryRouter } from 'react-router-dom'
import { DebugProvider } from '@/lib/debug'
import { PeekDataProvider } from '@/api'
import { LastSelectionProvider } from '@/lib/lastSelection'
import { SCREENER_ITEMS, SCREENER_PREVIEW_ROWS } from '@/api/fixtures'
import { ScreenerPreviewCardView } from '@/components/ScreenerPreviewCard'
import type { StarredItem } from '@/components/ui/StarredSection'
import { PeoplePageView, type PeopleListItem } from './PeoplePage'
import { DeskPageView, type DeskRow } from './DeskPage'
import { FoldersPageView } from './FoldersPage'
import { FilePageView } from './FilePage'
import { FolderColumn, FolderTreeView } from '@/components/views/FolderTree'
import type { FolderSummary } from '@estiva-app/interop'
import type { TreeShow, TreeView } from '@/components/views/treeFilter'
import { treeFilterOf } from '@/components/views/treeFilter'
import { ObjectPageView } from './ObjectPage'
import { EmptyState, Panel } from '@estiva-app/ui'
import { ArchivedNotice } from '@/components/ArchivedNotice'
import { DateDivider } from '@/components/ui/DateDivider'

const noop = () => {}

const STARRED: StarredItem[] = [
  { id: 'amie', name: 'Amie Miles', type: 'DM', isUnread: true, isUrgent: false },
  { id: 'daniel', name: 'Daniel Stanton', type: 'DM', isUnread: false, isUrgent: false },
]

/** The hover card a Screener row opens, from the one fixture every Screener
 *  story uses. The real one reads the conversation, which needs a backend. */
const screenerPreview = () => <ScreenerPreviewCardView rows={SCREENER_PREVIEW_ROWS} />

const row = (
  id: string,
  kind: DeskRow['kind'],
  name: string,
  extra: Partial<DeskRow> = {},
): DeskRow => ({ id, kind, name, href: '#', isUnread: false, isSelected: false, onClick: noop, ...extra })

const URGENT: DeskRow[] = [
  row('u1', 'dm', 'Hallie Pratt', { isUnread: true, isUrgent: true, isSelected: true }),
  row('u2', 'dm', 'Alice Johnson', { isUnread: true, isUrgent: true }),
]

const OPEN_WORK: DeskRow[] = [
  row('o1', 'file', 'Launch checklist for v2 of the mobile app', { isUnread: true, glyph: 'topic', onRemove: noop }),
  // A Ship project and a Ship issue wear Ship's glyphs here too (7 October).
  row('o2', 'file', 'Payments v2', { glyph: 'project', onRemove: noop }),
  row('o4', 'file', 'Card form validation', { isUnread: true, glyph: 'issue', onRemove: noop }),
  // Archived where it lives, still on the list: point at it and the chip says so (Katerina, 14 October).
  row('o5', 'file', 'Remote work policy clarifications', { glyph: 'topic', archived: true, onRemove: noop }),
  row('o6', 'file', 'Quarterly planning notes for the design review', { glyph: 'topic', archived: true, onRemove: noop }),
  row('o3', 'dm', 'Daniel Stanton', { onRemove: noop }),
]

const STARRED_ROWS: DeskRow[] = [
  row('s1', 'dm', 'Amie Miles', { isUnread: true }),
  row('s2', 'dm', 'Juan Foley'),
]

/** The five team Folders FOL-20 leaves on production — the same fixture
 *  `Navigation/FolderTree` uses, so the two stories agree about what is there. */
const FOLDERS = [
  { id: '925897ad-796e-4bc6-999c-ca19df26c4aa', name: 'Peek', hasState: true },
  { id: '3789d2ca-103c-40e5-906f-0490782db5fd', name: 'Ship', hasState: true },
  { id: '85db5b59-9e49-4ea1-8e93-3d2a2d78c048', name: 'Estiva HQ', hasState: true },
  { id: '0f7d2c1e-2b0a-4a25-9a2a-1a2b3c4d5e6f', name: 'Leaf', hasState: true },
  { id: '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f', name: 'Steer', hasState: true },
]

const PEOPLE: PeopleListItem[] = [
  { id: 'alice', name: 'Alice Johnson', isUnread: true, isUrgent: true, canHide: true },
  { id: 'juan', name: 'Juan Foley', isUnread: true, isUrgent: false, canHide: true },
  { id: 'greg', name: 'Greg Bothman', isUnread: false, isUrgent: false, canHide: true },
  { id: 'hallie', name: 'Hallie Pratt', isUnread: false, isUrgent: false, canHide: false },
  { id: 'jake', name: 'Jake Walter', isUnread: false, isUrgent: false, canHide: true },
  { id: 'bob', name: 'Bob Chen', isUnread: false, isUrgent: false, canHide: true },
]

/**
 * **A page is a view placed in the shell** — Katerina's ruling of 9 September,
 * which Ship has followed since: *a view alone is under Views, a page in the
 * shell under Pages.*
 *
 * Peek could not do this until UIG-17, because its pages fetched inside
 * themselves and took no props: there was nothing a story could hand a fixture
 * to, so the only page stories possible were the whole live app on a route,
 * fed by the invented data. Those are gone; these replace them.
 *
 * What that buys is the states the live page could never be made to show on
 * demand — an empty workspace, a first read still in flight, a name long
 * enough to wrap.
 */
const meta = {
  title: 'Pages/In the shell',
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <MemoryRouter initialEntries={['/app/people/alice']}>
        <DebugProvider>
          <PeekDataProvider>
            <LastSelectionProvider>
              <Story />
            </LastSelectionProvider>
          </PeekDataProvider>
        </DebugProvider>
      </MemoryRouter>
    ),
  ],
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** The People page: starred at the top, then everybody else. */
export const People: Story = {
  render: () => (
    <PeoplePageView
      railClosed={false}
      loading={false}
      starred={STARRED}
      people={PEOPLE}
      selectedId="alice"
      onSelect={noop}
      onHideDm={noop}
      rightPanel={<EmptyState message="No conversation selected" />}
    />
  ),
}

/**
 * **An empty workspace** — nobody starred, nobody else either.
 *
 * The divider is the thing to look at: it is drawn only when there are people
 * under it, so there is no line dangling under an empty Starred section. That
 * was issue #2, and this is the first story able to show it.
 */
export const PeopleEmpty: Story = {
  render: () => (
    <PeoplePageView
      railClosed={false}
      loading={false}
      starred={[]}
      people={[]}
      selectedId={null}
      onSelect={noop}
      onHideDm={noop}
      rightPanel={<EmptyState message="No conversation selected" />}
    />
  ),
}

/**
 * **The first read, still in flight**, which is not the same thing as an empty
 * workspace and must not look like it.
 */
export const PeopleLoading: Story = {
  render: () => (
    <PeoplePageView
      railClosed={false}
      loading
      starred={[]}
      people={[]}
      selectedId={null}
      onSelect={noop}
      onHideDm={noop}
      rightPanel={<div className="flex-1 h-full" />}
    />
  ),
}

/**
 * The Desk, with every section carrying something: the screener, Urgent, Open
 * work and Starred.
 */
export const Desk: Story = {
  render: () => (
    <DeskPageView
      railClosed={false}
      loading={false}
      screener={SCREENER_ITEMS.slice(0, 2)}
      onOpenScreener={noop}
      onDismissScreener={noop}
      onLaterScreener={noop}
      screenerPreviewFor={screenerPreview}
      urgent={URGENT}
      openWork={OPEN_WORK}
      starred={STARRED_ROWS}
      rightPanel={<EmptyState message="No conversation selected" />}
    />
  ),
}

/**
 * **A Desk with nothing on it.**
 *
 * Every section hides itself when it is empty, except Open work, which says
 * what it is *for*, and Starred, which says how to fill it. Four headings over
 * nothing would be a page that looks broken; these two are the ones a person is
 * meant to fill, so they speak.
 */
export const DeskEmpty: Story = {
  render: () => (
    <DeskPageView
      railClosed={false}
      loading={false}
      screener={[]}
      onOpenScreener={noop}
      onDismissScreener={noop}
      onLaterScreener={noop}
      urgent={[]}
      openWork={[]}
      starred={[]}
      rightPanel={<EmptyState message="No conversation selected" />}
    />
  ),
}

/** The Desk, first read in flight. */
export const DeskLoading: Story = {
  render: () => (
    <DeskPageView
      railClosed={false}
      loading
      screener={[]}
      onOpenScreener={noop}
      onDismissScreener={noop}
      onLaterScreener={noop}
      urgent={[]}
      openWork={[]}
      starred={[]}
      rightPanel={<div className="flex-1 h-full" />}
    />
  ),
}

/**
 * The Topics column with a fixture — `FolderColumn` and `FolderTreeView`, the
 * two halves the wired `FolderTree` puts together. Its title is the view, and
 * opens a menu of the views; its header holds New folder (in Folders only),
 * New topic and the filter (Katerina, 5 October). An open Folder's rows are a
 * relay read, so here every Folder is folded or reads as empty.
 */
function Column({ view = 'mine', show = 'all', signedOut = false, folders = FOLDERS, unread = {}, member = {}, currentFolder }: {
  view?: TreeView
  show?: TreeShow
  signedOut?: boolean
  folders?: FolderSummary[] | null
  unread?: Record<string, boolean>
  member?: Record<string, boolean>
  currentFolder?: string
}) {
  return (
    <FolderColumn view={view} onViewChange={noop} show={show} onShowChange={noop} railClosed={false} signedOut={signedOut} onNewFolder={noop} onNewTopic={noop}>
      <FolderTreeView
        folders={folders}
        signedOut={signedOut}
        unread={unread}
        member={member}
        view={view}
        filter={treeFilterOf(view, show)}
        currentFolder={currentFolder}
        onSelect={noop}
        menuFor={() => null}
      />
    </FolderColumn>
  )
}

/** Every Folder the person is a member of something in. */
const MINE = Object.fromEntries(FOLDERS.map((folder) => [folder.id, true]))

/**
 * Topics, where the rail's Topics opens: what you are a member of, grouped by
 * Folder. Click "Topics ⌄" for the other view.
 */
export const Topics: Story = {
  render: () => <FoldersPageView nav={<Column member={MINE} />} rightPanel={<EmptyState message="No file selected" />} />,
}

/**
 * Folders: every Folder, each with the folder icon, the explorer. New folder
 * is in this view's header only. A Folder's own link lands here, with it open.
 */
export const Folders: Story = {
  render: () => <FoldersPageView nav={<Column view="all" />} rightPanel={<EmptyState message="No file selected" />} />,
}

/**
 * Archive: every Folder, the archived ones too, each closed — opening one
 * reads what is archived in it, and an archived Folder's ⋮ is Unarchive. No
 * header actions: nothing is made or filtered here (Katerina, 5 October).
 */
export const Archive: Story = {
  render: () => (
    <FoldersPageView
      nav={<Column view="archive" folders={[...FOLDERS, { id: '0a9b8c7d-6e5f-4a3b-9c2d-1e0f9a8b7c6d', name: 'Old launch plan', hasState: true, archived: { by: 'a'.repeat(64), at: 1 } }]} />}
      rightPanel={<EmptyState message="No file selected" />}
    />
  ),
}

/**
 * **Signed out.** No header actions — every one of them acts as somebody — and
 * the tree says so in its own words. The first version of this page told a
 * signed-out viewer "No folders yet" about a workspace holding eighty-one.
 */
export const FoldersSignedOut: Story = {
  render: () => <FoldersPageView nav={<Column view="all" signedOut folders={null} />} rightPanel={<EmptyState message="No file selected" />} />,
}

/**
 * **Filtered to Unread.** The filter button stays pressed while Unread is
 * chosen, because the tree is hiding rows and nothing else on screen says so.
 */
export const FoldersFiltered: Story = {
  render: () => (
    <FoldersPageView
      nav={<Column view="all" show="unread" unread={{ '3789d2ca-103c-40e5-906f-0490782db5fd': true }} />}
      rightPanel={<EmptyState message="No file selected" />}
    />
  ),
}

/**
 * A file's page: the Folder tree on the left, opened to where the file lives,
 * and the file's own panes beside it. Both panes read and write the file they
 * show, so the page hands them over as nodes; here they stand in as empties.
 */
export const File: Story = {
  render: () => (
    <FilePageView
      nav={<Column view="all" currentFolder="3789d2ca-103c-40e5-906f-0490782db5fd" />}
      rightPanel={<EmptyState message="No file selected" />}
    />
  ),
}

/**
 * **An archived file.** Read-only until it is unarchived (Katerina, 7
 * October): no composer, and the notice in its place, as a card — who
 * archived it and when, the resolution, and Unarchive. The messages here are
 * stand-ins.
 */
export const FileArchived: Story = {
  render: () => (
    <FilePageView
      nav={<Column view="all" currentFolder="3789d2ca-103c-40e5-906f-0490782db5fd" />}
      rightPanel={
        <Panel
          title="Release notes for 0.37"
          bodyClassName="flex min-h-full flex-col"
          footer={
            <div className="p-3">
              <ArchivedNotice
                archive={{ by: 'x', at: Math.floor(Date.now() / 1000) - 86_400 * 2, resolution: 'Shipped in 0.37. What was left moved to the 0.38 topic.' }}
                by="Miky"
                onUnarchive={noop}
                look="card"
              />
            </div>
          }
        >
          {['Monday', 'Tuesday', 'Yesterday'].map((day) => (
            <div key={day} className="flex flex-col">
              <DateDivider label={day} className="sticky top-0 z-10 bg-bg-surface" />
              {Array.from({ length: 6 }, (_, i) => (
                <p key={i} className="px-4 py-2 text-body-2 text-text-secondary">
                  A message from {day.toLowerCase()}, number {i + 1}.
                </p>
              ))}
            </div>
          ))}
        </Panel>
      }
    />
  ),
}

/**
 * `/o/<bech32>` while it resolves, and when it cannot.
 *
 * **The second one is the state nobody could see**: reaching it meant finding a
 * reference Peek genuinely cannot open. Another app's `naddr` is a valid
 * reference, and sending it somewhere arbitrary would be worse than saying so.
 */
export const ObjectOpening: Story = {
  render: () => <ObjectPageView state="looking" />,
}

export const ObjectUnopenable: Story = {
  render: () => <ObjectPageView state="unopenable" />,
}

/** **A workspace with no Folders in it at all** — which is a different sentence
 *  from "not signed in", and from a read still in flight. */
export const FoldersEmpty: Story = {
  render: () => <FoldersPageView nav={<Column view="all" folders={[]} />} rightPanel={<EmptyState message="No file selected" />} />,
}
