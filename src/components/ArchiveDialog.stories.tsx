import type { Meta, StoryObj } from '@storybook/react-vite'
import { ArchiveDialog } from './ArchiveDialog'

const noop = () => {}

/**
 * The question before archiving a file or a Folder (FOL-46): what goes with
 * it, counted, and an optional resolution. The shell is the package's
 * `ConfirmDialog`; these show Peek's words.
 */
const meta = {
  title: 'Overlays/ArchiveDialog',
  component: ArchiveDialog,
  parameters: {
    layout: 'fullscreen',
    docs: { story: { inline: false, height: '560px' } },
  },
  args: {
    title: 'Conversation standard',
    what: 'project',
    hides: ['14 issues'],
    onClose: noop,
    onArchive: async () => true,
  },
} satisfies Meta<typeof ArchiveDialog>

export default meta
type Story = StoryObj<typeof meta>

/** A project and the issues that go with it. */
export const AProject: Story = {}

/** A topic with nothing under it: only the topic goes. */
export const ATopic: Story = {
  args: { title: 'Release notes', what: 'topic', hides: [] },
}

/** A Folder: what only it lists goes, and what another Folder lists stays there. */
export const AFolder: Story = {
  args: { title: 'Estiva HQ', what: 'folder', hides: ['3 projects', '6 topics'], staysVisible: ['2 files also in Steer'] },
}
