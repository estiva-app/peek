import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { PeekDataProvider } from '@/api'
import type { ForeignObject } from '@estiva-app/interop'
import { RECORDED_SHIP_ISSUE as recorded } from '@/api/fixtures'
import type { DraftStore } from '@/lib/drafts'
import { ClosedBox, ConversationBox, type SendAnswer } from './ConversationBox'

/**
 * Peek's comment box, the package's `CommentBox` with what only Peek knows
 * (PEEKM-3). The box's own behaviour — keys, drafts, files, a refusal — is
 * the package's, proved in its stories; these show Peek's parts: its `/`
 * rows, its chips and its card under the box.
 *
 * The `/` menu and the selection strip hang above the caret, as in the app
 * where the box sits at the bottom of a topic, so the box sits at the bottom
 * of a tall box here too.
 */
const meta = {
  title: 'Writing & text/Composer/ConversationBox',
  component: ConversationBox,
  decorators: [
    // The upload actions come from the seam's context.
    (Story) => (
      <PeekDataProvider>
        <div className="flex min-h-[520px] w-[560px] items-end">
          <div className="w-full">
            <Story />
          </div>
        </div>
      </PeekDataProvider>
    ),
  ],
  args: {
    onSend: async (): Promise<SendAnswer> => ({ accepted: true }),
  },
} satisfies Meta<typeof ConversationBox>

export default meta
type Story = StoryObj<typeof meta>

/** A store holding one draft, for a story that opens with words in the box. */
const draftOf = (text: string): DraftStore => ({
  read: () => text,
  readDraft: () => ({ text }),
  write: () => {},
  clear: () => {},
})

const RESOLVED = { [recorded.naddr]: recorded.object as unknown as ForeignObject }

/** A topic's box: `/` opens Format, then Insert with Peek's Resolve and Highlights after the triggers. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const editor = canvasElement.querySelector('.ProseMirror') as HTMLElement
    await userEvent.click(editor)
    await userEvent.keyboard('/')
    // The menu portals to the body, so query the document rather than the canvas.
    const body = within(canvasElement.ownerDocument.body)
    await expect(await body.findByText('Format')).toBeInTheDocument()
    await expect(body.getByText('Resolve')).toBeInTheDocument()
    await expect(body.getByText('Insight')).toBeInTheDocument()
  },
}

/** A thread's box: the "Reply..." placeholder. */
export const Reply: Story = {
  args: { kind: 'reply', contextLabel: 'Reply to Katerina' },
}

/**
 * Another app's object in the text — an issue the launcher created, a pasted
 * address, a draft coming back (UIG-40): the sent message's chip, its title
 * and its status. The one file it links gets its card under the box, as it
 * will be sent, and ✕ takes it off (4136f999).
 */
export const WithAnIssue: Story = {
  args: {
    draftKey: 'story-with-an-issue',
    drafts: draftOf(`Filed it for Thursday: nostr:${recorded.naddr} `),
    resolvedObjects: RESOLVED,
  },
}

/** A line that is only the link draws as its row while it is written, as the sent message will, and its card waits under the box. */
export const AnIssueAloneOnItsLine: Story = {
  args: {
    draftKey: 'story-issue-alone',
    drafts: draftOf(`Words on the line above the link.\nnostr:${recorded.naddr}`),
    resolvedObjects: RESOLVED,
  },
}

/** A send the relay refused: the words back in the box, and the line under it saying why — no toast (Decided 2026-10-17). */
export const Refused: Story = {
  args: {
    draftKey: 'story-refused',
    drafts: draftOf('Can we move the review to Friday?'),
    onSend: async () => ({ accepted: false, reason: 'blocked: you are not a member of this Folder' }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Send' }))
    await expect(await canvas.findByText(/blocked: you are not a member of this Folder/)).toBeInTheDocument()
    await expect(canvas.getByText('Can we move the review to Friday?')).toBeInTheDocument()
  },
}

/** An archived file: the line in the box's place, and no box (Decided 2026-10-17). */
export const Archived: Story = {
  render: () => <ClosedBox reason="Archived. Unarchive it to comment." />,
}
