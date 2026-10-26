import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, within } from 'storybook/test'
import { PeekDataProvider } from '@/api'
import { EditBox } from './ConversationBox'

/**
 * Editing a comment or a reply you wrote: the shared box's edit form with
 * Peek's people, `[`, chips and upload (PEEKM-4). The box's own behaviour —
 * the keys, the selection strip, the refusal line — is the package's, proved
 * in its stories; these show what Peek opens it with.
 */
const meta = {
  title: 'Writing & text/Composer/EditBox',
  component: EditBox,
  decorators: [
    // The upload actions come from the seam's context.
    (Story) => (
      <PeekDataProvider>
        <div className="w-[560px]">
          <Story />
        </div>
      </PeekDataProvider>
    ),
  ],
  args: {
    message: { body: 'Found the root cause — the cache key ignored the locale.' },
    onSave: fn(),
    onCancel: fn(),
  },
} satisfies Meta<typeof EditBox>

export default meta
type Story = StoryObj<typeof meta>

/** A message open for editing: only its keys, Cancel and Save; no paperclip (Decided 2026-10-17). */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText(/Found the root cause/)).toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    await expect(canvas.queryByRole('button', { name: /attach/i })).not.toBeInTheDocument()
  },
}

/** A resolved message with a file: the resolution and the file open in the box, and stay unless taken out. */
export const ResolvedWithAFile: Story = {
  args: {
    message: {
      body: 'Found the root cause — the cache key ignored the locale.',
      resolution: { message: 'Fixed in the next build' },
      files: [{ name: 'trace.txt', contentType: 'text/plain', size: 2048 }],
    },
  },
}

/** An edit the relay refused, reopened: what was saved, and why under it. */
export const Refused: Story = {
  args: {
    refused: { text: 'Found the root cause — the cache key ignored the locale and the zone.', reason: 'the relay did not take it' },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('Not saved: the relay did not take it. Your changes are still in the box.')).toBeInTheDocument()
  },
}
