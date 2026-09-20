import type { Meta, StoryObj } from '@storybook/react-vite'
import type { FolderProject, FolderSummary, ForeignObject } from '@estiva-app/interop'
import { PEOPLE, PeekDataProvider, type RenameOutcome } from '@/api'
import { AddToOpenWorkDialog } from './AddToOpenWorkDialog'
import { ConfirmDelete } from './ConfirmDelete'
import { CreateTopicDialog } from './CreateTopicDialog'
import { MembersDialog } from './MembersDialog'
import { MoveFileDialog } from './MoveFileDialog'
import { ResolveDialog } from './ResolveDialog'
import { StartTopicDialog } from './StartTopicDialog'
import { TopicDetailsDialogView, type TopicDetails } from './TopicDetailsDialog'

/**
 * Every dialog Peek opens, on one page — the shape Ship's `Overlays/Dialogs`
 * uses, and the one Katerina asked for on 20 September. Each is built from the
 * shared `DialogShell`, its fields and its buttons, and each portals a fixed
 * overlay over the page, so on a Docs page they render in their own frame.
 */
const meta = {
  title: 'Overlays/Dialogs',
  parameters: {
    layout: 'fullscreen',
    docs: { story: { inline: false, height: '560px' } },
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** The seam, for the dialogs that read people or topics through it. */
const throughTheSeam = (children: React.ReactNode) => <PeekDataProvider>{children}</PeekDataProvider>

const noop = () => {}

/* ── ConfirmDelete ──────────────────────────────────────────────────────── */

/**
 * The question before a deletion (D56). The dialog is the package's
 * `ConfirmDialog` — its stories live there; these show Peek's words.
 *
 * A message with replies: the replies are separate events and stay.
 */
export const ConfirmDeleteMessage: Story = {
  render: () => <ConfirmDelete what="message" replies={2} onConfirm={noop} onClose={noop} />,
}

/** A topic: Peek says so if the relay keeps it. */
export const ConfirmDeleteTopic: Story = {
  render: () => <ConfirmDelete what="topic" replies={0} onConfirm={noop} onClose={noop} />,
}

/* ── CreateTopicDialog ──────────────────────────────────────────────────── */

/** Empty — the confirm button stays disabled until a title is entered. */
export const CreateTopic: Story = {
  render: () => throughTheSeam(<CreateTopicDialog onConfirm={noop} onCancel={noop} />),
}

/** Pre-filled title + invitees — confirm enabled. */
export const CreateTopicPrefilled: Story = {
  render: () =>
    throughTheSeam(
      <CreateTopicDialog
        defaultTitle="Async export performance"
        defaultInvitees={[PEOPLE[0], PEOPLE[2]]}
        onConfirm={noop}
        onCancel={noop}
      />,
    ),
}

/**
 * Started from a DM: the warning-bordered privacy banner explains the DM becomes a
 * private huddle inside the new (public) topic.
 */
export const CreateTopicFromADm: Story = {
  render: () =>
    throughTheSeam(
      <CreateTopicDialog
        defaultInvitees={[PEOPLE[0]]}
        dmContext={{ participants: [PEOPLE[0]] }}
        onConfirm={noop}
        onCancel={noop}
      />,
    ),
}

/* ── MembersDialog ──────────────────────────────────────────────────────── */

const memberNames = ['You', 'Alice Johnson', 'Jake Walter', 'Zack Bright', 'Amie Miles']

/** Opened from the members pill: the roster with the "Add members" row on top
 *  (the viewer is a member). Clicking it slides to the add layer. */
export const Members: Story = {
  render: () => throughTheSeam(<MembersDialog memberNames={memberNames} canAdd onInvite={noop} onClose={noop} />),
}

/** As a non-member: read-only roster — the add affordance lives behind the
 *  Join banner instead (capability rule). */
export const MembersAsNonMember: Story = {
  render: () => throughTheSeam(<MembersDialog memberNames={memberNames} onInvite={noop} onClose={noop} />),
}

/** The add layer (also where the empty-topic banner lands directly): back
 *  arrow returns to the roster; suggestions appear only once you type. */
export const MembersAddLayer: Story = {
  render: () =>
    throughTheSeam(
      <MembersDialog memberNames={memberNames} canAdd initialView="add" onInvite={noop} onClose={noop} />,
    ),
}

/* ── ResolveDialog ──────────────────────────────────────────────────────── */

/**
 * Resolve a conversation with an optional outcome message. The textarea starts empty;
 * type an outcome (or leave it blank to resolve with no message).
 */
export const Resolve: Story = {
  parameters: { docs: { story: { inline: false, height: '440px' } } },
  render: () => <ResolveDialog onResolve={noop} onCancel={noop} />,
}

/* ── AddToOpenWorkDialog ────────────────────────────────────────────────── */

/**
 * The Desk "+" picker: topics not already in Open work, unresolved first,
 * multi-selected via checkboxes (click anywhere on a row). The primary
 * button stays disabled until something is selected and counts the picks.
 */
export const AddToOpenWork: Story = {
  render: () => throughTheSeam(<AddToOpenWorkDialog onAdd={noop} onClose={noop} />),
}

/* ── StartTopicDialog and MoveFileDialog ────────────────────────────────── */

const SHIP = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const HERE = '85db5b59-9e49-4ea1-8e93-3d2a2d78c048'

/** One Ship project, standing in for the file a topic starts under or moves. */
const shipProject = {
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

/**
 * Starting a topic — a bare file, SPEC §6.7 (RFC 0.5 §10.7).
 *
 * Two cases shape the component and both are here: a topic at the top of a
 * Folder, and a topic started from a row, which sits *under* that file. The
 * second names the parent and its app, because "under" has a consequence the
 * person should hear before they type — the owning app shows the topic on that
 * file's page as related.
 *
 * A topic at the top of the Folder — no parent, no `a` tag.
 */
export const StartTopicInAFolder: Story = {
  render: () => <StartTopicDialog folderName="Folders" onCreate={async () => true} onClose={noop} />,
}

/**
 * Started from a Ship project's row. The dialog names the parent and says what
 * follows from it, because a person choosing "under" is choosing where Ship
 * will show it too.
 */
export const StartTopicUnderAFile: Story = {
  render: () => (
    <StartTopicDialog folderName="Folders" parent={shipProject} onCreate={async () => true} onClose={noop} />
  ),
}

/**
 * Choosing where a file is filed (RFC 0.4 §2 — a Folder is an association, so
 * moving is re-associating).
 *
 * The fixture keeps the two cases that shape the component: a workspace with
 * several Folders, one of which is where the file already is and therefore is
 * not offered; and a workspace with only one, where there is nowhere to move to
 * and the dialog says that instead of offering an empty picker.
 */
const folders: FolderSummary[] = [
  { id: HERE, name: 'Folders' },
  { id: '2303e8c1-c866-43b8-9b4c-e263f313a683', name: 'Feedback on Peek' },
  { id: 'a1b2c3d4-0000-4000-8000-000000000001', name: 'Performance & infrastructure' },
  // No name: a Folder with no state event carries only its channel's, and a
  // channel an app created may have none. The id is what a reader gets.
  { id: 'a1b2c3d4-0000-4000-8000-000000000002' },
] as FolderSummary[]

/**
 * The ordinary case. "Folders" is where the file is now, so it is absent from
 * the picker — an action that cannot do anything is not offered.
 */
export const MoveFilePickADestination: Story = {
  render: () => (
    <MoveFileDialog file={shipProject} from={HERE} folders={folders} onMove={async () => true} onClose={noop} />
  ),
}

/** A Folder with no name is offered by its id rather than left out. */
export const MoveFileUnnamedFolders: Story = {
  render: () => (
    <MoveFileDialog
      file={shipProject}
      from={HERE}
      folders={folders.slice(2)}
      onMove={async () => true}
      onClose={noop}
    />
  ),
}

/**
 * Nowhere to go, said rather than shown as an empty picker.
 *
 * Reachable whenever the only Folder is the one you are in, which is every
 * workspace on its first day.
 */
export const MoveFileNowhereToMoveIt: Story = {
  render: () => (
    <MoveFileDialog file={shipProject} from={HERE} folders={[folders[0]!]} onMove={async () => true} onClose={noop} />
  ),
}

/**
 * The write was refused, so the dialog stays open.
 *
 * `onMove` resolving false is the contract `ConfirmDialog` and `EditableText`
 * use too: the caller has already said why — a toast, here — and closing would
 * throw that away along with the chosen destination.
 */
export const MoveFileRefused: Story = {
  render: () => (
    <MoveFileDialog file={shipProject} from={HERE} folders={folders} onMove={async () => false} onClose={noop} />
  ),
}

/* ── TopicDetailsDialog ─────────────────────────────────────────────────── */

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
 * **TopicDetailsCanRename** with **TopicDetailsReadOnly** below: the difference
 * is one button, and no disabled field anywhere.
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

/**
 * Fixed dates for the older entries and offsets for the recent ones, so the
 * relative labels ("now", "12m", "5h") are actually exercised rather than
 * every row reading as a date.
 */
const HOUR = 60 * 60 * 1000
const ago = (ms: number) => Date.now() - ms

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
    at: ago(5 * HOUR),
    by: 'Katerina Kelepouri',
    subject: 'Reference widget will not show up in some cases',
  },
  { kind: 'joined' as const, at: ago(12 * 60 * 1000), by: 'Juan Foley' },
  { kind: 'renamed' as const, at: ago(20 * 1000), by: 'Katerina Kelepouri', detail: 'Peek feedback', subject: 'Feedback on Peek' },
]

const object = (id: string, title: string, status: string, colour: string): ForeignObject =>
  ({
    ref: `30851:${person}:${id}`,
    address: `30851:${person}:${id}`,
    eventId: 'e'.repeat(64),
    naddr: `naddr1${id}`,
    kind: 30851,
    widget: 'row',
    appName: 'Estiva Ship',
    slots: {
      title: { value: title, field: 'title' },
      // Ship's `subtitle` is the issue's *content*. The key is a `meta` slot —
      // see below.
      subtitle: { value: `Reported while reviewing ${title.toLowerCase()}.` },
      status: { label: 'Status', value: status, colour, field: 'status' },
    },
    // `ref` unlabelled is the key; labelled entries are properties. Ship's
    // manifest declares exactly this shape for an issue.
    meta: [{ value: id.toUpperCase(), field: 'ref' }],
    comments: [],
    people: { [person]: { displayName: 'Amie Miles' } },
    actions: [],
    viaRecommendation: true,
  }) as ForeignObject

const folderProject: FolderProject = {
  project: {
    ...object('fee', 'Feedback on Peek', 'In Progress', 'blue'),
    kind: 30850,
    widget: 'card',
    // A project has a description, not a key — inventing a short code for one
    // put a label in this story that no project has.
    slots: {
      title: { value: 'Feedback on Peek', field: 'title' },
      status: { label: 'Status', value: 'In Progress', colour: 'blue', field: 'status' },
    },
    // A project has a lead, and the dialog was showing none because the fixture
    // carried none — the same fixture gap that hid the truncated key in FEE-1.
    meta: [{ label: 'Lead', value: person, isPubkey: true, field: 'lead' }],
  },
  tickets: [
    object('fee-1', 'Assignee avatar and full name is missing in files panel', 'In Progress', 'blue'),
    object('fee-2', 'Reference widget will not show up in some cases', 'Done', 'green'),
    object('pee-2', 'Editing / renaming topics', 'Todo', 'neutral'),
  ],
  openCount: 2,
  doneCount: 1,
}

const noRename = async (): Promise<RenameOutcome> => null

/** The creator's view: the name has an Edit beside it. */
export const TopicDetailsCanRename: Story = {
  render: () => (
    <TopicDetailsDialogView
      details={details}
      activity={activity}
      folderProject={folderProject}
      onClose={noop}
      onRename={noRename}
    />
  ),
}

/**
 * **Everybody else.**
 *
 * A label, not a disabled field. A greyed-out input says "you could type here
 * but we won't let you" and invites someone to try; a label just says what the
 * name is. No lock, no tooltip, no explanation — "Created this topic" under
 * Katerina already answers who to ask.
 */
export const TopicDetailsReadOnly: Story = {
  render: () => (
    <TopicDetailsDialogView
      details={{ ...details, canRename: false }}
      activity={activity}
      folderProject={folderProject}
      onClose={noop}
      onRename={noRename}
    />
  ),
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
export const TopicDetailsEditing: Story = {
  render: () => (
    <TopicDetailsDialogView
      details={details}
      activity={activity}
      folderProject={folderProject}
      initialEditing
      onClose={noop}
      onRename={noRename}
    />
  ),
}

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
export const TopicDetailsRenameRefused: Story = {
  render: () => (
    <TopicDetailsDialogView
      details={details}
      activity={activity}
      folderProject={folderProject}
      initialEditing
      initialError="Only the person who created a topic can rename it."
      onClose={noop}
      onRename={async () => ({
        kind: 'error' as const,
        message: 'Only the person who created a topic can rename it.',
      })}
    />
  ),
}

/**
 * **Renamed, but not announced.**
 *
 * A different thing from a failure and it must not look like one: the topic
 * *was* renamed, the relay just was not told, so other apps still show the old
 * name. The editor closes because the rename happened, and the note is a
 * warning rather than an error — red under a name that had visibly changed
 * read as "this failed" (Katerina, 2026-08-20).
 */
export const TopicDetailsRenamedButNotAnnounced: Story = {
  render: () => (
    <TopicDetailsDialogView
      details={details}
      activity={activity}
      folderProject={folderProject}
      onClose={noop}
      onRename={async () => ({
        kind: 'warning' as const,
        message: 'Renamed in Peek. Sign in to Estiva ID so other apps see the new name too.',
      })}
    />
  ),
}

/**
 * Long entries, which is the normal case once resolutions carry a message.
 *
 * The text wraps to a second line under itself and the time keeps its column —
 * it never gets pushed off the row or squeezed to a character per line.
 */
export const TopicDetailsLongActivityEntries: Story = {
  render: () => (
    <TopicDetailsDialogView
      details={details}
      folderProject={null}
      activity={[
        activity[0],
        {
          kind: 'resolved',
          at: ago(3 * HOUR),
          by: 'Jan Miky',
          subject:
            'Reference widget will not show up in some cases — specifically when a message is edited after it was sent, or when the conversation was started from Ship',
        },
        {
          kind: 'renamed',
          at: ago(90 * 1000),
          by: 'Katerina Kelepouri',
          detail: 'Feedback',
          subject: 'Feedback on Peek, and everything else we found while reviewing it',
        },
      ]}
      onClose={noop}
      onRename={noRename}
    />
  ),
}

/**
 * A project whose lead nobody has published a profile for.
 *
 * The silhouette and an em dash, never the key — the same rule the Files panel
 * and the reference widget follow (FEE-1).
 */
export const TopicDetailsProjectWithoutLead: Story = {
  render: () => (
    <TopicDetailsDialogView
      details={details}
      activity={activity}
      folderProject={{ ...folderProject, project: { ...folderProject.project, people: {} } }}
      onClose={noop}
      onRename={noRename}
    />
  ),
}

/** A topic with no project attached — the section is absent rather than empty. */
export const TopicDetailsNoProject: Story = {
  render: () => (
    <TopicDetailsDialogView
      details={details}
      activity={activity}
      folderProject={null}
      onClose={noop}
      onRename={noRename}
    />
  ),
}

/** Brand new: created, and nothing else has happened to it yet. */
export const TopicDetailsJustCreated: Story = {
  render: () => (
    <TopicDetailsDialogView
      details={{ ...details, members: [details.members[0]] }}
      activity={[activity[0]]}
      folderProject={null}
      onClose={noop}
      onRename={noRename}
    />
  ),
}

/** Still loading — the dialog opens immediately rather than after a round trip. */
export const TopicDetailsLoading: Story = {
  render: () => (
    <TopicDetailsDialogView
      details={undefined}
      activity={[]}
      folderProject={null}
      onClose={noop}
      onRename={noRename}
    />
  ),
}
