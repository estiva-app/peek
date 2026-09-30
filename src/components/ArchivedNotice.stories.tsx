import type { Meta, StoryObj } from '@storybook/react-vite'
import { ArchivedNotice } from './ArchivedNotice'

const noop = () => {}
const PROJECT = `30850:${'b'.repeat(64)}:bea1c4f7-cab4-47a1-bb4b-966e20fcf945`

/**
 * What an archived file or Folder opens under (FOL-46): who archived it and
 * when, the resolution first, and the way back.
 */
const meta = {
  title: 'Folders/ArchivedNotice',
  component: ArchivedNotice,
  args: {
    archive: { by: 'x', at: Math.floor(Date.now() / 1000), resolution: 'Shipped in 0.37; the rest moved to FOL-47.' },
    by: 'Miky',
    onUnarchive: noop,
  },
} satisfies Meta<typeof ArchivedNotice>

export default meta
type Story = StoryObj<typeof meta>

/** Archived itself, with a resolution: Unarchive restores it here. */
export const Archived: Story = {}

/** Hidden with its project: restored there, so the notice opens it. */
export const ArchivedWithItsProject: Story = {
  args: {
    archive: { by: 'x', at: Math.floor(Date.now() / 1000), with: PROJECT },
    withWhat: 'project',
    onOpenParent: noop,
  },
}
