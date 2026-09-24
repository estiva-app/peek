import type { Meta, StoryObj } from '@storybook/react-vite'
import { FOLDER_HERE, PICKER_FOLDERS, SHIP_PROJECT, STATELESS_FOLDER } from '@/api/fixtures'
import { MoveFileDialog } from './MoveFileDialog'

const noop = () => {}

/**
 * Choosing where a file is filed (RFC 0.4 §2 — a Folder is an association, so
 * moving is re-associating).
 */
const meta = {
  title: 'Folders/MoveFileDialog',
  component: MoveFileDialog,
  parameters: {
    layout: 'fullscreen',
    docs: { story: { inline: false, height: '560px' } },
  },
  args: {
    file: SHIP_PROJECT,
    from: FOLDER_HERE,
    folders: PICKER_FOLDERS,
    onMove: async (): Promise<boolean> => true,
    onClose: noop,
  },
} satisfies Meta<typeof MoveFileDialog>

export default meta
type Story = StoryObj<typeof meta>

/**
 * The ordinary case. "Folders" is where the file is now, so it is absent from
 * the picker — an action that cannot do anything is not offered.
 */
export const PickADestination: Story = {}

/**
 * "Old topic channel" has no Folder state, so it is not offered (FOL-10): a
 * move into it would emit state listing only this file and hide everything
 * already filed there.
 */
export const StatelessFolderNotOffered: Story = {
  args: { folders: [...PICKER_FOLDERS, STATELESS_FOLDER] },
}

/** A Folder with no name is offered by its id rather than left out. */
export const UnnamedFolders: Story = {
  args: { folders: PICKER_FOLDERS.slice(2) },
}

/**
 * Nowhere to go, said rather than shown as an empty picker.
 *
 * Reachable whenever the only Folder is the one you are in, which is every
 * workspace on its first day — or when every other one has no state.
 */
export const NowhereToMoveIt: Story = {
  args: { folders: [PICKER_FOLDERS[0]!, STATELESS_FOLDER] },
}

/**
 * The write was refused, so the dialog stays open.
 *
 * `onMove` resolving false is the contract `ConfirmDialog` and `EditableText`
 * use too: the caller has already said why — a toast, here — and closing would
 * throw that away along with the chosen destination.
 */
export const Refused: Story = {
  args: { onMove: async () => false },
}
