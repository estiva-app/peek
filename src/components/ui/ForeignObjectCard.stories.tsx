import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ForeignObject } from '@estiva-app/interop'
import { ForeignObjectCard, ForeignObjectSkeleton } from './ForeignObjectWidget'

/**
 * A reference to another app's object, rendered inside a Peek message.
 *
 * `ForeignObjectWidget` resolves a `nostr:naddr…` against the relay and then
 * draws one of these. Resolution needs a relay round trip and a token, so it
 * cannot be exercised here — these stories cover the states the card can be in
 * once the answer (or the absence of one) has arrived.
 *
 * Nothing here knows it is looking at Ship. Peek renders what the owning app's
 * NIP-89 manifest declares: a title, a status, some meta, and the controls it
 * says are allowed.
 */
const PERSON = 'a8a7d739dda599143ec2e88a1c3b2d69808cd2a50001179c786f51d00dc3c697'

/**
 * The workspace directory the assignee picker lists (PEE-1) — in the app it
 * comes from `useWorkspaceDirectory` (every published kind:0); here, three
 * demo people so opening the picker shows the real shape: Unassigned first,
 * then faces.
 */
const DIRECTORY = {
  [PERSON]: { displayName: 'Amie Miles' },
  ['b'.repeat(64)]: { displayName: 'Alice Johnson' },
  ['c'.repeat(64)]: { displayName: 'Daniel Stanton' },
}

const issue: ForeignObject = {
  ref: '30851:a8a7d739dda599143ec2e88a1c3b2d69808cd2a50001179c786f51d00dc3c697:fee-1',
  address: '30851:a8a7d739dda599143ec2e88a1c3b2d69808cd2a50001179c786f51d00dc3c697:fee-1',
  eventId: 'e'.repeat(64),
  naddr: 'naddr1qqjxxcny8yexydp495enjces956x2vec95uk2ety94nxydeexc6nver9xycrz',
  kind: 30851,
  widget: 'card',
  appName: 'Estiva Ship',
  slots: {
    title: { value: 'Assignee avatar and full name is missing in files panel', field: 'title' },
    subtitle: { value: 'FEE-1' },
    status: { label: 'Status', value: 'Todo', colour: 'neutral', field: 'status' },
  },
  /*
   * The whole key, as a resolved slot really carries it — the fixture used to
   * hold a pre-truncated one, which made a bug look like the design.
   */
  meta: [{ label: 'Assignee', value: PERSON, isPubkey: true, field: 'assignee' }],
  /*
   * Who that key belongs to, resolved from their kind:0 with the object (FEE-1).
   * A demo person's name on purpose: with no picture on the relay, `Avatar`
   * falls back to the seeded portraits, so the story shows a face rather than a
   * silhouette.
   */
  people: { [PERSON]: { displayName: 'Amie Miles' } },
  comments: [],
  folder: 'b1d2c3e4-5f60-4718-a93a-4b5c6d7e8f90',
  openUrl: 'https://ship.estiva.app/#/issue/fee-1',
  actions: [
    {
      id: 'set-status',
      label: 'Change status',
      control: 'select',
      field: 'status',
      // Ship's issue vocabulary, verbatim from `ship/src/kinds.ts`.
      current: 'todo',
      options: [
        { value: 'todo', label: 'Todo' },
        { value: 'in_progress', label: 'In Progress' },
        { value: 'done', label: 'Done' },
        { value: 'cancelled', label: 'Cancelled' },
      ],
    },
    { id: 'assign-issue', label: 'Assign', control: 'pubkey', field: 'assignee', current: PERSON },
  ],
  // The author's own NIP-89 recommendation named the handler, rather than Peek
  // guessing one from the kind.
  viaRecommendation: true,
}

/** The same issue with nobody on it — the assign control has no face to show. */
const unassigned: ForeignObject = {
  ...issue,
  meta: [],
  actions: issue.actions.map((a) => (a.control === 'pubkey' ? { ...a, current: undefined } : a)),
}

const meta = {
  title: 'Messages/ForeignObject/ForeignObjectCard',
  component: ForeignObjectCard,
  parameters: { layout: 'padded' },
  // Required props, so a story can be pure `render`.
  args: { object: issue },
} satisfies Meta<typeof ForeignObjectCard>

export default meta
type Story = StoryObj<typeof meta>

/**
 * **Assigned** — a Ship issue as Peek renders it, with somebody on it.
 *
 * The person *is* the control: their face and full name, with nothing
 * captioning it. A face beside a name is self-evidently a person, and
 * "Assignee:" in front only repeats the picture. It stays a button, because
 * pressing it is how the assignee changes — and it is where a proper picker
 * will go (PEE-1).
 */
export const Assigned: Story = {
  args: { object: issue, onAct: () => {}, directory: DIRECTORY },
}

/**
 * **With its description** — the issue's body, drawn one step down with every
 * heading, list, quote and code block kept (the package's `RichText`, small:
 * Katerina, 28 September, UIG-30). Another app's text is drawn with its marks
 * and links only, never Peek's chips.
 */
export const WithDescription: Story = {
  args: {
    object: {
      ...issue,
      slots: {
        ...issue.slots,
        body: {
          value: [
            '## What happens',
            '',
            'The files panel shows the assignee as a bare key.',
            '',
            '- the avatar is missing',
            '- the **full name** is missing',
            '',
            '> Seen on every file with somebody on it.',
            '',
            'The row reads `assignee` straight from the tag.',
          ].join('\n'),
          format: 'marker',
        },
      },
    },
    onAct: () => {},
    directory: DIRECTORY,
  },
}

/**
 * **The fix for FEE-3.** While the relay is being asked, the card's shell is
 * drawn at the size the answer will take, so the message does not grow under
 * you when it lands.
 *
 * It holds itself invisible for 150ms first, so a reference that resolves
 * quickly — the common case — never flashes a placeholder at all. If it looks
 * like nothing is happening here, that delay is why.
 */
export const Loading: Story = {
  render: () => <ForeignObjectSkeleton />,
}

/**
 * **Unassigned** — nobody holds it, so there is no face to show.
 *
 * The one case that still needs words: an empty control cannot convey "press
 * this to take it" with a silhouette alone.
 */
export const Unassigned: Story = {
  args: { object: unassigned, onAct: () => {}, directory: DIRECTORY },
}

/**
 * Read-only — no controls, because none were passed.
 *
 * This is a viewer who cannot change anything. The status label comes back —
 * with no picker to defer to, the card states the fact itself — but the
 * assignee is still just a face and a name, unpressable.
 */
export const ReadOnly: Story = {
  args: { object: issue },
}

/** Mid-action: the control is disabled until the relay confirms. */
export const Busy: Story = {
  args: { object: issue, onAct: () => {}, busy: true, directory: DIRECTORY },
}

/** The relay refused the write, and says so rather than pretending it worked. */
export const ActionFailed: Story = {
  args: {
    object: issue,
    onAct: () => {},
    error: 'The relay refused that change: not a member of this Folder.',
  },
}

/** A longer title, to check it wraps rather than pushing the status off the row. */
export const LongTitle: Story = {
  args: {
    object: {
      ...issue,
      slots: {
        ...issue.slots,
        title: {
          value:
            'Reference widget will not show up when a message that already carries an `a` tag is edited to add a second reference',
          field: 'title',
        },
      },
    },
    onAct: () => {},
  },
}

/**
 * A Peek message, attached the way an issue is (RIC-11): a `nostr:nevent…`
 * alone on its line. Its manifest titles it by its author's pubkey, so the
 * title is a person — face and name — and the body is the message. Nothing
 * here says "Peek"; a Ship comment titled the same way would draw the same.
 */
export const PersonTitled: Story = {
  args: {
    object: {
      ...issue,
      ref: 'nevent1msg',
      address: undefined,
      naddr: undefined,
      kind: 9,
      widget: ['message', 'card'],
      appName: 'Peek',
      slots: {
        title: { value: 'a'.repeat(64), isPubkey: true },
        body: { value: 'Green. Leaving the **pin** in place until Monday.' },
      },
      meta: [],
      people: { ['a'.repeat(64)]: { displayName: 'Ada Lovelace' } },
      actions: [],
    },
  },
}
