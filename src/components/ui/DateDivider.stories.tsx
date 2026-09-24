import type { Meta, StoryObj } from '@storybook/react-vite'
import { Card, ScrollArea } from '@estiva-app/ui'
import { DateDivider } from './DateDivider'

const meta = {
  title: 'Primitives/DateDivider',
  component: DateDivider,
  args: {
    label: 'Today',
  },
} satisfies Meta<typeof DateDivider>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: args => (
    <div className="w-96">
      <DateDivider {...args} />
    </div>
  ),
}

export const LongLabel: Story = {
  args: { label: 'Wednesday, February 25th' },
  render: args => (
    <div className="w-96">
      <DateDivider {...args} />
    </div>
  ),
}

/** The thread panel uses it to separate the pinned original message from its replies. */
export const RepliesLabel: Story = {
  args: { label: 'Replies' },
  render: args => (
    <div className="w-96">
      <DateDivider {...args} />
    </div>
  ),
}

/** As used in message streams: sticky against the scroll with a surface background. Scroll the box. */
export const StickyInScroll: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Card clip className="h-64 w-96">
      <ScrollArea className="h-full">
        {['Yesterday', 'Today'].map(day => (
          <div key={day} className="flex flex-col">
            <DateDivider label={day} className="sticky top-0 z-10 bg-bg-surface" />
            {Array.from({ length: 6 }, (_, i) => (
              <p key={i} className="px-4 py-3 text-body-2 text-text-secondary">
                Message {i + 1} from {day.toLowerCase()}
              </p>
            ))}
          </div>
        ))}
      </ScrollArea>
    </Card>
  ),
}
