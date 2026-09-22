import type { Meta, StoryObj } from '@storybook/react-vite'
import { MemoryRouter } from 'react-router-dom'
import { DebugProvider } from '@/lib/debug'
import { PeekDataProvider } from '@/api'
import { LastSelectionProvider } from '@/lib/lastSelection'
import { EmptyState } from '@/components/ui/EmptyState'
import type { StarredItem } from '@/components/ui/StarredSection'
import { PeoplePageView, type PeopleListItem } from './PeoplePage'

const noop = () => {}

const STARRED: StarredItem[] = [
  { id: 'amie', name: 'Amie Miles', type: 'DM', isUnread: true, isUrgent: false },
  { id: 'daniel', name: 'Daniel Stanton', type: 'DM', isUnread: false, isUrgent: false },
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
      rightPanel={<EmptyState />}
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
      rightPanel={<EmptyState />}
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
