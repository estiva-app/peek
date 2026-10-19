import type { Meta, StoryObj } from '@storybook/react-vite'
import { PersonItem } from './PersonItem'

const meta = {
  title: 'Frame/PersonItem',
  component: PersonItem,
  args: { id: 'alice', name: 'Alice Johnson', active: false },
  render: (args) => (
    <div className="flex w-72 flex-col">
      <PersonItem {...args} />
    </div>
  ),
} satisfies Meta<typeof PersonItem>

export default meta
type Story = StoryObj<typeof meta>

/** A person: their photo and their name, a link to their page. */
export const Default: Story = {}

/** The one open beside the list. */
export const Active: Story = { args: { active: true } }

/** Something new from them: the dot. */
export const Unread: Story = { args: { unread: true } }

/** New and urgent: the warning badge in the dot's place. */
export const UnreadUrgent: Story = { args: { unread: true, urgent: true } }

/** Hiding can succeed: point at the row and the ⋮ holds "Hide conversation". */
export const WithHide: Story = { args: { onHide: () => {} } }
