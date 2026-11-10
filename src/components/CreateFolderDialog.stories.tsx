import type { Meta, StoryObj } from '@storybook/react-vite'
import { CreateFolderDialog } from './CreateFolderDialog'

const noop = () => {}

/**
 * Making a Folder (FOL-41) — the header's first action, and what replaced the
 * name-and-Create row that sat above the Folders list.
 */
const meta = {
  title: 'Folders/CreateFolderDialog',
  component: CreateFolderDialog,
  parameters: {
    layout: 'fullscreen',
    docs: { story: { inline: false, height: '440px' } },
  },
  args: {
    onCreate: async () => true,
    onClose: noop,
  },
} satisfies Meta<typeof CreateFolderDialog>

export default meta
type Story = StoryObj<typeof meta>

/**
 * One field, because a Folder is a name and nothing else on the wire: the relay
 * mints the channel and its state from the command (§4.1).
 */
export const Default: Story = {}

/**
 * Renaming: the same dialog from a Folder's heading ⋮ (5 October) — "Rename
 * folder", the name filled in, no line about what a Folder is.
 */
export const Renaming: Story = { args: { rename: 'Design' } }
