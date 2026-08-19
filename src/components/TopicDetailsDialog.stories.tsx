import type { Meta, StoryObj } from '@storybook/react-vite'
import type { FolderProject, ForeignObject } from '../../convex/nostr/projection'
import { TopicDetailsDialogView, type TopicDetails } from './TopicDetailsDialog'

/**
 * A topic's details, and the only place its name can be changed (PEE-2).
 *
 * Renaming lives in a dialog rather than in the header title for two reasons
 * that a header cannot answer: **who may** and **what if it fails**. Only the
 * topic's creator can rename it — the relay grants a name change to a channel's
 * owner or admin — so most people need to see a name they cannot edit, which a
 * details row does simply by being a label. And when the relay refuses there
 * has to be somewhere to say so; a title in a header has nowhere.
 *
 * Which leaves the dialog needing to be worth opening when you can change
 * nothing at all — hence the members, the project and the history. Compare
 * **CanRename** with **ReadOnly** below: the difference is one button, and no
 * disabled field anywhere.
 */
const person = 'a8a7d739dda599143ec2e88a1c3b2d69808cd2a50001179c786f51d00dc3c697'

const details: TopicDetails = {
  title: 'Feedback on Peek',
  createdAt: Date.parse('2026-08-12T09:20:00Z'),
  createdByName: 'Katerina Kelepouri',
  canRename: true,
  members: [
    { name: 'Katerina Kelepouri', role: 'Product Designer', isCreator: true },
    { name: 'Jan Miky', role: 'Engineering', isCreator: false },
    { name: 'Amie Miles', role: 'Engineering Manager', isCreator: false },
  ],
}

const activity = [
  { kind: 'created' as const, at: Date.parse('2026-08-12T09:20:00Z'), by: 'Katerina Kelepouri' },
  { kind: 'joined' as const, at: Date.parse('2026-08-12T09:24:00Z'), by: 'Jan Miky' },
  {
    kind: 'renamed' as const,
    at: Date.parse('2026-08-14T11:02:00Z'),
    by: 'Katerina Kelepouri',
    detail: 'Feedback',
    subject: 'Feedback on Peek',
  },
  { kind: 'joined' as const, at: Date.parse('2026-08-15T08:10:00Z'), by: 'Amie Miles' },
  {
    kind: 'resolved' as const,
    at: Date.parse('2026-08-18T16:40:00Z'),
    by: 'Jan Miky',
    subject: 'Reference widget will not show up in some cases',
  },
  {
    kind: 'reopened' as const,
    at: Date.parse('2026-08-19T09:05:00Z'),
    by: 'Katerina Kelepouri',
    subject: 'Reference widget will not show up in some cases',
  },
]

const object = (id: string, title: string, status: string, colour: string): ForeignObject =>
  ({
    address: `30851:${person}:${id}`,
    naddr: `naddr1${id}`,
    kind: 30851,
    widget: 'row',
    appName: 'Estiva Ship',
    slots: {
      title: { value: title, field: 'title' },
      status: { label: 'Status', value: status, colour, field: 'status' },
    },
    meta: [],
    comments: [],
    actions: [],
    viaRecommendation: true,
  }) as ForeignObject

const folderProject: FolderProject = {
  project: {
    ...object('fee', 'Feedback on Peek', 'In Progress', 'blue'),
    kind: 30850,
    widget: 'card',
  },
  tickets: [
    object('fee-1', 'Assignee avatar and full name is missing in files panel', 'In Progress', 'blue'),
    object('fee-2', 'Reference widget will not show up in some cases', 'Done', 'green'),
    object('pee-2', 'Editing / renaming topics', 'Todo', 'neutral'),
  ],
  openCount: 2,
  doneCount: 1,
}

const meta = {
  title: 'Topics/Topic details',
  component: TopicDetailsDialogView,
  parameters: { layout: 'fullscreen' },
  args: {
    details,
    activity,
    folderProject,
    onClose: () => {},
    onRename: async (): Promise<string | null> => null,
  },
} satisfies Meta<typeof TopicDetailsDialogView>

export default meta
type Story = StoryObj<typeof meta>

/** The creator's view: the name has an Edit beside it. */
export const CanRename: Story = {}

/**
 * **Everybody else.**
 *
 * A label, not a disabled field. A greyed-out input says "you could type here
 * but we won't let you" and invites someone to try; a label just says what the
 * name is. No lock, no tooltip, no explanation — "Created this topic" under
 * Katerina already answers who to ask.
 */
export const ReadOnly: Story = {
  args: { details: { ...details, canRename: false } },
}

/**
 * Mid-edit.
 *
 * Enter saves and Escape abandons, because a field with buttons under it still
 * gets Enter pressed at it. Save stays unavailable until the name has actually
 * changed — and Buzz strips leading `#` and whitespace before storing, so `###`
 * counts as no name at all rather than failing at the relay.
 *
 * Click Edit to see it.
 */
export const Editing: Story = {}

/**
 * **The relay refused.**
 *
 * The reason is shown under the field and the text you typed is kept, because
 * throwing it away to show you the name you were replacing helps nobody. This
 * is the case a header title could not have handled — there is nowhere in a
 * header to put a sentence.
 *
 * Click Edit, change the name and press Save.
 */
export const RenameRefused: Story = {
  args: {
    onRename: async () => 'The relay refused: only a channel owner or admin can rename it.',
  },
}

/** A topic with no project attached — the section is absent rather than empty. */
export const NoProject: Story = {
  args: { folderProject: null },
}

/** Brand new: created, and nothing else has happened to it yet. */
export const JustCreated: Story = {
  args: {
    folderProject: null,
    activity: [activity[0]],
    details: { ...details, members: [details.members[0]] },
  },
}

/** Still loading — the dialog opens immediately rather than after a round trip. */
export const Loading: Story = {
  args: { details: undefined, activity: [], folderProject: null },
}
