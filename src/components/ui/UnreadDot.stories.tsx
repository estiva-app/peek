import type { Meta, StoryObj } from '@storybook/react-vite'
import { UnreadDot } from './UnreadDot'

const meta = {
  title: 'Primitives/UnreadDot',
  component: UnreadDot,
} satisfies Meta<typeof UnreadDot>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: args => <UnreadDot {...args} />,
}

/** Beside a line of text, as a list row draws it: the slot keeps the row's height. */
export const InARow: Story = {
  render: args => (
    <div className="flex w-64 items-center gap-1 text-body-2 text-text-primary">
      <span className="min-w-0 flex-1 truncate">A row with something new</span>
      <UnreadDot {...args} />
    </div>
  ),
}
