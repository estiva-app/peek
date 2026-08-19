import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ForeignObject } from '../../../convex/nostr/projection'
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
const issue: ForeignObject = {
  address: '30851:a8a7d739dda599143ec2e88a1c3b2d69808cd2a50001179c786f51d00dc3c697:fee-1',
  naddr: 'naddr1qqjxxcny8yexydp495enjces956x2vec95uk2ety94nxydeexc6nver9xycrz',
  kind: 30851,
  widget: 'card',
  appName: 'Estiva Ship',
  slots: {
    title: { value: 'Assignee avatar and full name is missing in files panel', field: 'title' },
    subtitle: { value: 'FEE-1' },
    status: { label: 'Status', value: 'Todo', colour: 'neutral', field: 'status' },
  },
  meta: [{ label: 'Assignee', value: 'a8a7d739…', isPubkey: true, field: 'assignee' }],
  comments: [],
  folder: 'b1d2c3e4-5f60-4718-a93a-4b5c6d7e8f90',
  openUrl: 'https://ship.estiva.app/#/issue/fee-1',
  actions: [
    {
      id: 'set-status',
      label: 'Change status',
      control: 'select',
      field: 'status',
      current: 'todo',
      options: [
        { value: 'todo', label: 'Todo' },
        { value: 'doing', label: 'Doing' },
        { value: 'done', label: 'Done' },
      ],
    },
    { id: 'assign-issue', label: 'Assign', control: 'pubkey', field: 'assignee' },
  ],
  // The author's own NIP-89 recommendation named the handler, rather than Peek
  // guessing one from the kind.
  viaRecommendation: true,
}

const meta = {
  title: 'Messages/Reference widget',
  component: ForeignObjectCard,
  parameters: { layout: 'padded' },
  // Required props, so a story can be pure `render`.
  args: { object: issue },
} satisfies Meta<typeof ForeignObjectCard>

export default meta
type Story = StoryObj<typeof meta>

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

/** Resolved: what a Ship issue looks like once Peek has read it. */
export const Resolved: Story = {
  args: { object: issue, onAct: () => {} },
}

/**
 * Read-only — no controls, because none were passed.
 *
 * This is the Files panel's rendering. Note the status and assignee labels come
 * back: with no picker to defer to, the card states the facts itself.
 */
export const ReadOnly: Story = {
  args: { object: issue },
}

/** Mid-action: the control is disabled until the relay confirms. */
export const Busy: Story = {
  args: { object: issue, onAct: () => {}, busy: true },
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
