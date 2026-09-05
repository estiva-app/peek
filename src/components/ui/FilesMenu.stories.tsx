import type { Meta, StoryObj } from '@storybook/react-vite'
import { TOPICS } from '@/api'
import { PeekDataProvider } from '@/api'
import { FilesMenu, type FilesMenuItem } from './FilesMenu'

// Exactly what the `[` extension offers (mention.tsx): topics, and nothing
// else. The Apps and Documents sections were mock rows and were retired on
// 2026-09-05 — a story that shows them would be showing a menu the app has
// never rendered.
const ITEMS: FilesMenuItem[] = TOPICS.map<FilesMenuItem>((t) => ({ kind: 'topic', data: t }))

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
 * icon. Rows are the shared `MenuItem` at its default size — one line of text
 * beside a 16px icon — because a topic has no second line to carry.
 */
export const Default: Story = {}

/** Search mode: the same section, filtered by what you have typed. */
export const Filtered: Story = {
  args: { query: 'onboarding' },
}

/** Nothing matches — the menu renders nothing rather than an empty box. */
export const NoMatches: Story = {
  args: { query: 'zzzz' },
}
