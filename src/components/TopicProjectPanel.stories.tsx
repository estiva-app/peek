import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ForeignObject, FolderProject } from '../../interop/projection'
import { TopicProjectPanelView } from './TopicProjectPanel'

/**
 * The Files panel — the linked project beside a topic, and its tickets.
 *
 * The panel reads another app's objects off the relay, so the live component
 * cannot run here. `TopicProjectPanelView` is the half that only takes what it
 * was given, which is what these stories drive.
 *
 * Nothing here knows it is looking at Ship. Peek renders whatever the owning
 * app's manifest declares — a title, a status, some properties, a list of
 * tickets — which is why every value below arrives as a `slot` rather than a
 * named field.
 *
 * Controls are deliberately absent from most stories: without `onAct` the panel
 * renders properties as values rather than pickers, which is how it reads for
 * somebody who cannot change them.
 */
const person = 'a8a7d739dda599143ec2e88a1c3b2d69808cd2a50001179c786f51d00dc3c697'

/**
 * Who that key belongs to, resolved from their kind:0 alongside the object.
 *
 * The name is a demo person's on purpose: `Avatar` falls back to the seeded
 * portraits when the relay holds no picture, so a story written this way shows
 * a real face instead of a silhouette — which is the thing worth looking at
 * here.
 */
const people = { [person]: { displayName: 'Amie Miles' } }

const object = (
  id: string,
  title: string,
  status: string,
  colour: string,
  extra: Partial<ForeignObject> = {},
): ForeignObject =>
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
      /*
       * Ship maps `subtitle` to the issue's *content*, not to its key. This
       * fixture said otherwise, and that guess is what filled the key column
       * with descriptions in production while Storybook looked right
       * (2026-08-20).
       */
      subtitle: { value: `Reported while reviewing ${title.toLowerCase()}.` },
      status: { label: 'Status', value: status, colour, field: 'status' },
    },
    /*
     * `ref` first and unlabelled — that is the key, FEE-1. The labelled entries
     * are properties. Verbatim from Ship's manifest, whose issue projection
     * declares `meta: [{tag: 'ref'}, {label: 'Assignee', as: 'pubkey'}]`.
     *
     * The whole pubkey too, as a slot really carries it — abbreviating it in
     * the fixture is what let a truncated key look correct here for so long.
     */
    meta: [
      { value: id.toUpperCase(), field: 'ref' },
      { label: 'Assignee', value: person, isPubkey: true, field: 'assignee' },
    ],
    people,
    comments: [],
    folder: 'b1d2c3e4-5f60-4718-a93a-4b5c6d7e8f90',
    /*
     * Tickets carry a link into the owning app, from the manifest's `web` tag —
     * that is what makes a row clickable. Without it the row renders as plain
     * text, which is not a state Ship produces and left the clickable row
     * untested here.
     */
    openUrl: `https://ship.estiva.app/#/issue/${id}`,
    actions: [],
    viaRecommendation: true,
    ...extra,
  }) as ForeignObject

const project = object('fee', 'Feedback on Peek', 'In Progress', 'blue', {
  kind: 30850,
  widget: 'card',
  /*
   * No subtitle. Ship gives an *issue* a key like FEE-1, which is worth showing
   * under its title; a project has a title and a description, and inventing a
   * short code for one put a label in this story that no project has.
   */
  slots: {
    title: { value: 'Feedback on Peek', field: 'title' },
    status: { label: 'Status', value: 'In Progress', colour: 'blue', field: 'status' },
  },
  meta: [{ label: 'Lead', value: person, isPubkey: true, field: 'lead' }],
  people,
  openUrl: 'https://ship.estiva.app/#/project/fee',
})

const full: FolderProject = {
  project,
  tickets: [
    object('fee-1', 'Assignee avatar and full name is missing in files panel', 'In Progress', 'blue'),
    object('fee-2', 'Reference widget will not show up in some cases', 'Todo', 'neutral'),
    object('fee-3', 'Reference widget missing skeleton on load', 'Done', 'green'),
    object('pee-1', 'It is not possible to select a different assignee', 'Todo', 'neutral'),
    object('pee-2', 'Editing / renaming topics', 'Cancelled', 'muted'),
  ],
  openCount: 3,
  doneCount: 1,
}

const meta = {
  title: 'Topics/Files panel',
  component: TopicProjectPanelView,
  parameters: { layout: 'fullscreen' },
  decorators: [
    /**
     * The real column, copied from `AppShell`: `w-[380px]`, its own left border,
     * a flex *column*, and full viewport height. Guessing at those numbers gives
     * a panel that reads correctly here and cramped in the app — the wrapping of
     * a ticket title is decided by that width, so it has to be the true one.
     */
    (Story) => (
      <div className="h-screen shrink-0 w-[380px] border-l border-border-subtle flex flex-col overflow-hidden">
        <Story />
      </div>
    ),
  ],
  args: { folderProject: full },
} satisfies Meta<typeof TopicProjectPanelView>

export default meta
type Story = StoryObj<typeof meta>

/** A project with work in every state, which is the normal case. */
export const WithTickets: Story = {}

/**
 * Reading the relay, which is a round trip and can be slow.
 *
 * Two bars rather than a mimic of the layout: the panel cannot know how many
 * tickets are coming, and a placeholder that guesses wrong is worse than one
 * that plainly says "reading".
 */
export const Loading: Story = {
  args: { folderProject: 'loading' },
}

/**
 * **The common state, and worth designing carefully.** Most topics have no
 * project attached, so this is what the panel usually looks like — not an
 * error, just an offer not yet taken up.
 */
export const NoProject: Story = {
  args: { folderProject: null },
}

/** A project created but not yet filled — the first thing anyone sees after linking one. */
export const NoTickets: Story = {
  args: { folderProject: { project, tickets: [], openCount: 0, doneCount: 0 } },
}

/** Everything finished. The count is what says so; the list looks otherwise ordinary. */
export const AllDone: Story = {
  args: {
    folderProject: {
      project,
      tickets: [
        object('fee-1', 'Assignee avatar and full name is missing', 'Done', 'green'),
        object('fee-2', 'Reference widget will not show up', 'Done', 'green'),
      ],
      openCount: 0,
      doneCount: 2,
    },
  },
}

/**
 * With controls, as somebody who can change things sees it.
 *
 * Passing `onAct` turns the project's properties from values into pickers — and
 * the labels step aside, because a status pill beside a status picker is one
 * fact rendered twice.
 */
export const WithControls: Story = {
  args: {
    folderProject: {
      ...full,
      project: {
        ...project,
        actions: [
          {
            id: 'set-status',
            label: 'Status',
            control: 'select',
            field: 'status',
            // Ship's own vocabulary, from `ship/src/kinds.ts` — the manifest
            // publishes these verbatim, so inventing labels here would design
            // against statuses no project can be in.
            current: 'in_progress',
            options: [
              { value: 'planned', label: 'Planned' },
              { value: 'in_progress', label: 'In Progress' },
              { value: 'completed', label: 'Completed' },
              { value: 'cancelled', label: 'Cancelled' },
            ],
          },
          // `current` is who holds it now. The control both reports and sets
          // the lead, so this is the *only* place the lead appears once a
          // viewer can act — and it is what FEE-1 found showing a key.
          { id: 'set-lead', label: 'Assign', control: 'pubkey', field: 'lead', current: person },
        ],
      },
    },
    onAct: () => {},
  },
}

/**
 * A lead nobody has published a name for.
 *
 * Rare — Estiva ID writes a profile at signup — but it must not put the key
 * back on screen when it happens. The silhouette says there *is* somebody here
 * and the em dash says we cannot name them, which is the same mark this panel
 * already uses for a property with no value.
 */
export const LeadWithoutProfile: Story = {
  args: {
    folderProject: { ...full, project: { ...project, people: {} } },
  },
}

/**
 * **Nobody leads it yet** — the same control with no face to show.
 *
 * The one place words are still needed: a silhouette cannot say "press this to
 * take it". Once someone holds it the control becomes their face and name, as
 * in the story above.
 */
export const NoLeadYet: Story = {
  args: {
    ...WithControls.args,
    folderProject: {
      ...full,
      project: {
        ...project,
        meta: [],
        // "Assign", not "Lead": the label is the verb the control performs, and
        // the property column beside it already says which field that is.
        actions: [{ id: 'set-lead', label: 'Assign', control: 'pubkey', field: 'lead' }],
      },
    },
  },
}

/** A change in flight: the control is held until the relay confirms it. */
export const Acting: Story = {
  args: { ...WithControls.args, actingOn: project.ref },
}

/** The relay refused a change, and the panel says which one rather than reverting quietly. */
export const ActionFailed: Story = {
  args: {
    ...WithControls.args,
    errors: { [project.ref]: 'Not a member of this Folder.' },
  },
}

/** Long titles, to check they wrap rather than shoving the status out of the row. */
export const LongTitles: Story = {
  args: {
    folderProject: {
      ...full,
      tickets: [
        object(
          'fee-9',
          'Reference widget will not show up when a message carrying an a tag is edited to add a second reference',
          'Todo',
          'neutral',
        ),
        object('fee-8', 'Short one', 'Done', 'green'),
      ],
    },
  },
}
