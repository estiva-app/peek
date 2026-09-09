import type { Meta, StoryObj } from '@storybook/react-vite'
import { ConversationMoreMenu } from './ConversationMoreMenu'
import { ConversationQuickMenu } from './ConversationQuickMenu'

const meta = {
  title: 'Messages/Menus/ConversationQuickMenu',
  component: ConversationQuickMenu,
  args: {
    isResolved: false,
    onReact: () => {},
    onReply: () => {},
    onResolve: () => {},
    onReopen: () => {},
    /* The ⋯ menu owns its own button, so the strip takes the menu rather
       than a callback and the button arrives with it. Press it. */
    more: <ConversationMoreMenu onDelete={() => {}} />,
  },
} satisfies Meta<typeof ConversationQuickMenu>

export default meta
type Story = StoryObj<typeof meta>

/** The hover toolbar on an open conversation card: React · Reply · Resolve · More. */
export const Unresolved: Story = {}

/** Once resolved, the middle action flips to Reopen (dashed circle). */
export const Resolved: Story = {
  args: { isResolved: true },
}

export const BothStates: Story = {
  render: args => (
    <div className="flex items-center gap-6">
      <ConversationQuickMenu {...args} isResolved={false} />
      <ConversationQuickMenu {...args} isResolved={true} />
    </div>
  ),
}
