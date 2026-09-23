import type { Meta, StoryObj } from '@storybook/react-vite'
import { JoinTopicBanner } from './JoinTopicBanner'

const meta = {
  title: 'To be removed/JoinTopicBanner',
  component: JoinTopicBanner,
  decorators: [
    Story => (
      <div className="w-[720px] max-w-full">
        <Story />
      </div>
    ),
  ],
  args: {
    title: 'Feedback on mobile onboarding flow',
    onJoin: () => {},
  },
} satisfies Meta<typeof JoinTopicBanner>

export default meta
type Story = StoryObj<typeof meta>

/** Shown above the composer of a topic the viewer is not a member of. */
export const Default: Story = {}

/** Long titles truncate; the Join action stays pinned to the right. */
export const LongTitle: Story = {
  args: { title: 'Usability test results for the dashboard redesign and the follow-up actions' },
}
