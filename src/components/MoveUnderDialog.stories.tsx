import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ForeignObject } from '@estiva-app/interop'
import { SHIP_PROJECT } from '@/api/fixtures'
import { MoveUnderDialog } from './MoveUnderDialog'

const noop = () => {}

const topic = (d: string, title: string) =>
  ({
    ...SHIP_PROJECT,
    ref: `30840:${'a'.repeat(64)}:${d}`,
    address: `30840:${'a'.repeat(64)}:${d}`,
    kind: 30840,
    appName: 'File',
    slots: { title: { value: title } },
  }) as unknown as ForeignObject

const NOTES = topic('notes', 'Notes')
const BRIEF = topic('brief', 'Brief')

/**
 * Putting a file under another file in the same team, or back at the top
 * (FOL-4). Where it may go is the caller's: `nestingOf(...).moveTargetsOf`.
 */
const meta = {
  title: 'Folders/MoveUnderDialog',
  component: MoveUnderDialog,
  parameters: {
    layout: 'fullscreen',
    docs: { story: { inline: false, height: '560px' } },
  },
  args: {
    file: NOTES,
    teamName: 'Estiva HQ',
    targets: [
      { path: [] },
      { file: SHIP_PROJECT, path: ['Folders: navigation for the whole suite'] },
      { file: BRIEF, path: ['Folders: navigation for the whole suite', 'Brief'] },
    ],
    onMove: async (): Promise<boolean> => true,
    onClose: noop,
  },
} satisfies Meta<typeof MoveUnderDialog>

export default meta
type Story = StoryObj<typeof meta>

/** A file under something, so the top is offered first, then every path. */
export const PickAParent: Story = {}

/** Nowhere to go — a team holding only this file and what is under it. */
export const NowhereToMoveIt: Story = {
  args: { targets: [] },
}

/** The write was refused: the dialog stays open, as `MoveFileDialog` does. */
export const Refused: Story = {
  args: { onMove: async () => false },
}
