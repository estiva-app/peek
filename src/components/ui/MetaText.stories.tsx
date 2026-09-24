import type { Meta, StoryObj } from '@storybook/react-vite'
import { MetaText } from './MetaText'

const meta = {
  title: 'Primitives/MetaText',
  component: MetaText,
  args: { children: '11:08 AM' },
} satisfies Meta<typeof MetaText>

export default meta
type Story = StoryObj<typeof meta>

/** A message's time, beside its author. */
export const Default: Story = {
  render: (args) => (
    <div className="flex items-baseline gap-2">
      <span className="text-body-2-strong text-text-primary">Juan Foley</span>
      <MetaText {...args} />
    </div>
  ),
}

/** A topic's open and resolved counts, as the header draws them. */
export const Counts: Story = {
  args: { children: '' },
  render: () => (
    <div className="flex items-center gap-2">
      <MetaText tone="secondary">6 open</MetaText>
      <MetaText tone="success">0 resolved</MetaText>
    </div>
  ),
}

/** The chip size, beside a small name: the thread panel and the Screener's preview. */
export const ChipSize: Story = {
  args: { size: 'chip', children: '9:14 AM' },
}
