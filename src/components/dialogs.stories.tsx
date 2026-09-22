import type { Meta, StoryObj } from '@storybook/react-vite'
import type { FolderSummary, ForeignObject } from '@estiva-app/interop'
import { PEOPLE, PeekDataProvider } from '@/api'
import { AddToOpenWorkDialog } from './AddToOpenWorkDialog'
import { ConfirmDelete } from './ConfirmDelete'
import { CreateTopicDialog } from './CreateTopicDialog'
import { MembersDialog } from './MembersDialog'
import { MoveFileDialog } from './MoveFileDialog'
import { ResolveDialog } from './ResolveDialog'
import { StartTopicDialog } from './StartTopicDialog'

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
