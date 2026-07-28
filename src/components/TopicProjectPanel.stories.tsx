import type { Meta, StoryObj } from '@storybook/react-vite'
import type { FolderProject, ForeignObject } from '../../convex/nostr/projection'
import { TopicProjectPanelView } from './TopicProjectPanel'

/**
 * The presentational half only — the container reads a relay, which Storybook
 * has no business doing. Every payload below is the shape `projectForFolder`
 * returns, so what renders here is what renders in the app.
 */
const meta = {
  title: 'Topics/TopicProjectPanel',
  component: TopicProjectPanelView,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="h-screen w-[380px] border-l border-border-subtle bg-bg-surface">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TopicProjectPanelView>

export default meta
type Story = StoryObj<typeof meta>

const openUrl = (id: string) => `http://localhost:5190/linear-lite/#/o/naddr1${id}`

/** The manifest-declared controls a project carries: status, and assignment. */
const projectActions: ForeignObject['actions'] = [
  {
    id: 'set-project-status',
    label: 'Change status',
    control: 'select',
    field: 'status',
    current: 'in_progress',
    options: [
      { value: 'planned', label: 'Planned', colour: 'neutral' },
      { value: 'in_progress', label: 'In Progress', colour: 'blue' },
      { value: 'completed', label: 'Completed', colour: 'green' },
      { value: 'cancelled', label: 'Cancelled', colour: 'muted' },
    ],
  },
  { id: 'assign-project', label: 'Assign', control: 'pubkey', field: 'lead', current: 'b'.repeat(64) },
  // Declared for this kind, and deliberately never drawn: commenting on the
  // project is the conversation this panel sits beside.
  { id: 'comment', label: 'Comment', control: 'text' },
]

const ticket = (id: string, title: string, status = 'In Progress', colour = 'blue'): ForeignObject => ({
  address: `30851:abc:${id}`,
  naddr: `naddr1${id}`,
  kind: 30851,
  widget: 'row',
  appName: 'Linear-lite',
  slots: { title: { value: title }, status: { value: status, colour, field: 'status' } },
  meta: [],
  comments: [],
  actions: [],
  openUrl: openUrl(id),
  viaRecommendation: true,
})

const folderProject = (overrides: Partial<FolderProject> = {}): FolderProject => ({
  project: {
    address: '30850:abc:p1',
    naddr: 'naddr1project',
    kind: 30850,
    widget: 'card',
    appName: 'Linear-lite',
    slots: {
      title: { value: 'Payment integration' },
      subtitle: {
        value: 'Stripe Checkout for workspace billing — redirect flow, no custom card form.',
      },
      status: { value: 'In Progress', colour: 'blue', field: 'status' },
    },
    meta: [{ label: 'Lead', value: 'b'.repeat(64), isPubkey: true, field: 'lead' }],
    comments: [],
    actions: projectActions,
    openUrl: openUrl('project'),
    viaRecommendation: true,
  },
  tickets: [
    ticket('i1', 'Billing entry + add payment method'),
    ticket('i2', 'Webhook signature verification'),
    ticket('i3', 'Retry copy for declined cards', 'Todo', 'neutral'),
    ticket('i4', 'Investigate drop-off spike', 'Done', 'green'),
    ticket('i5', 'Old card-form spike', 'Cancelled', 'muted'),
  ],
  openCount: 3,
  doneCount: 2,
  ...overrides,
})

/** The default state: title, properties, and the ticket count. */
export const Collapsed: Story = {
  args: { folderProject: folderProject() },
}

/** Click "Tickets (3/2)" in the canvas for the table: one row, one ticket. */
export const WithTickets: Story = {
  args: { folderProject: folderProject() },
}

/** A long-running project: every ticket it holds, started work at the top. */
export const ManyTickets: Story = {
  args: {
    folderProject: folderProject({
      tickets: [
        ticket('i1', 'Billing entry + add payment method'),
        ticket('i2', 'Webhook signature verification'),
        ticket('i3', 'Retry copy for declined cards', 'Todo', 'neutral'),
        ticket('i4', 'Proration on plan change', 'Todo', 'neutral'),
        ticket('i5', 'Dunning emails', 'Todo', 'neutral'),
        ticket('i6', 'Tax rates for EU customers', 'Todo', 'neutral'),
        ticket('i7', 'Receipt PDF layout', 'Done', 'green'),
        ticket('i8', 'Investigate drop-off spike', 'Done', 'green'),
        ticket('i9', 'Old card-form spike', 'Cancelled', 'muted'),
      ],
      openCount: 6,
      doneCount: 3,
    }),
  },
}

/**
 * The same project from an app that declares no actions for it.
 *
 * Properties become text: a consumer may only offer what the owner published,
 * and a control that cannot work is worse than none.
 */
export const ReadOnlyProperties: Story = {
  args: {
    folderProject: (() => {
      const value = folderProject()
      value.project = { ...value.project, actions: [] }
      return value
    })(),
  },
}

/** A change in flight: the project's controls are disabled until it lands. */
export const Acting: Story = {
  args: { folderProject: folderProject(), actingOn: 'naddr1project' },
}

/** The relay refused the change. The reason belongs where the click happened. */
export const ActionRefused: Story = {
  args: {
    folderProject: folderProject(),
    errors: { naddr1project: 'Sign in to change another app’s object.' },
  },
}

/** Nothing filed yet: no rows, and no bar claiming 0%. */
export const NoTickets: Story = {
  args: { folderProject: folderProject({ tickets: [], openCount: 0, doneCount: 0 }) },
}

/** Everything finished — the bar full, the queue empty. */
export const AllDone: Story = {
  args: {
    folderProject: folderProject({
      tickets: [ticket('i4', 'Investigate drop-off spike', 'Done', 'green')],
      openCount: 0,
      doneCount: 9,
    }),
  },
}

/** A topic with no linked project. No broken widget, no placeholder noise. */
export const NoProject: Story = {
  args: { folderProject: null },
}

export const Loading: Story = {
  args: { folderProject: 'loading' },
}
