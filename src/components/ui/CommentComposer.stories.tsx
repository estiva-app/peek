import type { Meta, StoryObj } from '@storybook/react-vite'
import { CommentComposer } from './CommentComposer'

const meta = {
  title: 'Primitives/CommentComposer',
  component: CommentComposer,
  args: {
    placeholder: 'Comment on Billing rewrite',
    onSend: async (): Promise<boolean> => true,
  },
} satisfies Meta<typeof CommentComposer>

export default meta
type Story = StoryObj<typeof meta>

/** At the foot of a pane, which is the only place it is ever drawn. */
export const Default: Story = {
  render: args => (
    <div className="flex h-48 w-[380px] flex-col justify-end border border-border-subtle bg-bg-surface">
      <CommentComposer {...args} />
    </div>
  ),
}

/** The reply manner: same component, a placeholder that says what it answers. */
export const InAThread: Story = {
  args: { placeholder: 'Reply to Marta' },
  render: args => (
    <div className="flex h-48 w-[380px] flex-col justify-end border border-border-subtle bg-bg-surface">
      <CommentComposer {...args} />
    </div>
  ),
}

/**
 * A relay that refuses keeps the draft. The composer clears only on `true`, so
 * nothing a person typed is lost to a failed publish.
 */
export const Refused: Story = {
  args: { onSend: async () => false },
  render: args => (
    <div className="flex h-48 w-[380px] flex-col justify-end border border-border-subtle bg-bg-surface">
      <CommentComposer {...args} />
    </div>
  ),
}
