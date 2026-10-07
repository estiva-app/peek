import type { Meta, StoryObj } from '@storybook/react-vite'
import { MemoryRouter } from 'react-router-dom'
import type { ForeignObject } from '@estiva-app/interop'
import { PeekDataProvider } from '@/api'
import { OverviewPanel } from './OverviewPanel'
import { FileActivityPanelView } from './FileActivityPanel'
import type { TopicActivityItem } from './TopicActivity'

/**
 * A file's third column while no thread is open: its Overview (Katerina,
 * 7 October). Another app's card when the file is that app's (FOL-29), its
 * long description cut behind "Show more", and Activity under it, with its
 * empty line when nobody has named the file. Opening a thread replaces the
 * whole column; closing it brings this back.
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
  title: 'Folders/OverviewPanel',
  component: OverviewPanel,
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
} satisfies Meta<typeof OverviewPanel>

export default meta
type Story = StoryObj<typeof meta>

const labels = new Map([['30840:aa:roadmap', 'Roadmap']])
const activity = (items: TopicActivityItem[]) => <FileActivityPanelView items={items} labelFor={labels} />

/** A Ship issue: its title is the link into Ship, its status and assignee are the manifest's controls; nobody has named it yet. */
export const Issue: Story = { args: { activity: activity([]) } }

/** A Ship project: the same card, with the description its manifest gives the subtitle. */
export const Project: Story = { args: { file: project, activity: activity([]) } }

const LONG = Array.from({ length: 14 }, (_, i) =>
  `Part ${i + 1}. What this project delivers, who it is for, and what it leaves for later, written out in full the way a real brief is.`,
).join(' ')
const longProject: ForeignObject = { ...project, slots: { ...project.slots, subtitle: { value: LONG } } }

/** A description longer than the card allows: cut behind a fade, "Show more" under it, the controls and Activity still in view. */
export const ALongDescription: Story = { args: { file: longProject, activity: activity([MENTION]) } }

/** A comment elsewhere named the issue: Activity, with its count beside the title. */
export const WithActivity: Story = { args: { activity: activity([MENTION]) } }

/** A file Peek owns, that others have named: no card, Activity alone. */
export const PeekFileWithMentions: Story = { args: { file: undefined, activity: activity([MENTION]) } }

/** A file Peek owns that nobody has named, shown by the header's button: Activity's empty line. */
export const PeekFileNothingYet: Story = { args: { file: undefined, activity: activity([]) } }
