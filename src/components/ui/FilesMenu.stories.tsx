import type { Meta, StoryObj } from '@storybook/react-vite'
import { TOPICS } from '@/api'
import { PeekDataProvider } from '@/api'
import { FilesMenu, type FilesMenuItem } from './FilesMenu'
import type { ConversationMessage } from '@/lib/conversationRegistry'

// Exactly what the `[` extension offers (mention.tsx): the topics, and the
// messages on screen (RIC-11). The Apps and Documents sections were mock rows
// and were retired on 2026-09-05 — a story that shows them would be showing a
// menu the app has never rendered.
const MESSAGES: ConversationMessage[] = [
  { id: 'm1', author: 'Ada Lovelace', timestamp: '9:41 AM', body: 'Build **#4821** failed again on the same step.', eventId: 'a'.repeat(64) },
  { id: 'm2', author: 'Grace Hopper', timestamp: '9:44 AM', body: 'Reverted the runner image; re-running now.', eventId: 'b'.repeat(64) },
  { id: 'm3', author: 'Ada Lovelace', timestamp: '9:52 AM', body: 'Green. Leaving the pin in place until Monday.', eventId: 'c'.repeat(64) },
]
const ITEMS: FilesMenuItem[] = [
  ...TOPICS.map<FilesMenuItem>((t) => ({ kind: 'topic', data: t })),
  ...MESSAGES.map<FilesMenuItem>((m) => ({ kind: 'message', data: m })),
]

const meta = {
  title: 'Messages/Composer/FilesMenu',
  component: FilesMenu,
  decorators: [
    Story => (
      <PeekDataProvider>
        <Story />
      </PeekDataProvider>
    ),
  ],
  args: {
    items: ITEMS,
    query: '',
    onSelect: () => {},
  },
  argTypes: {
    items: { control: false },
  },
} satisfies Meta<typeof FilesMenu>

export default meta
type Story = StoryObj<typeof meta>

/**
 * What `[` offers: the topics you can reference, each with its live status
 * icon, and below them the last few messages on screen, each as who said it
 * and how it opens. Rows are the shared `MenuItem` at its default size — one
 * line of text beside a 16px icon — so a message is cut to a line too.
 */
export const Default: Story = {}

/** Search mode: both sections, filtered by what you have typed. */
export const Filtered: Story = {
  args: { query: 'onboarding' },
}

/** A message is found by what was said or by who said it. */
export const FilteredToMessages: Story = {
  args: { query: 'ada' },
}

/** No conversation on screen (the composer in a DM, say): topics alone. */
export const TopicsOnly: Story = {
  args: { items: ITEMS.filter((i) => i.kind === 'topic') },
}

/** Nothing matches — the menu renders nothing rather than an empty box. */
export const NoMatches: Story = {
  args: { query: 'zzzz' },
}
