import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ForeignObject } from '@estiva-app/interop'
import { FileTreeView } from './FileTreeView'

/**
 * A Folder's files as sidebar rows — the file page's left column (FOL-19).
 *
 * The fixture is the Folders project's own Folder as production holds it: a
 * Ship project with issues under it, and a Peek bare file beside it. In a
 * 290px column the card view wrapped the project's description into a tower;
 * this is the same listing as one line per file, the Topics list's row.
 */
const SHIP = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const CATH = 'a8a7d739dda599143ec2e88a1c3b2d69808cd2a50001179c786f51d00dc3c697'
const PROJECT = `30850:${SHIP}:0ebd5fdd-c58a-416e-b8a7-cbdcec77b77f`
const ISSUE = `30851:${SHIP}:d68a8c78-5ec7-4652-b236-89ab57ac5b1e`
const TOPIC = `30840:${CATH}:0f7d2c1e-2b0a-4a25-9a2a-1a2b3c4d5e6f`

const file = (over: Partial<ForeignObject>): ForeignObject =>
  ({
    naddr: 'naddr1x',
    eventId: 'e'.repeat(64),
    widget: 'card',
    slots: {},
    meta: [],
    comments: [],
    actions: [],
    viaRecommendation: false,
    ...over,
  }) as unknown as ForeignObject

const project = file({
  ref: PROJECT,
  address: PROJECT,
  kind: 30850,
  appName: 'Estiva Ship',
  slots: { title: { value: 'Folders: navigation for the whole suite' } },
})
const issue = file({
  ref: ISSUE,
  address: ISSUE,
  kind: 30851,
  appName: 'Estiva Ship',
  parentRef: PROJECT,
  slots: { title: { value: 'The file route: /topic/<address> opens any file in three panes' } },
})
const topic = file({
  ref: TOPIC,
  address: TOPIC,
  kind: 30840,
  appName: 'File',
  slots: { title: { value: 'Folders: Universal navigation concept' } },
})

const listing = (files: ForeignObject[]) => ({
  id: '85db5b59-9e49-4ea1-8e93-3d2a2d78c048',
  name: 'Folders',
  hasState: true,
  source: 'state' as const,
  files,
})

const meta = {
  title: 'Folders/FileTreeView',
  component: FileTreeView,
  args: { onSelect: () => {} },
  decorators: [
    Story => (
      <div className="w-[290px] bg-bg-surface px-3 py-2">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FileTreeView>

export default meta
type Story = StoryObj<typeof meta>

/** The open file's parent expanded, the file itself highlighted. */
export const Default: Story = {
  args: {
    state: listing([project, issue, topic]),
    selectedRef: ISSUE,
    expand: [PROJECT],
  },
}

/** Collapsed: a project row with its chevron, a topic beside it. */
export const Collapsed: Story = {
  args: { state: listing([project, issue, topic]), selectedRef: TOPIC },
}

export const Loading: Story = {
  args: { state: 'loading' },
}

/** A refused read is not an empty Folder. */
export const Unreadable: Story = {
  args: { state: { failed: 'not_a_member' } },
}
