import type { Meta, StoryObj } from '@storybook/react-vite'
import { MemoryRouter } from 'react-router-dom'
import type { ForeignObject } from '@estiva-app/interop'
import { PeekDataProvider } from '@/api'
import { FileWidgetPanel } from './FileWidgetPanel'
import { FileActivityPanelView } from './FileActivityPanel'
import type { TopicActivityItem } from './TopicActivity'

/**
 * A file page's third column while no thread is open, for a file another app
 * owns (FOL-29): the owning app's widget, and under it the Activity when
 * there is any. Opening a thread replaces the whole column; closing it brings
 * this back. A bare file draws nothing here — the page hands the column
 * nothing, so there is no empty state to show.
 *
 * The object is handed in already resolved, as the page hands it: the widget
 * makes no read of its own here, and the controls it draws would land on the
 * relay in the app.
 */
const SHIP = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const PERSON = 'a8a7d739dda599143ec2e88a1c3b2d69808cd2a50001179c786f51d00dc3c697'
const PROJECT = `30850:${SHIP}:0ebd5fdd-c58a-416e-b8a7-cbdcec77b77f`
const ISSUE = `30851:${SHIP}:fea8e059-d6cc-4d02-8e1b-3b788946cf79`

const issue: ForeignObject = {
  ref: ISSUE,
  address: ISSUE,
  eventId: 'e'.repeat(64),
  naddr: 'naddr1qqjxxcny8yexydp495enjces956x2vec95uk2ety94nxydeexc6nver9xycrz',
  kind: 30851,
  widget: 'card',
  appName: 'Estiva Ship',
  parentRef: PROJECT,
  slots: {
    title: { value: "A non-Peek file's widget lives in the right pane while no thread is open", field: 'title' },
    subtitle: { value: 'FOL-29' },
    status: { label: 'Status', value: 'In Progress', colour: 'blue', field: 'status' },
  },
  meta: [{ label: 'Assignee', value: PERSON, isPubkey: true, field: 'assignee' }],
  people: { [PERSON]: { displayName: 'Amie Miles' } },
  comments: [],
  folder: '05bebd5b-b699-4bd4-af50-f5377df0fd67',
  openUrl: 'https://ship.estiva.app/issue/fol-29',
  actions: [
    {
      id: 'set-status',
      label: 'Change status',
      control: 'select',
      field: 'status',
      current: 'in_progress',
      options: [
        { value: 'todo', label: 'Todo' },
        { value: 'in_progress', label: 'In Progress' },
        { value: 'done', label: 'Done' },
        { value: 'cancelled', label: 'Cancelled' },
      ],
    },
    { id: 'assign-issue', label: 'Assign', control: 'pubkey', field: 'assignee', current: PERSON },
  ],
  viaRecommendation: true,
}

const project: ForeignObject = {
  ...issue,
  ref: PROJECT,
  address: PROJECT,
  kind: 30850,
  parentRef: undefined,
  slots: {
    title: { value: 'Folders: navigation for the whole suite', field: 'title' },
    subtitle: { value: 'One tree of Folders replaces the Topics list; every file opens in the same three panes.' },
    status: { label: 'Status', value: 'In Progress', colour: 'blue', field: 'status' },
  },
  meta: [],
  openUrl: 'https://ship.estiva.app/project/folders',
  actions: [
    {
      id: 'set-status',
      label: 'Change status',
      control: 'select',
      field: 'status',
      current: 'in_progress',
      options: [
        { value: 'planned', label: 'Planned' },
        { value: 'in_progress', label: 'In Progress' },
        { value: 'completed', label: 'Completed' },
      ],
    },
  ],
}

/** One mention elsewhere, for the column with both parts. */
const MENTION: TopicActivityItem = {
  relation: 'mention',
  about: '30840:aa:roadmap',
  href: '/topic/30840:aa:roadmap?thread=m1',
  conv: {
    id: 'm1',
    authorName: 'Miky',
    timestamp: '11:08 AM',
    body: 'Same three panes for every file — nostr:naddr1… is the one that draws the widget.',
    nostrReferences: [ISSUE],
  },
}

const meta = {
  title: 'Messages/FileWidgetPanel',
  component: FileWidgetPanel,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <MemoryRouter>
        <PeekDataProvider>
          {/* The third column, copied from `AppShell`: `w-[380px]`, where a thread would otherwise open. */}
          <div className="w-[380px] h-[560px] flex flex-col bg-bg-base">
            <Story />
          </div>
        </PeekDataProvider>
      </MemoryRouter>
    ),
  ],
  args: { file: issue },
} satisfies Meta<typeof FileWidgetPanel>

export default meta
type Story = StoryObj<typeof meta>

/** A Ship issue: its title is the link into Ship, its status and assignee are the manifest's controls. */
export const Issue: Story = {}

/** A Ship project: the same card, with the description its manifest gives the subtitle. */
export const Project: Story = { args: { file: project } }

/** The widget over Activity: a file another app owns that a comment elsewhere has named. */
export const WithActivity: Story = {
  render: (args) => (
    <>
      <FileWidgetPanel {...args} />
      <FileActivityPanelView items={[MENTION]} labelFor={new Map([['30840:aa:roadmap', 'Roadmap']])} />
    </>
  ),
}
