import type { Meta, StoryObj } from '@storybook/react-vite'
import { EditedMarker } from './EditedMarker'

const meta = {
  title: 'To be removed/EditedMarker',
  component: EditedMarker,
  args: {
    editedAt: Date.now() - 5 * 60_000,
  },
} satisfies Meta<typeof EditedMarker>

export default meta
type Story = StoryObj<typeof meta>

/** Beside a time, the way a card draws it. Hover for when. */
export const Default: Story = {
  render: args => (
    <div className="flex items-center gap-2">
      <span className="text-body-2-strong text-text-primary">Juan Foley</span>
      <span className="text-caption text-text-muted">9:14 AM</span>
      <EditedMarker {...args} />
    </div>
  ),
}

/** Nothing at all when the message was never edited. */
export const Unedited: Story = {
  args: { editedAt: undefined },
  render: args => (
    <div className="flex items-center gap-2">
      <span className="text-body-2-strong text-text-primary">Juan Foley</span>
      <span className="text-caption text-text-muted">9:14 AM</span>
      <EditedMarker {...args} />
    </div>
  ),
}
