import type { Meta, StoryObj } from '@storybook/react-vite'
import { MemoryRouter } from 'react-router-dom'
import { DebugProvider } from '@/lib/debug'
import { PeekDataProvider } from '@/api'
import { LastSelectionProvider } from '@/lib/lastSelection'
import { EmptyState } from '@/components/ui/EmptyState'
import type { StarredItem } from '@/components/ui/StarredSection'
import { PeoplePageView, type PeopleListItem } from './PeoplePage'
import { TopicsPageView, type TopicListItem } from './TopicsPage'

const noop = () => {}

const STARRED: StarredItem[] = [
  { id: 'amie', name: 'Amie Miles', type: 'DM', isUnread: true, isUrgent: false },
  { id: 'daniel', name: 'Daniel Stanton', type: 'DM', isUnread: false, isUrgent: false },
]

const TOPICS: TopicListItem[] = [
  { id: 't1', title: 'CI/CD pipeline stuck during build stage', isResolved: false, isUnread: true, isUrgent: true, isMember: true, inOpenWork: true },
  { id: 't2', title: 'Launch checklist for v2 of the mobile app', isResolved: false, isUnread: true, isUrgent: false, isMember: true, inOpenWork: false },
  { id: 't3', title: 'Ongoing onboarding issues', isResolved: false, isUnread: false, isUrgent: false, isMember: true, inOpenWork: false },
  { id: 't4', title: 'Remote work policy clarifications', isResolved: true, isUnread: false, isUrgent: false, isMember: true, inOpenWork: false },
  { id: 't5', title: 'Usability test results for the dashboard redesign', isResolved: true, isUnread: false, isUrgent: false, isMember: false, inOpenWork: false },
  { id: 't6', title: 'Pricing page copy', isResolved: false, isUnread: false, isUrgent: false, isMember: false, inOpenWork: false },
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

/**
 * The Topics page, with topics the reader is **not** a member of present — so
 * the list splits into "Your topics" and "Other topics" (QA #2.7).
 */
export const Topics: Story = {
  render: () => (
    <TopicsPageView
      railClosed={false}
      loading={false}
      topics={TOPICS}
      selectedId="t1"
      onSelect={noop}
      onNewTopic={noop}
      onDeleteTopic={noop}
      onOpenDetails={noop}
      onToggleOpenWork={noop}
      rightPanel={<EmptyState />}
    />
  ),
}

/**
 * The same page where the reader is a member of everything: **one flat list**,
 * no sections at all. Which of the two you get is decided by the topics, not by
 * a setting, and this is the first story that shows both shapes exist.
 */
export const TopicsFlat: Story = {
  render: () => (
    <TopicsPageView
      railClosed={false}
      loading={false}
      topics={TOPICS.filter((t) => t.isMember)}
      selectedId="t3"
      onSelect={noop}
      onNewTopic={noop}
      onDeleteTopic={noop}
      onOpenDetails={noop}
      onToggleOpenWork={noop}
      rightPanel={<EmptyState />}
    />
  ),
}

/** Topics, first read in flight. */
export const TopicsLoading: Story = {
  render: () => (
    <TopicsPageView
      railClosed={false}
      loading
      topics={[]}
      selectedId={null}
      onSelect={noop}
      onNewTopic={noop}
      onDeleteTopic={noop}
      onOpenDetails={noop}
      onToggleOpenWork={noop}
      rightPanel={<div className="flex-1 h-full" />}
    />
  ),
}
