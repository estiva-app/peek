import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ForeignObject } from '@estiva-app/interop'
import { StartTopicDialog } from './StartTopicDialog'

/**
 * Starting a topic — a bare file, SPEC §6.7 (RFC 0.5 §10.7).
 *
 * Two cases shape the component and both are here: a topic at the top of a
 * Folder, and a topic started from a row, which sits *under* that file. The
 * second names the parent and its app, because "under" has a consequence the
 * person should hear before they type — the owning app shows the topic on that
 * file's page as related.
 */
const SHIP = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'

const project = {
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
  title: 'Components/StartTopicDialog',
  component: StartTopicDialog,
  parameters: { layout: 'centered' },
  args: {
    folderName: 'Folders',
    onCreate: async (): Promise<boolean> => true,
    onClose: () => {},
  },
} satisfies Meta<typeof StartTopicDialog>

export default meta
type Story = StoryObj<typeof meta>

/** A topic at the top of the Folder — no parent, no `a` tag. */
export const InAFolder: Story = {}

/**
 * Started from a Ship project's row. The dialog names the parent and says what
 * follows from it, because a person choosing "under" is choosing where Ship
 * will show it too.
 */
export const UnderAFile: Story = {
  args: { parent: project },
}
