import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ForeignObject } from '@estiva-app/interop'
import { SHIP_PROJECT } from '@/api/fixtures'
import { MoveDialog } from './MoveDialog'

const noop = () => {}

const topic = (d: string, title: string) =>
  ({
    ...SHIP_PROJECT,
    ref: `30840:${'a'.repeat(64)}:${d}`,
    address: `30840:${'a'.repeat(64)}:${d}`,
    kind: 30840,
    appName: 'Peek',
    parentField: 'parent',
    slots: { title: { value: title } },
  }) as unknown as ForeignObject

const NOTES = topic('notes', 'Notes')
const BRIEF = topic('brief', 'Brief')
const FOLDERS = [
  { id: 'hq', name: 'Estiva HQ' },
  { id: 'peek', name: 'Peek' },
  { id: 'steer', name: 'Steer' },
]

/**
 * Moving a file to another Folder, under another file, or both (FOL-45). The
 * Folder's targets are the caller's — `moveTargetsIn` over that Folder's
 * listing — and another Folder's are read when it is picked.
 */
const meta = {
  title: 'Folders/MoveDialog',
  component: MoveDialog,
  parameters: {
    layout: 'fullscreen',
    docs: { story: { inline: false, height: '560px' } },
  },
  args: {
    file: NOTES,
    from: 'hq',
    folders: FOLDERS,
    nests: true,
    targets: [
      { path: [] },
      { file: SHIP_PROJECT, path: ['Folders: navigation for the whole suite'] },
      { file: BRIEF, path: ['Folders: navigation for the whole suite', 'Brief'] },
    ],
    targetsIn: async () => [{ path: [] }, { file: BRIEF, path: ['Brief'] }],
    onMove: async (): Promise<boolean> => true,
    onClose: noop,
  },
} satisfies Meta<typeof MoveDialog>

export default meta
type Story = StoryObj<typeof meta>

/** A topic under something: its own Folder first, with the top and every other path. */
export const Topic: Story = {}

/** A project nests under nothing, so only the Folder is asked, and not the one it is in. */
export const Project: Story = {
  args: { file: SHIP_PROJECT, nests: false, targets: undefined },
}

/** Nowhere to go in its own Folder — a Folder holding only this file and what is under it. */
export const NowhereHere: Story = {
  args: { targets: [] },
}

/** Another Folder could not be read: said in the dialog, beside Try again. */
export const FolderUnreadable: Story = {
  args: { targets: [], targetsIn: async () => Promise.reject(new Error('down')) },
}

/** The write was refused: the dialog stays open, and the caller has said why. */
export const Refused: Story = {
  args: { onMove: async () => false },
}
