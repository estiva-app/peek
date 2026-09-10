import type { Meta, StoryObj } from '@storybook/react-vite'
import { ConfirmDelete } from './ConfirmDelete'

/**
 * The question before a deletion (D56). The dialog is the package's
 * `ConfirmDialog` — its stories live there; this one shows Peek's words.
 */
const meta = {
  title: 'Messages/ConfirmDelete',
  component: ConfirmDelete,
  args: {
    what: 'message',
    replies: 2,
    onConfirm: () => {},
    onClose: () => {},
  },
} satisfies Meta<typeof ConfirmDelete>

export default meta
type Story = StoryObj<typeof meta>

/** A message with replies: the replies are separate events and stay. */
export const Message: Story = {}

/** A topic: Peek says so if the relay keeps it. */
export const Topic: Story = { args: { what: 'topic', replies: 0 } }
