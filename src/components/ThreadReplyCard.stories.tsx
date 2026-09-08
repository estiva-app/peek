import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { PeekDataProvider } from '@/api'
import { ThreadReplyCard } from './ThreadReplyCard'

const meta = {
  title: 'Messages/ThreadReplyCard',
  component: ThreadReplyCard,
  parameters: { layout: 'padded' },
  decorators: [
    Story => (
      <PeekDataProvider>
        <div className="w-[520px]">
          <Story />
        </div>
      </PeekDataProvider>
    ),
  ],
  args: {
    authorName: 'Alice Johnson',
    timestamp: '2:14 PM',
    body: 'Confirmed on my end — the funnel drop is EU-only, matches the identity-service capacity theory.',
  },
} satisfies Meta<typeof ThreadReplyCard>

export default meta
type Story = StoryObj<typeof meta>

/** A resting reply. Hover reveals the react + more quick actions; more → Edit opens the inline editor. */
export const Default: Story = {}

export const WithReactions: Story = {
  args: {
    reactions: [{ emoji: '👍', count: 2, owner: 'others' }],
  },
}

/** A reply can carry a highlight type pill, same as a top-level message. */
export const Highlight: Story = {
  args: { highlightType: 'concern' },
}

/** New (unread) reply — soft blue border + blue dot by the author's name. */
export const New: Story = {
  args: { isNew: true },
}

/**
 * Urgent is a modifier of new: paired together the border and badge go amber.
 * (`isUrgent` without `isNew` renders no chrome — by design.)
 */
export const NewUrgent: Story = {
  args: { isNew: true, isUrgent: true },
}

/**
 * Editing a reply — the second edit box, and the reason `peekEditor.ts` exists.
 *
 * This file and `ConversationCard` are the same edit box written twice
 * (COMPONENTS-PEEK F4), so anything the composer gains has to be written into
 * both or it is only half added. `/` was added to neither. It, the selection
 * toolbar and the highlighter all arrive here from the one shared list, and
 * this story is what proves the second copy actually got them.
 */
async function startEditing(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  const doc = within(canvasElement.ownerDocument.body)
  await userEvent.hover(canvasElement.querySelector('div.relative.rounded-lg') as HTMLElement)
  await userEvent.click(await doc.findByRole('button', { name: 'More actions' }))
  await userEvent.click(await doc.findByText('Edit message'))
  const surface = (await canvas.findByText(/Confirmed on my end/)).closest('.ProseMirror') as HTMLElement
  await userEvent.click(surface)
  return { canvas, doc }
}

/** The box, with the composer's toolbar row under it. */
export const Editing: Story = {
  args: { authorName: 'You' },
  play: async ({ canvasElement }) => {
    const { canvas } = await startEditing(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Highlight' })).toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  },
}

/** `/` in a reply's edit box, opening at the caret like the composer's. */
export const EditingSlashMenu: Story = {
  args: { authorName: 'You' },
  play: async ({ canvasElement }) => {
    const { doc } = await startEditing(canvasElement)
    await userEvent.keyboard(' /')
    await expect(await doc.findByText('Format')).toBeInTheDocument()
    await expect(doc.getByText('Highlights')).toBeInTheDocument()
  },
}

/** Bold, italic, underline and link over a chosen word. */
export const EditingSelectionToolbar: Story = {
  args: { authorName: 'You' },
  play: async ({ canvasElement }) => {
    const { doc } = await startEditing(canvasElement)
    await userEvent.keyboard('{Control>}a{/Control}')
    await expect(await doc.findByRole('button', { name: 'Bold' })).toBeInTheDocument()
    await expect(doc.getByRole('button', { name: 'Link' })).toBeInTheDocument()
  },
}
