import type { Meta, StoryObj } from '@storybook/react-vite'
import { ResolveDialog } from './ResolveDialog'

const noop = () => {}

/**
 * Resolving a conversation, with an optional outcome message.
 */
const meta = {
  title: 'Topics/ResolveDialog',
  component: ResolveDialog,
  parameters: {
    layout: 'fullscreen',
    docs: { story: { inline: false, height: '440px' } },
  },
  args: {
    onResolve: noop,
    onCancel: noop,
  },
} satisfies Meta<typeof ResolveDialog>

export default meta
type Story = StoryObj<typeof meta>

/**
 * The textarea starts empty; type an outcome, or leave it blank to resolve with
 * no message.
 */
export const Default: Story = {}
