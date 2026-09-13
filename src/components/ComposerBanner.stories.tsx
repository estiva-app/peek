import type { Meta, StoryObj } from '@storybook/react-vite'
import { IconPencilMinus, IconUserPlus } from '@tabler/icons-react'
import { ComposerBanner } from './ComposerBanner'

const meta = {
  title: 'Topics/ComposerBanner',
  component: ComposerBanner,
  decorators: [
    Story => (
      <div className="w-[720px] max-w-full">
        <Story />
      </div>
    ),
  ],
  args: {
    icon: IconUserPlus,
    children: (
      <>
        You&apos;re not a member of <span className="font-medium">Feedback on mobile onboarding flow</span> yet
      </>
    ),
    action: { label: 'Join topic', onClick: () => {} },
  },
  argTypes: { icon: { control: false }, children: { control: false } },
} satisfies Meta<typeof ComposerBanner>

export default meta
type Story = StoryObj<typeof meta>

/** The strip with its one action — what `JoinTopicBanner` and `NewTopicBanner` draw. */
export const WithAction: Story = {}

/** No action: the line alone, as a direct message's first-message banner has it. */
export const WithoutAction: Story = {
  args: {
    icon: IconPencilMinus,
    children: (
      <>
        This is the beginning of your conversation with <span className="font-medium">Amie Wong</span>
      </>
    ),
    action: undefined,
  },
}
