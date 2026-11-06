import type { Meta, StoryObj } from '@storybook/react-vite'
import { MemoryRouter } from 'react-router-dom'
import { LastSelectionProvider } from '@/lib/lastSelection'
import { ToastProvider } from '@/lib/toast'
import { PeekTopics } from './PeekTopics'

/**
 * Peek's screens of "Topics: level up the topic experience", a prototype on
 * the `concept/topics-level-up` branch only (it never merges). Drawn on
 * Peek's own frame and components on main; only what the project changes is
 * changed. Read me first.
 */
const meta = {
  title: 'Prototype/Topics level-up/Screens',
  component: PeekTopics,
  parameters: { layout: 'fullscreen' },
  decorators: [
    // The rail lights Topics, as on a topic opened from the Topics column.
    (Story) => (
      <MemoryRouter initialEntries={['/app/topics']}>
        <LastSelectionProvider>
          <ToastProvider>
            <Story />
          </ToastProvider>
        </LastSelectionProvider>
      </MemoryRouter>
    ),
  ],
} satisfies Meta<typeof PeekTopics>
export default meta
type Story = StoryObj<typeof meta>

/** Widgets open: the flat sidebar, the header's Add to Open work, and the topic's files in its Overview. Hover a file for its "…", drag one to move it. */
export const PeekATopicsFiles: Story = { name: 'Peek: a topic’s files', args: {} }

/** Nothing open; two seconds in, Katerina writes in Onboarding and it jumps to the top with its dot. */
export const PeekANewMessageMovesATopic: Story = { name: 'Peek: a new message moves a topic', args: { start: { type: 'none' }, live: true } }

/** Explore topics: All, Your topics, Other topics and Archived, with a search; Join on a topic you're not in. */
export const PeekExploreTopics: Story = { name: 'Peek: Explore topics', args: { start: { type: 'explore' } } }

/** Widgets already in Open work: the header's button says so, and Ctrl/Cmd+O takes it out. */
export const PeekInOpenWork: Story = { name: 'Peek: a topic in Open work', args: { openWork: ['widgets'] } }

/** Hiring, which Miky is not in: its files, no drag, no "…", no Add file. */
export const PeekATopicYoureNotIn: Story = { name: 'Peek: a topic you’re not in', args: { start: { type: 'topic', id: 'hiring' } } }

/** Comments everywhere, archived: read-only, its menu Copy link, Unarchive and Delete; no Add to Open work. */
export const PeekAnArchivedTopic: Story = { name: 'Peek: an archived topic', args: { start: { type: 'topic', id: 'comments' } } }

/** Brand refresh as Katerina: a topic with no files yet. */
export const PeekATopicWithNoFiles: Story = { name: 'Peek: a topic with no files', args: { viewer: 'katerina', start: { type: 'topic', id: 'brand' } } }

/** In no topic yet: the sidebar says so above Explore topics. */
export const PeekNoTopics: Story = { name: 'Peek: no topics yet', args: { none: true, start: { type: 'none' } } }

export const PeekLoading: Story = { name: 'Peek: loading', args: { read: 'loading', topic: 'loading' } }

export const PeekReadFailed: Story = { name: 'Peek: read failed', args: { read: 'failed', topic: 'failed' } }

/** Explore topics while its read is out, and when it failed. */
export const PeekExploreLoading: Story = { name: 'Peek: Explore topics loading', args: { start: { type: 'explore' }, read: 'loading' } }
export const PeekExploreFailed: Story = { name: 'Peek: Explore topics read failed', args: { start: { type: 'explore' }, read: 'failed' } }
