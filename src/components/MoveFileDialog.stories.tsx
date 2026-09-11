import type { Meta, StoryObj } from '@storybook/react-vite'
import type { FolderSummary, ForeignObject } from '@estiva-app/interop'
import { MoveFileDialog } from './MoveFileDialog'

/**
 * Choosing where a file is filed (RFC 0.4 §2 — a Folder is an association, so
 * moving is re-associating).
 *
 * The fixture keeps the two cases that shape the component: a workspace with
 * several Folders, one of which is where the file already is and therefore is
 * not offered; and a workspace with only one, where there is nowhere to move to
 * and the dialog says that instead of offering an empty picker.
 */
const SHIP = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const HERE = '85db5b59-9e49-4ea1-8e93-3d2a2d78c048'

const folders: FolderSummary[] = [
  { id: HERE, name: 'Folders' },
  { id: '2303e8c1-c866-43b8-9b4c-e263f313a683', name: 'Feedback on Peek' },
  { id: 'a1b2c3d4-0000-4000-8000-000000000001', name: 'Performance & infrastructure' },
  // No name: a Folder with no state event carries only its channel's, and a
  // channel an app created may have none. The id is what a reader gets.
  { id: 'a1b2c3d4-0000-4000-8000-000000000002' },
] as FolderSummary[]

const file = {
  ref: `30850:${SHIP}:0ebd5fdd`,
  address: `30850:${SHIP}:0ebd5fdd`,
  naddr: 'naddr1',
  eventId: 'e',
  kind: 30850,
  widget: 'card',
  appName: 'Estiva Ship',
  slots: { title: { value: 'Folders: navigation for the whole suite' } },
  meta: [],
  comments: [],
  actions: [],
} as unknown as ForeignObject

const meta = {
  title: 'Components/MoveFileDialog',
  component: MoveFileDialog,
  parameters: { layout: 'centered' },
  args: {
    file,
    from: HERE,
    folders,
    onMove: async (): Promise<boolean> => true,
    onClose: () => {},
  },
} satisfies Meta<typeof MoveFileDialog>

export default meta
type Story = StoryObj<typeof meta>

/**
 * The ordinary case. "Folders" is where the file is now, so it is absent from
 * the picker — an action that cannot do anything is not offered.
 */
export const PickADestination: Story = {}

/** A Folder with no name is offered by its id rather than left out. */
export const UnnamedFolders: Story = {
  args: { folders: folders.slice(2) },
}

/**
 * Nowhere to go, said rather than shown as an empty picker.
 *
 * Reachable whenever the only Folder is the one you are in, which is every
 * workspace on its first day.
 */
export const NowhereToMoveIt: Story = {
  args: { folders: [folders[0]!] },
}

/**
 * The write was refused, so the dialog stays open.
 *
 * `onMove` resolving false is the contract `ConfirmDialog` and `EditableText`
 * use too: the caller has already said why — a toast, here — and closing would
 * throw that away along with the chosen destination.
 */
export const TheMoveWasRefused: Story = {
  args: { onMove: async () => false },
}
