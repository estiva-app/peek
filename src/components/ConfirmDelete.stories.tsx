import type { Meta, StoryObj } from '@storybook/react-vite'
import { ConfirmDelete } from './ConfirmDelete'

const noop = () => {}

/**
 * The question before a deletion (D56). The dialog is the package's
 * `ConfirmDialog` — its stories live there; these show Peek's words.
 */
const meta = {
  title: 'Overlays/ConfirmDelete',
  component: ConfirmDelete,
  parameters: {
    layout: 'fullscreen',
    docs: { story: { inline: false, height: '560px' } },
  },
  args: {
    what: 'message',
    replies: 2,
    onConfirm: noop,
    onClose: noop,
  },
} satisfies Meta<typeof ConfirmDelete>

export default meta
type Story = StoryObj<typeof meta>

/** A message with replies: the replies are separate events and stay. */
export const AMessage: Story = {}

/** A topic: Peek says so if the relay keeps it. */
export const ATopic: Story = {
  args: { what: 'topic', replies: 0 },
}

/** A topic its manifest lets you archive: Archive is offered as the safer answer (FOL-46). */
export const ATopicThatCanBeArchived: Story = {
  args: { what: 'topic', replies: 0, onArchiveInstead: noop },
}
