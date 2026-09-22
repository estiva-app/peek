import type { Meta, StoryObj } from '@storybook/react-vite'
import { ReadOnlyTopicBanner } from './ReadOnlyTopicBanner'

const meta = {
  title: 'Topics/ReadOnlyTopicBanner',
  component: ReadOnlyTopicBanner,
  decorators: [
    Story => (
      <div className="w-[720px] max-w-full">
        <Story />
      </div>
    ),
  ],
  args: {
    onOpenFolder: () => {},
  },
} satisfies Meta<typeof ReadOnlyTopicBanner>

export default meta
type Story = StoryObj<typeof meta>

/** In place of a Convex topic's composer, with the Folder panel closed. */
export const Default: Story = {}

/** The Folder panel is already open, or the topic has no Folder: no action. */
export const NoAction: Story = {
  args: { onOpenFolder: undefined },
}
