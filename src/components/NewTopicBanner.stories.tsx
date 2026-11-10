import type { Meta, StoryObj } from '@storybook/react-vite'
import { NewTopicBanner } from './NewTopicBanner'

const meta = {
  title: 'Topics/NewTopicBanner',
  component: NewTopicBanner,
  decorators: [
    Story => (
      <div className="w-[720px] max-w-full">
        <Story />
      </div>
    ),
  ],
  args: {
    name: 'Amie Wong',
  },
} satisfies Meta<typeof NewTopicBanner>

export default meta
type Story = StoryObj<typeof meta>

/** The beginning of a direct message with a person: no messages yet. */
export const DmBeginning: Story = {}
